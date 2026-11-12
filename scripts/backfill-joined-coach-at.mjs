/**
 * Backfill User.joinedCoachAt for coach-owned clients.
 *
 * Rule: role=client, trainer set, joinedCoachAt missing/null → joinedCoachAt = createdAt.
 * Never overwrites an existing joinedCoachAt. Never touches subscription fields.
 *
 * Usage:
 *   node scripts/backfill-joined-coach-at.mjs --dry-run
 *   node scripts/backfill-joined-coach-at.mjs
 *
 * Does NOT run on server start. Do not run against production without approval.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';

const parseArgs = (argv) => {
    const options = { dryRun: false };
    for (const arg of argv) {
        if (arg === '--' || arg === '') continue;
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }
        if (arg.startsWith('--')) {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
};

/** Shared eligibility — identical for dry-run and live execution. */
const buildEligibleFilter = () => ({
    role: 'client',
    trainer: { $ne: null, $exists: true },
    $or: [{ joinedCoachAt: null }, { joinedCoachAt: { $exists: false } }],
});

async function main() {
    const { dryRun } = parseArgs(process.argv.slice(2));

    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);

    const eligibleFilter = buildEligibleFilter();

    const eligible = await User.find(eligibleFilter)
        .select('_id createdAt joinedCoachAt trainer role')
        .lean();

    const alreadySet = await User.countDocuments({
        role: 'client',
        trainer: { $ne: null, $exists: true },
        joinedCoachAt: { $type: 'date' },
    });

    const ops = [];
    let skippedMissingCreatedAt = 0;
    let skippedInvalidCreatedAt = 0;
    const failed = [];

    for (const doc of eligible) {
        if (doc.createdAt == null) {
            skippedMissingCreatedAt += 1;
            continue;
        }
        const createdAt = new Date(doc.createdAt);
        if (Number.isNaN(createdAt.getTime())) {
            skippedInvalidCreatedAt += 1;
            continue;
        }
        ops.push({
            updateOne: {
                filter: {
                    _id: doc._id,
                    ...eligibleFilter,
                },
                update: { $set: { joinedCoachAt: createdAt } },
            },
        });
    }

    let updated = 0;
    let matchedForUpdate = 0;

    if (!dryRun && ops.length > 0) {
        try {
            const result = await User.bulkWrite(ops, { ordered: false });
            matchedForUpdate = result.matchedCount ?? 0;
            updated = result.modifiedCount ?? 0;
        } catch (err) {
            // ordered:false may still throw BulkWriteError with partial results
            if (err?.result) {
                matchedForUpdate = err.result.matchedCount ?? 0;
                updated = err.result.modifiedCount ?? 0;
            }
            const writeErrors = err?.writeErrors ?? err?.result?.getWriteErrors?.() ?? [];
            if (Array.isArray(writeErrors) && writeErrors.length) {
                for (const writeError of writeErrors) {
                    failed.push({
                        index: writeError.index,
                        code: writeError.code,
                        message: writeError.errmsg || writeError.message,
                    });
                }
            } else {
                failed.push({ message: err.message || String(err) });
            }
        }
    } else if (dryRun) {
        matchedForUpdate = ops.length;
        updated = ops.length;
    }

    const skippedEligibleWithoutCreatedAt =
        skippedMissingCreatedAt + skippedInvalidCreatedAt;

    const report = {
        dryRun,
        eligible: eligible.length,
        plannedUpdates: ops.length,
        updated: dryRun ? 0 : updated,
        wouldUpdate: dryRun ? ops.length : undefined,
        matchedForUpdate: dryRun ? ops.length : matchedForUpdate,
        skipped: {
            alreadySet,
            missingCreatedAt: skippedMissingCreatedAt,
            invalidCreatedAt: skippedInvalidCreatedAt,
            eligibleButNotPlanned: skippedEligibleWithoutCreatedAt,
        },
        failed: {
            count: failed.length,
            items: failed,
        },
    };

    console.log(JSON.stringify(report, null, 2));
    console.log(
        dryRun
            ? `Dry run complete — ${ops.length} record(s) would be updated; no documents were modified.`
            : `Backfill complete — updated ${updated} document(s); failed ${failed.length}.`
    );

    await mongoose.disconnect();

    if (failed.length > 0) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
