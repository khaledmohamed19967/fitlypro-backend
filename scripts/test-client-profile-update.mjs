/**
 * Client profile + plan update contract tests.
 * Run: node scripts/test-client-profile-update.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import HealthReferenceOption from '../src/modules/health-reference/health-reference.model.js';
import NutritionProfile from '../src/modules/nutrition-profiles/nutrition-profile.model.js';
import PlanAssignment from '../src/modules/workout-plans/plan-assignment.model.js';
import NutritionPlanAssignment from '../src/modules/nutrition-plan-assignments/nutrition-plan-assignment.model.js';
import clientService from '../src/modules/clients/client.service.js';
import nutritionProfileService from '../src/modules/nutrition-profiles/nutrition-profile.service.js';
import { ApiError } from '../src/utils/ApiError.js';

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

const toIso = (value) => (value == null ? value : new Date(value).toISOString());

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

async function expectApiError(promise, statusCode, label) {
    try {
        await promise;
        fail(label, 'expected rejection');
        return false;
    } catch (err) {
        if (err instanceof ApiError && err.statusCode === statusCode) {
            pass(label);
            return true;
        }
        fail(label, err?.statusCode ? String(err.statusCode) : err?.message);
        return false;
    }
}

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Prof',
        lastName: 'TrainerA',
        email: `prof-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const trainerB = await User.create({
        firstName: 'Prof',
        lastName: 'TrainerB',
        email: `prof-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const peanut = await HealthReferenceOption.findOne({
        category: 'allergy',
        code: 'peanuts',
        status: 'active',
    });
    const leftKnee = await HealthReferenceOption.findOne({
        category: 'body_area',
        code: 'left_knee',
        status: 'active',
    });
    const halal = await HealthReferenceOption.findOne({
        category: 'dietary_restriction',
        code: 'halal',
        status: 'active',
    });

    if (!peanut || !leftKnee || !halal) {
        throw new Error('Seed health reference options (peanuts, left_knee, halal) required');
    }

    const created = await clientService.createClient(
        {
            firstName: 'Profile',
            lastName: 'Original',
            email: `prof-client-${suffix}@test.com`,
            password,
            phone: '1234567890',
            gender: 'male',
            primaryFitnessGoal: 'general_fitness',
            currentWeight: 80,
            targetWeight: 75,
            height: 175,
            experienceLevel: 'beginner',
            programType: 'personal_training',
            sessionsPerWeek: 3,
            startDate: '2026-04-01T00:00:00.000Z',
            packageDuration: '6_months',
            additionalNotes: 'baseline notes',
            allergyOptionIds: [peanut._id.toString()],
            dietaryRestrictionOptionIds: [halal._id.toString()],
        },
        trainerA._id.toString()
    );

    const workoutPlanId = new mongoose.Types.ObjectId();
    const nutritionPlanId = new mongoose.Types.ObjectId();
    await PlanAssignment.create({
        clientId: created.id,
        trainerId: trainerA._id,
        planId: workoutPlanId,
        status: 'active',
        startDate: new Date('2026-01-01'),
    });
    await NutritionPlanAssignment.create({
        clientId: created.id,
        trainerId: trainerA._id,
        planId: nutritionPlanId,
        status: 'active',
        startDate: new Date('2026-01-01'),
    });

    const assignmentCountsBefore = {
        workout: await PlanAssignment.countDocuments({
            clientId: created.id,
            status: 'active',
        }),
        nutrition: await NutritionPlanAssignment.countDocuments({
            clientId: created.id,
            status: 'active',
        }),
    };

    const detailAfterCreate = await clientService.getClientById(
        created.id,
        trainerA._id.toString()
    );
    if (
        Array.isArray(detailAfterCreate.allergyOptionIds) &&
        detailAfterCreate.allergyOptionIds.length === 1 &&
        detailAfterCreate.dietaryRestrictionOptionIds?.length === 1
    ) {
        pass('0. GET client enriches nutrition restriction option IDs');
    } else {
        fail(
            '0. GET client enriches nutrition restriction option IDs',
            JSON.stringify({
                allergyOptionIds: detailAfterCreate.allergyOptionIds,
                dietaryRestrictionOptionIds: detailAfterCreate.dietaryRestrictionOptionIds,
            })
        );
    }

    const personal = await clientService.updateClient(
        created.id,
        {
            firstName: 'Profile',
            lastName: 'Updated',
            phone: '9876543210',
            dateOfBirth: '1990-05-15T00:00:00.000Z',
            gender: 'female',
        },
        trainerA._id.toString()
    );
    if (
        personal.lastName === 'Updated' &&
        personal.phone === '9876543210' &&
        personal.gender === 'female'
    ) {
        pass('1. Personal fields update');
    } else {
        fail('1. Personal fields update', JSON.stringify(personal));
    }

    const fitness = await clientService.updateClient(
        created.id,
        {
            primaryFitnessGoal: 'muscle_gain',
            currentWeight: 82,
            targetWeight: 78,
            height: 176,
            experienceLevel: 'intermediate',
        },
        trainerA._id.toString()
    );
    if (
        fitness.primaryFitnessGoal === 'muscle_gain' &&
        fitness.currentWeight === 82 &&
        fitness.experienceLevel === 'intermediate'
    ) {
        pass('2. Fitness fields update');
    } else {
        fail('2. Fitness fields update', JSON.stringify(fitness));
    }

    const health = await clientService.updateClient(
        created.id,
        {
            medicalConditions: 'Asthma',
            injuryAreaOptionIds: [leftKnee._id.toString()],
            injuryDetails: 'Mild discomfort',
        },
        trainerA._id.toString()
    );
    if (
        health.medicalConditions === 'Asthma' &&
        health.injuryAreaOptions?.length === 1
    ) {
        pass('3. Health / injury fields update');
    } else {
        fail('3. Health / injury fields update', JSON.stringify(health));
    }

    const shellfish = await HealthReferenceOption.findOne({
        category: 'allergy',
        code: 'shellfish',
        status: 'active',
    });
    if (!shellfish) {
        throw new Error('shellfish allergy option required');
    }

    await clientService.updateClient(
        created.id,
        {
            allergyOptionIds: [peanut._id.toString(), shellfish._id.toString()],
            dietaryRestrictionOptionIds: [halal._id.toString()],
        },
        trainerA._id.toString()
    );
    const nutrition = await nutritionProfileService.getNutritionProfile(
        created.id,
        trainerA._id.toString()
    );
    if (
        nutrition?.allergyOptionIds?.length === 2 &&
        nutrition?.dietaryRestrictionOptionIds?.length === 1
    ) {
        pass('4. Allergies / dietary restrictions via nutrition profile');
    } else {
        fail('4. Allergies / dietary restrictions via nutrition profile', JSON.stringify(nutrition));
    }

    const packageUpdate = await clientService.updateClientPlan(
        created.id,
        {
            packageDuration: '1_month',
            startDate: '2026-01-06T00:00:00.000Z',
        },
        trainerA._id.toString()
    );
    if (toIso(packageUpdate.endDate) === '2026-02-06T00:00:00.000Z') {
        pass('5. Plan update recalculates endDate');
    } else {
        fail('5. Plan update recalculates endDate', JSON.stringify(packageUpdate.endDate));
    }

    const partial = await clientService.updateClient(
        created.id,
        { additionalNotes: 'only notes changed' },
        trainerA._id.toString()
    );
    if (
        partial.additionalNotes === 'only notes changed' &&
        partial.lastName === 'Updated' &&
        partial.primaryFitnessGoal === 'muscle_gain'
    ) {
        pass('6. Omitted fields remain unchanged');
    } else {
        fail('6. Omitted fields remain unchanged', JSON.stringify(partial));
    }

    const emailBefore = (await User.findById(created.id)).email;
    await clientService.updateClient(
        created.id,
        {
            firstName: 'Profile',
            email: `hacked-${suffix}@test.com`,
            role: 'admin',
            trainer: trainerB._id.toString(),
            isActive: false,
            password: 'newpass123',
        },
        trainerA._id.toString()
    );
    const afterProtected = await User.findById(created.id);
    if (
        afterProtected.email === emailBefore &&
        afterProtected.role === 'client' &&
        afterProtected.trainer.toString() === trainerA._id.toString() &&
        afterProtected.isActive === true
    ) {
        pass('7–8. Protected fields not applied (service allowlist)');
    } else {
        fail('7–8. Protected fields not applied', JSON.stringify({
            email: afterProtected.email,
            role: afterProtected.role,
        }));
    }

    await expectApiError(
        clientService.updateClient(
            created.id,
            { injuryAreaOptionIds: [peanut._id.toString()] },
            trainerA._id.toString()
        ),
        400,
        '9. Cross-category injury ID rejected'
    );

    await expectApiError(
        clientService.updateClient(created.id, { firstName: 'X' }, trainerB._id.toString()),
        403,
        '10. Foreign trainer denied'
    );

    await expectApiError(
        clientService.updateClient(
            new mongoose.Types.ObjectId().toString(),
            { firstName: 'Ghost' },
            trainerA._id.toString()
        ),
        404,
        '11. Missing client not found'
    );

    const assignmentCountsAfter = {
        workout: await PlanAssignment.countDocuments({
            clientId: created.id,
            status: 'active',
        }),
        nutrition: await NutritionPlanAssignment.countDocuments({
            clientId: created.id,
            status: 'active',
        }),
    };
    if (
        assignmentCountsBefore.workout === assignmentCountsAfter.workout &&
        assignmentCountsBefore.nutrition === assignmentCountsAfter.nutrition
    ) {
        pass('12. Workout/nutrition assignments unchanged');
    } else {
        fail('12. Workout/nutrition assignments unchanged', JSON.stringify({
            before: assignmentCountsBefore,
            after: assignmentCountsAfter,
        }));
    }

    const planOnly = await clientService.updateClientPlan(
        created.id,
        { sessionsPerWeek: 4, programType: 'online_coaching' },
        trainerA._id.toString()
    );
    if (planOnly.sessionsPerWeek === 4 && planOnly.programType === 'online_coaching') {
        pass('13. updateClientPlan service');
    } else {
        fail('13. updateClientPlan service', JSON.stringify(planOnly));
    }

    // HTTP (optional)
    const login = await request('POST', '/auth/login', {
        body: { email: trainerA.email, password },
    });
    const token = login.json?.data?.token;
    if (token) {
        const httpPlan = await request('PUT', `/clients/${created.id}/plan`, {
            token,
            body: { primaryFitnessGoal: 'endurance' },
        });
        if (httpPlan.status === 200 && httpPlan.json?.data?.primaryFitnessGoal === 'endurance') {
            pass('14. HTTP PUT /clients/:id/plan');
        } else {
            fail('14. HTTP PUT /clients/:id/plan', JSON.stringify(httpPlan));
        }

        const httpPut = await request('PUT', `/clients/${created.id}`, {
            token,
            body: { email: 'evil@test.com', lastName: 'HttpOk' },
        });
        const refreshed = await User.findById(created.id);
        if (
            httpPut.status === 200 &&
            httpPut.json?.data?.lastName === 'HttpOk' &&
            refreshed.email === emailBefore
        ) {
            pass('15. HTTP PUT strips email; lastName updates');
        } else {
            fail('15. HTTP PUT strips email', JSON.stringify(httpPut));
        }
    } else {
        console.log('SKIP: HTTP tests (login failed — start API for full HTTP coverage)');
    }

    await User.deleteMany({
        _id: { $in: [trainerA._id, trainerB._id, created.id] },
    });
    await NutritionProfile.deleteMany({ clientId: created.id });
    await PlanAssignment.deleteMany({ clientId: created.id });
    await NutritionPlanAssignment.deleteMany({ clientId: created.id });

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(
        `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
    );
    await mongoose.disconnect();
    process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
