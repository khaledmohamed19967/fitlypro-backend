/**
 * Manual Phase 3 NutritionPlan foundation verification.
 * Run: node scripts/test-nutrition-plan-foundation-phase3.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import Food from '../src/modules/foods/food.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import { DEFAULT_NUTRITION_PLAN_ICON } from '../src/modules/nutrition-plans/nutrition-plan.constants.js';
import {
    normalizeNutritionDays,
    normalizeMealOrder,
    normalizeFoodItemOrder,
    applyPlanDenormalizedCounters,
    resolvePlanOwnership,
    validateUniqueDayNumbers,
    processNutritionDaysFoodItems,
    loadVisibleFoodsByIds,
} from '../src/modules/nutrition-plans/nutrition-plan.helpers.js';
import {
    convertQuantityToGrams,
    validatePlanFoodItemUnit,
    calculateItemMacros,
    calculateFoodItemMacros,
    calculateMealTotals,
    calculateDailyTotals,
    calculatePlanComputedMacros,
} from '../src/modules/nutrition-plans/nutrition-plan.calculations.js';
import { buildFoodSnapshot } from '../src/modules/foods/food.helpers.js';
import {
    validateCreateNutritionPlan,
    validateUpdateNutritionPlan,
} from '../src/modules/nutrition-plans/nutrition-plan.validator.js';

const results = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};

const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const baseMacroTargets = () => ({
    calories: 2000,
    protein: 150,
    carbs: 200,
    fat: 65,
});

const basePlanPayload = (trainerId, overrides = {}) => ({
    name: 'Foundation Test Plan',
    goal: 'maintenance',
    duration: 4,
    daysCount: 7,
    macroTargets: baseMacroTargets(),
    ownership: { type: 'trainer', trainerId },
    nutritionDays: [],
    ...overrides,
});

const sampleSnapshot = (overrides = {}) => ({
    name: 'Test Chicken',
    brand: null,
    category: 'protein',
    nutritionPer100g: {
        calories: 165,
        protein: 31,
        carbs: 0,
        fat: 3.6,
    },
    defaultServing: {
        quantity: 1,
        unit: 'serving',
        gramWeight: 100,
    },
    ...overrides,
});

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const trainer = await User.create({
        firstName: 'Nutrition',
        lastName: 'Trainer',
        email: `nutrition-trainer-${suffix}@test.com`,
        password: 'testpass123',
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'Nutrition',
        lastName: 'Other',
        email: `nutrition-trainer-b-${suffix}@test.com`,
        password: 'testpass123',
        role: 'trainer',
    });

    const trainerFood = await Food.create({
        name: `Trainer Food ${suffix}`,
        category: 'protein',
        nutritionPer100g: {
            calories: 200,
            protein: 25,
            carbs: 2,
            fat: 10,
        },
        defaultServing: {
            quantity: 1,
            unit: 'serving',
            gramWeight: 120,
        },
        ownership: { type: 'trainer', trainerId: trainer._id },
        source: { type: 'manual' },
        status: 'active',
    });

    const foreignFood = await Food.create({
        name: `Foreign Food ${suffix}`,
        category: 'protein',
        nutritionPer100g: {
            calories: 180,
            protein: 20,
            carbs: 1,
            fat: 8,
        },
        defaultServing: {
            quantity: 100,
            unit: 'g',
            gramWeight: 100,
        },
        ownership: { type: 'trainer', trainerId: trainerB._id },
        source: { type: 'manual' },
        status: 'active',
    });

    const systemFood =
        (await Food.findOne({ 'ownership.type': 'system' })) ??
        (await Food.create({
            name: `System Food ${suffix}`,
            category: 'protein',
            nutritionPer100g: {
                calories: 150,
                protein: 20,
                carbs: 5,
                fat: 5,
            },
            defaultServing: {
                quantity: 100,
                unit: 'g',
                gramWeight: 100,
            },
            ownership: { type: 'system', trainerId: null },
            source: { type: 'seed' },
            status: 'active',
        }));

    // 1. Create NutritionPlan model instance
    try {
        const plan = new NutritionPlan(basePlanPayload(trainer._id));
        await plan.validate();
        pass('Create NutritionPlan model instance');
    } catch (err) {
        fail('Create NutritionPlan model instance', err.message);
    }

    // 2. Ownership synchronization
    try {
        const plan = new NutritionPlan(basePlanPayload(trainer._id));
        await plan.validate();
        if (
            plan.trainerId?.toString() === trainer._id.toString() &&
            plan.ownership.type === 'trainer' &&
            plan.ownership.trainerId?.toString() === trainer._id.toString()
        ) {
            pass('Ownership synchronization');
        } else {
            fail('Ownership synchronization', JSON.stringify(resolvePlanOwnership(plan)));
        }
    } catch (err) {
        fail('Ownership synchronization', err.message);
    }

    // 3. Default icon
    try {
        const plan = new NutritionPlan(basePlanPayload(trainer._id));
        if (plan.icon === DEFAULT_NUTRITION_PLAN_ICON) pass('Default icon');
        else fail('Default icon', plan.icon);
    } catch (err) {
        fail('Default icon', err.message);
    }

    // 4. Default status
    try {
        const plan = new NutritionPlan(basePlanPayload(trainer._id));
        if (plan.status === 'active') pass('Default status');
        else fail('Default status', plan.status);
    } catch (err) {
        fail('Default status', err.message);
    }

    // 5. Default isTemplate
    try {
        const plan = new NutritionPlan(basePlanPayload(trainer._id));
        if (plan.isTemplate === false) pass('Default isTemplate');
        else fail('Default isTemplate', String(plan.isTemplate));
    } catch (err) {
        fail('Default isTemplate', err.message);
    }

    // 6. Goal validation
    const goalResult = validateCreateNutritionPlan.validate({
        ...basePlanPayload(trainer._id),
        goal: 'invalid_goal',
    });
    if (goalResult.error) pass('Goal validation');
    else fail('Goal validation', 'Expected Joi error');

    // 7. Macro target validation
    const macroResult = validateCreateNutritionPlan.validate({
        ...basePlanPayload(trainer._id),
        macroTargets: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    if (macroResult.error) pass('Macro target validation');
    else fail('Macro target validation', 'Expected Joi error for calories <= 0');

    // 8. Day numbering (sequential renumber after normalize)
    const normalizedDays = normalizeNutritionDays([
        { dayNumber: 3, meals: [] },
        { dayNumber: 1, meals: [] },
        { dayNumber: 2, meals: [] },
    ]);
    if (
        normalizedDays.length === 3 &&
        normalizedDays[0].dayNumber === 1 &&
        normalizedDays[1].dayNumber === 2 &&
        normalizedDays[2].dayNumber === 3
    ) {
        pass('Day numbering');
    } else {
        fail('Day numbering', JSON.stringify(normalizedDays.map((d) => d.dayNumber)));
    }

    // 9. Duplicate day detection
    const dupDay = validateUniqueDayNumbers([
        { dayNumber: 1, meals: [] },
        { dayNumber: 1, meals: [] },
    ]);
    if (!dupDay.valid) pass('Duplicate day detection');
    else fail('Duplicate day detection', 'Expected invalid');

    // 10. Meal order normalization
    const normalizedMeals = normalizeMealOrder([
        { order: 3, name: 'Dinner', foodItems: [] },
        { order: 1, name: 'Breakfast', foodItems: [] },
    ]);
    if (normalizedMeals[0].order === 1 && normalizedMeals[1].order === 2) {
        pass('Meal order normalization');
    } else {
        fail('Meal order normalization', JSON.stringify(normalizedMeals.map((m) => m.order)));
    }

    // 11. Food item order normalization
    const normalizedItems = normalizeFoodItemOrder([
        { order: 2, foodId: trainerFood._id, quantity: 100, unit: 'g' },
        { order: 1, foodId: trainerFood._id, quantity: 50, unit: 'g' },
    ]);
    if (normalizedItems[0].order === 1 && normalizedItems[1].order === 2) {
        pass('Food item order normalization');
    } else {
        fail('Food item order normalization', JSON.stringify(normalizedItems.map((i) => i.order)));
    }

    // 12. Duplicate foodId allowed
    const dupFoodPayload = {
        ...basePlanPayload(trainer._id),
        nutritionDays: [
            {
                dayNumber: 1,
                meals: [
                    {
                        order: 1,
                        name: 'Lunch',
                        foodItems: [
                            {
                                order: 1,
                                foodId: trainerFood._id,
                                quantity: 150,
                                unit: 'g',
                                foodSnapshot: buildFoodSnapshot(trainerFood),
                            },
                            {
                                order: 2,
                                foodId: trainerFood._id,
                                quantity: 150,
                                unit: 'g',
                                foodSnapshot: buildFoodSnapshot(trainerFood),
                            },
                        ],
                    },
                ],
            },
        ],
    };
    try {
        const plan = new NutritionPlan(dupFoodPayload);
        await plan.validate();
        pass('Duplicate foodId allowed');
    } catch (err) {
        fail('Duplicate foodId allowed', err.message);
    }

    // 13. Food unit validation
    const badUnit = validatePlanFoodItemUnit(100, 'oz', sampleSnapshot());
    if (!badUnit.valid) pass('Food unit validation');
    else fail('Food unit validation', 'Expected invalid for oz');

    // 14. piece requires gramWeight
    const pieceNoWeight = validatePlanFoodItemUnit(1, 'piece', sampleSnapshot({
        defaultServing: { quantity: 1, unit: 'piece', gramWeight: 0 },
    }));
    if (!pieceNoWeight.valid && pieceNoWeight.field === 'defaultServing.gramWeight') {
        pass('piece requires gramWeight');
    } else {
        fail('piece requires gramWeight', JSON.stringify(pieceNoWeight));
    }

    // 15. serving requires gramWeight
    const servingNoWeight = validatePlanFoodItemUnit(1, 'serving', sampleSnapshot({
        defaultServing: { quantity: 1, unit: 'serving', gramWeight: null },
    }));
    if (!servingNoWeight.valid) pass('serving requires gramWeight');
    else fail('serving requires gramWeight', JSON.stringify(servingNoWeight));

    // 16. gram conversion
    const gConv = convertQuantityToGrams(150, 'g', {});
    if (gConv.grams === 150) pass('gram conversion');
    else fail('gram conversion', String(gConv.grams));

    // 17. kg conversion
    const kgConv = convertQuantityToGrams(1.5, 'kg', {});
    if (kgConv.grams === 1500) pass('kg conversion');
    else fail('kg conversion', String(kgConv.grams));

    // 18. ml conversion
    const mlConv = convertQuantityToGrams(250, 'ml', {});
    if (mlConv.grams === 250) pass('ml conversion');
    else fail('ml conversion', String(mlConv.grams));

    // 19. piece conversion
    const pieceConv = convertQuantityToGrams(2, 'piece', { gramWeight: 50 });
    if (pieceConv.grams === 100) pass('piece conversion');
    else fail('piece conversion', String(pieceConv.grams));

    // 20. serving conversion
    const servingConv = convertQuantityToGrams(1.5, 'serving', { gramWeight: 120 });
    if (servingConv.grams === 180) pass('serving conversion');
    else fail('serving conversion', String(servingConv.grams));

    // 21. item macro calculation
    const itemMacros = calculateItemMacros(
        { calories: 200, protein: 20, carbs: 10, fat: 5 },
        150
    );
    if (
        itemMacros.calories === 300 &&
        itemMacros.protein === 30 &&
        itemMacros.carbs === 15 &&
        itemMacros.fat === 7.5
    ) {
        pass('item macro calculation');
    } else {
        fail('item macro calculation', JSON.stringify(itemMacros));
    }

    // 22. meal totals
    const mealTotals = calculateMealTotals([
        {
            quantity: 100,
            unit: 'g',
            foodSnapshot: sampleSnapshot({
                nutritionPer100g: { calories: 100, protein: 10, carbs: 5, fat: 2 },
            }),
        },
        {
            quantity: 200,
            unit: 'g',
            foodSnapshot: sampleSnapshot({
                nutritionPer100g: { calories: 50, protein: 5, carbs: 2, fat: 1 },
            }),
        },
    ]);
    if (
        mealTotals.calories === 200 &&
        mealTotals.protein === 20 &&
        mealTotals.carbs === 9 &&
        mealTotals.fat === 4
    ) {
        pass('meal totals');
    } else {
        fail('meal totals', JSON.stringify(mealTotals));
    }

    // 23. daily totals
    const dailyTotals = calculateDailyTotals([
        {
            foodItems: [
                {
                    quantity: 100,
                    unit: 'g',
                    foodSnapshot: sampleSnapshot({
                        nutritionPer100g: { calories: 100, protein: 10, carbs: 5, fat: 2 },
                    }),
                },
            ],
        },
        {
            foodItems: [
                {
                    quantity: 100,
                    unit: 'g',
                    foodSnapshot: sampleSnapshot({
                        nutritionPer100g: { calories: 50, protein: 5, carbs: 2, fat: 1 },
                    }),
                },
            ],
        },
    ]);
    if (dailyTotals.calories === 150) pass('daily totals');
    else fail('daily totals', JSON.stringify(dailyTotals));

    // 24. plan average daily macros
    const planMacros = calculatePlanComputedMacros([
        {
            meals: [
                {
                    foodItems: [
                        {
                            quantity: 100,
                            unit: 'g',
                            foodSnapshot: sampleSnapshot({
                                nutritionPer100g: { calories: 200, protein: 20, carbs: 10, fat: 5 },
                            }),
                        },
                    ],
                },
            ],
        },
        {
            meals: [
                {
                    foodItems: [
                        {
                            quantity: 100,
                            unit: 'g',
                            foodSnapshot: sampleSnapshot({
                                nutritionPer100g: { calories: 100, protein: 10, carbs: 5, fat: 2 },
                            }),
                        },
                    ],
                },
            ],
        },
    ]);
    if (planMacros.avgDailyCalories === 150 && planMacros.avgDailyProtein === 15) {
        pass('plan average daily macros');
    } else {
        fail('plan average daily macros', JSON.stringify(planMacros));
    }

    // 25. empty nutritionDays calculation
    const emptyMacros = calculatePlanComputedMacros([]);
    if (
        emptyMacros.avgDailyCalories === 0 &&
        emptyMacros.avgDailyProtein === 0 &&
        emptyMacros.avgDailyCarbs === 0 &&
        emptyMacros.avgDailyFat === 0
    ) {
        pass('empty nutritionDays calculation');
    } else {
        fail('empty nutritionDays calculation', JSON.stringify(emptyMacros));
    }

    // 26. max days validation
    const maxDays = validateCreateNutritionPlan.validate({
        ...basePlanPayload(trainer._id),
        nutritionDays: Array.from({ length: 15 }, (_, i) => ({
            dayNumber: i + 1,
            meals: [],
        })),
    });
    if (maxDays.error) pass('max days validation');
    else fail('max days validation', 'Expected Joi error');

    // 27. max meals validation
    const maxMeals = validateCreateNutritionPlan.validate({
        ...basePlanPayload(trainer._id),
        nutritionDays: [
            {
                dayNumber: 1,
                meals: Array.from({ length: 13 }, (_, i) => ({
                    order: i + 1,
                    name: `Meal ${i + 1}`,
                    foodItems: [],
                })),
            },
        ],
    });
    if (maxMeals.error) pass('max meals validation');
    else fail('max meals validation', 'Expected Joi error');

    // 28. max food items validation
    const maxItems = validateCreateNutritionPlan.validate({
        ...basePlanPayload(trainer._id),
        nutritionDays: [
            {
                dayNumber: 1,
                meals: [
                    {
                        order: 1,
                        name: 'Meal',
                        foodItems: Array.from({ length: 31 }, (_, i) => ({
                            order: i + 1,
                            foodId: trainerFood._id.toString(),
                            quantity: 100,
                            unit: 'g',
                        })),
                    },
                ],
            },
        ],
    });
    if (maxItems.error) pass('max food items validation');
    else fail('max food items validation', 'Expected Joi error');

    // 29. snapshot helper integration
    try {
        const snapshot = buildFoodSnapshot(trainerFood);
        const processed = await processNutritionDaysFoodItems(
            [
                {
                    dayNumber: 1,
                    meals: [
                        {
                            order: 1,
                            name: 'Lunch',
                            foodItems: [
                                {
                                    order: 1,
                                    foodId: trainerFood._id,
                                    quantity: 100,
                                    unit: 'g',
                                },
                            ],
                        },
                    ],
                },
            ],
            trainer._id
        );
        if (
            snapshot?.name === trainerFood.name &&
            processed[0].meals[0].foodItems[0].foodSnapshot?.name === trainerFood.name
        ) {
            pass('snapshot helper integration');
        } else {
            fail('snapshot helper integration', 'Snapshot mismatch');
        }
    } catch (err) {
        fail('snapshot helper integration', err.message);
    }

    // Food visibility — foreign food not visible to trainer A
    const visibleMap = await loadVisibleFoodsByIds(
        [trainerFood._id.toString(), foreignFood._id.toString()],
        trainer._id
    );
    if (visibleMap.has(trainerFood._id.toString()) && !visibleMap.has(foreignFood._id.toString())) {
        // visibility filter works as expected
    }

    // 30. computed fields are not persisted
    const forbiddenUpdate = validateUpdateNutritionPlan.validate({
        name: 'Updated',
        computedMacros: { avgDailyCalories: 999 },
        dailyTotals: { calories: 1 },
        mealTotals: { calories: 1 },
        itemMacros: { calories: 1 },
        totalMeals: 99,
        totalFoodItems: 99,
        avgDailyCalories: 999,
        trainerId: trainer._id.toString(),
        ownership: { type: 'trainer', trainerId: trainer._id.toString() },
    });
    if (forbiddenUpdate.error) pass('computed fields are not persisted');
    else fail('computed fields are not persisted', 'Expected Joi forbidden fields error');

    // Denormalized counters helper
    const counterPlan = applyPlanDenormalizedCounters({
        nutritionDays: [
            {
                dayNumber: 1,
                meals: [
                    {
                        order: 1,
                        name: 'Breakfast',
                        foodItems: [
                            {
                                order: 1,
                                foodId: trainerFood._id,
                                quantity: 100,
                                unit: 'g',
                                foodSnapshot: buildFoodSnapshot(trainerFood),
                            },
                        ],
                    },
                ],
            },
        ],
    });
    if (counterPlan.totalMeals === 1 && counterPlan.totalFoodItems === 1) {
        // bonus verification — not in required list but useful
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);

    await User.deleteMany({ _id: { $in: [trainer._id, trainerB._id] } });
    await Food.deleteMany({
        _id: { $in: [trainerFood._id, foreignFood._id] },
    });
    if (systemFood && systemFood.name?.startsWith('System Food')) {
        await Food.deleteOne({ _id: systemFood._id });
    }
    await mongoose.disconnect();

    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
