/**
 * Cancel Workout Plan Assignment ("Remove from Client") verification.
 * Run: node scripts/test-workout-assignment-cancel.mjs
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

const sameValue = (a, b) => String(a ?? null) === String(b ?? null);

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Cancel',
        lastName: 'TrainerA',
        email: `wp-cancel-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'Cancel',
        lastName: 'TrainerB',
        email: `wp-cancel-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const clientOne = await User.create({
        firstName: 'Cancel',
        lastName: 'ClientOne',
        email: `wp-cancel-c1-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientCompleted = await User.create({
        firstName: 'Cancel',
        lastName: 'Completed',
        email: `wp-cancel-c2-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientPaused = await User.create({
        firstName: 'Cancel',
        lastName: 'Paused',
        email: `wp-cancel-c3-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientKeep = await User.create({
        firstName: 'Cancel',
        lastName: 'Keep',
        email: `wp-cancel-keep-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const loginA = await request('POST', '/auth/login', {
        body: { email: trainerA.email, password },
    });
    const loginB = await request('POST', '/auth/login', {
        body: { email: trainerB.email, password },
    });
    const loginClient = await request('POST', '/auth/login', {
        body: { email: clientOne.email, password },
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
            name: `Cancel Exercise ${suffix}`,
            slug: `cancel-ex-${suffix}`,
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
        name: `Cancel Plan One ${suffix}`,
        description: 'Cancel flow plan',
        duration: 6,
        daysPerWeek: 3,
        goal: 'strength',
        level: 'beginner',
        isTemplate: false,
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Day 1',
                exercises: [
                    {
                        exerciseId: systemExercise._id.toString(),
                        order: 1,
                        restBetweenSets: 60,
                        sets: [{ setNumber: 1, reps: 10, weightUnit: 'kg' }],
                    },
                ],
            },
        ],
    };

    const planOne = await request('POST', '/workout-plans', {
        token: tokenA,
        body: planPayload,
    });
    const planOneId = planOne.json?.data?.workoutPlan?.id;
    const planOneName = planOne.json?.data?.workoutPlan?.name;

    const planTwo = await request('POST', '/workout-plans', {
        token: tokenA,
        body: { ...planPayload, name: `Cancel Plan Two ${suffix}`, workoutDays: [] },
    });
    const planTwoId = planTwo.json?.data?.workoutPlan?.id;

    if (!planOneId || !planTwoId) {
        throw new Error('Failed to create plans');
    }

    const assignOne = await request('POST', `/workout-plans/${planOneId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [clientOne._id.toString()],
            startDate: new Date().toISOString(),
            notes: 'cancel-flow note',
        },
    });
    const assignmentOneId = assignOne.json?.data?.assignments?.[0]?.id;
    if (assignOne.status !== 201 || !assignmentOneId) {
        throw new Error(`Setup assign failed: ${JSON.stringify(assignOne.json)}`);
    }

    // Second active on another plan for same client (allowed)
    const assignKeep = await request('POST', `/workout-plans/${planTwoId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [clientOne._id.toString()],
            startDate: new Date('2026-06-01T00:00:00.000Z').toISOString(),
            notes: 'keep-active',
        },
    });
    const assignmentKeepId = assignKeep.json?.data?.assignments?.[0]?.id;
    if (assignKeep.status !== 201 || !assignmentKeepId) {
        throw new Error(`Second assign failed: ${JSON.stringify(assignKeep.json)}`);
    }

    const assignmentBefore = await PlanAssignment.findById(assignmentOneId).lean();
    const planBefore = await WorkoutPlan.findById(planOneId).lean();
    const keepBefore = await PlanAssignment.findById(assignmentKeepId).lean();

    // 1–3. Cancel active
    const cancel = await request(
        'PATCH',
        `/workout-plans/${planOneId}/assignments/${assignmentOneId}`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    const cancelled = cancel.json?.data?.assignment;

    if (cancel.status === 200 && cancelled?.status === 'cancelled') {
        pass('1. Active assignment cancelled successfully');
    } else {
        fail('1. Active assignment cancelled successfully', JSON.stringify(cancel.json));
    }

    if (cancelled?.status === 'cancelled') pass('2. Response status is cancelled');
    else fail('2. Response status is cancelled', JSON.stringify(cancelled?.status));

    if (
        cancelled?.plan?.id === planOneId &&
        cancelled?.plan?.name === planOneName &&
        cancelled?.client === null &&
        cancelled?.planId === planOneId
    ) {
        pass('3. Correct plan information is returned');
    } else {
        fail('3. Correct plan information is returned', JSON.stringify(cancelled));
    }

    // Integrity
    const assignmentAfter = await PlanAssignment.findById(assignmentOneId).lean();
    if (
        assignmentAfter &&
        assignmentAfter.status === 'cancelled' &&
        sameValue(assignmentAfter.planId, assignmentBefore.planId) &&
        sameValue(assignmentAfter.clientId, assignmentBefore.clientId) &&
        sameValue(assignmentAfter.trainerId, assignmentBefore.trainerId) &&
        sameValue(assignmentAfter.planVersionId, assignmentBefore.planVersionId) &&
        sameValue(assignmentAfter.startDate, assignmentBefore.startDate) &&
        sameValue(assignmentAfter.endDate, assignmentBefore.endDate) &&
        sameValue(assignmentAfter.notes, assignmentBefore.notes) &&
        assignmentAfter.progress === assignmentBefore.progress &&
        assignmentAfter.completedSessions === assignmentBefore.completedSessions &&
        assignmentAfter.totalSessions === assignmentBefore.totalSessions &&
        sameValue(assignmentAfter.createdAt, assignmentBefore.createdAt)
    ) {
        pass('4. Only status (+ updatedAt) changed; other fields preserved');
    } else {
        fail('4. Only status (+ updatedAt) changed; other fields preserved', JSON.stringify({
            before: assignmentBefore,
            after: assignmentAfter,
        }));
    }

    const planAfter = await WorkoutPlan.findById(planOneId).lean();
    if (planAfter && sameValue(planAfter.updatedAt, planBefore.updatedAt)) {
        pass('5. WorkoutPlan.updatedAt remains unchanged');
    } else {
        fail('5. WorkoutPlan.updatedAt remains unchanged', JSON.stringify({
            before: planBefore?.updatedAt,
            after: planAfter?.updatedAt,
        }));
    }

    const keepAfter = await PlanAssignment.findById(assignmentKeepId).lean();
    if (keepAfter?.status === 'active' && sameValue(keepAfter.updatedAt, keepBefore.updatedAt)) {
        pass('6. Only target assignment is modified; other active remains');
    } else {
        fail('6. Only target assignment is modified; other active remains', JSON.stringify(keepAfter));
    }

    // Player + Client Details after cancel
    const me = await request('GET', '/me/workout-plan', { token: tokenClient });
    if (
        me.status === 200 &&
        me.json?.data?.assignment?.notes === 'keep-active' &&
        me.json?.data?.assignment?.plan?.id === planTwoId
    ) {
        pass('7. Player /me still resolves remaining active assignment');
    } else {
        fail('7. Player /me still resolves remaining active assignment', JSON.stringify(me.json));
    }

    // Cancel the remaining one and verify nulls
    await request('PATCH', `/workout-plans/${planTwoId}/assignments/${assignmentKeepId}`, {
        token: tokenA,
        body: { status: 'cancelled' },
    });

    const meNull = await request('GET', '/me/workout-plan', { token: tokenClient });
    if (meNull.status === 200 && meNull.json?.data?.assignment === null) {
        pass('8. Player /me returns assignment: null after all cancelled');
    } else {
        fail('8. Player /me returns assignment: null after all cancelled', JSON.stringify(meNull.json));
    }

    const clientScoped = await request(
        'GET',
        `/clients/${clientOne._id}/workout-plan-assignment`,
        { token: tokenA }
    );
    if (clientScoped.status === 200 && clientScoped.json?.data?.assignment === null) {
        pass('9. Trainer client-scoped GET returns assignment: null after cancellation');
    } else {
        fail(
            '9. Trainer client-scoped GET returns assignment: null after cancellation',
            JSON.stringify(clientScoped.json)
        );
    }

    // Re-create an active for remaining negative tests
    const reassign = await request('POST', `/workout-plans/${planOneId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [clientOne._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    const activeId = reassign.json?.data?.assignments?.[0]?.id;

    // 10. Unknown assignment
    const unknown = await request(
        'PATCH',
        `/workout-plans/${planOneId}/assignments/000000000000000000000000`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    if (unknown.status === 404) pass('10. Unknown assignment → 404');
    else fail('10. Unknown assignment → 404', `status=${unknown.status}`);

    // 11. Foreign trainer
    const foreign = await request(
        'PATCH',
        `/workout-plans/${planOneId}/assignments/${activeId}`,
        { token: tokenB, body: { status: 'cancelled' } }
    );
    if (foreign.status === 404) pass('11. Foreign trainer → 404');
    else fail('11. Foreign trainer → 404', `status=${foreign.status}`);

    // 12. Assignment belonging to another plan
    const mismatched = await request(
        'PATCH',
        `/workout-plans/${planTwoId}/assignments/${activeId}`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    if (mismatched.status === 404) pass('12. Assignment from another plan → 404');
    else fail('12. Assignment from another plan → 404', `status=${mismatched.status}`);

    // 13. Invalid assignment ID
    const malformed = await request(
        'PATCH',
        `/workout-plans/${planOneId}/assignments/not-an-id`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    if (malformed.status === 400) pass('13. Invalid assignment ID → 400');
    else fail('13. Invalid assignment ID → 400', `status=${malformed.status}`);

    // 14–15. Validation
    const missingStatus = await request(
        'PATCH',
        `/workout-plans/${planOneId}/assignments/${activeId}`,
        { token: tokenA, body: {} }
    );
    if (missingStatus.status === 400) pass('14. Missing status → validation error');
    else fail('14. Missing status → validation error', `status=${missingStatus.status}`);

    const wrongStatus = await request(
        'PATCH',
        `/workout-plans/${planOneId}/assignments/${activeId}`,
        { token: tokenA, body: { status: 'paused' } }
    );
    if (wrongStatus.status === 400) pass('15. Wrong status → validation error');
    else fail('15. Wrong status → validation error', `status=${wrongStatus.status}`);

    const stillActive = await PlanAssignment.findById(activeId).lean();
    if (stillActive?.status === 'active') {
        pass('16. Rejected requests leave assignment active');
    } else {
        fail('16. Rejected requests leave assignment active', JSON.stringify(stillActive?.status));
    }

    // 17–19. Non-active transitions
    const completedAssignment = await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: planTwoId,
        clientId: clientCompleted._id,
        startDate: new Date(),
        status: 'completed',
    });
    const cancelCompleted = await request(
        'PATCH',
        `/workout-plans/${planTwoId}/assignments/${completedAssignment._id}`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    if (cancelCompleted.status === 409) pass('17. Completed → 409');
    else fail('17. Completed → 409', `status=${cancelCompleted.status}`);

    const pausedAssignment = await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: planTwoId,
        clientId: clientPaused._id,
        startDate: new Date(),
        status: 'paused',
    });
    const cancelPaused = await request(
        'PATCH',
        `/workout-plans/${planTwoId}/assignments/${pausedAssignment._id}`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    if (cancelPaused.status === 409) pass('18. Paused → 409');
    else fail('18. Paused → 409', `status=${cancelPaused.status}`);

    // Cancel then cancel again
    await request('PATCH', `/workout-plans/${planOneId}/assignments/${activeId}`, {
        token: tokenA,
        body: { status: 'cancelled' },
    });
    const cancelAgain = await request(
        'PATCH',
        `/workout-plans/${planOneId}/assignments/${activeId}`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    if (cancelAgain.status === 409) pass('19. Already cancelled → 409');
    else fail('19. Already cancelled → 409', `status=${cancelAgain.status}`);

    // 20–21. Auth
    const unauth = await request(
        'PATCH',
        `/workout-plans/${planOneId}/assignments/${activeId}`,
        { body: { status: 'cancelled' } }
    );
    if (unauth.status === 401) pass('20. Unauthenticated → 401');
    else fail('20. Unauthenticated → 401', `status=${unauth.status}`);

    if (tokenClient) {
        const asClient = await request(
            'PATCH',
            `/workout-plans/${planOneId}/assignments/${activeId}`,
            { token: tokenClient, body: { status: 'cancelled' } }
        );
        if (asClient.status === 403) pass('21. Client role → 403');
        else fail('21. Client role → 403', `status=${asClient.status}`);
    } else {
        fail('21. Client role → 403', 'client login failed');
    }

    // Extra: if another active exists, cancellation of one leaves the other for clientKeep
    const assignKeepClient = await request('POST', `/workout-plans/${planOneId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [clientKeep._id.toString()],
            startDate: new Date('2026-01-01T00:00:00.000Z').toISOString(),
            notes: 'older-keep',
        },
    });
    const olderKeepId = assignKeepClient.json?.data?.assignments?.[0]?.id;
    const assignNewerKeep = await request('POST', `/workout-plans/${planTwoId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [clientKeep._id.toString()],
            startDate: new Date('2026-06-01T00:00:00.000Z').toISOString(),
            notes: 'newer-keep',
        },
    });
    const newerKeepId = assignNewerKeep.json?.data?.assignments?.[0]?.id;

    await request('PATCH', `/workout-plans/${planTwoId}/assignments/${newerKeepId}`, {
        token: tokenA,
        body: { status: 'cancelled' },
    });

    const loginKeep = await request('POST', '/auth/login', {
        body: { email: clientKeep.email, password },
    });
    const tokenKeep = loginKeep.json?.data?.token;
    const meKeep = await request('GET', '/me/workout-plan', { token: tokenKeep });
    const detailsKeep = await request(
        'GET',
        `/clients/${clientKeep._id}/workout-plan-assignment`,
        { token: tokenA }
    );

    if (
        meKeep.json?.data?.assignment?.notes === 'older-keep' &&
        detailsKeep.json?.data?.assignment?.notes === 'older-keep' &&
        detailsKeep.json?.data?.assignment?.id === olderKeepId
    ) {
        pass('22. Cancelling one active leaves the other available');
    } else {
        fail(
            '22. Cancelling one active leaves the other available',
            JSON.stringify({ me: meKeep.json, details: detailsKeep.json })
        );
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
                clientOne._id,
                clientCompleted._id,
                clientPaused._id,
                clientKeep._id,
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
