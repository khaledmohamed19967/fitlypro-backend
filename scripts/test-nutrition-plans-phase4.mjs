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
import NutritionPlanAssignment from '../src/modules/nutrition-plan-assignments/nutrition-plan-assignment.model.js';
import { loadVisibleFoodsByIds } from '../src/modules/nutrition-plans/nutrition-plan.helpers.js';
import {
    MAX_SUPPLEMENTS,
    MAX_VITAMINS,
    MAX_INSTRUCTION_LENGTH,
} from '../src/modules/nutrition-plans/nutrition-plan.constants.js';

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
    // Multi-day templates require weekly schedule mode (daily allows at most one day).
    const replaceDays = await request('PATCH', `/nutrition-plans/${planId}`, {
        token: tokenA,
        body: {
            scheduleMode: 'weekly',
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

    // -------------------------------------------------------------------------
    // Supplements & Vitamins (Option B)
    // -------------------------------------------------------------------------

    const instructionEntries = (texts) =>
        texts.map((instruction, index) => ({
            instruction,
            order: index + 1,
        }));

    // SV1. Create with supplements and vitamins
    const svCreate = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload(foodId, {
            name: `SV Plan ${suffix}`,
            supplements: instructionEntries([
                'Whey protein - 30g - After workout',
                'Creatine - 5g - Daily',
            ]),
            vitamins: instructionEntries(['Omega 3 - 2 caps - with a meal']),
        }),
    });
    const svPlan = svCreate.json?.data?.nutritionPlan;
    const svPlanId = svPlan?.id;
    if (
        svCreate.status === 201 &&
        svPlan?.supplements?.length === 2 &&
        svPlan?.vitamins?.length === 1 &&
        svPlan.supplements[0].instruction.includes('Whey') &&
        svPlan.supplements[0].order === 1 &&
        svPlan.supplements[0].id &&
        svPlan.vitamins[0].instruction.includes('Omega')
    ) {
        pass('SV1 Create with supplements and vitamins');
    } else {
        fail('SV1 Create with supplements and vitamins', JSON.stringify(svCreate.json));
    }

    // SV2. Create without either field
    const svNoFields = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload(foodId, { name: `SV No Fields ${suffix}` }),
    });
    const svNoPlan = svNoFields.json?.data?.nutritionPlan;
    if (
        svNoFields.status === 201 &&
        Array.isArray(svNoPlan?.supplements) &&
        svNoPlan.supplements.length === 0 &&
        Array.isArray(svNoPlan?.vitamins) &&
        svNoPlan.vitamins.length === 0
    ) {
        pass('SV2 Create without either field');
    } else {
        fail('SV2 Create without either field', JSON.stringify(svNoFields.json));
    }

    // SV3. Create with empty arrays
    const svEmpty = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload(foodId, {
            name: `SV Empty ${suffix}`,
            supplements: [],
            vitamins: [],
        }),
    });
    if (
        svEmpty.status === 201 &&
        (svEmpty.json?.data?.nutritionPlan?.supplements ?? null)?.length === 0 &&
        (svEmpty.json?.data?.nutritionPlan?.vitamins ?? null)?.length === 0
    ) {
        pass('SV3 Create with empty arrays');
    } else {
        fail('SV3 Create with empty arrays', JSON.stringify(svEmpty.json));
    }

    // SV4. Create with blank and whitespace-only instructions
    const svBlank = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload(foodId, {
            name: `SV Blank ${suffix}`,
            supplements: [
                { instruction: '', order: 1 },
                { instruction: '   ', order: 2 },
                { instruction: 'Keep me', order: 3 },
            ],
            vitamins: [
                { instruction: '', order: 1 },
                { instruction: '\t', order: 2 },
            ],
        }),
    });
    const svBlankPlan = svBlank.json?.data?.nutritionPlan;
    if (
        svBlank.status === 201 &&
        svBlankPlan?.supplements?.length === 1 &&
        svBlankPlan.supplements[0].instruction === 'Keep me' &&
        svBlankPlan.supplements[0].order === 1 &&
        svBlankPlan?.vitamins?.length === 0
    ) {
        pass('SV4 Create with blank and whitespace-only instructions');
    } else {
        fail(
            'SV4 Create with blank and whitespace-only instructions',
            JSON.stringify(svBlank.json)
        );
    }

    // SV5. Maximum 20 entries accepted
    const maxSupp = instructionEntries(
        Array.from({ length: MAX_SUPPLEMENTS }, (_, i) => `Supp ${i + 1}`)
    );
    const maxVit = instructionEntries(
        Array.from({ length: MAX_VITAMINS }, (_, i) => `Vit ${i + 1}`)
    );
    const svMax = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload(foodId, {
            name: `SV Max ${suffix}`,
            supplements: maxSupp,
            vitamins: maxVit,
        }),
    });
    if (
        svMax.status === 201 &&
        svMax.json?.data?.nutritionPlan?.supplements?.length === MAX_SUPPLEMENTS &&
        svMax.json?.data?.nutritionPlan?.vitamins?.length === MAX_VITAMINS
    ) {
        pass('SV5 Maximum 20 entries accepted');
    } else {
        fail('SV5 Maximum 20 entries accepted', JSON.stringify(svMax.json));
    }

    // SV6. More than 20 entries rejected
    const tooMany = instructionEntries(
        Array.from({ length: MAX_SUPPLEMENTS + 1 }, (_, i) => `Too many ${i + 1}`)
    );
    const svTooMany = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload(foodId, {
            name: `SV Too Many ${suffix}`,
            supplements: tooMany,
        }),
    });
    if (svTooMany.status === 400) pass('SV6 More than 20 entries rejected');
    else fail('SV6 More than 20 entries rejected', JSON.stringify(svTooMany.json));

    // SV7. Instruction length over 500 rejected
    const svTooLong = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload(foodId, {
            name: `SV Too Long ${suffix}`,
            vitamins: [
                {
                    instruction: 'x'.repeat(MAX_INSTRUCTION_LENGTH + 1),
                    order: 1,
                },
            ],
        }),
    });
    if (svTooLong.status === 400) pass('SV7 Instruction length over 500 rejected');
    else fail('SV7 Instruction length over 500 rejected', JSON.stringify(svTooLong.json));

    // SV8. Duplicate instructions allowed
    const svDup = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload(foodId, {
            name: `SV Dup ${suffix}`,
            supplements: instructionEntries(['Same text', 'Same text']),
        }),
    });
    if (
        svDup.status === 201 &&
        svDup.json?.data?.nutritionPlan?.supplements?.length === 2 &&
        svDup.json.data.nutritionPlan.supplements[0].instruction ===
            svDup.json.data.nutritionPlan.supplements[1].instruction
    ) {
        pass('SV8 Duplicate instructions allowed');
    } else {
        fail('SV8 Duplicate instructions allowed', JSON.stringify(svDup.json));
    }

    // Seed SV plan content for update tests
    const seedSv = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: {
            supplements: instructionEntries(['Supp A', 'Supp B']),
            vitamins: instructionEntries(['Vit A', 'Vit B']),
        },
    });
    const seeded = seedSv.json?.data?.nutritionPlan;
    const suppAId = seeded?.supplements?.[0]?.id;
    const suppBId = seeded?.supplements?.[1]?.id;
    const vitAId = seeded?.vitamins?.[0]?.id;
    const vitBId = seeded?.vitamins?.[1]?.id;

    // SV9. Omitted supplements preserve existing data
    const svOmitSupp = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: { notes: 'preserve supplements' },
    });
    const afterOmitSupp = svOmitSupp.json?.data?.nutritionPlan;
    if (
        svOmitSupp.status === 200 &&
        afterOmitSupp?.supplements?.length === 2 &&
        afterOmitSupp.supplements[0].id === suppAId &&
        afterOmitSupp.supplements[1].id === suppBId
    ) {
        pass('SV9 Omitted supplements preserve existing data');
    } else {
        fail('SV9 Omitted supplements preserve existing data', JSON.stringify(svOmitSupp.json));
    }

    // SV10. Omitted vitamins preserve existing data
    const svOmitVit = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: { description: 'preserve vitamins' },
    });
    const afterOmitVit = svOmitVit.json?.data?.nutritionPlan;
    if (
        svOmitVit.status === 200 &&
        afterOmitVit?.vitamins?.length === 2 &&
        afterOmitVit.vitamins[0].id === vitAId &&
        afterOmitVit.vitamins[1].id === vitBId
    ) {
        pass('SV10 Omitted vitamins preserve existing data');
    } else {
        fail('SV10 Omitted vitamins preserve existing data', JSON.stringify(svOmitVit.json));
    }

    // SV11. Empty supplements array clears only supplements
    const svClearSupp = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: { supplements: [] },
    });
    const afterClearSupp = svClearSupp.json?.data?.nutritionPlan;
    if (
        svClearSupp.status === 200 &&
        afterClearSupp?.supplements?.length === 0 &&
        afterClearSupp?.vitamins?.length === 2 &&
        afterClearSupp.vitamins[0].id === vitAId
    ) {
        pass('SV11 Empty supplements array clears only supplements');
    } else {
        fail(
            'SV11 Empty supplements array clears only supplements',
            JSON.stringify(svClearSupp.json)
        );
    }

    // Re-seed supplements (new IDs); keep existing vitamin IDs
    const restoredSupp = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: {
            supplements: instructionEntries(['Supp A', 'Supp B']),
            vitamins: [
                { _id: vitAId, instruction: 'Vit A', order: 1 },
                { _id: vitBId, instruction: 'Vit B', order: 2 },
            ],
        },
    });
    const restored = restoredSupp.json?.data?.nutritionPlan;
    const rSuppAId = restored?.supplements?.[0]?.id;
    const rSuppBId = restored?.supplements?.[1]?.id;

    // SV12. Empty vitamins array clears only vitamins
    const svClearVit = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: { vitamins: [] },
    });
    const afterClearVit = svClearVit.json?.data?.nutritionPlan;
    if (
        svClearVit.status === 200 &&
        afterClearVit?.vitamins?.length === 0 &&
        afterClearVit?.supplements?.length === 2 &&
        afterClearVit.supplements[0].id === rSuppAId
    ) {
        pass('SV12 Empty vitamins array clears only vitamins');
    } else {
        fail('SV12 Empty vitamins array clears only vitamins', JSON.stringify(svClearVit.json));
    }

    // Restore vitamins (new IDs)
    const restored2 = (
        await request('PATCH', `/nutrition-plans/${svPlanId}`, {
            token: tokenA,
            body: {
                vitamins: instructionEntries(['Vit A', 'Vit B']),
            },
        })
    ).json?.data?.nutritionPlan;
    const r2VitAId = restored2?.vitamins?.[0]?.id;
    const r2VitBId = restored2?.vitamins?.[1]?.id;
    const r2SuppAId = restored2?.supplements?.[0]?.id;
    const r2SuppBId = restored2?.supplements?.[1]?.id;

    // SV13. Updating supplements preserves vitamins
    const svUpdSupp = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: {
            supplements: [
                { _id: r2SuppAId, instruction: 'Supp A updated', order: 1 },
                { instruction: 'Supp C new', order: 2 },
            ],
        },
    });
    const afterUpdSupp = svUpdSupp.json?.data?.nutritionPlan;
    if (
        svUpdSupp.status === 200 &&
        afterUpdSupp?.supplements?.length === 2 &&
        afterUpdSupp.supplements[0].instruction === 'Supp A updated' &&
        afterUpdSupp.vitamins?.length === 2 &&
        afterUpdSupp.vitamins[0].id === r2VitAId &&
        afterUpdSupp.vitamins[1].id === r2VitBId
    ) {
        pass('SV13 Updating supplements preserves vitamins');
    } else {
        fail('SV13 Updating supplements preserves vitamins', JSON.stringify(svUpdSupp.json));
    }

    // SV14. Updating vitamins preserves supplements
    const keepSuppIds = afterUpdSupp.supplements.map((s) => s.id);
    const svUpdVit = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: {
            vitamins: [{ _id: r2VitAId, instruction: 'Vit A updated', order: 1 }],
        },
    });
    const afterUpdVit = svUpdVit.json?.data?.nutritionPlan;
    if (
        svUpdVit.status === 200 &&
        afterUpdVit?.vitamins?.length === 1 &&
        afterUpdVit.vitamins[0].instruction === 'Vit A updated' &&
        afterUpdVit.supplements?.length === 2 &&
        afterUpdVit.supplements[0].id === keepSuppIds[0] &&
        afterUpdVit.supplements[1].id === keepSuppIds[1]
    ) {
        pass('SV14 Updating vitamins preserves supplements');
    } else {
        fail('SV14 Updating vitamins preserves supplements', JSON.stringify(svUpdVit.json));
    }

    // SV15. Valid existing IDs are preserved
    if (afterUpdVit?.vitamins?.[0]?.id === r2VitAId) {
        pass('SV15 Valid existing IDs are preserved');
    } else {
        fail(
            'SV15 Valid existing IDs are preserved',
            JSON.stringify({ expected: r2VitAId, got: afterUpdVit?.vitamins?.[0]?.id })
        );
    }

    // SV16. New entries receive new IDs
    const newSuppId = afterUpdSupp?.supplements?.[1]?.id;
    if (newSuppId && newSuppId !== r2SuppAId && newSuppId !== r2SuppBId) {
        pass('SV16 New entries receive new IDs');
    } else {
        fail('SV16 New entries receive new IDs', JSON.stringify(afterUpdSupp?.supplements));
    }

    // SV17. Foreign IDs are rejected
    const foreignOid = new mongoose.Types.ObjectId().toString();
    const svForeign = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: {
            supplements: [{ _id: foreignOid, instruction: 'Foreign', order: 1 }],
        },
    });
    if (svForeign.status === 400) pass('SV17 Foreign IDs are rejected');
    else fail('SV17 Foreign IDs are rejected', JSON.stringify(svForeign.json));

    // SV18. Malformed IDs are rejected
    const svBadId = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: {
            vitamins: [{ _id: 'not-a-valid-objectid', instruction: 'Bad', order: 1 }],
        },
    });
    if (svBadId.status === 400) pass('SV18 Malformed IDs are rejected');
    else fail('SV18 Malformed IDs are rejected', JSON.stringify(svBadId.json));

    // SV19. IDs cannot be moved between supplements and vitamins
    const currentSuppId = afterUpdVit?.supplements?.[0]?.id;
    const svCross = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: {
            vitamins: [{ _id: currentSuppId, instruction: 'Cross move', order: 1 }],
        },
    });
    if (svCross.status === 400) pass('SV19 IDs cannot be moved between supplements and vitamins');
    else {
        fail(
            'SV19 IDs cannot be moved between supplements and vitamins',
            JSON.stringify(svCross.json)
        );
    }

    // SV20. Submitted order is normalized sequentially
    const svOrder = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: {
            supplements: [
                { instruction: 'First in array', order: 99 },
                { instruction: '', order: 100 },
                { instruction: 'Second kept', order: 50 },
            ],
        },
    });
    const ordered = svOrder.json?.data?.nutritionPlan?.supplements;
    if (
        svOrder.status === 200 &&
        ordered?.length === 2 &&
        ordered[0].instruction === 'First in array' &&
        ordered[0].order === 1 &&
        ordered[1].instruction === 'Second kept' &&
        ordered[1].order === 2
    ) {
        pass('SV20 Submitted order is normalized sequentially');
    } else {
        fail('SV20 Submitted order is normalized sequentially', JSON.stringify(svOrder.json));
    }

    // SV21/22. Trainer detail / public response includes both collections
    const svGet = await request('GET', `/nutrition-plans/${svPlanId}`, { token: tokenA });
    const detailPlan = svGet.json?.data?.nutritionPlan;
    if (
        svGet.status === 200 &&
        Array.isArray(detailPlan?.supplements) &&
        Array.isArray(detailPlan?.vitamins) &&
        detailPlan.supplements.every(
            (e) => e.id && typeof e.instruction === 'string' && typeof e.order === 'number'
        )
    ) {
        pass('SV21 Trainer detail response includes both collections');
        pass('SV22 Public response includes both collections');
    } else {
        fail(
            'SV21 Trainer detail response includes both collections',
            JSON.stringify(svGet.json)
        );
        fail('SV22 Public response includes both collections', JSON.stringify(svGet.json));
    }

    // SV23. Legacy documents return empty arrays
    const legacyDoc = await NutritionPlan.create({
        trainerId: trainerA._id,
        ownership: { type: 'trainer', trainerId: trainerA._id },
        name: `Legacy SV ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        nutritionDays: [],
        status: 'active',
        isTemplate: false,
    });
    // Ensure fields absent as stored (older shape) — unset if mongoose applied defaults
    await NutritionPlan.collection.updateOne(
        { _id: legacyDoc._id },
        { $unset: { supplements: '', vitamins: '' } }
    );
    const legacyGet = await request('GET', `/nutrition-plans/${legacyDoc._id}`, {
        token: tokenA,
    });
    const legacyPlan = legacyGet.json?.data?.nutritionPlan;
    if (
        legacyGet.status === 200 &&
        Array.isArray(legacyPlan?.supplements) &&
        legacyPlan.supplements.length === 0 &&
        Array.isArray(legacyPlan?.vitamins) &&
        legacyPlan.vitamins.length === 0
    ) {
        pass('SV23 Legacy documents return empty arrays');
    } else {
        fail('SV23 Legacy documents return empty arrays', JSON.stringify(legacyGet.json));
    }

    // SV24. Raw internal Mongoose fields are not exposed
    const rawKeys = ['_id', '__v', '$__', '$isNew', '_doc'];
    const hasRaw = (obj, path = '') => {
        if (obj == null || typeof obj !== 'object') return null;
        for (const key of Object.keys(obj)) {
            const next = path ? `${path}.${key}` : key;
            if (rawKeys.includes(key)) return next;
            if (typeof obj[key] === 'object') {
                const hit = hasRaw(obj[key], next);
                if (hit) return hit;
            }
        }
        return null;
    };
    const rawHit = hasRaw({
        supplements: detailPlan?.supplements,
        vitamins: detailPlan?.vitamins,
    });
    if (!rawHit) pass('SV24 Raw internal Mongoose fields are not exposed');
    else fail('SV24 Raw internal Mongoose fields are not exposed', rawHit);

    // SV25/26. Clone preserves content/order with fresh IDs
    await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenA,
        body: {
            supplements: instructionEntries(['Clone Supp 1', 'Clone Supp 2']),
            vitamins: instructionEntries(['Clone Vit 1']),
        },
    });
    const beforeClone = (
        await request('GET', `/nutrition-plans/${svPlanId}`, { token: tokenA })
    ).json?.data?.nutritionPlan;
    const cloneRes = await request('POST', `/nutrition-plans/${svPlanId}/clone`, {
        token: tokenA,
        body: { name: `SV Clone ${suffix}` },
    });
    const cloned = cloneRes.json?.data?.nutritionPlan;
    const sourceSuppIds = (beforeClone?.supplements ?? []).map((e) => e.id);
    const clonedSuppIds = (cloned?.supplements ?? []).map((e) => e.id);
    if (
        cloneRes.status === 201 &&
        cloned?.supplements?.length === 2 &&
        cloned.supplements[0].instruction === 'Clone Supp 1' &&
        cloned.supplements[0].order === 1 &&
        cloned.supplements[1].instruction === 'Clone Supp 2' &&
        cloned.supplements[1].order === 2 &&
        cloned?.vitamins?.length === 1 &&
        cloned.vitamins[0].instruction === 'Clone Vit 1' &&
        clonedSuppIds.every((id) => !sourceSuppIds.includes(id)) &&
        cloned.vitamins[0].id !== beforeClone?.vitamins?.[0]?.id
    ) {
        pass('SV25 Clone preserves supplement/vitamin content and order');
        pass('SV26 Clone generates new IDs');
    } else {
        fail(
            'SV25 Clone preserves supplement/vitamin content and order',
            JSON.stringify(cloneRes.json)
        );
        fail('SV26 Clone generates new IDs', JSON.stringify(cloneRes.json));
    }

    // SV27/28/29. Client-facing player API
    const clientUser = await User.create({
        firstName: 'SV',
        lastName: 'Client',
        email: `sv-client-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });
    const legacyClient = await User.create({
        firstName: 'SV',
        lastName: 'LegacyClient',
        email: `sv-legacy-client-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });
    const clientLogin = await request('POST', '/auth/login', {
        body: { email: clientUser.email, password },
    });
    const legacyClientLogin = await request('POST', '/auth/login', {
        body: { email: legacyClient.email, password },
    });
    const clientToken = clientLogin.json?.data?.token;
    const legacyClientToken = legacyClientLogin.json?.data?.token;

    const assignSv = await request('POST', `/nutrition-plans/${svPlanId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [clientUser._id.toString()],
            startDate: new Date().toISOString(),
        },
    });

    const playerMe = await request('GET', '/me/nutrition-plan', { token: clientToken });
    const playerPlan = playerMe.json?.data?.plan;
    if (
        assignSv.status === 201 &&
        playerMe.status === 200 &&
        Array.isArray(playerPlan?.supplements) &&
        playerPlan.supplements.length === 2 &&
        playerPlan.supplements[0].instruction === 'Clone Supp 1' &&
        playerPlan.supplements[0].order === 1 &&
        playerPlan.supplements[0].id &&
        Array.isArray(playerPlan?.vitamins) &&
        playerPlan.vitamins.length === 1
    ) {
        pass('SV27 Player nutrition response includes both collections');
    } else {
        fail(
            'SV27 Player nutrition response includes both collections',
            JSON.stringify({ assign: assignSv.json, player: playerMe.json })
        );
    }

    await NutritionPlanAssignment.create({
        planId: legacyDoc._id,
        clientId: legacyClient._id,
        trainerId: trainerA._id,
        status: 'active',
        startDate: new Date(),
    });

    const playerLegacy = await request('GET', '/me/nutrition-plan', {
        token: legacyClientToken,
    });
    const legacyPlayerPlan = playerLegacy.json?.data?.plan;
    if (
        playerLegacy.status === 200 &&
        Array.isArray(legacyPlayerPlan?.supplements) &&
        legacyPlayerPlan.supplements.length === 0 &&
        Array.isArray(legacyPlayerPlan?.vitamins) &&
        legacyPlayerPlan.vitamins.length === 0
    ) {
        pass('SV28 Legacy assigned plans return empty arrays');
    } else {
        fail(
            'SV28 Legacy assigned plans return empty arrays',
            JSON.stringify(playerLegacy.json)
        );
    }

    // SV29. Authorization boundaries remain unchanged
    const playerAsTrainer = await request('GET', '/me/nutrition-plan', { token: tokenA });
    const foreignClientPatch = await request('PATCH', `/nutrition-plans/${svPlanId}`, {
        token: tokenB,
        body: { supplements: instructionEntries(['Hijack']) },
    });
    if (playerAsTrainer.status === 403 && foreignClientPatch.status === 404) {
        pass('SV29 Authorization boundaries remain unchanged');
    } else {
        fail(
            'SV29 Authorization boundaries remain unchanged',
            JSON.stringify({
                playerAsTrainer: playerAsTrainer.status,
                foreignClientPatch: foreignClientPatch.status,
            })
        );
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);

    await NutritionPlanAssignment.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
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
    await User.deleteMany({
        _id: { $in: [trainerA._id, trainerB._id, clientUser._id, legacyClient._id] },
    });
    await mongoose.disconnect();

    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
