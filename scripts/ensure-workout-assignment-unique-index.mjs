/**
 * Ensure workout PlanAssignment unique active index.
 * Drops legacy non-unique planId_1_clientId_1 if present, then syncIndexes.
 * Run: node scripts/ensure-workout-assignment-unique-index.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import PlanAssignment from '../src/modules/workout-plans/plan-assignment.model.js';

await mongoose.connect(process.env.APP_DB_URL);
const col = mongoose.connection.collection('planassignments');

const dups = await col
    .aggregate([
        { $match: { status: 'active' } },
        {
            $group: {
                _id: { planId: '$planId', clientId: '$clientId' },
                count: { $sum: 1 },
            },
        },
        { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

if (dups.length > 0) {
    console.error(`Abort: ${dups.length} duplicate active (planId, clientId) groups found.`);
    await mongoose.disconnect();
    process.exit(1);
}

const existing = await col.indexes();
const legacy = existing.find(
    (idx) =>
        idx.name === 'planId_1_clientId_1' &&
        !idx.unique &&
        !idx.partialFilterExpression
);

if (legacy) {
    await col.dropIndex('planId_1_clientId_1');
    console.log('Dropped legacy non-unique index planId_1_clientId_1');
}

await PlanAssignment.syncIndexes();
const after = await col.indexes();
console.log(
    'Indexes after sync:',
    after.map((i) => ({
        name: i.name,
        unique: Boolean(i.unique),
        partial: i.partialFilterExpression ?? null,
    }))
);

await mongoose.disconnect();
console.log('Workout assignment unique active index ensured.');
