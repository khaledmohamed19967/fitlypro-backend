/**
 * Trainer Client Details — active Workout Plan Assignment lookup.
 * Run: node scripts/test-workout-assignment-client-scoped.mjs
 *
 * Prerequisites:
 * - Dev server running (with latest code)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
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
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Scope',
        lastName: 'TrainerA',
        email: `wp-scope-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'Scope',
        lastName: 'TrainerB',
        email: `wp-scope-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const clientA = await User.create({
        firstName: 'Scope',
        lastName: 'ClientA',
        email: `wp-scope-ca-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientEmpty = await User.create({
        firstName: 'Scope',
        lastName: 'Empty',
        email: `wp-scope-empty-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientStatus = await User.create({
        firstName: 'Scope',
        lastName: 'Status',
        email: `wp-scope-status-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientMulti = await User.create({
        firstName: 'Scope',
        lastName: 'Multi',
        email: `wp-scope-multi-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const foreignClient = await User.create({
        firstName: 'Scope',
        lastName: 'Foreign',
        email: `wp-scope-foreign-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerB._id,
    });

    const loginA = await request('POST', '/auth/login', {
        body: { email: trainerA.email, password },
    });
    const loginB = await request('POST', '/auth/login', {
        body: { email: trainerB.email, password },
    });
    const loginClient = await request('POST', '/auth/login', {
        body: { email: clientA.email, password },
    });

    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;
    const tokenClient = loginClient.json?.data?.token;

    if (!tokenA || !tokenB) {
        throw new Error('Failed to login test trainers');
    }

    let systemExercise = await Exercise.findOne({ 'ownership.type': 'system', status: 'active' });
    if (!systemExercise) {
        systemExercise = await Exercise.create({
            name: `Scope Exercise ${suffix}`,
            slug: `scope-ex-${suffix}`,
            muscles: { primary: 'chest', secondary: [] },
            equipment: ['dumbbell'],
            category: 'strength',
            difficulty: 'beginner',
            ownership: { type: 'system', trainerId: null },
            source: { type: 'manual' },
            status: 'active',
        });
    }

    const planPayload = {
        name: `Scope Plan ${suffix}`,
        description: 'Client Details summary plan',
        duration: 6,
        daysPerWeek: 3,
        goal: 'strength',
        level: 'beginner',
        isTemplate: false,
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Day 1',
                description: 'Should not appear in Client Details DTO',
                exercises: [
                    {
                        exerciseId: systemExercise._id.toString(),
                        order: 1,
                        restBetweenSets: 60,
                        sets: [{ setNumber: 1, reps: 10, weight: 20, weightUnit: 'kg' }],
                    },
                ],
            },
        ],
    };

    const createPlan = await request('POST', '/workout-plans', {
        token: tokenA,
        body: planPayload,
    });
    const planId = createPlan.json?.data?.workoutPlan?.id;
    if (!planId) throw new Error(`Plan create failed: ${JSON.stringify(createPlan.json)}`);

    const otherPlan = await request('POST', '/workout-plans', {
        token: tokenA,
        body: { ...planPayload, name: `Scope Other ${suffix}`, description: 'Newer multi-active plan', workoutDays: [] },
    });
    const otherPlanId = otherPlan.json?.data?.workoutPlan?.id;

    const statusPlan = await request('POST', '/workout-plans', {
        token: tokenA,
        body: { ...planPayload, name: `Scope Status ${suffix}`, workoutDays: [] },
    });
    const statusPlanId = statusPlan.json?.data?.workoutPlan?.id;

    const assign = await request('POST', `/workout-plans/${planId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [clientA._id.toString()],
            startDate: new Date().toISOString(),
            notes: 'client-details note',
        },
    });
    const assignmentId = assign.json?.data?.assignments?.[0]?.id;
    if (assign.status !== 201 || !assignmentId) {
        throw new Error(`Assign failed: ${JSON.stringify(assign.json)}`);
    }

    // 1–8: own client active assignment
    const getOwn = await request('GET', `/clients/${clientA._id}/workout-plan-assignment`, {
        token: tokenA,
    });
    const assignment = getOwn.json?.data?.assignment;

    if (getOwn.status === 200 && assignment) pass('1. GET own client active workout assignment → 200');
    else fail('1. GET own client active workout assignment → 200', JSON.stringify(getOwn.json));

    if (assignment?.status === 'active') pass('2. Response contains assignment');
    else fail('2. Response contains assignment', JSON.stringify(assignment));

    if (assignment?.id === assignmentId) pass('3. Response contains correct assignment.id');
    else fail('3. Response contains correct assignment.id', JSON.stringify(assignment?.id));

    if (assignment?.clientId === clientA._id.toString()) pass('4. Response contains correct clientId');
    else fail('4. Response contains correct clientId', JSON.stringify(assignment?.clientId));

    if (assignment?.plan?.id === planId) pass('5. Response contains plan.id');
    else fail('5. Response contains plan.id', JSON.stringify(assignment?.plan));

    if (assignment?.plan?.name === planPayload.name) pass('6. Response contains plan.name');
    else fail('6. Response contains plan.name', JSON.stringify(assignment?.plan));

    if (
        assignment?.plan?.description === planPayload.description &&
        assignment?.plan?.goal === 'strength' &&
        assignment?.plan?.level === 'beginner' &&
        assignment?.notes === 'client-details note' &&
        assignment?.planId === planId
    ) {
        pass('7. Response contains expected plan summary fields');
    } else {
        fail('7. Response contains expected plan summary fields', JSON.stringify(assignment));
    }

    if (
        assignment?.plan &&
        !('workoutDays' in assignment.plan) &&
        !JSON.stringify(assignment).includes('"sets"') &&
        !JSON.stringify(assignment).includes('Day 1')
    ) {
        pass('8. Response does not contain full workoutDays/exercises/sets');
    } else {
        fail('8. Response does not contain full workoutDays/exercises/sets', JSON.stringify(assignment?.plan));
    }

    // 9. null when no active
    const getEmpty = await request('GET', `/clients/${clientEmpty._id}/workout-plan-assignment`, {
        token: tokenA,
    });
    if (getEmpty.status === 200 && getEmpty.json?.data?.assignment === null) {
        pass('9. No active assignment → null');
    } else {
        fail('9. No active assignment → null', JSON.stringify(getEmpty.json));
    }

    // 10–12: non-active statuses
    await PlanAssignment.create({
        trainerId: trainerA._id,
        planId,
        clientId: clientStatus._id,
        startDate: new Date(),
        status: 'paused',
    });
    await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: otherPlanId,
        clientId: clientStatus._id,
        startDate: new Date(),
        status: 'completed',
    });
    await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: statusPlanId,
        clientId: clientStatus._id,
        startDate: new Date(),
        status: 'cancelled',
    });

    const getStatus = await request(
        'GET',
        `/clients/${clientStatus._id}/workout-plan-assignment`,
        { token: tokenA }
    );
    if (getStatus.status === 200 && getStatus.json?.data?.assignment === null) {
        pass('10. Paused assignment → null');
        pass('11. Completed assignment → null');
        pass('12. Cancelled assignment → null');
    } else {
        fail('10. Paused assignment → null', JSON.stringify(getStatus.json));
        fail('11. Completed assignment → null', JSON.stringify(getStatus.json));
        fail('12. Cancelled assignment → null', JSON.stringify(getStatus.json));
    }

    // 13. Foreign client
    const getForeign = await request(
        'GET',
        `/clients/${foreignClient._id}/workout-plan-assignment`,
        { token: tokenA }
    );
    if (getForeign.status === 403 || getForeign.status === 404) {
        pass('13. Trainer A cannot access Trainer B client');
    } else {
        fail('13. Trainer A cannot access Trainer B client', JSON.stringify(getForeign.json));
    }

    // 14. Unknown client
    const getUnknown = await request(
        'GET',
        '/clients/000000000000000000000000/workout-plan-assignment',
        { token: tokenA }
    );
    if (getUnknown.status === 404) pass('14. Unknown client → 404');
    else fail('14. Unknown client → 404', `status=${getUnknown.status}`);

    // 15. Malformed ID
    const getBad = await request('GET', '/clients/not-an-id/workout-plan-assignment', {
        token: tokenA,
    });
    if (getBad.status === 400) pass('15. Malformed client ID → 400');
    else fail('15. Malformed client ID → 400', `status=${getBad.status}`);

    // 16. Client role
    if (tokenClient) {
        const asClient = await request(
            'GET',
            `/clients/${clientA._id}/workout-plan-assignment`,
            { token: tokenClient }
        );
        if (asClient.status === 403) pass('16. Client role → 403');
        else fail('16. Client role → 403', `status=${asClient.status}`);
    } else {
        fail('16. Client role → 403', 'client login failed');
    }

    // 17. Unauthenticated
    const unauth = await request('GET', `/clients/${clientA._id}/workout-plan-assignment`);
    if (unauth.status === 401) pass('17. Unauthenticated → 401');
    else fail('17. Unauthenticated → 401', `status=${unauth.status}`);

    // 18. Multiple actives → newest startDate
    await PlanAssignment.create({
        trainerId: trainerA._id,
        planId,
        clientId: clientMulti._id,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        status: 'active',
        notes: 'older-active',
    });
    await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: otherPlanId,
        clientId: clientMulti._id,
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        status: 'active',
        notes: 'newer-active',
    });

    const getMulti = await request(
        'GET',
        `/clients/${clientMulti._id}/workout-plan-assignment`,
        { token: tokenA }
    );
    if (
        getMulti.status === 200 &&
        getMulti.json?.data?.assignment?.notes === 'newer-active' &&
        getMulti.json?.data?.assignment?.plan?.id === otherPlanId
    ) {
        pass('18. Multiple active assignments → newest by startDate');
    } else {
        fail('18. Multiple active assignments → newest by startDate', JSON.stringify(getMulti.json));
    }

    // Trainer B cannot see trainer A client assignment via param manipulation
    const asB = await request('GET', `/clients/${clientA._id}/workout-plan-assignment`, {
        token: tokenB,
    });
    if (asB.status === 403 || asB.status === 404) {
        pass('18b. Manipulating :id cannot expose another trainer client');
    } else {
        fail('18b. Manipulating :id cannot expose another trainer client', JSON.stringify(asB.json));
    }

    // Safety: no trainerId / ownership leaks
    const topKeys = Object.keys(assignment || {});
    const planKeys = Object.keys(assignment?.plan || {});
    const topLeaks = ['trainerId', 'ownership', 'client', 'createdAt', 'updatedAt'].filter((k) =>
        topKeys.includes(k)
    );
    const planLeaks = ['trainerId', 'ownership', 'templateKey', 'isTemplate', 'status', 'notes', 'workoutDays'].filter(
        (k) => planKeys.includes(k)
    );
    if (topLeaks.length === 0 && planLeaks.length === 0) {
        pass('19. Trainer/admin-only fields not leaked');
    } else {
        fail('19. Trainer/admin-only fields not leaked', `top=${topLeaks} plan=${planLeaks}`);
    }

    // Player endpoint still agrees on multi client
    const loginMulti = await request('POST', '/auth/login', {
        body: { email: clientMulti.email, password },
    });
    const tokenMulti = loginMulti.json?.data?.token;
    const meMulti = await request('GET', '/me/workout-plan', { token: tokenMulti });
    if (
        meMulti.status === 200 &&
        meMulti.json?.data?.assignment?.notes === 'newer-active' &&
        meMulti.json?.data?.assignment?.plan?.id === otherPlanId &&
        Array.isArray(meMulti.json?.data?.assignment?.plan?.workoutDays)
    ) {
        pass('20. Player GET /me/workout-plan still works and matches newest');
    } else {
        fail('20. Player GET /me/workout-plan still works and matches newest', JSON.stringify(meMulti.json));
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);

    await PlanAssignment.deleteMany({ trainerId: { $in: [trainerA._id, trainerB._id] } });
    await WorkoutPlan.deleteMany({ trainerId: { $in: [trainerA._id, trainerB._id] } });
    await User.deleteMany({
        _id: {
            $in: [
                trainerA._id,
                trainerB._id,
                clientA._id,
                clientEmpty._id,
                clientStatus._id,
                clientMulti._id,
                foreignClient._id,
            ],
        },
    });
    await mongoose.disconnect();

    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
