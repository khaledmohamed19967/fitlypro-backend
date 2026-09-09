/**
 * System Food catalog seed script (Phase 2)
 *
 * Usage: pnpm run seed:foods
 *
 * Behavior:
 * - Upserts by (ownership.type=system, source.externalProvider=fitlypro, source.externalId)
 * - Never deletes foods
 * - Never modifies trainer-owned foods
 * - Safe / idempotent to re-run
 */

import 'dotenv/config';
import mongoose from 'mongoose';

import Food from '../src/modules/foods/food.model.js';

const SEED_PROVIDER = 'fitlypro';

const SYSTEM_FOODS = Object.freeze([
    {
        externalId: 'chicken-breast',
        name: 'Chicken Breast (Skinless)',
        brand: null,
        category: 'protein',
        nutritionPer100g: { calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, sugar: 0 },
        defaultServing: { quantity: 100, unit: 'g', gramWeight: 100 },
    },
    {
        externalId: 'eggs-whole',
        name: 'Eggs (Whole)',
        brand: null,
        category: 'protein',
        nutritionPer100g: { calories: 155, protein: 13, carbs: 1.1, fat: 11, fiber: 0, sugar: 1.1 },
        defaultServing: { quantity: 1, unit: 'piece', gramWeight: 50 },
    },
    {
        externalId: 'white-rice',
        name: 'White Rice (Cooked)',
        brand: null,
        category: 'grains',
        nutritionPer100g: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sugar: 0 },
        defaultServing: { quantity: 100, unit: 'g', gramWeight: 100 },
    },
    {
        externalId: 'brown-rice',
        name: 'Brown Rice (Cooked)',
        brand: null,
        category: 'grains',
        nutritionPer100g: { calories: 123, protein: 2.7, carbs: 25.6, fat: 1, fiber: 1.6, sugar: 0.4 },
        defaultServing: { quantity: 100, unit: 'g', gramWeight: 100 },
    },
    {
        externalId: 'oats',
        name: 'Oats (Rolled, Dry)',
        brand: null,
        category: 'grains',
        nutritionPer100g: { calories: 389, protein: 16.9, carbs: 66.3, fat: 6.9, fiber: 10.6, sugar: 0 },
        defaultServing: { quantity: 40, unit: 'g', gramWeight: 40 },
    },
    {
        externalId: 'greek-yogurt',
        name: 'Greek Yogurt (Non-fat)',
        brand: null,
        category: 'dairy',
        nutritionPer100g: { calories: 59, protein: 10, carbs: 3.6, fat: 0.4, fiber: 0, sugar: 3.2 },
        defaultServing: { quantity: 1, unit: 'serving', gramWeight: 170 },
    },
    {
        externalId: 'milk-whole',
        name: 'Milk (Whole)',
        brand: null,
        category: 'dairy',
        nutritionPer100g: { calories: 61, protein: 3.2, carbs: 4.8, fat: 3.3, fiber: 0, sugar: 5.1 },
        defaultServing: { quantity: 250, unit: 'ml', gramWeight: 250 },
    },
    {
        externalId: 'banana',
        name: 'Banana',
        brand: null,
        category: 'fruits',
        nutritionPer100g: { calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3, fiber: 2.6, sugar: 12.2 },
        defaultServing: { quantity: 1, unit: 'piece', gramWeight: 118 },
    },
    {
        externalId: 'apple',
        name: 'Apple',
        brand: null,
        category: 'fruits',
        nutritionPer100g: { calories: 52, protein: 0.3, carbs: 13.8, fat: 0.2, fiber: 2.4, sugar: 10.4 },
        defaultServing: { quantity: 1, unit: 'piece', gramWeight: 182 },
    },
    {
        externalId: 'potato',
        name: 'Potato (Baked, Flesh Only)',
        brand: null,
        category: 'vegetables',
        nutritionPer100g: { calories: 93, protein: 2.5, carbs: 21, fat: 0.1, fiber: 2.2, sugar: 1.2 },
        defaultServing: { quantity: 1, unit: 'piece', gramWeight: 173 },
    },
    {
        externalId: 'sweet-potato',
        name: 'Sweet Potato (Baked)',
        brand: null,
        category: 'vegetables',
        nutritionPer100g: { calories: 90, protein: 2, carbs: 20.7, fat: 0.2, fiber: 3.3, sugar: 6.5 },
        defaultServing: { quantity: 1, unit: 'piece', gramWeight: 114 },
    },
    {
        externalId: 'salmon',
        name: 'Salmon (Atlantic, Cooked)',
        brand: null,
        category: 'protein',
        nutritionPer100g: { calories: 208, protein: 20, carbs: 0, fat: 13, fiber: 0, sugar: 0 },
        defaultServing: { quantity: 100, unit: 'g', gramWeight: 100 },
    },
    {
        externalId: 'tuna-canned',
        name: 'Tuna (Canned in Water)',
        brand: null,
        category: 'protein',
        nutritionPer100g: { calories: 116, protein: 25.5, carbs: 0, fat: 0.8, fiber: 0, sugar: 0 },
        defaultServing: { quantity: 1, unit: 'serving', gramWeight: 85 },
    },
    {
        externalId: 'beef-sirloin',
        name: 'Beef (Sirloin, Lean, Cooked)',
        brand: null,
        category: 'protein',
        nutritionPer100g: { calories: 206, protein: 28, carbs: 0, fat: 10, fiber: 0, sugar: 0 },
        defaultServing: { quantity: 100, unit: 'g', gramWeight: 100 },
    },
    {
        externalId: 'olive-oil',
        name: 'Olive Oil',
        brand: null,
        category: 'fats',
        nutritionPer100g: { calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0, sugar: 0 },
        defaultServing: { quantity: 15, unit: 'ml', gramWeight: 15 },
    },
    {
        externalId: 'peanut-butter',
        name: 'Peanut Butter',
        brand: null,
        category: 'nuts_seeds',
        nutritionPer100g: { calories: 588, protein: 25, carbs: 20, fat: 50, fiber: 6, sugar: 9 },
        defaultServing: { quantity: 1, unit: 'serving', gramWeight: 32 },
    },
    {
        externalId: 'bread-whole-wheat',
        name: 'Bread (Whole Wheat)',
        brand: null,
        category: 'grains',
        nutritionPer100g: { calories: 247, protein: 13, carbs: 41, fat: 3.4, fiber: 7, sugar: 5 },
        defaultServing: { quantity: 1, unit: 'serving', gramWeight: 43 },
    },
]);

const upsertSystemFood = async (item) => {
    const existing = await Food.findOne({
        'ownership.type': 'system',
        'source.externalProvider': SEED_PROVIDER,
        'source.externalId': item.externalId,
    });

    const payload = {
        ownership: { type: 'system', trainerId: null },
        trainerId: null,
        name: item.name,
        brand: item.brand,
        category: item.category,
        status: 'active',
        nutritionPer100g: item.nutritionPer100g,
        defaultServing: item.defaultServing,
        source: {
            type: 'seed',
            externalProvider: SEED_PROVIDER,
            externalId: item.externalId,
        },
    };

    if (existing) {
        Object.assign(existing, payload);
        await existing.save();
        return 'updated';
    }

    await Food.create(payload);
    return 'created';
};

const main = async () => {
    await mongoose.connect(process.env.APP_DB_URL);
    console.log('Connected to MongoDB');

    const trainerFoodCountBefore = await Food.countDocuments({
        'ownership.type': 'trainer',
    });

    const stats = { created: 0, updated: 0, errors: [] };

    for (const item of SYSTEM_FOODS) {
        try {
            const result = await upsertSystemFood(item);
            stats[result] += 1;
            console.log(`${result.toUpperCase()}: ${item.externalId} (${item.name})`);
        } catch (err) {
            stats.errors.push(`${item.externalId}: ${err.message}`);
            console.error(`ERROR: ${item.externalId} — ${err.message}`);
        }
    }

    const systemCount = await Food.countDocuments({
        'ownership.type': 'system',
        'source.externalProvider': SEED_PROVIDER,
        'source.externalId': { $in: SYSTEM_FOODS.map((f) => f.externalId) },
    });

    const trainerFoodCountAfter = await Food.countDocuments({
        'ownership.type': 'trainer',
    });

    console.log('\nSeed summary');
    console.log(`  Created: ${stats.created}`);
    console.log(`  Updated: ${stats.updated}`);
    console.log(`  Errors: ${stats.errors.length}`);
    console.log(`  System seeded foods: ${systemCount}`);
    console.log(`  Trainer foods before/after: ${trainerFoodCountBefore}/${trainerFoodCountAfter}`);

    await mongoose.disconnect();

    if (stats.errors.length) {
        process.exit(1);
    }
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
