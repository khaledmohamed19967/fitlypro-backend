/**
 * Manual Phase 2 workout plan API verification script.
 * Run: node scripts/test-workout-plans-phase2.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../src/modules/users/user.model.js';
import Exercise from '../src/modules/exercises/exercise.model.js';
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js';
import PlanAssignment from '../src/modules/workout-plans/plan-assignment.model.js';

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
        body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const trainerAEmail = `trainer-a-wp-${suffix}@test.com`;
    const trainerBEmail = `trainer-b-wp-${suffix}@test.com`;
    const clientEmail = `client-wp-${suffix}@test.com`;
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Trainer',
        lastName: 'Alpha',
        email: trainerAEmail,
        password,
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'Trainer',
        lastName: 'Beta',
        email: trainerBEmail,
        password,
        role: 'trainer',
    });

    const client = await User.create({
        firstName: 'Client',
        lastName: 'One',
        email: clientEmail,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const foreignClient = await User.create({
        firstName: 'Foreign',
        lastName: 'Client',
        email: `foreign-client-wp-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerB._id,
    });

    const loginA = await request('POST', '/auth/login', {
        body: { email: trainerAEmail, password },
    });
    const loginB = await request('POST', '/auth/login', {
        body: { email: trainerBEmail, password },
    });

    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;

    if (!tokenA || !tokenB) {
        throw new Error('Failed to login test trainers');
    }

    const systemExercise = await Exercise.findOne({ 'ownership.type': 'system' });
    const ownExercise = await Exercise.create({
        name: `Trainer A Custom ${suffix}`,
        slug: `trainer-a-custom-${suffix}`,
        muscles: { primary: 'chest', secondary: [] },
        equipment: ['dumbbell'],
        category: 'strength',
        difficulty: 'beginner',
        ownership: { type: 'trainer', trainerId: trainerA._id },
        source: { type: 'manual' },
        status: 'active',
    });

    const foreignExercise = await Exercise.create({
        name: `Trainer B Custom ${suffix}`,
        slug: `trainer-b-custom-${suffix}`,
        muscles: { primary: 'back', secondary: [] },
        equipment: ['barbell'],
        category: 'strength',
        difficulty: 'intermediate',
        ownership: { type: 'trainer', trainerId: trainerB._id },
        source: { type: 'manual' },
        status: 'active',
    });

    const basePlan = {
        name: 'Phase 2 Test Plan',
        duration: 8,
        daysPerWeek: 3,
        goal: 'muscle_gain',
        level: 'intermediate',
        isTemplate: false,
        workoutDays: [],
    };

    const createValid = await request('POST', '/workout-plans', {
        token: tokenA,
        body: basePlan,
    });

    if (createValid.status === 201 && createValid.json?.data?.workoutPlan?.id) {
        pass('Create valid plan');
    } else {
        fail('Create valid plan', JSON.stringify(createValid.json));
    }

    const planId = createValid.json?.data?.workoutPlan?.id;

    const getOwn = await request('GET', `/workout-plans/${planId}`, { token: tokenA });
    if (getOwn.status === 200 && getOwn.json?.data?.workoutPlan?.id === planId) {
        pass('Get own plan');
    } else {
        fail('Get own plan', JSON.stringify(getOwn.json));
    }

    const listOwn = await request('GET', '/workout-plans', { token: tokenA });
    if (
        listOwn.status === 200 &&
        Array.isArray(listOwn.json?.data?.workoutPlans) &&
        listOwn.json.data.workoutPlans.some((p) => p.id === planId)
    ) {
        pass('List own plans');
    } else {
        fail('List own plans', JSON.stringify(listOwn.json));
    }

    const updateMeta = await request('PATCH', `/workout-plans/${planId}`, {
        token: tokenA,
        body: { name: 'Updated Plan Name' },
    });
    if (updateMeta.status === 200 && updateMeta.json?.data?.workoutPlan?.name === 'Updated Plan Name') {
        pass('Update metadata');
    } else {
        fail('Update metadata', JSON.stringify(updateMeta.json));
    }

    const exA = systemExercise._id.toString();
    const exB = ownExercise._id.toString();
    const tempExerciseIdA = new mongoose.Types.ObjectId();
    const tempExerciseIdB = new mongoose.Types.ObjectId();

    const replaceDays = await request('PATCH', `/workout-plans/${planId}`, {
        token: tokenA,
        body: {
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Day 1',
                    exercises: [
                        {
                            _id: tempExerciseIdA.toString(),
                            exerciseId: exA,
                            order: 1,
                            restBetweenSets: 90,
                            sets: [{ setNumber: 1, reps: 10, weight: 50, weightUnit: 'kg' }],
                        },
                        {
                            _id: tempExerciseIdB.toString(),
                            exerciseId: exA,
                            order: 2,
                            restBetweenSets: 60,
                            supersetWith: tempExerciseIdA.toString(),
                            sets: [{ setNumber: 1, reps: 8, weightUnit: 'kg' }],
                        },
                    ],
                },
            ],
        },
    });

    if (
        replaceDays.status === 200 &&
        replaceDays.json?.data?.workoutPlan?.workoutDays?.[0]?.exercises?.length === 2
    ) {
        pass('Replace workoutDays');
        pass('Duplicate exercise allowed');
        pass('Superset same-day reference allowed');
    } else {
        fail('Replace workoutDays', JSON.stringify(replaceDays.json));
    }

    const crossDaySuperset = await request('PATCH', `/workout-plans/${planId}`, {
        token: tokenA,
        body: {
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Day 1',
                    exercises: [
                        {
                            exerciseId: exA,
                            order: 1,
                            restBetweenSets: 90,
                            sets: [{ setNumber: 1, reps: 10, weightUnit: 'kg' }],
                        },
                    ],
                },
                {
                    dayNumber: 2,
                    name: 'Day 2',
                    exercises: [
                        {
                            exerciseId: exB,
                            order: 1,
                            restBetweenSets: 90,
                            supersetWith: '507f1f77bcf86cd799439011',
                            sets: [{ setNumber: 1, reps: 10, weightUnit: 'kg' }],
                        },
                    ],
                },
            ],
        },
    });

    if (crossDaySuperset.status === 400) {
        pass('Cross-day superset rejected');
    } else {
        fail('Cross-day superset rejected', `status ${crossDaySuperset.status}`);
    }

    const systemAllowed = await request('PATCH', `/workout-plans/${planId}`, {
        token: tokenA,
        body: {
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Day 1',
                    exercises: [
                        {
                            exerciseId: exA,
                            order: 1,
                            restBetweenSets: 60,
                            sets: [{ setNumber: 1, reps: 10, weightUnit: 'kg' }],
                        },
                    ],
                },
            ],
        },
    });
    if (systemAllowed.status === 200) pass('System exercise allowed');
    else fail('System exercise allowed', JSON.stringify(systemAllowed.json));

    const ownAllowed = await request('PATCH', `/workout-plans/${planId}`, {
        token: tokenA,
        body: {
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Day 1',
                    exercises: [
                        {
                            exerciseId: exB,
                            order: 1,
                            restBetweenSets: 60,
                            sets: [{ setNumber: 1, reps: 10, weightUnit: 'kg' }],
                        },
                    ],
                },
            ],
        },
    });
    if (ownAllowed.status === 200) pass('Own trainer exercise allowed');
    else fail('Own trainer exercise allowed', JSON.stringify(ownAllowed.json));

    const foreignExerciseReq = await request('PATCH', `/workout-plans/${planId}`, {
        token: tokenA,
        body: {
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Day 1',
                    exercises: [
                        {
                            exerciseId: foreignExercise._id.toString(),
                            order: 1,
                            restBetweenSets: 60,
                            sets: [{ setNumber: 1, reps: 10, weightUnit: 'kg' }],
                        },
                    ],
                },
            ],
        },
    });
    if (foreignExerciseReq.status === 400) pass('Other trainer exercise rejected');
    else fail('Other trainer exercise rejected', `status ${foreignExerciseReq.status}`);

    const invalidExerciseReq = await request('PATCH', `/workout-plans/${planId}`, {
        token: tokenA,
        body: {
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Day 1',
                    exercises: [
                        {
                            exerciseId: '507f1f77bcf86cd799439011',
                            order: 1,
                            restBetweenSets: 60,
                            sets: [{ setNumber: 1, reps: 10, weightUnit: 'kg' }],
                        },
                    ],
                },
            ],
        },
    });
    if (invalidExerciseReq.status === 400) pass('Invalid exercise rejected');
    else fail('Invalid exercise rejected', `status ${invalidExerciseReq.status}`);

    const archive = await request('DELETE', `/workout-plans/${planId}`, { token: tokenA });
    if (archive.status === 200 && archive.json?.data?.workoutPlan?.status === 'archived') {
        pass('Archive plan');
    } else {
        fail('Archive plan', JSON.stringify(archive.json));
    }

    const listActive = await request('GET', '/workout-plans?status=active', { token: tokenA });
    const stillListed = listActive.json?.data?.workoutPlans?.some((p) => p.id === planId);
    if (listActive.status === 200 && !stillListed) {
        pass('Archived plan excluded from active list');
    } else {
        fail('Archived plan excluded from active list', `listed=${stillListed}`);
    }

    const listArchived = await request('GET', '/workout-plans?status=archived', { token: tokenA });
    const inArchivedList = listArchived.json?.data?.workoutPlans?.some((p) => p.id === planId);
    if (listArchived.status === 200 && inArchivedList) {
        pass('Archived plan included in archived list');
    } else {
        fail('Archived plan included in archived list', JSON.stringify(listArchived.json?.data?.pagination));
    }

    const archivedDoc = await WorkoutPlan.findById(planId);
    if (archivedDoc && archivedDoc.status === 'archived') {
        pass('Archived plan remains in database');
    } else {
        fail('Archived plan remains in database', String(archivedDoc?.status));
    }

    const reArchive = await request('DELETE', `/workout-plans/${planId}`, { token: tokenA });
    if (reArchive.status === 200 && reArchive.json?.data?.workoutPlan?.status === 'archived') {
        pass('Re-archive is idempotent');
    } else {
        fail('Re-archive is idempotent', JSON.stringify(reArchive.json));
    }

    const listAll = await request('GET', '/workout-plans', { token: tokenA });
    const listedInAll = listAll.json?.data?.workoutPlans?.some((p) => p.id === planId);
    const allTotal = listAll.json?.data?.pagination?.total;
    if (listAll.status === 200 && listedInAll && typeof allTotal === 'number' && allTotal >= 1) {
        pass('Archived plan included in unfiltered list total');
    } else {
        fail('Archived plan included in unfiltered list total', JSON.stringify(listAll.json?.data?.pagination));
    }

    const getArchived = await request('GET', `/workout-plans/${planId}`, { token: tokenA });
    if (getArchived.status === 200) pass('Archived plan readable by ID');
    else fail('Archived plan readable by ID', `status ${getArchived.status}`);

    const assignArchived = await request('POST', `/workout-plans/${planId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [client._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    if (assignArchived.status === 400) pass('Archived plan cannot be assigned');
    else fail('Archived plan cannot be assigned', `status ${assignArchived.status}`);

    // Assignment survives archive of an already-assigned plan
    const survivePlan = await request('POST', '/workout-plans', {
        token: tokenA,
        body: { ...basePlan, name: 'Survive Archive Plan' },
    });
    const survivePlanId = survivePlan.json?.data?.workoutPlan?.id;
    await request('POST', `/workout-plans/${survivePlanId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [client._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    await request('DELETE', `/workout-plans/${survivePlanId}`, { token: tokenA });
    const surviveGet = await request('GET', `/workout-plans/${survivePlanId}/assignments`, {
        token: tokenA,
    });
    if (surviveGet.status === 200 && (surviveGet.json?.data?.assignments?.length ?? 0) >= 1) {
        pass('Assignment survives plan archive');
    } else {
        fail('Assignment survives plan archive', JSON.stringify(surviveGet.json));
    }

    const draftPlan = await request('POST', '/workout-plans', {
        token: tokenA,
        body: { ...basePlan, name: 'Draft Assign Plan', status: 'draft' },
    });
    const draftPlanId = draftPlan.json?.data?.workoutPlan?.id;
    const assignDraft = await request('POST', `/workout-plans/${draftPlanId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [client._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    if (assignDraft.status === 400) pass('Draft plan cannot be assigned');
    else fail('Draft plan cannot be assigned', JSON.stringify(assignDraft.json));

    const systemTemplate = await WorkoutPlan.findOne({
        'ownership.type': 'system',
        isTemplate: true,
        status: 'active',
    });
    if (systemTemplate) {
        const systemAssign = await request('POST', `/workout-plans/${systemTemplate._id}/assignments`, {
            token: tokenA,
            body: {
                clientIds: [client._id.toString()],
                startDate: new Date().toISOString(),
            },
        });
        if (systemAssign.status === 400) pass('System template cannot be assigned');
        else fail('System template cannot be assigned', JSON.stringify(systemAssign.json));
    } else {
        fail('System template cannot be assigned', 'No system workout template in DB');
    }

    const clientTwo = await User.create({
        firstName: 'Client',
        lastName: 'Two',
        email: `client2-wp-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const activePlan = await request('POST', '/workout-plans', {
        token: tokenA,
        body: { ...basePlan, name: 'Assignable Plan' },
    });
    const activePlanId = activePlan.json?.data?.workoutPlan?.id;

    const assignOwn = await request('POST', `/workout-plans/${activePlanId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [client._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    if (assignOwn.status === 201 && assignOwn.json?.data?.assignments?.length === 1) {
        pass('Assign to own client');
    } else {
        fail('Assign to own client', JSON.stringify(assignOwn.json));
    }

    const bulkPlan = await request('POST', '/workout-plans', {
        token: tokenA,
        body: { ...basePlan, name: 'Bulk Assign Plan' },
    });
    const bulkPlanId = bulkPlan.json?.data?.workoutPlan?.id;
    const bulkAssign = await request('POST', `/workout-plans/${bulkPlanId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [client._id.toString(), clientTwo._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    if (bulkAssign.status === 201 && bulkAssign.json?.data?.assignments?.length === 2) {
        pass('Bulk assign multiple clients');
    } else {
        fail('Bulk assign multiple clients', JSON.stringify(bulkAssign.json));
    }

    const foreignPlan = await request('POST', '/workout-plans', {
        token: tokenB,
        body: { ...basePlan, name: 'Foreign Plan B' },
    });
    const foreignPlanId = foreignPlan.json?.data?.workoutPlan?.id;
    const assignForeignPlan = await request('POST', `/workout-plans/${foreignPlanId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [client._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    if (assignForeignPlan.status === 404) pass('Foreign plan assignment rejected');
    else fail('Foreign plan assignment rejected', JSON.stringify(assignForeignPlan.json));

    const assignForeignClient = await request('POST', `/workout-plans/${activePlanId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [foreignClient._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    if (assignForeignClient.status === 400) pass('Assign to another trainer client rejected');
    else fail('Assign to another trainer client rejected', `status ${assignForeignClient.status}`);

    const duplicateAssign = await request('POST', `/workout-plans/${activePlanId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [client._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    if (duplicateAssign.status === 409) pass('Duplicate active assignment rejected');
    else fail('Duplicate active assignment rejected', `status ${duplicateAssign.status}`);

    const coexistPlan = await request('POST', '/workout-plans', {
        token: tokenA,
        body: { ...basePlan, name: 'Coexist Assign Plan' },
    });
    const coexistPlanId = coexistPlan.json?.data?.workoutPlan?.id;
    await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: coexistPlanId,
        clientId: client._id,
        startDate: new Date(),
        status: 'completed',
    });
    const reassignAfterCompleted = await request('POST', `/workout-plans/${coexistPlanId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [client._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    if (reassignAfterCompleted.status === 201) pass('Completed assignment can coexist with new active');
    else fail('Completed assignment can coexist with new active', JSON.stringify(reassignAfterCompleted.json));

    const getAssignments = await request('GET', `/workout-plans/${activePlanId}/assignments`, {
        token: tokenA,
    });
    if (getAssignments.status === 200 && getAssignments.json?.data?.assignments?.length >= 1) {
        pass('Get assignments');
    } else {
        fail('Get assignments', JSON.stringify(getAssignments.json));
    }

    const foreignRead = await request('GET', `/workout-plans/${activePlanId}`, { token: tokenB });
    if (foreignRead.status === 404) pass('Foreign plan cannot be read');
    else fail('Foreign plan cannot be read', `status ${foreignRead.status}`);

    const foreignUpdate = await request('PATCH', `/workout-plans/${activePlanId}`, {
        token: tokenB,
        body: { name: 'Hacked' },
    });
    if (foreignUpdate.status === 404) pass('Foreign plan cannot be updated');
    else fail('Foreign plan cannot be updated', `status ${foreignUpdate.status}`);

    const foreignArchive = await request('DELETE', `/workout-plans/${activePlanId}`, {
        token: tokenB,
    });
    if (foreignArchive.status === 404) pass('Foreign plan cannot be archived');
    else fail('Foreign plan cannot be archived', `status ${foreignArchive.status}`);

    await WorkoutPlan.deleteMany({ trainerId: { $in: [trainerA._id, trainerB._id] } });
    await PlanAssignment.deleteMany({ trainerId: { $in: [trainerA._id, trainerB._id] } });
    await Exercise.deleteMany({ _id: { $in: [ownExercise._id, foreignExercise._id] } });
    await User.deleteMany({
        _id: { $in: [trainerA._id, trainerB._id, client._id, clientTwo._id, foreignClient._id] },
    });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
