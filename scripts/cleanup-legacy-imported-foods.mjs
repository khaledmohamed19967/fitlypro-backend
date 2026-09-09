/**
 * Dry-run / optional cleanup for legacy imported system foods
 * (Open Food Facts + USDA FoodData Central).
 *
 * Usage:
 *   pnpm run cleanup:foods:legacy -- --dry-run
 *   pnpm run cleanup:foods:legacy
 *
 * Never deletes trainer-owned foods or FitlyPro seed foods.
 * Does not run unless explicitly invoked. Prefer --dry-run first.
 */

import 'dotenv/config';
import mongoose from 'mongoose';

import Food from '../src/modules/foods/food.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import { FITLYPRO_SEED_PROVIDER, LEGACY_IMPORT_PROVIDERS } from '../src/modules/foods/food.constants.js';

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

const legacyFilter = {
    'ownership.type': 'system',
    'source.externalProvider': { $in: [...LEGACY_IMPORT_PROVIDERS] },
};

const main = async () => {
    const { dryRun } = parseArgs(process.argv.slice(2));
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);

    const [offCount, usdaCount, trainerCount, fitlyCount, matching] = await Promise.all([
        Food.countDocuments({
            'ownership.type': 'system',
            'source.externalProvider': 'openfoodfacts',
        }),
        Food.countDocuments({
            'ownership.type': 'system',
            'source.externalProvider': 'usda_fooddata_central',
        }),
        Food.countDocuments({ 'ownership.type': 'trainer' }),
        Food.countDocuments({
            'ownership.type': 'system',
            'source.externalProvider': FITLYPRO_SEED_PROVIDER,
        }),
        Food.find(legacyFilter).select('_id name source.externalProvider').lean(),
    ]);

    const ids = matching.map((food) => food._id);
    const referencedPlans = ids.length
        ? await NutritionPlan.countDocuments({
              'nutritionDays.meals.foodItems.foodId': { $in: ids },
          })
        : 0;

    console.log('\nLegacy imported system food cleanup');
    console.log(`  dry-run: ${dryRun ? 'yes' : 'no'}`);
    console.log(`  Open Food Facts system foods: ${offCount}`);
    console.log(`  USDA system foods: ${usdaCount}`);
    console.log(`  trainer-owned foods (preserved): ${trainerCount}`);
    console.log(`  FitlyPro seed foods (preserved): ${fitlyCount}`);
    console.log(`  NutritionPlans referencing these foods: ${referencedPlans}`);
    console.log('  Snapshots on existing plans are independent of live Food documents.');

    if (dryRun) {
        console.log('\nDry run complete — no records deleted.');
        await mongoose.disconnect();
        return;
    }

    const result = await Food.deleteMany(legacyFilter);
    console.log(`\nDeleted: ${result.deletedCount}`);
    await mongoose.disconnect();
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
