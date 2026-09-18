/**
 * Player-facing active nutrition plan retrieval.
 * Run: node scripts/test-nutrition-plan-player-me.mjs
 *
 * Prerequisites:
 * - Dev server running (with latest code)
 */
import 'dotenv/config';
import http from 'node:http';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import Food from '../src/modules/foods/food.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import NutritionPlanAssignment from '../src/modules/nutrition-plan-assignments/nutrition-plan-assignment.model.js';

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

const hasForbiddenKeys = (obj, keys, path = '') => {
    if (obj == null || typeof obj !== 'object') return null;
    for (const key of Object.keys(obj)) {
        const next = path ? `${path}.${key}` : key;
        if (keys.includes(key)) return next;
        if (typeof obj[key] === 'object') {
            const hit = hasForbiddenKeys(obj[key], keys, next);
            if (hit) return hit;
        }
    }
    return null;
};

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    const trainer = await User.create({
        firstName: 'NutPlayer',
        lastName: 'Trainer',
        email: `np-player-trainer-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'NutPlayer',
        lastName: 'TrainerB',
        email: `np-player-trainer-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const admin = await User.create({
        firstName: 'NutPlayer',
        lastName: 'Admin',
        email: `np-player-admin-${suffix}@test.com`,
        password,
        role: 'admin',
    });

    const clientA = await User.create({
        firstName: 'NutPlayer',
        lastName: 'ClientA',
        email: `np-player-a-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const clientB = await User.create({
        firstName: 'NutPlayer',
        lastName: 'ClientB',
        email: `np-player-b-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const clientEmpty = await User.create({
        firstName: 'NutPlayer',
        lastName: 'Empty',
        email: `np-player-empty-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const clientMulti = await User.create({
        firstName: 'NutPlayer',
        lastName: 'Multi',
        email: `np-player-multi-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const clientMissing = await User.create({
        firstName: 'NutPlayer',
        lastName: 'Missing',
        email: `np-player-missing-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const clientDraft = await User.create({
        firstName: 'NutPlayer',
        lastName: 'Draft',
        email: `np-player-draft-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const clientArchived = await User.create({
        firstName: 'NutPlayer',
        lastName: 'Archived',
        email: `np-player-archived-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const loginTrainer = await request('POST', '/auth/login', {
        body: { email: trainer.email, password },
    });
    const loginAdmin = await request('POST', '/auth/login', {
        body: { email: admin.email, password },
    });
    const loginA = await request('POST', '/auth/login', {
        body: { email: clientA.email, password },
    });
    const loginB = await request('POST', '/auth/login', {
        body: { email: clientB.email, password },
    });
    const loginEmpty = await request('POST', '/auth/login', {
        body: { email: clientEmpty.email, password },
    });
    const loginMulti = await request('POST', '/auth/login', {
        body: { email: clientMulti.email, password },
    });
    const loginMissing = await request('POST', '/auth/login', {
        body: { email: clientMissing.email, password },
    });
    const loginDraft = await request('POST', '/auth/login', {
        body: { email: clientDraft.email, password },
    });
    const loginArchived = await request('POST', '/auth/login', {
        body: { email: clientArchived.email, password },
    });

    const tokenTrainer = loginTrainer.json?.data?.token;
    const tokenAdmin = loginAdmin.json?.data?.token;
    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;
    const tokenEmpty = loginEmpty.json?.data?.token;
    const tokenMulti = loginMulti.json?.data?.token;
    const tokenMissing = loginMissing.json?.data?.token;
    const tokenDraft = loginDraft.json?.data?.token;
    const tokenArchived = loginArchived.json?.data?.token;

    if (!tokenTrainer || !tokenA || !tokenB || !tokenEmpty) {
        throw new Error('Failed to login test users');
    }

    const food = await Food.create({
        name: `Player Food ${suffix}`,
        brand: 'Test Brand',
        category: 'protein',
        nutritionPer100g: { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
        defaultServing: { quantity: 1, unit: 'serving', gramWeight: 100 },
        ownership: { type: 'trainer', trainerId: trainer._id },
        source: { type: 'manual' },
        status: 'active',
    });

    const planPayload = (overrides = {}) => ({
        name: `Player Nutrition Plan ${suffix}`,
        description: 'Player live nutrition prescription',
        goal: 'muscle_gain',
        duration: 8,
        daysCount: 7,
        scheduleMode: 'weekly',
        notes: 'Eat well',
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
                notes: 'High carb',
                meals: [
                    {
                        order: 1,
                        name: 'Breakfast',
                        mealType: 'breakfast',
                        suggestedTime: '08:00',
                        notes: 'Post wake',
                        foodItems: [
                            {
                                foodId: food._id.toString(),
                                order: 1,
                                quantity: 150,
                                unit: 'g',
                                notes: 'Lean protein',
                            },
                        ],
                    },
                ],
            },
        ],
        ...overrides,
    });

    const createPlan = await request('POST', '/nutrition-plans', {
        token: tokenTrainer,
        body: planPayload(),
    });
    const planId = createPlan.json?.data?.nutritionPlan?.id;
    if (createPlan.status !== 201 || !planId) {
        throw new Error(`Failed to create plan: ${JSON.stringify(createPlan.json)}`);
    }

    const planB = await request('POST', '/nutrition-plans', {
        token: tokenTrainer,
        body: planPayload({ name: `Client B Plan ${suffix}` }),
    });
    const planBId = planB.json?.data?.nutritionPlan?.id;

    const assignA = await request('POST', `/nutrition-plans/${planId}/assignments`, {
        token: tokenTrainer,
        body: {
            clientIds: [clientA._id.toString()],
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 7 * 86400000).toISOString(),
            notes: 'player primary',
        },
    });
    if (assignA.status !== 201) {
        throw new Error(`Assign A failed: ${JSON.stringify(assignA.json)}`);
    }

    const assignB = await request('POST', `/nutrition-plans/${planBId}/assignments`, {
        token: tokenTrainer,
        body: {
            clientIds: [clientB._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    if (assignB.status !== 201) {
        throw new Error(`Assign B failed: ${JSON.stringify(assignB.json)}`);
    }

    // --- Auth ---
    const noToken = await request('GET', '/me/nutrition-plan');
    if (noToken.status === 401) pass('1. No token → 401');
    else fail('1. No token → 401', JSON.stringify(noToken.json));

    const trainerRes = await request('GET', '/me/nutrition-plan', { token: tokenTrainer });
    if (trainerRes.status === 403) pass('2. Trainer token → 403');
    else fail('2. Trainer token → 403', JSON.stringify(trainerRes.json));

    const adminRes = await request('GET', '/me/nutrition-plan', { token: tokenAdmin });
    if (adminRes.status === 403) pass('3. Admin token → 403');
    else fail('3. Admin token → 403', JSON.stringify(adminRes.json));

    // --- Happy path ---
    const meA = await request('GET', '/me/nutrition-plan', { token: tokenA });
    const dataA = meA.json?.data;
    const assignmentA = dataA?.assignment;
    const planOut = dataA?.plan;

    if (meA.status === 200 && meA.json?.success === true && assignmentA && planOut) {
        pass('4. Client with active assignment → 200');
    } else {
        fail('4. Client with active assignment → 200', JSON.stringify(meA.json));
    }

    if (
        assignmentA?.id &&
        assignmentA?.status === 'active' &&
        assignmentA?.startDate &&
        assignmentA?.endDate
    ) {
        pass('5. Response contains assignment metadata');
    } else {
        fail('5. Response contains assignment metadata', JSON.stringify(assignmentA));
    }

    if (
        planOut?.id === planId &&
        planOut?.name &&
        planOut?.description &&
        planOut?.goal &&
        planOut?.duration != null &&
        planOut?.daysCount != null &&
        planOut?.scheduleMode &&
        planOut?.icon &&
        planOut?.status === 'active' &&
        planOut?.notes
    ) {
        pass('6. Response contains plan metadata');
    } else {
        fail('6. Response contains plan metadata', JSON.stringify(planOut));
    }

    if (
        planOut?.macroTargets?.calories === 2800 &&
        planOut?.macroTargets?.protein === 180 &&
        planOut?.macroTargets?.carbs === 320 &&
        planOut?.macroTargets?.fat === 80
    ) {
        pass('7. Response contains macroTargets');
    } else {
        fail('7. Response contains macroTargets', JSON.stringify(planOut?.macroTargets));
    }

    const day0 = planOut?.nutritionDays?.[0];
    if (Array.isArray(planOut?.nutritionDays) && day0?.dayNumber === 1 && day0?.name) {
        pass('8. Response contains nutritionDays');
    } else {
        fail('8. Response contains nutritionDays', JSON.stringify(planOut?.nutritionDays));
    }

    const meal0 = day0?.meals?.[0];
    if (
        meal0?.order === 1 &&
        meal0?.name === 'Breakfast' &&
        meal0?.mealType === 'breakfast' &&
        meal0?.suggestedTime === '08:00'
    ) {
        pass('9. Response contains meals');
    } else {
        fail('9. Response contains meals', JSON.stringify(meal0));
    }

    const food0 = meal0?.foodItems?.[0];
    if (
        food0?.foodId === food._id.toString() &&
        food0?.order === 1 &&
        food0?.quantity === 150 &&
        food0?.unit === 'g'
    ) {
        pass('10. Response contains foodItems');
    } else {
        fail('10. Response contains foodItems', JSON.stringify(food0));
    }

    if (
        food0?.foodSnapshot?.name &&
        food0?.foodSnapshot?.category === 'protein' &&
        food0?.foodSnapshot?.nutritionPer100g?.calories != null &&
        food0?.foodSnapshot?.defaultServing?.unit
    ) {
        pass('11. Food snapshot is included where present');
    } else {
        fail('11. Food snapshot is included where present', JSON.stringify(food0?.foodSnapshot));
    }

    // --- Empty ---
    const meEmpty = await request('GET', '/me/nutrition-plan', { token: tokenEmpty });
    if (
        meEmpty.status === 200 &&
        meEmpty.json?.success === true &&
        meEmpty.json?.data?.assignment === null
    ) {
        pass('12. Client with no active assignment → 200 + null assignment');
    } else {
        fail('12. Client with no active assignment → 200 + null assignment', JSON.stringify(meEmpty.json));
    }

    // --- Ownership / IDOR ---
    const meB = await request('GET', '/me/nutrition-plan', { token: tokenB });
    if (
        meB.status === 200 &&
        meB.json?.data?.plan?.id === planBId &&
        meB.json?.data?.plan?.id !== planId
    ) {
        pass("13. Client A cannot retrieve Client B's plan (B sees own)");
    } else {
        fail("13. Client A cannot retrieve Client B's plan (B sees own)", JSON.stringify(meB.json));
    }

    if (meA.json?.data?.plan?.id !== planBId && meA.json?.data?.plan?.id === planId) {
        pass('13b. Client A sees own plan only');
    } else {
        fail('13b. Client A sees own plan only', JSON.stringify(meA.json?.data?.plan?.id));
    }

    const queryOverride = await request(
        'GET',
        `/me/nutrition-plan?clientId=${clientB._id.toString()}`,
        { token: tokenA }
    );
    if (
        queryOverride.status === 200 &&
        queryOverride.json?.data?.plan?.id === planId &&
        queryOverride.json?.data?.plan?.id !== planBId
    ) {
        pass('14. No clientId query parameter is accepted');
    } else {
        fail('14. No clientId query parameter is accepted', JSON.stringify(queryOverride.json));
    }

    // Node fetch forbids GET bodies; send raw HTTP GET with a body to prove identity is ignored.
    const bodyOverride = await new Promise((resolve) => {
        const url = new URL(`${API}/me/nutrition-plan`);
        const payload = JSON.stringify({ clientId: clientB._id.toString() });
        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${tokenA}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
            },
            (res) => {
                let raw = '';
                res.on('data', (chunk) => {
                    raw += chunk;
                });
                res.on('end', () => {
                    let json = {};
                    try {
                        json = JSON.parse(raw);
                    } catch {
                        json = {};
                    }
                    resolve({ status: res.statusCode, json });
                });
            }
        );
        req.on('error', (err) => resolve({ status: 0, json: { error: String(err) } }));
        req.write(payload);
        req.end();
    });
    if (
        bodyOverride.status === 200 &&
        bodyOverride.json?.data?.plan?.id === planId &&
        bodyOverride.json?.data?.plan?.id !== planBId
    ) {
        pass('15. No clientId body is accepted');
    } else {
        fail('15. No clientId body is accepted', JSON.stringify(bodyOverride.json));
    }

    const trainerOverride = await request(
        'GET',
        `/me/nutrition-plan?trainerId=${trainerB._id.toString()}`,
        { token: tokenA }
    );
    if (
        trainerOverride.status === 200 &&
        trainerOverride.json?.data?.plan?.id === planId
    ) {
        pass('16. No trainerId override is accepted');
    } else {
        fail('16. No trainerId override is accepted', JSON.stringify(trainerOverride.json));
    }

    // --- Multiple active assignments ---
    const multiPlan1 = await NutritionPlan.create({
        name: `Multi Plan 1 ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        scheduleMode: 'weekly',
        macroTargets: { calories: 2000, protein: 120, carbs: 200, fat: 60 },
        nutritionDays: [],
        ownership: { type: 'trainer', trainerId: trainer._id },
        status: 'active',
        isTemplate: false,
    });
    const multiPlan2 = await NutritionPlan.create({
        name: `Multi Plan 2 ${suffix}`,
        goal: 'weight_loss',
        duration: 4,
        daysCount: 7,
        scheduleMode: 'weekly',
        macroTargets: { calories: 1800, protein: 140, carbs: 150, fat: 50 },
        nutritionDays: [],
        ownership: { type: 'trainer', trainerId: trainerB._id },
        status: 'active',
        isTemplate: false,
    });

    const olderStart = new Date('2020-01-01T00:00:00.000Z');
    const newerStart = new Date('2025-01-01T00:00:00.000Z');

    await NutritionPlanAssignment.create({
        trainerId: trainer._id,
        planId: multiPlan1._id,
        clientId: clientMulti._id,
        startDate: olderStart,
        status: 'active',
    });
    await NutritionPlanAssignment.create({
        trainerId: trainerB._id,
        planId: multiPlan2._id,
        clientId: clientMulti._id,
        startDate: newerStart,
        status: 'active',
    });

    const meMulti = await request('GET', '/me/nutrition-plan', { token: tokenMulti });
    if (
        meMulti.status === 500 &&
        String(meMulti.json?.message || '').toLowerCase().includes('integrity')
    ) {
        pass('17. Multiple active assignments → integrity error');
    } else {
        fail('17. Multiple active assignments → integrity error', JSON.stringify(meMulti.json));
    }

    if (meMulti.json?.data?.plan?.id == null && meMulti.json?.data?.assignment?.id == null) {
        pass('18. Endpoint does NOT choose newest/arbitrary assignment');
    } else {
        fail(
            '18. Endpoint does NOT choose newest/arbitrary assignment',
            JSON.stringify(meMulti.json?.data)
        );
    }

    // --- Plan integrity ---
    const ghostPlanId = new mongoose.Types.ObjectId();
    await NutritionPlanAssignment.create({
        trainerId: trainer._id,
        planId: ghostPlanId,
        clientId: clientMissing._id,
        startDate: new Date(),
        status: 'active',
    });

    const meMissing = await request('GET', '/me/nutrition-plan', { token: tokenMissing });
    if (meMissing.status === 404) {
        pass('19. Missing referenced plan → appropriate error');
    } else {
        fail('19. Missing referenced plan → appropriate error', JSON.stringify(meMissing.json));
    }

    const draftPlan = await NutritionPlan.create({
        name: `Draft Plan ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        scheduleMode: 'weekly',
        macroTargets: { calories: 2000, protein: 120, carbs: 200, fat: 60 },
        nutritionDays: [],
        ownership: { type: 'trainer', trainerId: trainer._id },
        status: 'draft',
        isTemplate: false,
    });
    await NutritionPlanAssignment.create({
        trainerId: trainer._id,
        planId: draftPlan._id,
        clientId: clientDraft._id,
        startDate: new Date(),
        status: 'active',
    });
    const meDraft = await request('GET', '/me/nutrition-plan', { token: tokenDraft });
    if (meDraft.status === 404) {
        pass('20a. Draft plan → not found (domain rule)');
    } else {
        fail('20a. Draft plan → not found (domain rule)', JSON.stringify(meDraft.json));
    }

    const archivedPlan = await request('POST', '/nutrition-plans', {
        token: tokenTrainer,
        body: planPayload({ name: `Archived Assign Plan ${suffix}` }),
    });
    const archivedPlanId = archivedPlan.json?.data?.nutritionPlan?.id;
    const assignArchived = await request('POST', `/nutrition-plans/${archivedPlanId}/assignments`, {
        token: tokenTrainer,
        body: {
            clientIds: [clientArchived._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    if (assignArchived.status !== 201) {
        throw new Error(`Assign archived client failed: ${JSON.stringify(assignArchived.json)}`);
    }
    const archiveRes = await request('DELETE', `/nutrition-plans/${archivedPlanId}`, {
        token: tokenTrainer,
    });
    if (archiveRes.status !== 200) {
        throw new Error(`Archive failed: ${JSON.stringify(archiveRes.json)}`);
    }
    const meArchived = await request('GET', '/me/nutrition-plan', { token: tokenArchived });
    if (
        meArchived.status === 200 &&
        meArchived.json?.data?.plan?.id === archivedPlanId &&
        meArchived.json?.data?.plan?.status === 'archived'
    ) {
        pass('20b. Archived plan with active assignment remains readable');
    } else {
        fail(
            '20b. Archived plan with active assignment remains readable',
            JSON.stringify(meArchived.json)
        );
    }

    const rawLeak =
        hasForbiddenKeys(dataA, ['_id', '__v', '$__', '$isNew', '_doc']) ||
        (typeof dataA?.plan?.nutritionDays?.[0]?.toObject === 'function'
            ? 'mongoose method leak'
            : null);
    if (!rawLeak) pass('21. No raw Mongoose document leaks');
    else fail('21. No raw Mongoose document leaks', rawLeak);

    // --- DTO security ---
    if (assignmentA && !('trainerId' in assignmentA) && !('clientId' in assignmentA)) {
        pass('22. trainerId absent from assignment');
    } else {
        fail('22. trainerId absent from assignment', JSON.stringify(assignmentA));
    }

    if (planOut && !('ownership' in planOut) && !('trainerId' in planOut)) {
        pass('23. ownership internals absent from plan');
    } else {
        fail('23. ownership internals absent from plan', JSON.stringify({
            ownership: planOut?.ownership,
            trainerId: planOut?.trainerId,
        }));
    }

    if (
        planOut &&
        !('createdAt' in planOut) &&
        !('updatedAt' in planOut) &&
        !('_id' in planOut) &&
        !('__v' in planOut)
    ) {
        pass('24. internal Mongo / audit fields absent');
    } else {
        fail('24. internal Mongo / audit fields absent', JSON.stringify(planOut));
    }

    if (
        planOut &&
        !('computedMacros' in planOut) &&
        !('templateKey' in planOut) &&
        !('isTemplate' in planOut)
    ) {
        pass('25. calculator/recommendation internals absent');
    } else {
        fail('25. calculator/recommendation internals absent', JSON.stringify({
            computedMacros: planOut?.computedMacros,
            templateKey: planOut?.templateKey,
            isTemplate: planOut?.isTemplate,
        }));
    }

    // --- Live plan behavior ---
    const liveEdit = await request('PATCH', `/nutrition-plans/${planId}`, {
        token: tokenTrainer,
        body: {
            name: `Live Edited Plan ${suffix}`,
            description: 'Updated after assign',
            macroTargets: {
                calories: 3000,
                protein: 200,
                carbs: 350,
                fat: 90,
            },
            nutritionDays: [
                {
                    dayNumber: 1,
                    name: 'Updated Day',
                    meals: [
                        {
                            order: 1,
                            name: 'Lunch',
                            mealType: 'lunch',
                            suggestedTime: '13:00',
                            foodItems: [
                                {
                                    foodId: food._id.toString(),
                                    order: 1,
                                    quantity: 200,
                                    unit: 'g',
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    });
    if (liveEdit.status !== 200) {
        fail('26. Edit assigned live plan', JSON.stringify(liveEdit.json));
    } else {
        pass('26. Edit assigned live plan');
    }

    const meLive = await request('GET', '/me/nutrition-plan', { token: tokenA });
    const livePlan = meLive.json?.data?.plan;
    if (
        meLive.status === 200 &&
        livePlan?.name === `Live Edited Plan ${suffix}` &&
        livePlan?.description === 'Updated after assign' &&
        livePlan?.macroTargets?.calories === 3000 &&
        livePlan?.nutritionDays?.[0]?.name === 'Updated Day' &&
        livePlan?.nutritionDays?.[0]?.meals?.[0]?.name === 'Lunch' &&
        livePlan?.nutritionDays?.[0]?.meals?.[0]?.foodItems?.[0]?.quantity === 200
    ) {
        pass('27. GET Player endpoint returns current live plan content');
    } else {
        fail('27. GET Player endpoint returns current live plan content', JSON.stringify(livePlan));
    }

    // Cleanup
    await NutritionPlanAssignment.deleteMany({
        clientId: {
            $in: [
                clientA._id,
                clientB._id,
                clientEmpty._id,
                clientMulti._id,
                clientMissing._id,
                clientDraft._id,
                clientArchived._id,
            ],
        },
    });
    await NutritionPlan.deleteMany({
        'ownership.trainerId': { $in: [trainer._id, trainerB._id] },
    });
    await Food.deleteMany({ _id: food._id });
    await User.deleteMany({
        _id: {
            $in: [
                trainer._id,
                trainerB._id,
                admin._id,
                clientA._id,
                clientB._id,
                clientEmpty._id,
                clientMulti._id,
                clientMissing._id,
                clientDraft._id,
                clientArchived._id,
            ],
        },
    });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log('\n--- Summary ---');
    console.log(`Passed: ${results.filter((r) => r.ok).length}/${results.length}`);
    if (failed.length) {
        failed.forEach((f) => console.log(`FAIL: ${f.name} — ${f.detail}`));
        process.exit(1);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
