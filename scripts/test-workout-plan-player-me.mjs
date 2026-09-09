/**
 * Player-facing active workout plan retrieval.
 * Run: node scripts/test-workout-plan-player-me.mjs
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

    const trainer = await User.create({
        firstName: 'Player',
        lastName: 'Trainer',
        email: `wp-player-trainer-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const admin = await User.create({
        firstName: 'Player',
        lastName: 'Admin',
        email: `wp-player-admin-${suffix}@test.com`,
        password,
        role: 'admin',
    });

    const clientA = await User.create({
        firstName: 'Player',
        lastName: 'ClientA',
        email: `wp-player-a-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const clientB = await User.create({
        firstName: 'Player',
        lastName: 'ClientB',
        email: `wp-player-b-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const clientEmpty = await User.create({
        firstName: 'Player',
        lastName: 'Empty',
        email: `wp-player-empty-${suffix}@test.com`,
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

    const tokenTrainer = loginTrainer.json?.data?.token;
    const tokenAdmin = loginAdmin.json?.data?.token;
    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;
    const tokenEmpty = loginEmpty.json?.data?.token;

    if (!tokenTrainer || !tokenA || !tokenB || !tokenEmpty) {
        throw new Error('Failed to login test users');
    }

    let systemExercise = await Exercise.findOne({ 'ownership.type': 'system', status: 'active' });
    if (!systemExercise) {
        systemExercise = await Exercise.create({
            name: `Player Test Exercise ${suffix}`,
            slug: `player-test-ex-${suffix}`,
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
        name: `Player Active Plan ${suffix}`,
        description: 'Executable plan for player me endpoint',
        duration: 6,
        daysPerWeek: 3,
        goal: 'muscle_gain',
        level: 'intermediate',
        isTemplate: false,
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Day A — Push',
                description: 'Chest focus',
                exercises: [
                    {
                        exerciseId: systemExercise._id.toString(),
                        order: 1,
                        restBetweenSets: 90,
                        notes: 'Controlled tempo',
                        tempo: '3010',
                        sets: [
                            {
                                setNumber: 1,
                                reps: 10,
                                weight: 20,
                                weightUnit: 'kg',
                                isWarmup: false,
                                isDropset: false,
                            },
                            {
                                setNumber: 2,
                                reps: 8,
                                weight: 25,
                                weightUnit: 'kg',
                                isWarmup: false,
                                isDropset: false,
                            },
                        ],
                    },
                ],
            },
        ],
    };

    const createPlan = await request('POST', '/workout-plans', {
        token: tokenTrainer,
        body: planPayload,
    });
    const planId = createPlan.json?.data?.workoutPlan?.id;
    if (createPlan.status !== 201 || !planId) {
        throw new Error(`Failed to create plan: ${JSON.stringify(createPlan.json)}`);
    }

    const otherPlan = await request('POST', '/workout-plans', {
        token: tokenTrainer,
        body: {
            ...planPayload,
            name: `Other Plan ${suffix}`,
            description: 'Must not leak into client A response',
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Other Day',
                    exercises: [
                        {
                            exerciseId: systemExercise._id.toString(),
                            order: 1,
                            restBetweenSets: 60,
                            sets: [{ setNumber: 1, reps: 5, weightUnit: 'kg' }],
                        },
                    ],
                },
            ],
        },
    });
    const otherPlanId = otherPlan.json?.data?.workoutPlan?.id;

    const assignA = await request('POST', `/workout-plans/${planId}/assignments`, {
        token: tokenTrainer,
        body: {
            clientIds: [clientA._id.toString()],
            startDate: new Date().toISOString(),
            notes: 'player primary assignment',
        },
    });
    if (assignA.status !== 201) {
        throw new Error(`Assign client A failed: ${JSON.stringify(assignA.json)}`);
    }

    const assignB = await request('POST', `/workout-plans/${otherPlanId}/assignments`, {
        token: tokenTrainer,
        body: {
            clientIds: [clientB._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    if (assignB.status !== 201) {
        throw new Error(`Assign client B failed: ${JSON.stringify(assignB.json)}`);
    }

    // 1–6: Client A retrieves own active assignment with executable content
    const meA = await request('GET', '/me/workout-plan', { token: tokenA });
    const assignment = meA.json?.data?.assignment;

    if (meA.status === 200 && assignment?.id && assignment?.status === 'active') {
        pass('1. Client retrieves own active workout assignment');
    } else {
        fail('1. Client retrieves own active workout assignment', JSON.stringify(meA.json));
    }

    if (
        assignment &&
        assignment.startDate &&
        typeof assignment.progress === 'number' &&
        typeof assignment.completedSessions === 'number' &&
        typeof assignment.totalSessions === 'number' &&
        assignment.notes === 'player primary assignment'
    ) {
        pass('2. Response contains assignment metadata');
    } else {
        fail('2. Response contains assignment metadata', JSON.stringify(assignment));
    }

    if (
        assignment?.plan?.id === planId &&
        assignment?.plan?.name === planPayload.name &&
        assignment?.plan?.description === planPayload.description &&
        assignment?.plan?.goal === 'muscle_gain' &&
        assignment?.plan?.level === 'intermediate'
    ) {
        pass('3. Response contains plan id/name/description/goal/level');
    } else {
        fail('3. Response contains plan id/name/description/goal/level', JSON.stringify(assignment?.plan));
    }

    if (Array.isArray(assignment?.plan?.workoutDays) && assignment.plan.workoutDays.length === 1) {
        pass('4. Response contains workoutDays');
    } else {
        fail('4. Response contains workoutDays', JSON.stringify(assignment?.plan?.workoutDays));
    }

    const day = assignment?.plan?.workoutDays?.[0];
    const exercise = day?.exercises?.[0];
    if (exercise?.exerciseId && exercise?.order === 1 && exercise?.restBetweenSets === 90) {
        pass('5. Response contains exercises');
    } else {
        fail('5. Response contains exercises', JSON.stringify(exercise));
    }

    const set = exercise?.sets?.[0];
    if (
        set?.setNumber === 1 &&
        set?.reps === 10 &&
        set?.weight === 20 &&
        set?.weightUnit === 'kg' &&
        exercise?.tempo === '3010' &&
        exercise?.notes === 'Controlled tempo' &&
        exercise?.exerciseSnapshot?.name
    ) {
        pass('6. Response contains sets and executable fields');
    } else {
        fail('6. Response contains sets and executable fields', JSON.stringify({ set, exercise }));
    }

    // 7. No active assignment → null
    const meEmpty = await request('GET', '/me/workout-plan', { token: tokenEmpty });
    if (meEmpty.status === 200 && meEmpty.json?.data?.assignment === null) {
        pass('7. No active assignment returns null');
    } else {
        fail('7. No active assignment returns null', JSON.stringify(meEmpty.json));
    }

    // 8. Unauthenticated
    const unauth = await request('GET', '/me/workout-plan');
    if (unauth.status === 401) pass('8. Unauthenticated → 401');
    else fail('8. Unauthenticated → 401', `status=${unauth.status}`);

    // 9. Trainer cannot use player endpoint
    const asTrainer = await request('GET', '/me/workout-plan', { token: tokenTrainer });
    if (asTrainer.status === 403) pass('9. Trainer cannot use player endpoint → 403');
    else fail('9. Trainer cannot use player endpoint → 403', `status=${asTrainer.status}`);

    // 10. Admin cannot use player endpoint
    if (tokenAdmin) {
        const asAdmin = await request('GET', '/me/workout-plan', { token: tokenAdmin });
        if (asAdmin.status === 403) pass('10. Admin cannot use player endpoint → 403');
        else fail('10. Admin cannot use player endpoint → 403', `status=${asAdmin.status}`);
    } else {
        fail('10. Admin cannot use player endpoint → 403', 'admin login failed');
    }

    // 11. Client A cannot retrieve Client B's assignment
    if (
        assignment?.plan?.id === planId &&
        assignment?.plan?.id !== otherPlanId &&
        assignment?.plan?.name !== `Other Plan ${suffix}`
    ) {
        pass('11. Client A cannot retrieve Client B assignment content');
    } else {
        fail('11. Client A cannot retrieve Client B assignment content', JSON.stringify(assignment?.plan));
    }

    const meB = await request('GET', '/me/workout-plan', { token: tokenB });
    if (meB.status === 200 && meB.json?.data?.assignment?.plan?.id === otherPlanId) {
        pass('11b. Client B only sees own assignment');
    } else {
        fail('11b. Client B only sees own assignment', JSON.stringify(meB.json));
    }

    // 12–14: non-active statuses ignored
    const statusClient = await User.create({
        firstName: 'Player',
        lastName: 'Status',
        email: `wp-player-status-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });
    const loginStatus = await request('POST', '/auth/login', {
        body: { email: statusClient.email, password },
    });
    const tokenStatus = loginStatus.json?.data?.token;

    await PlanAssignment.create({
        trainerId: trainer._id,
        planId,
        clientId: statusClient._id,
        startDate: new Date(),
        status: 'paused',
    });
    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: otherPlanId,
        clientId: statusClient._id,
        startDate: new Date(),
        status: 'completed',
    });
    // Cancelled on a third create needs another plan for unique active index — use direct statuses only
    const cancelPlan = await request('POST', '/workout-plans', {
        token: tokenTrainer,
        body: { ...planPayload, name: `Cancel Status Plan ${suffix}`, workoutDays: [] },
    });
    const cancelPlanId = cancelPlan.json?.data?.workoutPlan?.id;
    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: cancelPlanId,
        clientId: statusClient._id,
        startDate: new Date(),
        status: 'cancelled',
    });

    const meStatus = await request('GET', '/me/workout-plan', { token: tokenStatus });
    if (meStatus.status === 200 && meStatus.json?.data?.assignment === null) {
        pass('12. Paused assignment is not returned');
        pass('13. Completed assignment is not returned');
        pass('14. Cancelled assignment is not returned');
    } else {
        fail('12. Paused assignment is not returned', JSON.stringify(meStatus.json));
        fail('13. Completed assignment is not returned', JSON.stringify(meStatus.json));
        fail('14. Cancelled assignment is not returned', JSON.stringify(meStatus.json));
    }

    // 15. Assignment content is tied to its planId only
    if (assignment?.plan?.name === planPayload.name && !JSON.stringify(assignment).includes('Other Day')) {
        pass('15. Assignment cannot return unrelated plan content');
    } else {
        fail('15. Assignment cannot return unrelated plan content', JSON.stringify(assignment?.plan));
    }

    // 16. Trainer/admin-only fields absent from player DTO
    const topKeys = Object.keys(assignment || {});
    const planKeys = Object.keys(assignment?.plan || {});
    const planLeaks = ['trainerId', 'ownership', 'templateKey', 'isTemplate', 'status', 'notes'].filter((k) =>
        planKeys.includes(k)
    );
    const topLeaks = ['trainerId', 'clientId', 'client', 'planId', 'planVersionId', 'ownership'].filter((k) =>
        topKeys.includes(k)
    );
    if (topLeaks.length === 0 && planLeaks.length === 0) {
        pass('16. Trainer/admin-only fields not present in player DTO');
    } else {
        fail(
            '16. Trainer/admin-only fields not present in player DTO',
            `top=${topLeaks.join(',')} plan=${planLeaks.join(',')}`
        );
    }

    // 17. Existing trainer workout endpoints unchanged
    const trainerGet = await request('GET', `/workout-plans/${planId}`, { token: tokenTrainer });
    if (
        trainerGet.status === 200 &&
        trainerGet.json?.data?.workoutPlan?.id === planId &&
        trainerGet.json?.data?.workoutPlan?.ownership
    ) {
        pass('17. Existing trainer workout endpoints remain unchanged');
    } else {
        fail('17. Existing trainer workout endpoints remain unchanged', JSON.stringify(trainerGet.json));
    }

    // Multiple actives: newest by startDate wins
    const multiClient = await User.create({
        firstName: 'Player',
        lastName: 'Multi',
        email: `wp-player-multi-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });
    const loginMulti = await request('POST', '/auth/login', {
        body: { email: multiClient.email, password },
    });
    const tokenMulti = loginMulti.json?.data?.token;

    const olderStart = new Date('2026-01-01T00:00:00.000Z');
    const newerStart = new Date('2026-06-01T00:00:00.000Z');
    await PlanAssignment.create({
        trainerId: trainer._id,
        planId,
        clientId: multiClient._id,
        startDate: olderStart,
        status: 'active',
        notes: 'older-active',
    });
    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: otherPlanId,
        clientId: multiClient._id,
        startDate: newerStart,
        status: 'active',
        notes: 'newer-active',
    });

    const meMulti = await request('GET', '/me/workout-plan', { token: tokenMulti });
    if (
        meMulti.status === 200 &&
        meMulti.json?.data?.assignment?.notes === 'newer-active' &&
        meMulti.json?.data?.assignment?.plan?.id === otherPlanId
    ) {
        pass('18. Multiple actives → newest startDate wins');
    } else {
        fail('18. Multiple actives → newest startDate wins', JSON.stringify(meMulti.json));
    }

    // Client cannot call trainer plan detail with planId alone
    const clientPlanGet = await request('GET', `/workout-plans/${planId}`, { token: tokenA });
    if (clientPlanGet.status === 403) {
        pass('19. Client cannot use trainer GET /workout-plans/:id');
    } else {
        fail('19. Client cannot use trainer GET /workout-plans/:id', `status=${clientPlanGet.status}`);
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);

    await PlanAssignment.deleteMany({
        trainerId: trainer._id,
    });
    await WorkoutPlan.deleteMany({ trainerId: trainer._id });
    await User.deleteMany({
        _id: {
            $in: [
                trainer._id,
                admin._id,
                clientA._id,
                clientB._id,
                clientEmpty._id,
                statusClient._id,
                multiClient._id,
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
