/**
 * Nutrition plan list enrichment (template card fields).
 * Run: node scripts/test-nutrition-plans-list-enrichment.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import nutritionPlanService from '../src/modules/nutrition-plans/nutrition-plan.service.js';
import {
    mapNutritionPlanListItem,
    mapNutritionPlanToDetail,
    applyPlanDenormalizedCounters,
    countTotalMeals,
    pickCanonicalPreviewMeals,
    buildNutritionPlanMealsPreview,
} from '../src/modules/nutrition-plans/nutrition-plan.helpers.js';
import { calculatePlanComputedMacros } from '../src/modules/nutrition-plans/nutrition-plan.calculations.js';

const results = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};

const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const sampleSnapshot = (name) => ({
    name,
    brand: null,
    category: 'protein',
    nutritionPer100g: { calories: 100, protein: 10, carbs: 5, fat: 2 },
    defaultServing: { quantity: 100, unit: 'g', gramWeight: 100 },
});

function buildRichPlanDoc(overrides = {}) {
    const nutritionDays = [
        {
            dayNumber: 2,
            name: 'Day B',
            meals: [
                {
                    order: 2,
                    name: 'Second',
                    foodItems: [
                        {
                            order: 1,
                            foodId: new mongoose.Types.ObjectId(),
                            quantity: 100,
                            unit: 'g',
                            foodSnapshot: sampleSnapshot('Should not preview first'),
                        },
                    ],
                },
            ],
        },
        {
            dayNumber: 1,
            name: 'Day A',
            meals: [
                {
                    order: 2,
                    name: 'Lunch',
                    foodItems: [
                        {
                            order: 2,
                            foodId: new mongoose.Types.ObjectId(),
                            quantity: 100,
                            unit: 'g',
                            foodSnapshot: sampleSnapshot('Rice'),
                        },
                        {
                            order: 1,
                            foodId: new mongoose.Types.ObjectId(),
                            quantity: 100,
                            unit: 'g',
                            foodSnapshot: sampleSnapshot('Chicken'),
                        },
                    ],
                },
                {
                    order: 1,
                    name: 'Breakfast',
                    foodItems: [
                        {
                            order: 1,
                            foodId: new mongoose.Types.ObjectId(),
                            quantity: 100,
                            unit: 'g',
                            foodSnapshot: sampleSnapshot('Oats'),
                        },
                        {
                            order: 2,
                            foodId: new mongoose.Types.ObjectId(),
                            quantity: 100,
                            unit: 'g',
                            foodSnapshot: sampleSnapshot('Eggs'),
                        },
                    ],
                },
            ],
        },
    ];

    const plan = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Lean Muscle Builder',
        description: 'A balanced plan designed to support lean muscle growth.',
        goal: 'muscle_gain',
        duration: 8,
        daysCount: 7,
        macroTargets: { calories: 2600, protein: 166, carbs: 245, fat: 52 },
        nutritionDays,
        isTemplate: true,
        status: 'active',
        ownership: { type: 'system' },
        icon: 'lucide:utensils',
        ...overrides,
    };

    applyPlanDenormalizedCounters(plan);
    return plan;
}

async function main() {
    const rich = buildRichPlanDoc();
    const listItem = mapNutritionPlanListItem(rich);
    const detail = mapNutritionPlanToDetail(rich);

    if (listItem.description === rich.description) {
        pass('1. Description returned on list item');
    } else {
        fail('1. Description', JSON.stringify(listItem.description));
    }

    if (
        listItem.mealCount === countTotalMeals(rich.nutritionDays) &&
        listItem.mealCount === listItem.totalMeals
    ) {
        pass('2. mealCount matches total meals in plan');
    } else {
        fail('2. mealCount', `${listItem.mealCount} vs ${countTotalMeals(rich.nutritionDays)}`);
    }

    const preview = listItem.mealsPreview ?? [];
    if (
        preview.length === 2 &&
        preview[0].name === 'Breakfast' &&
        preview[1].name === 'Lunch' &&
        JSON.stringify(preview[0].foods) === JSON.stringify(['Oats', 'Eggs']) &&
        JSON.stringify(preview[1].foods) === JSON.stringify(['Chicken', 'Rice'])
    ) {
        pass('3. Meal and food ordering preserved in mealsPreview');
    } else {
        fail('3. Ordering', JSON.stringify(preview));
    }

    const empty = mapNutritionPlanListItem(
        buildRichPlanDoc({
            description: null,
            nutritionDays: [],
            macroTargets: { calories: 2000, protein: 0, carbs: 0, fat: 0 },
        })
    );
    if (empty.description === null && empty.mealsPreview.length === 0 && empty.mealCount === 0) {
        pass('4. Missing description and empty meals handled');
    } else {
        fail('4. Empty handling', JSON.stringify(empty));
    }

    if (listItem.avgDailyCalories === detail.avgDailyCalories) {
        pass('5a. list avgDailyCalories matches detail avgDailyCalories');
    } else {
        fail('5a. avgDailyCalories', `list=${listItem.avgDailyCalories} detail=${detail.avgDailyCalories}`);
    }

    if (
        listItem.avgDailyCalories > 0 &&
        listItem.dailyCalories === listItem.avgDailyCalories &&
        listItem.dailyCalories !== detail.macroTargets.calories
    ) {
        pass('5b. dailyCalories prefers meal-derived avg when it differs from macroTargets.calories');
    } else {
        fail(
            '5b. dailyCalories precedence',
            `daily=${listItem.dailyCalories} avg=${listItem.avgDailyCalories} target=${detail.macroTargets.calories}`
        );
    }

    const targetOnlyPlan = buildRichPlanDoc({
        nutritionDays: [],
        macroTargets: { calories: 2600, protein: 166, carbs: 245, fat: 52 },
    });
    const targetOnlyList = mapNutritionPlanListItem(targetOnlyPlan);
    const targetOnlyDetail = mapNutritionPlanToDetail(targetOnlyPlan);
    if (
        targetOnlyList.avgDailyCalories === 0 &&
        targetOnlyList.dailyCalories === 2600 &&
        targetOnlyDetail.avgDailyCalories === 0
    ) {
        pass('5c. dailyCalories falls back to macroTargets.calories when meal avg is 0');
    } else {
        fail('5c. target fallback', JSON.stringify(targetOnlyList));
    }

    const staleAvgPlan = buildRichPlanDoc();
    staleAvgPlan.avgDailyCalories = 1800;
    const staleList = mapNutritionPlanListItem(staleAvgPlan);
    const staleDetail = mapNutritionPlanToDetail(staleAvgPlan);
    if (
        staleList.avgDailyCalories === staleDetail.avgDailyCalories &&
        staleList.dailyCalories === 1800 &&
        staleDetail.computedMacros.avgDailyCalories !== 1800
    ) {
        pass('5d. list/detail avgDailyCalories honor stored denormalized value over recomputed meals');
    } else {
        fail(
            '5d. stale avg',
            JSON.stringify({
                listAvg: staleList.avgDailyCalories,
                detailAvg: staleDetail.avgDailyCalories,
                computed: staleDetail.computedMacros.avgDailyCalories,
            })
        );
    }

    if (
        listItem.macros?.protein === detail.macroTargets.protein &&
        listItem.macros?.carbs === detail.macroTargets.carbs &&
        listItem.macros?.fat === detail.macroTargets.fat
    ) {
        pass('6a. macros grams match macroTargets (detail)');
    } else {
        fail('6a. macros', JSON.stringify(listItem.macros));
    }

    const partialZero = mapNutritionPlanListItem(
        buildRichPlanDoc({
            macroTargets: { calories: 2000, protein: 0, carbs: 200, fat: 60 },
        })
    );
    if (
        partialZero.macros?.protein === 0 &&
        partialZero.macros?.carbs === 200 &&
        partialZero.macros?.fat === 60
    ) {
        pass('6b. partial-zero macroTargets preserved (protein 0)');
    } else {
        fail('6b. partial zero', JSON.stringify(partialZero.macros));
    }

    const computedFallbackPlan = buildRichPlanDoc({
        macroTargets: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    const computedFallbackList = mapNutritionPlanListItem(computedFallbackPlan);
    const computed = calculatePlanComputedMacros(computedFallbackPlan.nutritionDays);
    if (
        computedFallbackList.macros?.protein > 0 &&
        computedFallbackList.macros.protein ===
            Math.round((computed.avgDailyProtein ?? 0) * 10) / 10
    ) {
        pass('6c. macros fall back to computed meal averages when all macroTargets grams are 0');
    } else {
        fail('6c. computed fallback', JSON.stringify(computedFallbackList.macros));
    }

    const dayOrderPlan = buildRichPlanDoc({
        nutritionDays: [
            { dayNumber: 1, name: 'Empty', meals: [] },
            {
                dayNumber: 3,
                name: 'Third',
                meals: [
                    {
                        order: 1,
                        name: 'Snack',
                        foodItems: [
                            {
                                order: 1,
                                foodId: new mongoose.Types.ObjectId(),
                                quantity: 100,
                                unit: 'g',
                                foodSnapshot: sampleSnapshot('Almonds'),
                            },
                        ],
                    },
                ],
            },
        ],
    });
    const previewDay = buildNutritionPlanMealsPreview(dayOrderPlan.nutritionDays);
    const canonical = pickCanonicalPreviewMeals(dayOrderPlan.nutritionDays);
    if (previewDay.length === 1 && previewDay[0].name === 'Snack' && previewDay[0].foods[0] === 'Almonds') {
        pass('7a. canonical preview day is first by dayNumber with meals');
    } else {
        fail('7a. canonical day', JSON.stringify(previewDay));
    }
    if (canonical.length === 1 && canonical[0].name === 'Snack') {
        pass('7b. pickCanonicalPreviewMeals matches preview builder');
    } else {
        fail('7b. canonical meals', JSON.stringify(canonical));
    }

    const multiDayPreview = mapNutritionPlanListItem(rich);
    if (multiDayPreview.mealsPreview.length === 2 && multiDayPreview.mealCount === 3) {
        pass('7c. mealCount is all days; mealsPreview is one canonical day only');
    } else {
        fail(
            '7c. mealCount vs preview',
            `count=${multiDayPreview.mealCount} previewMeals=${multiDayPreview.mealsPreview.length}`
        );
    }

    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const trainer = await User.create({
        firstName: 'List',
        lastName: 'Enrichment',
        email: `np-list-${suffix}@test.com`,
        password: 'testpass123',
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'List',
        lastName: 'Other',
        email: `np-list-b-${suffix}@test.com`,
        password: 'testpass123',
        role: 'trainer',
    });

    const ownPlan = new NutritionPlan({
        trainerId: trainer._id,
        ownership: { type: 'trainer', trainerId: trainer._id },
        name: `Own Plan ${suffix}`,
        description: 'Trainer plan',
        goal: 'maintenance',
        duration: 4,
        daysCount: 1,
        macroTargets: { calories: 2100, protein: 140, carbs: 200, fat: 60 },
        nutritionDays: rich.nutritionDays,
        isTemplate: false,
        status: 'active',
    });
    applyPlanDenormalizedCounters(ownPlan);
    await ownPlan.save();

    const systemTemplate = new NutritionPlan({
        trainerId: null,
        ownership: { type: 'system' },
        templateKey: `list-enrich-${suffix}`,
        name: `System Template ${suffix}`,
        description: 'System template',
        goal: 'muscle_gain',
        duration: 8,
        daysCount: 7,
        macroTargets: rich.macroTargets,
        nutritionDays: rich.nutritionDays,
        isTemplate: true,
        status: 'active',
    });
    applyPlanDenormalizedCounters(systemTemplate);
    await systemTemplate.save();

    const listOwn = await nutritionPlanService.listNutritionPlans(
        { ownership: 'trainer', page: 1, limit: 50 },
        trainer._id.toString()
    );
    const ownRow = listOwn.nutritionPlans.find((p) => p.id === ownPlan._id.toString());
    if (ownRow?.mealsPreview?.length === 2 && ownRow.description === 'Trainer plan') {
        pass('8. Trainer list rows include enrichment fields');
    } else {
        fail('8. Trainer list', JSON.stringify(ownRow));
    }

    const listTemplates = await nutritionPlanService.listNutritionPlans(
        {
            ownership: 'system',
            isTemplate: true,
            status: 'active',
            goal: 'muscle_gain',
            search: `System Template ${suffix}`,
            page: 1,
            limit: 10,
        },
        trainer._id.toString()
    );
    const templateRow = listTemplates.nutritionPlans.find(
        (p) => p.id === systemTemplate._id.toString()
    );
    if (templateRow?.macros?.protein === 166 && listTemplates.pagination.total >= 1) {
        pass('9. Template filters + pagination unchanged with enrichment');
    } else {
        fail('9. Template filters', JSON.stringify({ templateRow, pagination: listTemplates.pagination }));
    }

    const legacyShape = listOwn.nutritionPlans.find((p) => p.id === ownPlan._id.toString());
    if (
        legacyShape?.id &&
        legacyShape?.macroTargets &&
        typeof legacyShape.avgDailyCalories === 'number'
    ) {
        pass('10. Legacy list fields still present');
    } else {
        fail('10. Legacy fields', JSON.stringify(legacyShape));
    }

    const foreignList = await nutritionPlanService.listNutritionPlans(
        { ownership: 'trainer', page: 1, limit: 50 },
        trainerB._id.toString()
    );
    if (!foreignList.nutritionPlans.some((p) => p.id === ownPlan._id.toString())) {
        pass('11. Other trainer cannot list foreign plan');
    } else {
        fail('11. Authorization leak', 'foreign trainer saw private plan');
    }

    let findCallCount = 0;
    const originalFind = NutritionPlan.find.bind(NutritionPlan);
    NutritionPlan.find = function patchedFind(...args) {
        findCallCount += 1;
        return originalFind(...args);
    };

    await nutritionPlanService.listNutritionPlans(
        { ownership: 'system', isTemplate: true, status: 'active', page: 1, limit: 5 },
        trainer._id.toString()
    );

    NutritionPlan.find = originalFind;

    if (findCallCount === 1) {
        pass('12. List uses single find query (no per-row detail fetch)');
    } else {
        fail('12. Query count', `find called ${findCallCount} times`);
    }

    await NutritionPlan.deleteMany({
        _id: { $in: [ownPlan._id, systemTemplate._id] },
    });
    await User.deleteMany({ _id: { $in: [trainer._id, trainerB._id] } });
    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);

    if (failed.length) {
        process.exit(1);
    }

    console.log('\nSample list item (sanitized):');
    console.log(
        JSON.stringify(
            {
                id: listItem.id,
                name: listItem.name,
                description: listItem.description,
                goal: listItem.goal,
                dailyCalories: listItem.dailyCalories,
                macros: listItem.macros,
                mealCount: listItem.mealCount,
                mealsPreview: listItem.mealsPreview,
            },
            null,
            2
        )
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
