/**
 * System health reference catalog seed.
 *
 * Usage: node scripts/seed-health-reference-options.mjs
 *
 * Upserts by (category, code). Preserves document _id on re-run.
 * Updates label, sortOrder, and status from seed data only (catalog metadata).
 * Does not modify User or NutritionProfile documents.
 */

import 'dotenv/config';
import mongoose from 'mongoose';

import HealthReferenceOption from '../src/modules/health-reference/health-reference.model.js';
import { HEALTH_REFERENCE_SEED_OPTIONS } from '../src/modules/health-reference/health-reference.seed-data.js';

const upsertOption = async (item) => {
    const result = await HealthReferenceOption.findOneAndUpdate(
        { category: item.category, code: item.code },
        {
            $set: {
                label: item.label,
                sortOrder: item.sortOrder,
                status: 'active',
            },
            $setOnInsert: {
                category: item.category,
                code: item.code,
            },
        },
        { upsert: true, new: true, runValidators: true }
    );

    const created = result.createdAt?.getTime() === result.updatedAt?.getTime();
    return created ? 'created' : 'updated';
};

const main = async () => {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);

    const stats = { created: 0, updated: 0, errors: [] };

    for (const item of HEALTH_REFERENCE_SEED_OPTIONS) {
        try {
            const outcome = await upsertOption(item);
            stats[outcome] += 1;
            console.log(`${outcome.toUpperCase()}: ${item.category}/${item.code}`);
        } catch (err) {
            stats.errors.push(`${item.category}/${item.code}: ${err.message}`);
            console.error(`ERROR: ${item.category}/${item.code} — ${err.message}`);
        }
    }

    const total = await HealthReferenceOption.countDocuments();

    console.log('\nSeed summary');
    console.log(`  Created: ${stats.created}`);
    console.log(`  Updated: ${stats.updated}`);
    console.log(`  Errors: ${stats.errors.length}`);
    console.log(`  Total catalog documents: ${total}`);

    await mongoose.disconnect();

    if (stats.errors.length) {
        process.exit(1);
    }
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
