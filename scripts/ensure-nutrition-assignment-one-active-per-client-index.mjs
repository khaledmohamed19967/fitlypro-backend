/**
 * Preferred long-term integrity constraint for Nutrition Plan Assignments:
 * at most one active assignment per (trainerId, clientId).
 *
 * Partial unique index:
 *   { trainerId: 1, clientId: 1 } where status === 'active'
 *
 * This script:
 * 1. Scans for existing duplicate active groups (must clean before indexing)
 * 2. Syncs indexes only when safe
 *
 * Do NOT run against production until duplicates are resolved.
 * Run: node scripts/ensure-nutrition-assignment-one-active-per-client-index.mjs
 *
 * NOTE: The Mongoose schema does not yet declare this index — apply via this
 * script after data cleanup so deploy-time syncIndexes cannot fail on legacy rows.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

await mongoose.connect(process.env.APP_DB_URL);
const col = mongoose.connection.collection('nutritionplanassignments');

const dups = await col
    .aggregate([
        { $match: { status: 'active' } },
        {
            $group: {
                _id: { trainerId: '$trainerId', clientId: '$clientId' },
                count: { $sum: 1 },
                assignmentIds: { $push: '$_id' },
            },
        },
        { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

if (dups.length > 0) {
    console.error(
        `Abort: ${dups.length} duplicate active (trainerId, clientId) group(s) found.`
    );
    for (const row of dups.slice(0, 20)) {
        console.error(
            `  trainer=${row._id.trainerId} client=${row._id.clientId} count=${row.count} ids=${row.assignmentIds.join(', ')}`
        );
    }
    await mongoose.disconnect();
    process.exit(1);
}

const indexName = 'trainerId_1_clientId_1_active_unique';
const existing = await col.indexes();
const already = existing.find((idx) => idx.name === indexName);

if (!already) {
    await col.createIndex(
        { trainerId: 1, clientId: 1 },
        {
            unique: true,
            name: indexName,
            partialFilterExpression: { status: 'active' },
        }
    );
    console.log(`Created partial unique index ${indexName}`);
} else {
    console.log(`Index ${indexName} already present`);
}

const after = await col.indexes();
console.log(
    'Indexes:',
    after.map((i) => ({
        name: i.name,
        unique: Boolean(i.unique),
        partial: i.partialFilterExpression ?? null,
    }))
);

await mongoose.disconnect();
console.log('One-active-per-client nutrition assignment index ensured.');
