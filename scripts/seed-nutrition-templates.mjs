/**
 * System Nutrition Template seed script (Phase 5)
 *
 * Usage: pnpm run seed:nutrition-templates
 *
 * Behavior:
 * - Upserts by (ownership.type=system, isTemplate=true, templateKey)
 * - Resolves foods from system Food catalog by source.externalId
 * - Never deletes plans
 * - Never modifies trainer-owned plans
 * - Safe / idempotent to re-run
 */

import 'dotenv/config';
import mongoose from 'mongoose';

import Food from '../src/modules/foods/food.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import { buildFoodSnapshot } from '../src/modules/foods/food.helpers.js';
import { applyPlanDenormalizedCounters } from '../src/modules/nutrition-plans/nutrition-plan.helpers.js';

const SEED_PROVIDER = 'fitlypro';

const TEMPLATE_KEYS = Object.freeze([
    'weight-loss-beginner',
    'weight-loss-high-protein',
    'maintenance-balanced',
    'muscle-gain-beginner',
    'muscle-gain-high-protein',
    'body-recomposition',
    'high-protein',
    'general-health',
]);

const TEMPLATE_ICONS = Object.freeze({
    'weight-loss-beginner': 'lucide:scale',
    'weight-loss-high-protein': 'lucide:dumbbell',
    'maintenance-balanced': 'lucide:balance-scale',
    'muscle-gain-beginner': 'lucide:trending-up',
    'muscle-gain-high-protein': 'lucide:beef',
    'body-recomposition': 'lucide:activity',
    'high-protein': 'lucide:egg',
    'general-health': 'lucide:heart',
});

/**
 * @param {import('mongoose').Document} food
 * @param {number} order
 * @param {number} quantity
 * @param {string} unit
 */
const foodItem = (food, order, quantity, unit) => ({
    foodId: food._id,
    order,
    quantity,
    unit,
    notes: null,
    foodSnapshot: buildFoodSnapshot(food),
});

/**
 * @param {Record<string, import('mongoose').Document>} foods
 * @param {Array<{ name: string, mealType: string, suggestedTime?: string, items: Array<{ key: string, quantity: number, unit: string }> }>} meals
 */
const buildStarterDay = (foods, meals) => ({
    dayNumber: 1,
    name: 'Day 1',
    notes: 'Starter example day — edit meals and foods to fit your client.',
    meals: meals.map((meal, mealIndex) => ({
        order: mealIndex + 1,
        name: meal.name,
        mealType: meal.mealType,
        suggestedTime: meal.suggestedTime ?? null,
        notes: null,
        foodItems: meal.items.map((item, itemIndex) =>
            foodItem(foods[item.key], itemIndex + 1, item.quantity, item.unit)
        ),
    })),
});

const STARTER_MEALS = Object.freeze({
    balanced: [
        {
            name: 'Breakfast',
            mealType: 'breakfast',
            suggestedTime: '08:00',
            items: [
                { key: 'oats', quantity: 40, unit: 'g' },
                { key: 'banana', quantity: 1, unit: 'piece' },
            ],
        },
        {
            name: 'Lunch',
            mealType: 'lunch',
            suggestedTime: '13:00',
            items: [
                { key: 'chicken-breast', quantity: 120, unit: 'g' },
                { key: 'white-rice', quantity: 150, unit: 'g' },
                { key: 'olive-oil', quantity: 5, unit: 'ml' },
            ],
        },
        {
            name: 'Dinner',
            mealType: 'dinner',
            suggestedTime: '19:00',
            items: [
                { key: 'salmon', quantity: 120, unit: 'g' },
                { key: 'sweet-potato', quantity: 1, unit: 'piece' },
            ],
        },
        {
            name: 'Snack',
            mealType: 'snack',
            suggestedTime: '16:00',
            items: [
                { key: 'greek-yogurt', quantity: 1, unit: 'serving' },
                { key: 'apple', quantity: 1, unit: 'piece' },
            ],
        },
    ],
    highProtein: [
        {
            name: 'Breakfast',
            mealType: 'breakfast',
            suggestedTime: '07:30',
            items: [
                { key: 'eggs-whole', quantity: 3, unit: 'piece' },
                { key: 'bread-whole-wheat', quantity: 1, unit: 'serving' },
            ],
        },
        {
            name: 'Lunch',
            mealType: 'lunch',
            suggestedTime: '12:30',
            items: [
                { key: 'chicken-breast', quantity: 150, unit: 'g' },
                { key: 'brown-rice', quantity: 150, unit: 'g' },
            ],
        },
        {
            name: 'Dinner',
            mealType: 'dinner',
            suggestedTime: '19:00',
            items: [
                { key: 'beef-sirloin', quantity: 150, unit: 'g' },
                { key: 'potato', quantity: 1, unit: 'piece' },
            ],
        },
        {
            name: 'Snack',
            mealType: 'snack',
            suggestedTime: '15:30',
            items: [
                { key: 'tuna-canned', quantity: 1, unit: 'serving' },
                { key: 'greek-yogurt', quantity: 1, unit: 'serving' },
            ],
        },
    ],
    muscleGain: [
        {
            name: 'Breakfast',
            mealType: 'breakfast',
            suggestedTime: '08:00',
            items: [
                { key: 'oats', quantity: 60, unit: 'g' },
                { key: 'milk-whole', quantity: 250, unit: 'ml' },
                { key: 'banana', quantity: 1, unit: 'piece' },
            ],
        },
        {
            name: 'Lunch',
            mealType: 'lunch',
            suggestedTime: '13:00',
            items: [
                { key: 'chicken-breast', quantity: 180, unit: 'g' },
                { key: 'white-rice', quantity: 200, unit: 'g' },
                { key: 'olive-oil', quantity: 10, unit: 'ml' },
            ],
        },
        {
            name: 'Dinner',
            mealType: 'dinner',
            suggestedTime: '19:00',
            items: [
                { key: 'salmon', quantity: 150, unit: 'g' },
                { key: 'sweet-potato', quantity: 1, unit: 'piece' },
            ],
        },
        {
            name: 'Snack',
            mealType: 'snack',
            suggestedTime: '16:00',
            items: [
                { key: 'peanut-butter', quantity: 1, unit: 'serving' },
                { key: 'bread-whole-wheat', quantity: 1, unit: 'serving' },
            ],
        },
    ],
    light: [
        {
            name: 'Breakfast',
            mealType: 'breakfast',
            suggestedTime: '08:00',
            items: [
                { key: 'greek-yogurt', quantity: 1, unit: 'serving' },
                { key: 'apple', quantity: 1, unit: 'piece' },
            ],
        },
        {
            name: 'Lunch',
            mealType: 'lunch',
            suggestedTime: '13:00',
            items: [
                { key: 'tuna-canned', quantity: 1, unit: 'serving' },
                { key: 'white-rice', quantity: 120, unit: 'g' },
            ],
        },
        {
            name: 'Dinner',
            mealType: 'dinner',
            suggestedTime: '19:00',
            items: [
                { key: 'chicken-breast', quantity: 120, unit: 'g' },
                { key: 'potato', quantity: 1, unit: 'piece' },
            ],
        },
        {
            name: 'Snack',
            mealType: 'snack',
            suggestedTime: '16:00',
            items: [{ key: 'banana', quantity: 1, unit: 'piece' }],
        },
    ],
});

const buildTemplates = (foods) => [
    {
        templateKey: 'weight-loss-beginner',
        name: 'Weight Loss — Beginner',
        description:
            'Starter example plan with moderate calories. Edit meals and portions for each client.',
        goal: 'weight_loss',
        duration: 8,
        daysCount: 7,
        macroTargets: { calories: 1700, protein: 120, carbs: 170, fat: 55 },
        nutritionDays: [buildStarterDay(foods, STARTER_MEALS.light)],
    },
    {
        templateKey: 'weight-loss-high-protein',
        name: 'Weight Loss — High Protein',
        description:
            'Higher-protein starter example for weight management. Adjust targets and foods as needed.',
        goal: 'weight_loss',
        duration: 8,
        daysCount: 7,
        macroTargets: { calories: 1800, protein: 150, carbs: 150, fat: 55 },
        nutritionDays: [buildStarterDay(foods, STARTER_MEALS.highProtein)],
    },
    {
        templateKey: 'maintenance-balanced',
        name: 'Maintenance — Balanced',
        description:
            'Balanced starter example for general maintenance. Customize days and macro targets.',
        goal: 'maintenance',
        duration: 8,
        daysCount: 7,
        macroTargets: { calories: 2200, protein: 140, carbs: 250, fat: 70 },
        nutritionDays: [buildStarterDay(foods, STARTER_MEALS.balanced)],
    },
    {
        templateKey: 'muscle-gain-beginner',
        name: 'Muscle Gain — Beginner',
        description:
            'Higher-calorie starter example for muscle gain. Edit foods and portions per client.',
        goal: 'muscle_gain',
        duration: 12,
        daysCount: 7,
        macroTargets: { calories: 2600, protein: 160, carbs: 300, fat: 75 },
        nutritionDays: [buildStarterDay(foods, STARTER_MEALS.muscleGain)],
    },
    {
        templateKey: 'muscle-gain-high-protein',
        name: 'Muscle Gain — High Protein',
        description:
            'High-protein muscle gain starter example. Adjust calories and meals for each trainee.',
        goal: 'muscle_gain',
        duration: 12,
        daysCount: 7,
        macroTargets: { calories: 3000, protein: 200, carbs: 320, fat: 80 },
        nutritionDays: [buildStarterDay(foods, STARTER_MEALS.highProtein)],
    },
    {
        templateKey: 'body-recomposition',
        name: 'Body Recomposition',
        description:
            'Balanced starter example for body recomposition goals. Fully editable by the trainer.',
        goal: 'body_recomp',
        duration: 10,
        daysCount: 7,
        macroTargets: { calories: 2400, protein: 170, carbs: 240, fat: 70 },
        nutritionDays: [buildStarterDay(foods, STARTER_MEALS.balanced)],
    },
    {
        templateKey: 'high-protein',
        name: 'High Protein',
        description:
            'Protein-forward starter example. Swap foods and adjust macro targets as needed.',
        goal: 'high_protein',
        duration: 8,
        daysCount: 7,
        macroTargets: { calories: 2500, protein: 190, carbs: 220, fat: 70 },
        nutritionDays: [buildStarterDay(foods, STARTER_MEALS.highProtein)],
    },
    {
        templateKey: 'general-health',
        name: 'General Health',
        description:
            'Simple balanced starter example for general health habits. Not a medical prescription.',
        goal: 'general_health',
        duration: 8,
        daysCount: 7,
        macroTargets: { calories: 2000, protein: 130, carbs: 220, fat: 65 },
        nutritionDays: [buildStarterDay(foods, STARTER_MEALS.balanced)],
    },
];

const loadSystemFoods = async () => {
    const externalIds = [
        'chicken-breast',
        'eggs-whole',
        'white-rice',
        'brown-rice',
        'oats',
        'greek-yogurt',
        'milk-whole',
        'banana',
        'apple',
        'potato',
        'sweet-potato',
        'salmon',
        'tuna-canned',
        'beef-sirloin',
        'olive-oil',
        'peanut-butter',
        'bread-whole-wheat',
    ];

    const foods = await Food.find({
        'ownership.type': 'system',
        'source.externalProvider': SEED_PROVIDER,
        'source.externalId': { $in: externalIds },
    });

    const map = {};
    for (const food of foods) {
        map[food.source.externalId] = food;
    }

    const missing = externalIds.filter((id) => !map[id]);
    if (missing.length) {
        throw new Error(
            `Missing system foods: ${missing.join(', ')}. Run pnpm run seed:foods first.`
        );
    }

    return map;
};

const upsertTemplate = async (template) => {
    const existing = await NutritionPlan.findOne({
        'ownership.type': 'system',
        isTemplate: true,
        templateKey: template.templateKey,
    });

    const payload = {
        ownership: { type: 'system', trainerId: null },
        trainerId: null,
        templateKey: template.templateKey,
        icon: TEMPLATE_ICONS[template.templateKey] ?? 'lucide:apple',
        name: template.name,
        description: template.description,
        goal: template.goal,
        duration: template.duration,
        daysCount: template.daysCount,
        macroTargets: template.macroTargets,
        nutritionDays: template.nutritionDays,
        isTemplate: true,
        status: 'active',
        notes: null,
    };

    if (existing) {
        Object.assign(existing, payload);
        existing.markModified('nutritionDays');
        existing.markModified('ownership');
        applyPlanDenormalizedCounters(existing);
        await existing.save();
        return 'updated';
    }

    const plan = new NutritionPlan(payload);
    applyPlanDenormalizedCounters(plan);
    await plan.save();
    return 'created';
};

const main = async () => {
    const dbUrl = process.env.APP_DB_URL;
    if (!dbUrl) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(dbUrl);
    console.log('Connected to MongoDB');

    const trainerPlanCountBefore = await NutritionPlan.countDocuments({
        $or: [
            { 'ownership.type': 'trainer' },
            { ownership: { $exists: false }, trainerId: { $ne: null } },
        ],
    });

    const foods = await loadSystemFoods();
    console.log(`Loaded ${Object.keys(foods).length} system foods`);

    const templates = buildTemplates(foods);

    if (templates.length !== TEMPLATE_KEYS.length) {
        throw new Error('Template count mismatch with TEMPLATE_KEYS');
    }

    const stats = { created: 0, updated: 0, skipped: 0, errors: [] };

    for (const template of templates) {
        try {
            const result = await upsertTemplate(template);
            stats[result] += 1;
            console.log(`${result.toUpperCase()}: ${template.templateKey} (${template.name})`);
        } catch (err) {
            stats.errors.push(`${template.templateKey}: ${err.message}`);
            console.error(`ERROR: ${template.templateKey} — ${err.message}`);
        }
    }

    const systemCount = await NutritionPlan.countDocuments({
        'ownership.type': 'system',
        isTemplate: true,
        templateKey: { $in: TEMPLATE_KEYS },
    });

    const trainerPlanCountAfter = await NutritionPlan.countDocuments({
        $or: [
            { 'ownership.type': 'trainer' },
            { ownership: { $exists: false }, trainerId: { $ne: null } },
        ],
    });

    console.log('\nSeed summary');
    console.log(`  Created: ${stats.created}`);
    console.log(`  Updated: ${stats.updated}`);
    console.log(`  Skipped: ${stats.skipped}`);
    console.log(`  Errors: ${stats.errors.length}`);
    console.log(`  System templates with seed keys: ${systemCount}`);
    console.log(
        `  Trainer plans before/after: ${trainerPlanCountBefore}/${trainerPlanCountAfter}`
    );

    await mongoose.disconnect();

    if (stats.errors.length) {
        process.exit(1);
    }
};

main().catch(async (err) => {
    console.error(err);
    try {
        await mongoose.disconnect();
    } catch {
        // ignore
    }
    process.exit(1);
});
