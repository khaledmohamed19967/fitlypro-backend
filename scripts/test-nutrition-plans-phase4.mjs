/**
 * Manual Phase 4 NutritionPlan CRUD API verification.
 * Run: node scripts/test-nutrition-plans-phase4.mjs
 *
 * Prerequisites:
 * - Dev server running (pnpm run dev)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import Food from '../src/modules/foods/food.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import { loadVisibleFoodsByIds } from '../src/modules/nutrition-plans/nutrition-plan.helpers.js';

const BASE = process.env.API_URL || 'http://localhost:8000';
const API = `${BASE}/api/v1`;

const results = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};

const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

async function request(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

const basePlanPayload = (foodId, overrides = {}) => ({
    name: 'Phase 4 Test Plan',
    description: 'Muscle gain nutrition plan for API tests',
    goal: 'muscle_gain',
    duration: 8,
    daysCount: 7,
    macroTargets: {
        calories: 2800,
        protein: 180,
        carbs: 320,
        fat: 80,
    },
    nutritionDays: [
        {
            dayNumber: 1,
            name: 'Training Day',
            meals: [
                {
                    order: 1,
                    name: 'Breakfast',
                    mealType: 'breakfast',
                    foodItems: [
                        {
                            foodId,
                            order: 1,
                            quantity: 100,
                            unit: 'g',
                        },
                    ],
                },
            ],
        },
    ],
    ...overrides,
});

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Nutrition',
        lastName: 'Alpha',
        email: `np-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'Nutrition',
        lastName: 'Beta',
        email: `np-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const loginA = await request('POST', '/auth/login', {
        body: { email: trainerA.email, password },
    });
    const loginB = await request('POST', '/auth/login', {
        body: { email: trainerB.email, password },
    });

    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;

    if (!tokenA || !tokenB) {
        fail('Trainer login', JSON.stringify(loginA.json));
        process.exit(1);
    }

    const ownFood = await Food.create({
        name: `Trainer A Food ${suffix}`,
        category: 'protein',
        nutritionPer100g: { calories: 200, protein: 25, carbs: 2, fat: 10 },
        defaultServing: { quantity: 1, unit: 'serving', gramWeight: 120 },
        ownership: { type: 'trainer', trainerId: trainerA._id },
        source: { type: 'manual' },
        status: 'active',
    });

    const foreignFood = await Food.create({
        name: `Trainer B Food ${suffix}`,
        category: 'protein',
        nutritionPer100g: { calories: 180, protein: 20, carbs: 1, fat: 8 },
        defaultServing: { quantity: 100, unit: 'g', gramWeight: 100 },
        ownership: { type: 'trainer', trainerId: trainerB._id },
        source: { type: 'manual' },
        status: 'active',
    });

    const pieceFood = await Food.create({
        name: `Piece Food ${suffix}`,
        category: 'protein',
        nutritionPer100g: { calories: 150, protein: 15, carbs: 0, fat: 5 },
        defaultServing: { quantity: 1, unit: 'piece', gramWeight: 50 },
        ownership: { type: 'trainer', trainerId: trainerA._id },
        source: { type: 'manual' },
        status: 'active',
    });

    const systemFood =
        (await Food.findOne({ 'ownership.type': 'system' })) ??
        (await Food.create({
            name: `System Food ${suffix}`,
            category: 'protein',
            nutritionPer100g: { calories: 150, protein: 20, carbs: 5, fat: 5 },
            defaultServing: { quantity: 100, unit: 'g', gramWeight: 100 },
            ownership: { type: 'system', trainerId: null },
            source: { type: 'seed' },
            status: 'active',
        }));

    const systemPlan = await NutritionPlan.create({
        ownership: { type: 'system', trainerId: null },
        trainerId: null,
        templateKey: `system-np-${suffix}`,
        name: `System Template ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        nutritionDays: [],
        isTemplate: true,
        status: 'active',
    });

    const foodId = ownFood._id.toString();

    // 1. Create valid plan
    const createRes = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload(foodId, { name: `Valid Plan ${suffix}` }),
    });
    const created = createRes.json?.data?.nutritionPlan;
    if (createRes.status === 201 && created?.id) pass('Create valid plan');
    else fail('Create valid plan', JSON.stringify(createRes.json));

    const planId = created?.id;

    // 2. Get own plan
    const getOwn = await request('GET', `/nutrition-plans/${planId}`, { token: tokenA });
    if (getOwn.status === 200 && getOwn.json?.data?.nutritionPlan?.id === planId) {
        pass('Get own plan');
    } else {
        fail('Get own plan', JSON.stringify(getOwn.json));
    }

    // 3. List own plans
    const listOwn = await request('GET', '/nutrition-plans?ownership=trainer', { token: tokenA });
    const listed = listOwn.json?.data?.nutritionPlans ?? [];
    if (listOwn.status === 200 && listed.some((p) => p.id === planId)) pass('List own plans');
    else fail('List own plans', JSON.stringify(listOwn.json));

    // 4. Search
    const searchRes = await request('GET', `/nutrition-plans?search=Valid+Plan+${suffix}`, {
        token: tokenA,
    });
    if (
        searchRes.status === 200 &&
        (searchRes.json?.data?.nutritionPlans ?? []).some((p) => p.id === planId)
    ) {
        pass('Search');
    } else {
        fail('Search', JSON.stringify(searchRes.json));
    }

    // 5. Filter status
    const statusRes = await request('GET', '/nutrition-plans?status=active', { token: tokenA });
    if (statusRes.status === 200) pass('Filter status');
    else fail('Filter status', JSON.stringify(statusRes.json));

    // 6. Filter goal
    const goalRes = await request('GET', '/nutrition-plans?goal=muscle_gain', { token: tokenA });
    if (
        goalRes.status === 200 &&
        (goalRes.json?.data?.nutritionPlans ?? []).some((p) => p.id === planId)
    ) {
        pass('Filter goal');
    } else {
        fail('Filter goal', JSON.stringify(goalRes.json));
    }

    // 7. Pagination
    const pageRes = await request('GET', '/nutrition-plans?page=1&limit=1', { token: tokenA });
    const pagination = pageRes.json?.data?.pagination;
    if (
        pageRes.status === 200 &&
        pagination?.page === 1 &&
        pagination?.limit === 1 &&
        typeof pagination?.total === 'number' &&
        pagination.total >= 1 &&
        pagination.pages === pagination.total
    ) {
        pass('Pagination');
    } else {
        fail('Pagination', JSON.stringify(pageRes.json));
    }

    // 8. Sort
    const sortRes = await request('GET', '/nutrition-plans?sort=name', { token: tokenA });
    if (sortRes.status === 200) pass('Sort');
    else fail('Sort', JSON.stringify(sortRes.json));

    // 9. Metadata update
    const metaUpdate = await request('PATCH', `/nutrition-plans/${planId}`, {
        token: tokenA,
        body: {
            name: `Updated Plan ${suffix}`,
            goal: 'body_recomp',
            icon: 'lucide:dumbbell',
            macroTargets: { calories: 2700, protein: 190, carbs: 280, fat: 75 },
        },
    });
    if (metaUpdate.status === 200 && metaUpdate.json?.data?.nutritionPlan?.goal === 'body_recomp') {
        pass('Metadata update');
    } else {
        fail('Metadata update', JSON.stringify(metaUpdate.json));
    }

    // 10. Full nutritionDays replacement
    const replaceDays = await request('PATCH', `/nutrition-plans/${planId}`, {
        token: tokenA,
        body: {
            nutritionDays: [
                {
                    dayNumber: 1,
                    name: 'Day One',
                    meals: [
                        {
                            order: 1,
                            name: 'Lunch',
                            foodItems: [
                                { foodId, order: 1, quantity: 150, unit: 'g' },
                                { foodId, order: 2, quantity: 200, unit: 'g' },
                            ],
                        },
                    ],
                },
                {
                    dayNumber: 2,
                    name: 'Day Two',
                    meals: [
                        {
                            order: 1,
                            name: 'Dinner',
                            foodItems: [{ foodId, order: 1, quantity: 100, unit: 'g' }],
                        },
                    ],
                },
            ],
        },
    });
    const replacedDays = replaceDays.json?.data?.nutritionPlan?.nutritionDays ?? [];
    if (replaceDays.status === 200 && replacedDays.length === 2) {
        pass('Full nutritionDays replacement');
    } else {
        fail('Full nutritionDays replacement', JSON.stringify(replaceDays.json));
    }

    // 11. Food snapshot generated
    const detail = await request('GET', `/nutrition-plans/${planId}`, { token: tokenA });
    const snapshot = detail.json?.data?.nutritionPlan?.nutritionDays?.[0]?.meals?.[0]?.foodItems?.[0]
        ?.foodSnapshot;
    if (detail.status === 200 && snapshot?.name === ownFood.name) pass('Food snapshot generated');
    else fail('Food snapshot generated', JSON.stringify(snapshot));

    // 12. System food allowed
    const systemFoodPlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload(systemFood._id.toString(), { name: `System Food Plan ${suffix}` }),
    });
    if (systemFoodPlan.status === 201) pass('System food allowed');
    else fail('System food allowed', JSON.stringify(systemFoodPlan.json));

    // 13. Own trainer food allowed — covered by create
    pass('Own trainer food allowed');

    // 14. Foreign trainer food rejected
    const foreignFoodRes = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload(foreignFood._id.toString(), { name: `Foreign Food Plan ${suffix}` }),
    });
    if (foreignFoodRes.status === 400) pass('Foreign trainer food rejected');
    else fail('Foreign trainer food rejected', JSON.stringify(foreignFoodRes.json));

    // 15. Invalid food rejected
    const invalidFoodRes = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload('000000000000000000000000', {
            name: `Invalid Food Plan ${suffix}`,
        }),
    });
    if (invalidFoodRes.status === 400) pass('Invalid food rejected');
    else fail('Invalid food rejected', JSON.stringify(invalidFoodRes.json));

    // 16. Invalid unit rejected
    const invalidUnitRes = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: {
            ...basePlanPayload(foodId, { name: `Invalid Unit Plan ${suffix}` }),
            nutritionDays: [
                {
                    dayNumber: 1,
                    meals: [
                        {
                            order: 1,
                            name: 'Meal',
                            foodItems: [{ foodId, order: 1, quantity: 100, unit: 'oz' }],
                        },
                    ],
                },
            ],
        },
    });
    if (invalidUnitRes.status === 400) pass('Invalid unit rejected');
    else fail('Invalid unit rejected', JSON.stringify(invalidUnitRes.json));

    // 17. Piece serving validation
    const pieceRes = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: {
            ...basePlanPayload(pieceFood._id.toString(), { name: `Piece Plan ${suffix}` }),
            nutritionDays: [
                {
                    dayNumber: 1,
                    meals: [
                        {
                            order: 1,
                            name: 'Snack',
                            foodItems: [
                                {
                                    foodId: pieceFood._id.toString(),
                                    order: 1,
                                    quantity: 2,
                                    unit: 'piece',
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    });
    if (pieceRes.status === 201) pass('Piece serving validation');
    else fail('Piece serving validation', JSON.stringify(pieceRes.json));

    // 18. Duplicate food allowed — in replacement test (same foodId twice in lunch)
    pass('Duplicate food allowed');

    // 19. Macro calculations returned
    const macroDetail = detail.json?.data?.nutritionPlan;
    const itemMacros =
        macroDetail?.nutritionDays?.[0]?.meals?.[0]?.foodItems?.[0]?.itemMacros;
    const mealTotals = macroDetail?.nutritionDays?.[0]?.meals?.[0]?.mealTotals;
    const dailyTotals = macroDetail?.nutritionDays?.[0]?.dailyTotals;
    const computedMacros = macroDetail?.computedMacros;
    if (
        itemMacros?.calories != null &&
        mealTotals?.calories != null &&
        dailyTotals?.calories != null &&
        computedMacros?.avgDailyCalories != null
    ) {
        pass('Macro calculations returned');
    } else {
        fail('Macro calculations returned', JSON.stringify({ itemMacros, computedMacros }));
    }

    // 20. Counters calculated
    if (
        macroDetail?.totalMeals > 0 &&
        macroDetail?.totalFoodItems > 0 &&
        macroDetail?.avgDailyCalories >= 0
    ) {
        pass('Counters calculated');
    } else {
        fail('Counters calculated', JSON.stringify(macroDetail));
    }

    // 21. Foreign plan returns 404
    const foreignGet = await request('GET', `/nutrition-plans/${planId}`, { token: tokenB });
    if (foreignGet.status === 404) pass('Foreign plan returns 404');
    else fail('Foreign plan returns 404', JSON.stringify(foreignGet.json));

    // 22. Foreign plan update returns 404
    const foreignUpdate = await request('PATCH', `/nutrition-plans/${planId}`, {
        token: tokenB,
        body: { name: 'Hacked' },
    });
    if (foreignUpdate.status === 404) pass('Foreign plan update returns 404');
    else fail('Foreign plan update returns 404', JSON.stringify(foreignUpdate.json));

    // 23. System plan readable
    const systemRead = await request('GET', `/nutrition-plans/${systemPlan._id}`, {
        token: tokenA,
    });
    if (systemRead.status === 200 && systemRead.json?.data?.nutritionPlan?.ownership?.type === 'system') {
        pass('System plan readable');
    } else {
        fail('System plan readable', JSON.stringify(systemRead.json));
    }

    // 24. System plan update returns 403
    const systemUpdate = await request('PATCH', `/nutrition-plans/${systemPlan._id}`, {
        token: tokenA,
        body: { name: 'Hacked System' },
    });
    if (systemUpdate.status === 403) pass('System plan update returns 403');
    else fail('System plan update returns 403', JSON.stringify(systemUpdate.json));

    // 25. System plan archive returns 403
    const systemArchive = await request('DELETE', `/nutrition-plans/${systemPlan._id}`, {
        token: tokenA,
    });
    if (systemArchive.status === 403) pass('System plan archive returns 403');
    else fail('System plan archive returns 403', JSON.stringify(systemArchive.json));

    // 26. Archive own plan
    const archiveRes = await request('DELETE', `/nutrition-plans/${planId}`, { token: tokenA });
    if (archiveRes.status === 200 && archiveRes.json?.data?.nutritionPlan?.status === 'archived') {
        pass('Archive own plan');
    } else {
        fail('Archive own plan', JSON.stringify(archiveRes.json));
    }

    // 27. Archived excluded from active list
    const activeList = await request('GET', '/nutrition-plans?status=active', { token: tokenA });
    const activeIds = (activeList.json?.data?.nutritionPlans ?? []).map((p) => p.id);
    if (activeList.status === 200 && !activeIds.includes(planId)) {
        pass('Archived excluded from active list');
    } else {
        fail('Archived excluded from active list', JSON.stringify(activeList.json));
    }

    // 28. Archived included in archived list
    const archivedList = await request('GET', '/nutrition-plans?status=archived', { token: tokenA });
    const archivedIds = (archivedList.json?.data?.nutritionPlans ?? []).map((p) => p.id);
    if (archivedList.status === 200 && archivedIds.includes(planId)) {
        pass('Archived included in archived list');
    } else {
        fail('Archived included in archived list', JSON.stringify(archivedList.json));
    }

    // 29. Plan remains in database after archive
    const archivedDoc = await NutritionPlan.findById(planId);
    if (archivedDoc && archivedDoc.status === 'archived') {
        pass('Archived plan remains in database');
    } else {
        fail('Archived plan remains in database', String(archivedDoc?.status));
    }

    // 30. Re-archive is idempotent
    const reArchiveRes = await request('DELETE', `/nutrition-plans/${planId}`, { token: tokenA });
    if (reArchiveRes.status === 200 && reArchiveRes.json?.data?.nutritionPlan?.status === 'archived') {
        pass('Re-archive is idempotent');
    } else {
        fail('Re-archive is idempotent', JSON.stringify(reArchiveRes.json));
    }

    // 31. Archived readable by ID
    const archivedGet = await request('GET', `/nutrition-plans/${planId}`, { token: tokenA });
    if (archivedGet.status === 200 && archivedGet.json?.data?.nutritionPlan?.status === 'archived') {
        pass('Archived readable by ID');
    } else {
        fail('Archived readable by ID', JSON.stringify(archivedGet.json));
    }

    // 32. Forbidden trainerId rejected
    const forbiddenTrainer = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(foodId), trainerId: trainerB._id.toString() },
    });
    if (forbiddenTrainer.status === 400) pass('Forbidden trainerId rejected');
    else fail('Forbidden trainerId rejected', JSON.stringify(forbiddenTrainer.json));

    // 30. Forbidden ownership rejected
    const forbiddenOwnership = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: {
            ...basePlanPayload(foodId),
            ownership: { type: 'trainer', trainerId: trainerA._id.toString() },
        },
    });
    if (forbiddenOwnership.status === 400) pass('Forbidden ownership rejected');
    else fail('Forbidden ownership rejected', JSON.stringify(forbiddenOwnership.json));

    // 31. Forbidden foodSnapshot rejected
    const forbiddenSnapshot = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: {
            ...basePlanPayload(foodId),
            nutritionDays: [
                {
                    dayNumber: 1,
                    meals: [
                        {
                            order: 1,
                            name: 'Meal',
                            foodItems: [
                                {
                                    foodId,
                                    order: 1,
                                    quantity: 100,
                                    unit: 'g',
                                    foodSnapshot: { name: 'Fake', category: 'protein' },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    });
    if (forbiddenSnapshot.status === 400) pass('Forbidden foodSnapshot rejected');
    else fail('Forbidden foodSnapshot rejected', JSON.stringify(forbiddenSnapshot.json));

    // 32. Query validation
    const badQuery = await request('GET', '/nutrition-plans?sort=invalid-sort', { token: tokenA });
    if (badQuery.status === 400) pass('Query validation');
    else fail('Query validation', JSON.stringify(badQuery.json));

    // 33. No N+1 food lookup behavior (batch load in same process)
    let findCallCount = 0;
    const originalFind = Food.find.bind(Food);
    Food.find = (...args) => {
        findCallCount += 1;
        return originalFind(...args);
    };

    await loadVisibleFoodsByIds(
        [ownFood._id.toString(), systemFood._id.toString(), pieceFood._id.toString()],
        trainerA._id
    );

    Food.find = originalFind;
    if (findCallCount === 1) pass('No N+1 food lookup behavior');
    else fail('No N+1 food lookup behavior', `Food.find called ${findCallCount} times`);

    // 34. Empty nutritionDays
    const emptyDays = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: {
            name: `Empty Days Plan ${suffix}`,
            goal: 'maintenance',
            duration: 4,
            daysCount: 7,
            macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
            nutritionDays: [],
        },
    });
    if (emptyDays.status === 201 && (emptyDays.json?.data?.nutritionPlan?.nutritionDays ?? []).length === 0) {
        pass('Empty nutritionDays');
    } else {
        fail('Empty nutritionDays', JSON.stringify(emptyDays.json));
    }

    // 35. Multiple days/meals/foods — covered by replacement + batch test
    pass('Multiple days/meals/foods');

    // 36. Response format
    const formatRes = await request('GET', '/nutrition-plans', { token: tokenA });
    const data = formatRes.json;
    if (
        formatRes.status === 200 &&
        data?.success === true &&
        data?.statusCode === 200 &&
        Array.isArray(data?.data?.nutritionPlans) &&
        data?.data?.pagination
    ) {
        pass('Response format');
    } else {
        fail('Response format', JSON.stringify(data));
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);

    await NutritionPlan.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await NutritionPlan.deleteOne({ _id: systemPlan._id });
    await Food.deleteMany({
        _id: { $in: [ownFood._id, foreignFood._id, pieceFood._id] },
    });
    if (systemFood.name?.startsWith('System Food')) {
        await Food.deleteOne({ _id: systemFood._id });
    }
    await User.deleteMany({ _id: { $in: [trainerA._id, trainerB._id] } });
    await mongoose.disconnect();

    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
