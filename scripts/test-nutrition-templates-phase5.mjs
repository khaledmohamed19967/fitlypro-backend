/**
 * Manual Phase 5 system nutrition templates + clone verification.
 * Run: node scripts/test-nutrition-templates-phase5.mjs
 *
 * Prerequisites:
 * - Dev server running
 * - Foods seeded: pnpm run seed:foods
 * - Templates seeded: pnpm run seed:nutrition-templates
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { execSync } from 'node:child_process';
import User from '../src/modules/users/user.model.js';
import Food from '../src/modules/foods/food.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';

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
};

const collectNestedIds = (plan) => {
    const dayIds = [];
    const mealIds = [];
    const foodItemIds = [];
    const foodIds = [];
    const snapshots = [];

    for (const day of plan.nutritionDays || []) {
        dayIds.push(day.id);
        for (const meal of day.meals || []) {
            mealIds.push(meal.id);
            for (const item of meal.foodItems || []) {
                foodItemIds.push(item.id);
                foodIds.push(item.foodId);
                snapshots.push(JSON.stringify(item.foodSnapshot));
            }
        }
    }

    return { dayIds, mealIds, foodItemIds, foodIds, snapshots };
};

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'NutTpl',
        lastName: 'Alpha',
        email: `nuttpl-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'NutTpl',
        lastName: 'Beta',
        email: `nuttpl-b-${suffix}@test.com`,
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
        throw new Error('Failed to login test trainers');
    }

    const trainerPlanCountBefore = await NutritionPlan.countDocuments({
        $or: [
            { 'ownership.type': 'trainer' },
            { ownership: { $exists: false }, trainerId: { $ne: null } },
        ],
    });

    const systemTemplate = await NutritionPlan.findOne({
        'ownership.type': 'system',
        isTemplate: true,
        templateKey: 'maintenance-balanced',
        status: 'active',
    });

    if (systemTemplate) pass('System templates exist');
    else fail('System templates exist', 'maintenance-balanced not found — run seed:nutrition-templates');

    const systemCount = await NutritionPlan.countDocuments({
        'ownership.type': 'system',
        isTemplate: true,
        templateKey: {
            $in: [
                'weight-loss-beginner',
                'weight-loss-high-protein',
                'maintenance-balanced',
                'muscle-gain-beginner',
                'muscle-gain-high-protein',
                'body-recomposition',
                'high-protein',
                'general-health',
            ],
        },
    });

    if (systemCount === 8) pass('Eight system templates in DB');
    else fail('Eight system templates in DB', `count=${systemCount}`);

    const listSystem = await request(
        'GET',
        '/nutrition-plans?ownership=system&isTemplate=true',
        { token: tokenA }
    );

    if (
        listSystem.status === 200 &&
        listSystem.json?.data?.nutritionPlans?.some(
            (p) => p.id === systemTemplate?._id.toString()
        )
    ) {
        pass('System template list');
    } else {
        fail('System template list', JSON.stringify(listSystem.json));
    }

    const detail = await request('GET', `/nutrition-plans/${systemTemplate._id}`, {
        token: tokenA,
    });
    const sourcePlan = detail.json?.data?.nutritionPlan;

    if (
        detail.status === 200 &&
        sourcePlan?.ownership?.type === 'system' &&
        sourcePlan?.isTemplate === true
    ) {
        pass('System template detail');
    } else {
        fail('System template detail', JSON.stringify(detail.json));
    }

    const patchSystem = await request('PATCH', `/nutrition-plans/${systemTemplate._id}`, {
        token: tokenA,
        body: { name: 'Hacked System Template' },
    });
    if (patchSystem.status === 403) pass('System template cannot PATCH');
    else fail('System template cannot PATCH', `status ${patchSystem.status}`);

    const deleteSystem = await request('DELETE', `/nutrition-plans/${systemTemplate._id}`, {
        token: tokenA,
    });
    if (deleteSystem.status === 403) pass('System template cannot DELETE');
    else fail('System template cannot DELETE', `status ${deleteSystem.status}`);

    const cloneRes = await request('POST', `/nutrition-plans/${systemTemplate._id}/clone`, {
        token: tokenA,
    });
    const clone = cloneRes.json?.data?.nutritionPlan;

    if (cloneRes.status === 201 && clone?.id) pass('Clone system template');
    else fail('Clone system template', JSON.stringify(cloneRes.json));

    if (clone?.ownership?.type === 'trainer') pass('Clone has trainer ownership');
    else fail('Clone has trainer ownership', JSON.stringify(clone?.ownership));

    if (clone?.isTemplate === false) pass('Clone is not template');
    else fail('Clone is not template', String(clone?.isTemplate));

    if (clone?.status === 'active') pass('Clone is active');
    else fail('Clone is active', clone?.status);

    if (clone?.templateKey == null) pass('Clone templateKey null');
    else fail('Clone templateKey null', String(clone?.templateKey));

    if (clone?.id !== sourcePlan?.id) pass('Clone plan ID different');
    else fail('Clone plan ID different', 'IDs match');

    const sourceIds = collectNestedIds(sourcePlan);
    const cloneIds = collectNestedIds(clone);

    if (
        sourceIds.dayIds.every((id, i) => id !== cloneIds.dayIds[i]) &&
        sourceIds.dayIds.length === cloneIds.dayIds.length
    ) {
        pass('Day IDs different');
    } else {
        fail('Day IDs different', JSON.stringify({ sourceIds: sourceIds.dayIds, cloneIds: cloneIds.dayIds }));
    }

    if (
        sourceIds.mealIds.every((id, i) => id !== cloneIds.mealIds[i]) &&
        sourceIds.mealIds.length === cloneIds.mealIds.length
    ) {
        pass('Meal IDs different');
    } else {
        fail('Meal IDs different', JSON.stringify({ sourceIds: sourceIds.mealIds, cloneIds: cloneIds.mealIds }));
    }

    if (
        sourceIds.foodItemIds.every((id, i) => id !== cloneIds.foodItemIds[i]) &&
        sourceIds.foodItemIds.length === cloneIds.foodItemIds.length
    ) {
        pass('Food item IDs different');
    } else {
        fail('Food item IDs different', JSON.stringify({
            sourceIds: sourceIds.foodItemIds,
            cloneIds: cloneIds.foodItemIds,
        }));
    }

    if (
        sourceIds.foodIds.length === cloneIds.foodIds.length &&
        sourceIds.foodIds.every((id, i) => id === cloneIds.foodIds[i])
    ) {
        pass('foodId preserved');
    } else {
        fail('foodId preserved', JSON.stringify({ sourceIds: sourceIds.foodIds, cloneIds: cloneIds.foodIds }));
    }

    if (
        sourceIds.snapshots.length === cloneIds.snapshots.length &&
        sourceIds.snapshots.every((s, i) => s === cloneIds.snapshots[i])
    ) {
        pass('foodSnapshot preserved');
    } else {
        fail('foodSnapshot preserved', 'snapshots differ');
    }

    if (clone?.icon === sourcePlan?.icon) pass('icon preserved');
    else fail('icon preserved', `${sourcePlan?.icon} vs ${clone?.icon}`);

    if (
        clone?.macroTargets?.calories === sourcePlan?.macroTargets?.calories &&
        clone?.macroTargets?.protein === sourcePlan?.macroTargets?.protein
    ) {
        pass('macroTargets preserved');
    } else {
        fail('macroTargets preserved', JSON.stringify({ source: sourcePlan?.macroTargets, clone: clone?.macroTargets }));
    }

    const weeklyTemplate = await NutritionPlan.create({
        trainerId: trainerA._id,
        ownership: { type: 'trainer', trainerId: trainerA._id },
        name: `Weekly Template ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        scheduleMode: 'weekly',
        macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        nutritionDays: Array.from({ length: 7 }, (_, i) => ({
            dayNumber: i + 1,
            name: `Day ${i + 1}`,
            meals: [],
        })),
        isTemplate: true,
        status: 'active',
    });

    const weeklyCloneRes = await request('POST', `/nutrition-plans/${weeklyTemplate._id}/clone`, {
        token: tokenA,
    });
    const weeklyClone = weeklyCloneRes.json?.data?.nutritionPlan;
    if (weeklyCloneRes.status === 201 && weeklyClone?.scheduleMode === 'weekly') {
        pass('scheduleMode preserved on clone');
    } else {
        fail('scheduleMode preserved on clone', JSON.stringify({
            status: weeklyCloneRes.status,
            scheduleMode: weeklyClone?.scheduleMode,
        }));
    }

    const nameOverride = await request('POST', `/nutrition-plans/${systemTemplate._id}/clone`, {
        token: tokenA,
        body: { name: `Custom Clone ${suffix}` },
    });
    if (
        nameOverride.status === 201 &&
        nameOverride.json?.data?.nutritionPlan?.name === `Custom Clone ${suffix}`
    ) {
        pass('Name override');
    } else {
        fail('Name override', JSON.stringify(nameOverride.json));
    }

    await request('POST', `/nutrition-plans/${systemTemplate._id}/clone`, { token: tokenA });
    const collisionClone = await request('POST', `/nutrition-plans/${systemTemplate._id}/clone`, {
        token: tokenA,
    });
    const defaultName = `${sourcePlan.name} Copy`;
    const collisionName = collisionClone.json?.data?.nutritionPlan?.name;
    if (
        collisionClone.status === 201 &&
        collisionName !== defaultName &&
        / Copy( \d+)?$/.test(collisionName)
    ) {
        pass('Name collision handling');
    } else {
        fail('Name collision handling', collisionName);
    }

    const defaultClone = await request('POST', `/nutrition-plans/${systemTemplate._id}/clone`, {
        token: tokenA,
    });
    const defaultCloneName = defaultClone.json?.data?.nutritionPlan?.name;
    if (
        defaultClone.status === 201 &&
        (defaultCloneName === defaultName ||
            defaultCloneName?.startsWith(`${sourcePlan.name} Copy`))
    ) {
        pass('Default Copy name');
    } else {
        fail('Default Copy name', defaultCloneName);
    }

    const ownTemplate = await NutritionPlan.create({
        trainerId: trainerA._id,
        ownership: { type: 'trainer', trainerId: trainerA._id },
        name: `Trainer Template ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        nutritionDays: [],
        isTemplate: true,
        status: 'active',
    });

    const cloneOwn = await request('POST', `/nutrition-plans/${ownTemplate._id}/clone`, {
        token: tokenA,
    });
    if (cloneOwn.status === 201 && cloneOwn.json?.data?.nutritionPlan?.isTemplate === false) {
        pass('Own trainer template clone');
    } else {
        fail('Own trainer template clone', JSON.stringify(cloneOwn.json));
    }

    const foreignTemplate = await NutritionPlan.create({
        trainerId: trainerB._id,
        ownership: { type: 'trainer', trainerId: trainerB._id },
        name: `Foreign Template ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        nutritionDays: [],
        isTemplate: true,
        status: 'active',
    });

    const cloneForeign = await request('POST', `/nutrition-plans/${foreignTemplate._id}/clone`, {
        token: tokenA,
    });
    if (cloneForeign.status === 404) pass('Foreign trainer template rejected');
    else fail('Foreign trainer template rejected', JSON.stringify(cloneForeign.json));

    const archivedTemplate = await NutritionPlan.create({
        trainerId: trainerA._id,
        ownership: { type: 'trainer', trainerId: trainerA._id },
        name: `Archived Template ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        nutritionDays: [],
        isTemplate: true,
        status: 'archived',
    });

    const cloneArchived = await request('POST', `/nutrition-plans/${archivedTemplate._id}/clone`, {
        token: tokenA,
    });
    if (cloneArchived.status === 400) pass('Archived template rejected');
    else fail('Archived template rejected', JSON.stringify(cloneArchived.json));

    const nonTemplate = await NutritionPlan.create({
        trainerId: trainerA._id,
        ownership: { type: 'trainer', trainerId: trainerA._id },
        name: `Non Template ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        nutritionDays: [],
        isTemplate: false,
        status: 'active',
    });

    const ownFood = await Food.create({
        name: `Clone Normal Food ${suffix}`,
        category: 'protein',
        nutritionPer100g: { calories: 200, protein: 25, carbs: 2, fat: 10 },
        defaultServing: { quantity: 100, unit: 'g', gramWeight: 100 },
        ownership: { type: 'trainer', trainerId: trainerA._id },
        source: { type: 'manual' },
        status: 'active',
    });

    const createNormalRes = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: {
            name: `Active Normal Plan ${suffix}`,
            goal: 'muscle_gain',
            duration: 8,
            daysCount: 7,
            scheduleMode: 'weekly',
            macroTargets: { calories: 2800, protein: 180, carbs: 320, fat: 80 },
            nutritionDays: [
                {
                    dayNumber: 1,
                    name: 'Day 1',
                    meals: [
                        {
                            order: 1,
                            name: 'Breakfast',
                            mealType: 'breakfast',
                            foodItems: [
                                {
                                    foodId: ownFood._id.toString(),
                                    order: 1,
                                    quantity: 100,
                                    unit: 'g',
                                },
                            ],
                        },
                    ],
                },
            ],
            isTemplate: false,
            status: 'active',
        },
    });
    const activeNormalPlan = createNormalRes.json?.data?.nutritionPlan;

    const cloneNormalRes = await request('POST', `/nutrition-plans/${activeNormalPlan?.id}/clone`, {
        token: tokenA,
    });
    const normalClone = cloneNormalRes.json?.data?.nutritionPlan;

    if (cloneNormalRes.status === 201 && normalClone?.id) pass('Own active normal plan clone succeeds');
    else fail('Own active normal plan clone succeeds', JSON.stringify(cloneNormalRes.json));

    if (normalClone?.id !== activeNormalPlan?.id) pass('Normal clone has new plan ID');
    else fail('Normal clone has new plan ID', `${normalClone?.id} vs ${activeNormalPlan?.id}`);

    if (normalClone?.isTemplate === false) pass('Normal clone isTemplate=false');
    else fail('Normal clone isTemplate=false', String(normalClone?.isTemplate));

    if (normalClone?.status === 'active') pass('Normal clone status=active');
    else fail('Normal clone status=active', normalClone?.status);

    if (normalClone?.templateKey == null) pass('Normal clone templateKey null');
    else fail('Normal clone templateKey null', String(normalClone?.templateKey));

    if (
        normalClone?.ownership?.type === 'trainer' &&
        String(normalClone?.ownership?.trainerId) === String(trainerA._id)
    ) {
        pass('Normal clone trainer ownership');
    } else {
        fail('Normal clone trainer ownership', JSON.stringify(normalClone?.ownership));
    }

    const sourceNormalIds = collectNestedIds(activeNormalPlan);
    const cloneNormalIds = collectNestedIds(normalClone);

    if (
        sourceNormalIds.dayIds.length > 0 &&
        sourceNormalIds.dayIds.every((id, i) => id !== cloneNormalIds.dayIds[i])
    ) {
        pass('Normal clone nested day IDs independent');
    } else {
        fail('Normal clone nested day IDs independent', JSON.stringify({ sourceNormalIds, cloneNormalIds }));
    }

    if (
        sourceNormalIds.foodIds.length === cloneNormalIds.foodIds.length &&
        sourceNormalIds.foodIds.every((id, i) => id === cloneNormalIds.foodIds[i])
    ) {
        pass('Normal clone foodId preserved');
    } else {
        fail('Normal clone foodId preserved', JSON.stringify({ sourceNormalIds, cloneNormalIds }));
    }

    if (
        sourceNormalIds.snapshots.length === cloneNormalIds.snapshots.length &&
        sourceNormalIds.snapshots.every((s, i) => s === cloneNormalIds.snapshots[i])
    ) {
        pass('Normal clone foodSnapshot preserved');
    } else {
        fail('Normal clone foodSnapshot preserved', 'snapshots differ');
    }

    if (normalClone?.scheduleMode === 'weekly') pass('Normal clone scheduleMode preserved');
    else fail('Normal clone scheduleMode preserved', normalClone?.scheduleMode);

    const normalSourceAfter = await request('GET', `/nutrition-plans/${activeNormalPlan?.id}`, {
        token: tokenA,
    });
    if (
        normalSourceAfter.status === 200 &&
        normalSourceAfter.json?.data?.nutritionPlan?.name === activeNormalPlan?.name &&
        collectNestedIds(normalSourceAfter.json?.data?.nutritionPlan).dayIds[0] ===
            sourceNormalIds.dayIds[0]
    ) {
        pass('Normal plan source unchanged');
    } else {
        fail('Normal plan source unchanged', JSON.stringify(normalSourceAfter.json));
    }

    const cloneClient = await User.create({
        firstName: 'Clone',
        lastName: 'Client',
        email: `np-clone-client-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const assignBeforeClone = await request('POST', `/nutrition-plans/${activeNormalPlan?.id}/assignments`, {
        token: tokenA,
        body: { clientIds: [cloneClient._id.toString()], startDate: '2026-01-01' },
    });
    if (assignBeforeClone.status === 201) pass('Assignment created on source normal plan');
    else fail('Assignment created on source normal plan', JSON.stringify(assignBeforeClone.json));

    const sourceAssignments = await request('GET', `/nutrition-plans/${activeNormalPlan?.id}/assignments`, {
        token: tokenA,
    });
    const cloneAssignments = await request('GET', `/nutrition-plans/${normalClone?.id}/assignments`, {
        token: tokenA,
    });
    if (
        sourceAssignments.status === 200 &&
        (sourceAssignments.json?.data?.assignments?.length ?? 0) >= 1 &&
        cloneAssignments.status === 200 &&
        (cloneAssignments.json?.data?.assignments?.length ?? 0) === 0
    ) {
        pass('Normal clone assignments not copied');
    } else {
        fail(
            'Normal clone assignments not copied',
            JSON.stringify({
                source: sourceAssignments.json,
                clone: cloneAssignments.json,
            })
        );
    }

    const foreignNormalPlan = await NutritionPlan.create({
        trainerId: trainerB._id,
        ownership: { type: 'trainer', trainerId: trainerB._id },
        name: `Foreign Normal Plan ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        nutritionDays: [],
        isTemplate: false,
        status: 'active',
    });

    const cloneForeignNormal = await request('POST', `/nutrition-plans/${foreignNormalPlan._id}/clone`, {
        token: tokenA,
    });
    if (cloneForeignNormal.status === 404) pass('Foreign active normal plan rejected');
    else fail('Foreign active normal plan rejected', JSON.stringify(cloneForeignNormal.json));

    const draftNormalPlan = await NutritionPlan.create({
        trainerId: trainerA._id,
        ownership: { type: 'trainer', trainerId: trainerA._id },
        name: `Draft Normal Plan ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        nutritionDays: [],
        isTemplate: false,
        status: 'draft',
    });

    const cloneDraftNormal = await request('POST', `/nutrition-plans/${draftNormalPlan._id}/clone`, {
        token: tokenA,
    });
    if (cloneDraftNormal.status === 400) pass('Draft normal plan rejected');
    else fail('Draft normal plan rejected', JSON.stringify(cloneDraftNormal.json));

    const archivedNormalPlan = await NutritionPlan.create({
        trainerId: trainerA._id,
        ownership: { type: 'trainer', trainerId: trainerA._id },
        name: `Archived Normal Plan ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        nutritionDays: [],
        isTemplate: false,
        status: 'archived',
    });

    const cloneArchivedNormal = await request(
        'POST',
        `/nutrition-plans/${archivedNormalPlan._id}/clone`,
        { token: tokenA }
    );
    if (cloneArchivedNormal.status === 400) pass('Archived normal plan rejected');
    else fail('Archived normal plan rejected', JSON.stringify(cloneArchivedNormal.json));

    const cloneLegacyActive = await request('POST', `/nutrition-plans/${nonTemplate._id}/clone`, {
        token: tokenA,
    });
    if (cloneLegacyActive.status === 201 && cloneLegacyActive.json?.data?.nutritionPlan?.isTemplate === false) {
        pass('Legacy active normal plan clone succeeds');
    } else {
        fail('Legacy active normal plan clone succeeds', JSON.stringify(cloneLegacyActive.json));
    }

    const missingClone = await request('POST', '/nutrition-plans/000000000000000000000000/clone', {
        token: tokenA,
    });
    if (missingClone.status === 404) pass('Missing template returns 404');
    else fail('Missing template returns 404', JSON.stringify(missingClone.json));

    const sourceAfter = await request('GET', `/nutrition-plans/${systemTemplate._id}`, {
        token: tokenA,
    });
    if (
        sourceAfter.status === 200 &&
        sourceAfter.json?.data?.nutritionPlan?.name === sourcePlan?.name &&
        sourceAfter.json?.data?.nutritionPlan?.ownership?.type === 'system'
    ) {
        pass('Source unchanged');
    } else {
        fail('Source unchanged', JSON.stringify(sourceAfter.json));
    }

    let seedOutput = '';
    const trainerPlanCountBeforeSeed = await NutritionPlan.countDocuments({
        $or: [
            { 'ownership.type': 'trainer' },
            { ownership: { $exists: false }, trainerId: { $ne: null } },
        ],
    });

    try {
        seedOutput = execSync('node scripts/seed-nutrition-templates.mjs', {
            encoding: 'utf8',
            cwd: process.cwd(),
        });
    } catch (err) {
        fail('Seed idempotency', err.stderr || err.message);
    }

    const createdMatch = seedOutput.match(/Created:\s*(\d+)/);
    const updatedMatch = seedOutput.match(/Updated:\s*(\d+)/);
    const created = createdMatch ? Number(createdMatch[1]) : -1;
    const updated = updatedMatch ? Number(updatedMatch[1]) : -1;

    if (created === 0 && updated === 8) pass('Seed idempotency');
    else fail('Seed idempotency', `Created: ${created}, Updated: ${updated}`);

    const trainerPlanCountAfterSeed = await NutritionPlan.countDocuments({
        $or: [
            { 'ownership.type': 'trainer' },
            { ownership: { $exists: false }, trainerId: { $ne: null } },
        ],
    });

    if (trainerPlanCountBeforeSeed === trainerPlanCountAfterSeed) {
        pass('Trainer plans not modified by seed');
    } else {
        fail(
            'Trainer plans not modified by seed',
            `${trainerPlanCountBeforeSeed} -> ${trainerPlanCountAfterSeed}`
        );
    }

    const defaultList = await request('GET', '/nutrition-plans', { token: tokenA });
    const defaultIds = (defaultList.json?.data?.nutritionPlans ?? []).map((p) => p.id);
    if (
        defaultList.status === 200 &&
        !defaultIds.includes(systemTemplate._id.toString()) &&
        defaultIds.includes(clone?.id)
    ) {
        pass('Default ownership filter remains trainer');
    } else {
        fail('Default ownership filter remains trainer', JSON.stringify(defaultList.json));
    }

    const allList = await request('GET', '/nutrition-plans?ownership=all', { token: tokenA });
    const allIds = (allList.json?.data?.nutritionPlans ?? []).map((p) => p.id);
    if (
        allList.status === 200 &&
        allIds.includes(systemTemplate._id.toString()) &&
        allIds.includes(clone?.id)
    ) {
        pass('ownership=all returns system + own plans');
    } else {
        fail('ownership=all returns system + own plans', JSON.stringify(allList.json));
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);

    await NutritionPlan.deleteMany({
        $or: [
            { trainerId: { $in: [trainerA._id, trainerB._id] } },
            {
                _id: {
                    $in: [
                        ownTemplate._id,
                        foreignTemplate._id,
                        archivedTemplate._id,
                        nonTemplate._id,
                        weeklyTemplate._id,
                        foreignNormalPlan._id,
                        draftNormalPlan._id,
                        archivedNormalPlan._id,
                    ],
                },
            },
        ],
    });
    await Food.deleteMany({ _id: ownFood._id });
    await User.deleteMany({ _id: { $in: [trainerA._id, trainerB._id, cloneClient._id] } });
    await mongoose.disconnect();

    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
