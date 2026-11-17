/**
 * Legacy User package → ClientSubscription backfill (Phase 6.5).
 *
 * Dry-run is the default. Write mode requires BOTH:
 *   --execute
 *   --confirm-write
 *
 * Usage:
 *   node scripts/backfill-client-subscriptions.mjs
 *   node scripts/backfill-client-subscriptions.mjs --dry-run
 *   BACKFILL_ACK_REMOTE_DB=1 node scripts/backfill-client-subscriptions.mjs --execute --confirm-write
 *
 * Remote (non-localhost) DB requires BACKFILL_ACK_REMOTE_DB=1.
 * Refuses NODE_ENV/APP_NODE_ENV=production and production-like URL patterns.
 *
 * Write rules (v1):
 * - Only legacy_active / legacy_expired
 * - Preserve original dates/duration; do NOT call createSubscription
 * - Do NOT update User snapshots
 * - Skip if ANY Subscription exists for the trainer/client pair
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientSubscription from '../src/modules/client-subscriptions/client-subscription.model.js';
import {
    BACKFILL_CLASSIFICATION,
    BACKFILL_WRITE_OUTCOME,
    classifyLegacyClientForBackfill,
    isWriteEligibleClassification,
    planBackfillWrite,
    snapshotFingerprint,
} from './lib/client-subscription-backfill-classify.js';

const BLOCKED_DB_URL_PATTERNS = [
    /production/i,
    /\.vercel\.app/i,
    /fitlypro-backend\.netlify/i,
];

const isLocalDbUrl = (url) =>
    /mongodb(\+srv)?:\/\/(localhost|127\.0\.0\.1)/i.test(url);

const redactDbUrl = (url) => {
    if (!url || typeof url !== 'string') return '(missing)';
    try {
        const u = new URL(url.replace(/^mongodb(\+srv)?:\/\//, 'https://'));
        return `${url.startsWith('mongodb+srv') ? 'mongodb+srv' : 'mongodb'}://***:***@${u.host}${u.pathname}`;
    } catch {
        return '(unparseable)';
    }
};

const isDuplicateKey = (err) => {
    if (!err) return false;
    if (err.code === 11000 || err.codeName === 'DuplicateKey') return true;
    const cause = err.cause;
    return Boolean(
        cause && (cause.code === 11000 || cause.codeName === 'DuplicateKey')
    );
};

export const parseArgs = (argv) => {
    let mode = 'dry-run';
    let confirmWrite = false;
    for (const arg of argv) {
        if (arg === '--' || arg === '') continue;
        if (arg === '--dry-run' || arg === '--mode=dry-run') {
            mode = 'dry-run';
            continue;
        }
        if (arg === '--execute' || arg === '--mode=execute') {
            mode = 'execute';
            continue;
        }
        if (arg === '--write') {
            throw new Error(
                'Unknown argument: --write. Use --execute --confirm-write'
            );
        }
        if (arg === '--confirm-write') {
            confirmWrite = true;
            continue;
        }
        if (arg.startsWith('--')) {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (mode === 'execute' && !confirmWrite) {
        throw new Error(
            'Write mode requires explicit --confirm-write in addition to --execute'
        );
    }
    if (mode === 'dry-run' && confirmWrite) {
        throw new Error(
            '--confirm-write is only valid with --execute (refusing conflicting args)'
        );
    }

    return { mode, confirmWrite };
};

export const assertSafeEnvironment = ({ requireWriteAck = false } = {}) => {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing: NODE_ENV=production');
    }
    if (process.env.APP_NODE_ENV === 'production') {
        throw new Error('Refusing: APP_NODE_ENV=production');
    }

    const dbUrl = process.env.APP_DB_URL;
    if (!dbUrl) {
        throw new Error('APP_DB_URL is required');
    }

    for (const pattern of BLOCKED_DB_URL_PATTERNS) {
        if (pattern.test(dbUrl)) {
            throw new Error(
                'Refusing: APP_DB_URL looks like a production deployment database'
            );
        }
    }

    if (!isLocalDbUrl(dbUrl) && process.env.BACKFILL_ACK_REMOTE_DB !== '1') {
        throw new Error(
            'Refusing: APP_DB_URL is not localhost. Set BACKFILL_ACK_REMOTE_DB=1 only for a verified non-production cluster.'
        );
    }

    if (requireWriteAck && !isLocalDbUrl(dbUrl)) {
        // Same ACK as connect gate — never silently enable remote writes.
        if (process.env.BACKFILL_ACK_REMOTE_DB !== '1') {
            throw new Error(
                'Refusing remote write: BACKFILL_ACK_REMOTE_DB=1 is required'
            );
        }
    }

    return dbUrl;
};

const buildClientScanFilter = () => ({
    role: 'client',
    trainer: { $ne: null, $exists: true },
});

const emptyCounters = () => ({
    usersScanned: 0,
    eligibleTrainerClients: 0,
    legacyActive: 0,
    legacyExpired: 0,
    alreadyMigrated: 0,
    snapshotMatches: 0,
    snapshotMismatches: 0,
    missingPackage: 0,
    invalidByReason: {},
    ambiguousByReason: {},
    excludedNonClientRole: 0,
    excludedNoTrainer: 0,
    orphanSubscriptions: 0,
    duplicateActivePairs: 0,
    datesInconsistentWithPackageCalc: 0,
});

const bump = (map, key) => {
    map[key] = (map[key] ?? 0) + 1;
};

const runAudit = async (now = new Date()) => {
    const counters = emptyCounters();
    const rows = [];

    const totalUsers = await User.countDocuments({});
    counters.usersScanned = totalUsers;

    counters.excludedNonClientRole = await User.countDocuments({
        role: { $ne: 'client' },
        $or: [
            { packageDuration: { $exists: true, $ne: null } },
            { startDate: { $exists: true, $ne: null } },
            { endDate: { $exists: true, $ne: null } },
        ],
    });

    counters.excludedNoTrainer = await User.countDocuments({
        role: 'client',
        $or: [{ trainer: null }, { trainer: { $exists: false } }],
    });

    const clients = await User.find(buildClientScanFilter())
        .select('_id role trainer packageDuration startDate endDate')
        .lean();

    counters.eligibleTrainerClients = clients.length;

    const clientIds = clients.map((c) => c._id);
    const trainerIds = [
        ...new Set(clients.map((c) => String(c.trainer))),
    ].map((id) => new mongoose.Types.ObjectId(id));

    const subscriptions =
        clientIds.length || trainerIds.length
            ? await ClientSubscription.find({
                  $or: [
                      { clientId: { $in: clientIds } },
                      { trainerId: { $in: trainerIds } },
                  ],
              })
                  .select(
                      '_id trainerId clientId status packageDuration startDate endDate'
                  )
                  .lean()
            : [];

    const subByPair = new Map();
    for (const sub of subscriptions) {
        const key = `${String(sub.trainerId)}|${String(sub.clientId)}`;
        if (!subByPair.has(key)) subByPair.set(key, []);
        subByPair.get(key).push(sub);
    }

    for (const [key, list] of subByPair) {
        const activeCount = list.filter((s) => s.status === 'active').length;
        if (activeCount > 1) {
            counters.duplicateActivePairs += 1;
            rows.push({
                trainerId: key.split('|')[0],
                clientId: key.split('|')[1],
                packageDuration: null,
                startDate: null,
                endDate: null,
                proposedStatus: null,
                classification: BACKFILL_CLASSIFICATION.AMBIGUOUS,
                skipReason: 'multiple_active_subscriptions_index_violation',
                notes: [`activeCount=${activeCount}`],
            });
        }
    }

    const clientById = new Map(clients.map((c) => [String(c._id), c]));
    const allSubsForOrphanCheck = await ClientSubscription.find({})
        .select('_id trainerId clientId status')
        .lean();

    const missingClientIds = [
        ...new Set(
            allSubsForOrphanCheck
                .map((s) => String(s.clientId))
                .filter((id) => !clientById.has(id))
        ),
    ];
    const extraClients =
        missingClientIds.length > 0
            ? await User.find({ _id: { $in: missingClientIds } })
                  .select('_id role trainer')
                  .lean()
            : [];
    const extraById = new Map(extraClients.map((c) => [String(c._id), c]));

    for (const sub of allSubsForOrphanCheck) {
        const scanned = clientById.get(String(sub.clientId));
        const anyClient = scanned ?? extraById.get(String(sub.clientId));
        if (!anyClient || anyClient.role !== 'client') {
            counters.orphanSubscriptions += 1;
            rows.push({
                trainerId: String(sub.trainerId),
                clientId: String(sub.clientId),
                packageDuration: null,
                startDate: null,
                endDate: null,
                proposedStatus: null,
                classification: BACKFILL_CLASSIFICATION.AMBIGUOUS,
                skipReason: 'orphan_subscription_missing_client',
                notes: [`subscriptionId=${String(sub._id)}`],
            });
            continue;
        }
        if (
            !anyClient.trainer ||
            String(anyClient.trainer) !== String(sub.trainerId)
        ) {
            counters.orphanSubscriptions += 1;
            rows.push({
                trainerId: String(sub.trainerId),
                clientId: String(sub.clientId),
                packageDuration: null,
                startDate: null,
                endDate: null,
                proposedStatus: null,
                classification: BACKFILL_CLASSIFICATION.AMBIGUOUS,
                skipReason: 'orphan_subscription_trainer_mismatch',
                notes: [`subscriptionId=${String(sub._id)}`],
            });
        }
    }

    for (const user of clients) {
        const key = `${String(user.trainer)}|${String(user._id)}`;
        const pairSubs = subByPair.get(key) ?? [];
        const result = classifyLegacyClientForBackfill(user, pairSubs, now);

        rows.push({
            trainerId: result.trainerId,
            clientId: result.clientId,
            packageDuration: result.packageDuration,
            startDate: result.startDate,
            endDate: result.endDate,
            proposedStatus: result.proposedStatus,
            classification: result.classification,
            skipReason: result.skipReason,
            notes: result.notes,
            snapshotMatchesActive: result.snapshotMatchesActive,
            datesInconsistentWithPackageCalc:
                result.datesInconsistentWithPackageCalc,
            snapshotFingerprint: snapshotFingerprint(user),
        });

        switch (result.classification) {
            case BACKFILL_CLASSIFICATION.LEGACY_ACTIVE:
                counters.legacyActive += 1;
                break;
            case BACKFILL_CLASSIFICATION.LEGACY_EXPIRED:
                counters.legacyExpired += 1;
                break;
            case BACKFILL_CLASSIFICATION.ALREADY_MIGRATED:
                counters.alreadyMigrated += 1;
                if (result.snapshotMatchesActive === true) {
                    counters.snapshotMatches += 1;
                } else if (result.snapshotMatchesActive === false) {
                    counters.snapshotMismatches += 1;
                }
                break;
            case BACKFILL_CLASSIFICATION.MISSING_PACKAGE:
                counters.missingPackage += 1;
                break;
            case BACKFILL_CLASSIFICATION.INVALID:
                bump(counters.invalidByReason, result.skipReason || 'unknown');
                break;
            case BACKFILL_CLASSIFICATION.AMBIGUOUS:
                bump(
                    counters.ambiguousByReason,
                    result.skipReason || 'unknown'
                );
                break;
            default:
                bump(counters.ambiguousByReason, 'unknown_classification');
        }

        if (result.datesInconsistentWithPackageCalc) {
            counters.datesInconsistentWithPackageCalc += 1;
        }
    }

    return { counters, rows, clients, subByPair };
};

const printRows = (rows) => {
    console.log('\n--- Classification rows (IDs only) ---');
    for (const row of rows) {
        console.log(
            JSON.stringify({
                trainerId: row.trainerId,
                clientId: row.clientId,
                packageDuration: row.packageDuration,
                startDate: row.startDate,
                endDate: row.endDate,
                proposedStatus: row.proposedStatus,
                classification: row.classification,
                skipReason: row.skipReason,
                notes: row.notes?.length ? row.notes : undefined,
                snapshotMatchesActive:
                    row.snapshotMatchesActive != null
                        ? row.snapshotMatchesActive
                        : undefined,
                datesInconsistentWithPackageCalc:
                    row.datesInconsistentWithPackageCalc || undefined,
            })
        );
    }
};

const executeBackfill = async (candidates, now) => {
    const outcomes = [];
    let systemicStop = null;

    for (const candidate of candidates) {
        if (systemicStop) {
            outcomes.push({
                trainerId: candidate.trainerId,
                clientId: candidate.clientId,
                outcome: BACKFILL_WRITE_OUTCOME.FAILED,
                reason: `aborted_after_systemic:${systemicStop}`,
                subscriptionId: null,
            });
            continue;
        }

        try {
            const freshUser = await User.findById(candidate.clientId)
                .select('_id role trainer packageDuration startDate endDate')
                .lean();

            if (!freshUser) {
                outcomes.push({
                    trainerId: candidate.trainerId,
                    clientId: candidate.clientId,
                    outcome: BACKFILL_WRITE_OUTCOME.SKIPPED_CHANGED,
                    reason: 'user_missing',
                    subscriptionId: null,
                });
                continue;
            }

            const beforeSnap = snapshotFingerprint(freshUser);

            const freshSubs = await ClientSubscription.find({
                trainerId: candidate.trainerId,
                clientId: candidate.clientId,
            })
                .select(
                    '_id trainerId clientId status packageDuration startDate endDate'
                )
                .lean();

            const plan = planBackfillWrite(
                freshUser,
                freshSubs,
                candidate.classification,
                now
            );

            if (plan.outcome !== BACKFILL_WRITE_OUTCOME.CREATED) {
                outcomes.push({
                    trainerId: candidate.trainerId,
                    clientId: candidate.clientId,
                    outcome: plan.outcome,
                    reason: plan.reason,
                    subscriptionId: null,
                });
                continue;
            }

            let created;
            try {
                created = await ClientSubscription.create(plan.doc);
            } catch (err) {
                if (isDuplicateKey(err)) {
                    outcomes.push({
                        trainerId: candidate.trainerId,
                        clientId: candidate.clientId,
                        outcome: BACKFILL_WRITE_OUTCOME.SKIPPED_EXISTING,
                        reason: 'E11000_duplicate_active',
                        subscriptionId: null,
                    });
                    continue;
                }
                throw err;
            }

            const afterUser = await User.findById(candidate.clientId)
                .select('packageDuration startDate endDate')
                .lean();
            const afterSnap = snapshotFingerprint(afterUser);
            if (beforeSnap !== afterSnap) {
                outcomes.push({
                    trainerId: candidate.trainerId,
                    clientId: candidate.clientId,
                    outcome: BACKFILL_WRITE_OUTCOME.FAILED,
                    reason: 'user_snapshot_changed_unexpectedly',
                    subscriptionId: String(created._id),
                });
                // Isolated integrity alarm — stop further writes
                systemicStop = 'user_snapshot_changed_unexpectedly';
                continue;
            }

            outcomes.push({
                trainerId: candidate.trainerId,
                clientId: candidate.clientId,
                outcome: BACKFILL_WRITE_OUTCOME.CREATED,
                reason: null,
                subscriptionId: String(created._id),
                status: created.status,
                packageDuration: created.packageDuration,
                startDate: created.startDate?.toISOString?.() ?? null,
                endDate: created.endDate?.toISOString?.() ?? null,
            });
        } catch (err) {
            const message = err?.message || String(err);
            const systemic =
                /ECONN|topology|timed out|MongoNetwork|server selection/i.test(
                    message
                );
            outcomes.push({
                trainerId: candidate.trainerId,
                clientId: candidate.clientId,
                outcome: BACKFILL_WRITE_OUTCOME.FAILED,
                reason: message,
                subscriptionId: null,
            });
            if (systemic) {
                systemicStop = message;
            }
        }
    }

    return { outcomes, systemicStop };
};

async function main() {
    const { mode } = parseArgs(process.argv.slice(2));
    const isExecute = mode === 'execute';

    if (isExecute) {
        console.log('EXECUTE MODE — WRITES ENABLED (ClientSubscription create only)');
        console.log('User snapshots will NOT be modified');
    } else {
        console.log('DRY RUN — NO DATABASE WRITES');
    }
    console.log(`Mode: ${mode}`);

    const dbUrl = assertSafeEnvironment({ requireWriteAck: isExecute });
    console.log(`Target DB (redacted): ${redactDbUrl(dbUrl)}`);
    console.log(
        `Local DB: ${isLocalDbUrl(dbUrl) ? 'yes' : 'no (remote ACK present)'}`
    );

    await mongoose.connect(dbUrl);
    console.log(
        `Connected databaseName=${mongoose.connection.name} host=${mongoose.connection.host}`
    );

    if (
        mongoose.connection.name &&
        /prod/i.test(mongoose.connection.name) &&
        mongoose.connection.name.toLowerCase() !== 'test'
    ) {
        throw new Error(
            `Refusing: connected databaseName looks production-like (${mongoose.connection.name})`
        );
    }

    const now = new Date();
    const { counters, rows } = await runAudit(now);

    printRows(rows);
    console.log('\n--- Summary ---');
    console.log(JSON.stringify(counters, null, 2));

    const writeCandidates = rows.filter((r) =>
        isWriteEligibleClassification(r.classification)
    );

    console.log(
        `\nWrite-eligible candidates: ${writeCandidates.length} (legacy_active=${counters.legacyActive}, legacy_expired=${counters.legacyExpired})`
    );

    if (!isExecute) {
        console.log('\nDRY RUN COMPLETE — no mutations issued');
        await mongoose.disconnect();
        return;
    }

    console.log('\n--- Execute: per-record outcomes ---');
    const { outcomes, systemicStop } = await executeBackfill(
        writeCandidates,
        now
    );

    const tally = {
        created: 0,
        skipped_existing: 0,
        skipped_changed: 0,
        failed: 0,
    };
    for (const o of outcomes) {
        console.log(JSON.stringify(o));
        if (o.outcome in tally) {
            tally[o.outcome] += 1;
        }
    }

    console.log('\n--- Execute tally ---');
    console.log(JSON.stringify({ ...tally, systemicStop }, null, 2));

    console.log('\n--- Post-execution audit ---');
    const post = await runAudit(new Date());
    printRows(post.rows);
    console.log('\n--- Post-execution summary ---');
    console.log(JSON.stringify(post.counters, null, 2));

    // Snapshot unchanged check for migrated candidates
    const migratedClientIds = new Set(
        outcomes
            .filter((o) => o.outcome === BACKFILL_WRITE_OUTCOME.CREATED)
            .map((o) => o.clientId)
    );
    let snapshotDrift = 0;
    for (const before of rows) {
        if (!migratedClientIds.has(before.clientId)) continue;
        const after = post.rows.find(
            (r) =>
                r.clientId === before.clientId &&
                r.trainerId === before.trainerId
        );
        if (
            after &&
            before.snapshotFingerprint &&
            after.snapshotFingerprint &&
            before.snapshotFingerprint !== after.snapshotFingerprint
        ) {
            snapshotDrift += 1;
            console.log(
                JSON.stringify({
                    alert: 'snapshot_drift',
                    trainerId: before.trainerId,
                    clientId: before.clientId,
                })
            );
        }
    }
    console.log(`Snapshot drift among created: ${snapshotDrift}`);

    await mongoose.disconnect();

    if (tally.failed > 0 || systemicStop) {
        process.exitCode = 1;
    }
}

const isDirectRun =
    process.argv[1] &&
    process.argv[1].replace(/\\/g, '/').endsWith('backfill-client-subscriptions.mjs');

if (isDirectRun) {
    main().catch(async (err) => {
        console.error(err.message || err);
        try {
            await mongoose.disconnect();
        } catch {
            /* ignore */
        }
        process.exit(1);
    });
}
