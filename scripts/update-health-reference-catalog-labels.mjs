/**
 * Scoped HealthReferenceOption label update (26 allergy + body_area rows).
 *
 * - Matches by { category, code } only
 * - $set { label } only via native collection update (does not bump updatedAt)
 * - Does not touch dietary_restriction rows
 * - Does not insert/delete
 *
 * Usage:
 *   BACKFILL_ACK_REMOTE_DB=1 node scripts/update-health-reference-catalog-labels.mjs --dry-run
 *   BACKFILL_ACK_REMOTE_DB=1 node scripts/update-health-reference-catalog-labels.mjs --execute --confirm-write
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import HealthReferenceOption from '../src/modules/health-reference/health-reference.model.js';
import { HEALTH_REFERENCE_LABEL_UPDATES } from '../src/modules/health-reference/health-reference.seed-data.js';

const EXPECTED_TOTAL = 34;
const EXPECTED_UPDATES = 26;
const EXPECTED_DIETARY = 8;

const BLOCKED_DB_URL_PATTERNS = [
    /production/i,
    /\.vercel\.app/i,
    /fitlypro-backend\.netlify/i,
];

const isLocalDbUrl = (url) =>
    /mongodb(\+srv)?:\/\/(localhost|127\.0\.0\.1)/i.test(url);

const redactDbUrl = (url) => {
    try {
        const u = new URL(url.replace(/^mongodb(\+srv)?:\/\//, 'https://'));
        return `${url.startsWith('mongodb+srv') ? 'mongodb+srv' : 'mongodb'}://***:***@${u.host}${u.pathname}`;
    } catch {
        return '(unparseable)';
    }
};

const parseArgs = (argv) => {
    let mode = 'dry-run';
    let confirmWrite = false;
    for (const arg of argv) {
        if (arg === '--dry-run' || arg === '--mode=dry-run') {
            mode = 'dry-run';
            continue;
        }
        if (arg === '--execute' || arg === '--mode=execute') {
            mode = 'execute';
            continue;
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
        throw new Error('Write mode requires --execute --confirm-write');
    }
    if (mode === 'dry-run' && confirmWrite) {
        throw new Error('--confirm-write is only valid with --execute');
    }
    return { mode };
};

const assertSafeEnvironment = () => {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing: NODE_ENV=production');
    }
    if (process.env.APP_NODE_ENV === 'production') {
        throw new Error('Refusing: APP_NODE_ENV=production');
    }
    const dbUrl = process.env.APP_DB_URL;
    if (!dbUrl) throw new Error('APP_DB_URL is required');
    for (const pattern of BLOCKED_DB_URL_PATTERNS) {
        if (pattern.test(dbUrl)) {
            throw new Error('Refusing: APP_DB_URL looks production-like');
        }
    }
    if (!isLocalDbUrl(dbUrl) && process.env.BACKFILL_ACK_REMOTE_DB !== '1') {
        throw new Error(
            'Refusing remote DB without BACKFILL_ACK_REMOTE_DB=1'
        );
    }
    return dbUrl;
};

async function main() {
    const { mode } = parseArgs(process.argv.slice(2));
    const dbUrl = assertSafeEnvironment();

    console.log(`Mode: ${mode}`);
    console.log(`Target DB (redacted): ${redactDbUrl(dbUrl)}`);
    console.log(`Label updates planned: ${HEALTH_REFERENCE_LABEL_UPDATES.length}`);

    if (HEALTH_REFERENCE_LABEL_UPDATES.length !== EXPECTED_UPDATES) {
        throw new Error(
            `Expected ${EXPECTED_UPDATES} label updates, got ${HEALTH_REFERENCE_LABEL_UPDATES.length}`
        );
    }

    await mongoose.connect(dbUrl);
    console.log(
        `Connected databaseName=${mongoose.connection.name} host=${mongoose.connection.host}`
    );

    if (mongoose.connection.name !== 'test') {
        throw new Error(
            `Abort: expected databaseName=test, got ${mongoose.connection.name}`
        );
    }

    const total = await HealthReferenceOption.countDocuments();
    if (total !== EXPECTED_TOTAL) {
        throw new Error(
            `Abort: expected ${EXPECTED_TOTAL} catalog docs, got ${total}`
        );
    }

    const dietaryBefore = await HealthReferenceOption.find({
        category: 'dietary_restriction',
    })
        .select('_id category code label status sortOrder updatedAt')
        .sort({ code: 1 })
        .lean();

    if (dietaryBefore.length !== EXPECTED_DIETARY) {
        throw new Error(
            `Abort: expected ${EXPECTED_DIETARY} dietary docs, got ${dietaryBefore.length}`
        );
    }

    const dietarySnapshot = JSON.stringify(dietaryBefore);

    const beforeRows = [];
    for (const item of HEALTH_REFERENCE_LABEL_UPDATES) {
        const doc = await HealthReferenceOption.findOne({
            category: item.category,
            code: item.code,
        })
            .select('_id category code label status sortOrder updatedAt')
            .lean();
        if (!doc) {
            throw new Error(`Abort: missing ${item.category}/${item.code}`);
        }
        beforeRows.push({
            _id: String(doc._id),
            category: doc.category,
            code: doc.code,
            labelBefore: doc.label,
            labelAfter: item.label,
            status: doc.status,
            sortOrder: doc.sortOrder,
            updatedAt: doc.updatedAt?.toISOString?.() ?? null,
        });
    }

    console.log('\n--- Planned updates ---');
    for (const row of beforeRows) {
        console.log(
            JSON.stringify({
                _id: row._id,
                category: row.category,
                code: row.code,
                from: row.labelBefore,
                to: row.labelAfter,
            })
        );
    }

    if (mode !== 'execute') {
        console.log('\nDRY RUN — no writes');
        await mongoose.disconnect();
        return;
    }

    console.log('\n--- Executing label-only updates ---');
    const col = HealthReferenceOption.collection;
    let modified = 0;

    for (const item of HEALTH_REFERENCE_LABEL_UPDATES) {
        const result = await col.updateOne(
            { category: item.category, code: item.code },
            { $set: { label: item.label } }
        );
        if (result.matchedCount !== 1) {
            throw new Error(
                `Failed match for ${item.category}/${item.code} matched=${result.matchedCount}`
            );
        }
        if (result.modifiedCount === 1) modified += 1;
        console.log(
            JSON.stringify({
                category: item.category,
                code: item.code,
                matched: result.matchedCount,
                modified: result.modifiedCount,
                label: item.label,
            })
        );
    }

    const afterTotal = await HealthReferenceOption.countDocuments();
    if (afterTotal !== EXPECTED_TOTAL) {
        throw new Error(`Post-check total mismatch: ${afterTotal}`);
    }

    const dietaryAfter = await HealthReferenceOption.find({
        category: 'dietary_restriction',
    })
        .select('_id category code label status sortOrder updatedAt')
        .sort({ code: 1 })
        .lean();
    const dietaryAfterSnap = JSON.stringify(dietaryAfter);
    if (dietaryAfterSnap !== dietarySnapshot) {
        throw new Error('Dietary records changed unexpectedly');
    }

    const afterRows = [];
    for (const item of HEALTH_REFERENCE_LABEL_UPDATES) {
        const doc = await HealthReferenceOption.findOne({
            category: item.category,
            code: item.code,
        })
            .select('_id category code label status sortOrder updatedAt')
            .lean();
        const before = beforeRows.find(
            (r) => r.category === item.category && r.code === item.code
        );
        if (String(doc._id) !== before._id) {
            throw new Error(`_id changed for ${item.code}`);
        }
        if (doc.label !== item.label) {
            throw new Error(`label not applied for ${item.code}`);
        }
        if (doc.status !== before.status || doc.sortOrder !== before.sortOrder) {
            throw new Error(`status/sortOrder changed for ${item.code}`);
        }
        afterRows.push({
            _id: String(doc._id),
            code: doc.code,
            label: doc.label,
            updatedAtUnchanged:
                (doc.updatedAt?.toISOString?.() ?? null) === before.updatedAt,
        });
    }

    const dupes = await HealthReferenceOption.aggregate([
        { $group: { _id: { category: '$category', code: '$code' }, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
    ]);
    if (dupes.length) {
        throw new Error(`Duplicate (category,code) found: ${JSON.stringify(dupes)}`);
    }

    console.log('\n--- Post-execution ---');
    console.log(JSON.stringify({ modified, afterTotal, dietaryIntact: true }, null, 2));
    for (const row of afterRows) {
        console.log(JSON.stringify(row));
    }

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error(err.message || err);
    try {
        await mongoose.disconnect();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
