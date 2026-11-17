/**
 * Client Details — workoutPlanSummary + nutritionPlanSummary.
 * Run: node scripts/test-client-details-plan-summaries.mjs
 * Requires: APP_DB_URL
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js';
import PlanAssignment from '../src/modules/workout-plans/plan-assignment.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import NutritionPlanAssignment from '../src/modules/nutrition-plan-assignments/nutrition-plan-assignment.model.js';
import clientService from '../src/modules/clients/client.service.js';
import { ApiError } from '../src/utils/ApiError.js';

const results = [];
const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const WORKOUT_SUMMARY_KEYS = [
    'assignmentId',
    'planId',
    'planName',
    'status',
    'startDate',
    'endDate',
    'totalWeeks',
    'completedSessions',
    'totalSessions',
];

const NUTRITION_SUMMARY_KEYS = [
    'assignmentId',
    'planId',
    'planName',
    'status',
    'startDate',
    'endDate',
    'assignedAt',
];

const assertExactKeys = (obj, keys) => {
    const actual = Object.keys(obj).sort();
    const expected = [...keys].sort();
    return JSON.stringify(actual) === JSON.stringify(expected);
};

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Sum',
        lastName: 'TrainerA',
        email: `cd-sum-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const trainerB = await User.create({
        firstName: 'Sum',
        lastName: 'TrainerB',
        email: `cd-sum-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const mkClient = (trainer, last) =>
        User.create({
            firstName: 'Sum',
            lastName: last,
            email: `cd-sum-${last.toLowerCase()}-${suffix}@test.com`,
            password,
            role: 'client',
            trainer: trainer._id,
            primaryFitnessGoal: 'general_fitness',
            isActive: true,
        });

    const clientBoth = await mkClient(trainerA, 'Both');
    const clientEmpty = await mkClient(trainerA, 'Empty');
    const clientWorkoutOnly = await mkClient(trainerA, 'WorkoutOnly');
    const clientNutritionOnly = await mkClient(trainerA, 'NutritionOnly');
    const clientDraft = await mkClient(trainerA, 'Draft');
    const clientArchived = await mkClient(trainerA, 'Archived');
    const clientPastEnd = await mkClient(trainerA, 'PastEnd');
    const clientMulti = await mkClient(trainerA, 'Multi');
    const clientForeign = await mkClient(trainerB, 'Foreign');
    const clientNutriMulti = await mkClient(trainerA, 'NutriMulti');

    const mkWorkoutPlan = (overrides = {}) =>
        WorkoutPlan.create({
            trainerId: trainerA._id,
            ownership: { type: 'trainer', trainerId: trainerA._id },
            name: `CD Workout ${suffix}`,
            duration: 8,
            daysPerWeek: 3,
            goal: 'strength',
            level: 'beginner',
            isTemplate: false,
            status: 'active',
            workoutDays: [],
            ...overrides,
        });

    const mkNutritionPlan = (overrides = {}) =>
        NutritionPlan.create({
            trainerId: trainerA._id,
            ownership: { type: 'trainer', trainerId: trainerA._id },
            name: `CD Nutrition ${suffix}`,
            goal: 'maintenance',
            duration: 6,
            daysCount: 7,
            scheduleMode: 'weekly',
            status: 'active',
            macroTargets: { calories: 2000, protein: 120, carbs: 200, fat: 60 },
            nutritionDays: [],
            ...overrides,
        });

    const workoutPlan = await mkWorkoutPlan({ name: `CD Workout Main ${suffix}` });
    const workoutPlanNewer = await mkWorkoutPlan({
        name: `CD Workout Newer ${suffix}`,
        duration: 12,
    });
    const workoutDraft = await mkWorkoutPlan({
        name: `CD Workout Draft ${suffix}`,
        status: 'draft',
    });
    const workoutArchived = await mkWorkoutPlan({
        name: `CD Workout Archived ${suffix}`,
        status: 'archived',
        duration: 10,
    });

    const nutritionPlan = await mkNutritionPlan({ name: `CD Nutrition Main ${suffix}` });
    const nutritionPlanB = await mkNutritionPlan({ name: `CD Nutrition B ${suffix}` });

    const pastStart = new Date('2019-01-01T00:00:00.000Z');
    const pastEnd = new Date('2020-01-01T00:00:00.000Z');
    const olderStart = new Date('2026-01-01T00:00:00.000Z');
    const newerStart = new Date('2026-06-01T00:00:00.000Z');

    const bothWorkout = await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: workoutPlan._id,
        clientId: clientBoth._id,
        startDate: olderStart,
        status: 'active',
        completedSessions: 2,
        totalSessions: 5,
        progress: 40,
    });

    const bothNutrition = await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: nutritionPlan._id,
        clientId: clientBoth._id,
        startDate: olderStart,
        status: 'active',
    });

    await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: workoutPlan._id,
        clientId: clientWorkoutOnly._id,
        startDate: new Date(),
        status: 'active',
        completedSessions: 1,
        totalSessions: 3,
        progress: 33,
    });

    await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: nutritionPlan._id,
        clientId: clientNutritionOnly._id,
        startDate: new Date(),
        status: 'active',
    });

    await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: workoutDraft._id,
        clientId: clientDraft._id,
        startDate: new Date(),
        status: 'active',
    });

    await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: workoutArchived._id,
        clientId: clientArchived._id,
        startDate: new Date(),
        status: 'active',
        completedSessions: 0,
        totalSessions: 0,
    });

    await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: workoutPlan._id,
        clientId: clientPastEnd._id,
        startDate: pastStart,
        endDate: pastEnd,
        status: 'active',
        completedSessions: 0,
        totalSessions: 0,
    });

    await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: nutritionPlan._id,
        clientId: clientPastEnd._id,
        startDate: pastStart,
        endDate: pastEnd,
        status: 'active',
    });

    await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: workoutPlan._id,
        clientId: clientMulti._id,
        startDate: olderStart,
        status: 'active',
        notes: 'older',
    });
    const multiNewer = await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: workoutPlanNewer._id,
        clientId: clientMulti._id,
        startDate: newerStart,
        status: 'active',
        notes: 'newer',
        completedSessions: 4,
        totalSessions: 7,
        progress: 57,
    });

    await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: nutritionPlan._id,
        clientId: clientNutriMulti._id,
        startDate: olderStart,
        status: 'active',
    });
    await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: nutritionPlanB._id,
        clientId: clientNutriMulti._id,
        startDate: newerStart,
        status: 'active',
    });

    await PlanAssignment.create({
        trainerId: trainerB._id,
        planId: workoutPlan._id,
        clientId: clientForeign._id,
        startDate: new Date(),
        status: 'active',
    });
    await NutritionPlanAssignment.create({
        trainerId: trainerB._id,
        planId: nutritionPlan._id,
        clientId: clientForeign._id,
        startDate: new Date(),
        status: 'active',
    });

    // --- Both summaries ---
    const detailBoth = await clientService.getClientById(
        clientBoth._id.toString(),
        trainerA._id.toString()
    );

    if (
        detailBoth.workoutPlanSummary &&
        detailBoth.workoutPlanSummary.assignmentId === String(bothWorkout._id) &&
        detailBoth.workoutPlanSummary.planId === String(workoutPlan._id) &&
        detailBoth.workoutPlanSummary.planName === workoutPlan.name &&
        detailBoth.workoutPlanSummary.status === 'active' &&
        detailBoth.workoutPlanSummary.totalWeeks === 8 &&
        detailBoth.workoutPlanSummary.completedSessions === 2 &&
        detailBoth.workoutPlanSummary.totalSessions === 5 &&
        detailBoth.workoutPlanSummary.startDate === olderStart.toISOString() &&
        assertExactKeys(detailBoth.workoutPlanSummary, WORKOUT_SUMMARY_KEYS) &&
        !('progress' in detailBoth.workoutPlanSummary)
    ) {
        pass('Workout: active assignment returns correct summary without progress');
    } else {
        fail(
            'Workout: active assignment returns correct summary without progress',
            JSON.stringify(detailBoth.workoutPlanSummary)
        );
    }

    if (
        detailBoth.nutritionPlanSummary &&
        detailBoth.nutritionPlanSummary.assignmentId === String(bothNutrition._id) &&
        detailBoth.nutritionPlanSummary.planId === String(nutritionPlan._id) &&
        detailBoth.nutritionPlanSummary.planName === nutritionPlan.name &&
        detailBoth.nutritionPlanSummary.status === 'active' &&
        detailBoth.nutritionPlanSummary.assignedAt ===
            new Date(bothNutrition.createdAt).toISOString() &&
        assertExactKeys(detailBoth.nutritionPlanSummary, NUTRITION_SUMMARY_KEYS)
    ) {
        pass('Nutrition: active assignment returns correct summary with assignedAt=createdAt');
    } else {
        fail(
            'Nutrition: active assignment returns correct summary with assignedAt=createdAt',
            JSON.stringify(detailBoth.nutritionPlanSummary)
        );
    }

    if (
        detailBoth.firstName === 'Sum' &&
        detailBoth.email === clientBoth.email &&
        Array.isArray(detailBoth.injuryAreaOptionIds)
    ) {
        pass('Existing Client Details fields remain present');
    } else {
        fail('Existing Client Details fields remain present', detailBoth.email);
    }

    const leakJson = JSON.stringify(detailBoth);
    if (
        !leakJson.includes('workoutDays') &&
        !leakJson.includes('nutritionDays') &&
        !leakJson.includes('"progress"') &&
        !leakJson.includes('macroTargets')
    ) {
        pass('No full plan/session trees or progress leak into detail response');
    } else {
        fail('No full plan/session trees or progress leak into detail response', 'leak detected');
    }

    // --- Empty ---
    const detailEmpty = await clientService.getClientById(
        clientEmpty._id.toString(),
        trainerA._id.toString()
    );
    if (
        detailEmpty.workoutPlanSummary === null &&
        detailEmpty.nutritionPlanSummary === null
    ) {
        pass('Missing both assignments → null summaries');
    } else {
        fail(
            'Missing both assignments → null summaries',
            JSON.stringify({
                w: detailEmpty.workoutPlanSummary,
                n: detailEmpty.nutritionPlanSummary,
            })
        );
    }

    // --- Independence ---
    const detailWo = await clientService.getClientById(
        clientWorkoutOnly._id.toString(),
        trainerA._id.toString()
    );
    if (detailWo.workoutPlanSummary && detailWo.nutritionPlanSummary === null) {
        pass('Missing Nutrition does not affect Workout summary');
    } else {
        fail(
            'Missing Nutrition does not affect Workout summary',
            JSON.stringify({
                w: detailWo.workoutPlanSummary,
                n: detailWo.nutritionPlanSummary,
            })
        );
    }

    const detailNo = await clientService.getClientById(
        clientNutritionOnly._id.toString(),
        trainerA._id.toString()
    );
    if (detailNo.nutritionPlanSummary && detailNo.workoutPlanSummary === null) {
        pass('Missing Workout does not affect Nutrition summary');
    } else {
        fail(
            'Missing Workout does not affect Nutrition summary',
            JSON.stringify({
                w: detailNo.workoutPlanSummary,
                n: detailNo.nutritionPlanSummary,
            })
        );
    }

    // --- Draft workout plan hidden ---
    const detailDraft = await clientService.getClientById(
        clientDraft._id.toString(),
        trainerA._id.toString()
    );
    if (detailDraft.workoutPlanSummary === null) {
        pass('Draft workout plan is not exposed');
    } else {
        fail('Draft workout plan is not exposed', JSON.stringify(detailDraft.workoutPlanSummary));
    }

    // --- Archived remains visible ---
    const detailArchived = await clientService.getClientById(
        clientArchived._id.toString(),
        trainerA._id.toString()
    );
    if (
        detailArchived.workoutPlanSummary?.planName === workoutArchived.name &&
        detailArchived.workoutPlanSummary?.totalWeeks === 10
    ) {
        pass('Archived plan visibility follows existing behavior');
    } else {
        fail(
            'Archived plan visibility follows existing behavior',
            JSON.stringify(detailArchived.workoutPlanSummary)
        );
    }

    // --- Past endDate still active ---
    const detailPast = await clientService.getClientById(
        clientPastEnd._id.toString(),
        trainerA._id.toString()
    );
    if (
        detailPast.workoutPlanSummary?.status === 'active' &&
        detailPast.workoutPlanSummary?.endDate === pastEnd.toISOString() &&
        detailPast.nutritionPlanSummary?.status === 'active' &&
        detailPast.nutritionPlanSummary?.endDate === pastEnd.toISOString()
    ) {
        pass('Past endDate does not exclude active workout/nutrition assignments');
    } else {
        fail(
            'Past endDate does not exclude active workout/nutrition assignments',
            JSON.stringify({
                w: detailPast.workoutPlanSummary,
                n: detailPast.nutritionPlanSummary,
            })
        );
    }

    // --- Newest multi-active workout ---
    const detailMulti = await clientService.getClientById(
        clientMulti._id.toString(),
        trainerA._id.toString()
    );
    if (
        detailMulti.workoutPlanSummary?.assignmentId === String(multiNewer._id) &&
        detailMulti.workoutPlanSummary?.planId === String(workoutPlanNewer._id) &&
        detailMulti.workoutPlanSummary?.totalWeeks === 12 &&
        detailMulti.workoutPlanSummary?.completedSessions === 4 &&
        detailMulti.workoutPlanSummary?.totalSessions === 7
    ) {
        pass('Newest active workout assignment is selected; counters preserved');
    } else {
        fail(
            'Newest active workout assignment is selected; counters preserved',
            JSON.stringify(detailMulti.workoutPlanSummary)
        );
    }

    // --- Nutrition multi-active integrity error ---
    try {
        await clientService.getClientById(
            clientNutriMulti._id.toString(),
            trainerA._id.toString()
        );
        fail('Nutrition multiple active assignments preserve integrity error', 'no throw');
    } catch (err) {
        if (err instanceof ApiError && err.statusCode === 500) {
            pass('Nutrition multiple active assignments preserve integrity error');
        } else {
            fail(
                'Nutrition multiple active assignments preserve integrity error',
                String(err?.message || err)
            );
        }
    }

    // --- Trainer isolation ---
    try {
        await clientService.getClientById(
            clientForeign._id.toString(),
            trainerA._id.toString()
        );
        fail('Trainer ownership isolation preserved', 'expected 403');
    } catch (err) {
        if (err instanceof ApiError && err.statusCode === 403) {
            pass('Trainer ownership isolation preserved');
        } else {
            fail('Trainer ownership isolation preserved', String(err?.message || err));
        }
    }

    const detailForeign = await clientService.getClientById(
        clientForeign._id.toString(),
        trainerB._id.toString()
    );
    if (detailForeign.workoutPlanSummary && detailForeign.nutritionPlanSummary) {
        pass('Owning trainer still receives both summaries');
    } else {
        fail(
            'Owning trainer still receives both summaries',
            JSON.stringify({
                w: detailForeign.workoutPlanSummary,
                n: detailForeign.nutritionPlanSummary,
            })
        );
    }

    // Optional HTTP smoke
    const BASE = process.env.API_URL || 'http://localhost:8000';
    try {
        const login = await fetch(`${BASE}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: trainerA.email, password }),
        });
        const loginJson = await login.json().catch(() => ({}));
        const token = loginJson?.data?.token;
        if (!token) {
            pass('HTTP checks skipped (login unavailable)');
        } else {
            const res = await fetch(`${BASE}/api/v1/clients/${clientBoth._id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const json = await res.json().catch(() => ({}));
            const data = json?.data;
            if (
                res.status === 200 &&
                data?.workoutPlanSummary?.assignmentId === String(bothWorkout._id) &&
                data?.nutritionPlanSummary?.assignmentId === String(bothNutrition._id) &&
                !('progress' in (data.workoutPlanSummary || {}))
            ) {
                pass('HTTP: Client Details returns both summaries');
            } else {
                fail('HTTP: Client Details returns both summaries', JSON.stringify(json));
            }
        }
    } catch {
        pass('HTTP checks skipped (API not reachable)');
    }

    // Cleanup
    await PlanAssignment.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await NutritionPlanAssignment.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await WorkoutPlan.deleteMany({ trainerId: trainerA._id });
    await NutritionPlan.deleteMany({ trainerId: trainerA._id });
    await User.deleteMany({
        _id: {
            $in: [
                trainerA._id,
                trainerB._id,
                clientBoth._id,
                clientEmpty._id,
                clientWorkoutOnly._id,
                clientNutritionOnly._id,
                clientDraft._id,
                clientArchived._id,
                clientPastEnd._id,
                clientMulti._id,
                clientForeign._id,
                clientNutriMulti._id,
            ],
        },
    });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
