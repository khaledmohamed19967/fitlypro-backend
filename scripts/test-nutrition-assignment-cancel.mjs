/**
 * Cancel Nutrition Plan Assignment ("Remove from Client") verification.
 * Run: node scripts/test-nutrition-assignment-cancel.mjs
 *
 * Prerequisites:
 * - Dev server running (with latest code)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
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

const basePlanPayload = () => ({
    name: 'Cancel Test Plan',
    goal: 'maintenance',
    duration: 8,
    daysCount: 7,
    macroTargets: { calories: 2200, protein: 140, carbs: 250, fat: 70 },
    nutritionDays: [],
});

const assignmentBody = (clientIds, overrides = {}) => ({
    clientIds,
    startDate: new Date().toISOString(),
    ...overrides,
});

const isObjectIdString = (value) =>
    typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value);

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Cancel',
        lastName: 'Alpha',
        email: `np-cancel-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'Cancel',
        lastName: 'Beta',
        email: `np-cancel-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const clientOne = await User.create({
        firstName: 'Cancel',
        lastName: 'ClientOne',
        email: `np-cancel-c1-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientCompleted = await User.create({
        firstName: 'Cancel',
        lastName: 'ClientCompleted',
        email: `np-cancel-c2-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientPaused = await User.create({
        firstName: 'Cancel',
        lastName: 'ClientPaused',
        email: `np-cancel-c3-${suffix}@test.com`,
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

    const planOne = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: `Cancel Plan One ${suffix}` },
    });
    const planOneId = planOne.json?.data?.nutritionPlan?.id;
    const planOneName = planOne.json?.data?.nutritionPlan?.name;

    const planTwo = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: `Cancel Plan Two ${suffix}` },
    });
    const planTwoId = planTwo.json?.data?.nutritionPlan?.id;

    if (!planOneId || !planTwoId) {
        throw new Error('Failed to create test nutrition plans');
    }

    const assignOne = await request('POST', `/nutrition-plans/${planOneId}/assignments`, {
        token: tokenA,
        body: assignmentBody([clientOne._id.toString()], { notes: 'cancel-flow note' }),
    });
    const assignmentOneId = assignOne.json?.data?.assignments?.[0]?.id;

    if (assignOne.status !== 201 || !assignmentOneId) {
        throw new Error(`Setup assignment failed: ${JSON.stringify(assignOne.json)}`);
    }

    // Pre-cancel snapshots straight from Mongo for integrity assertions
    const assignmentBefore = await NutritionPlanAssignment.findById(assignmentOneId).lean();
    const planBefore = await NutritionPlan.findById(planOneId).lean();

    // 1. Trainer cancels own active assignment
    const cancel = await request(
        'PATCH',
        `/nutrition-plans/${planOneId}/assignments/${assignmentOneId}`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    const cancelled = cancel.json?.data?.assignment;

    if (cancel.status === 200 && cancelled?.status === 'cancelled') {
        pass('1. Active assignment cancelled successfully');
    } else {
        fail('1. Active assignment cancelled successfully', `status=${cancel.status} body=${JSON.stringify(cancel.json)}`);
    }

    if (
        cancelled?.plan?.id === planOneId &&
        cancelled?.plan?.name === planOneName &&
        cancelled?.client === null &&
        isObjectIdString(cancelled?.clientId) &&
        cancelled?.clientId === clientOne._id.toString()
    ) {
        pass('1b. Response DTO shape (plan summary, client null, clientId string)');
    } else {
        fail('1b. Response DTO shape (plan summary, client null, clientId string)', JSON.stringify(cancelled));
    }

    // Mongo integrity: only status + updatedAt changed
    const assignmentAfter = await NutritionPlanAssignment.findById(assignmentOneId).lean();
    const sameValue = (a, b) => String(a ?? null) === String(b ?? null);

    if (!assignmentAfter) {
        fail('1c. Assignment document preserved', 'document missing after cancellation');
    } else if (
        assignmentAfter.status === 'cancelled' &&
        sameValue(assignmentAfter.planId, assignmentBefore.planId) &&
        sameValue(assignmentAfter.clientId, assignmentBefore.clientId) &&
        sameValue(assignmentAfter.trainerId, assignmentBefore.trainerId) &&
        sameValue(assignmentAfter.planVersionId, assignmentBefore.planVersionId) &&
        sameValue(assignmentAfter.startDate, assignmentBefore.startDate) &&
        sameValue(assignmentAfter.endDate, assignmentBefore.endDate) &&
        sameValue(assignmentAfter.notes, assignmentBefore.notes) &&
        sameValue(assignmentAfter.createdAt, assignmentBefore.createdAt) &&
        assignmentBefore.status === 'active' &&
        new Date(assignmentAfter.updatedAt).getTime() >=
            new Date(assignmentBefore.updatedAt).getTime()
    ) {
        pass('1c. Only status + updatedAt changed; document preserved');
    } else {
        fail(
            '1c. Only status + updatedAt changed; document preserved',
            JSON.stringify({ before: assignmentBefore, after: assignmentAfter })
        );
    }

    // NutritionPlan untouched
    const planAfter = await NutritionPlan.findById(planOneId).lean();
    if (
        planAfter &&
        planAfter.status === planBefore.status &&
        planAfter.name === planBefore.name &&
        sameValue(planAfter.updatedAt, planBefore.updatedAt) &&
        (planAfter.nutritionDays?.length ?? 0) === (planBefore.nutritionDays?.length ?? 0)
    ) {
        pass('1d. NutritionPlan document unchanged');
    } else {
        fail('1d. NutritionPlan document unchanged', JSON.stringify({ before: planBefore?.updatedAt, after: planAfter?.updatedAt }));
    }

    // 2. Client-scoped active lookup returns null
    const activeAfterCancel = await request(
        'GET',
        `/clients/${clientOne._id}/nutrition-plan-assignment`,
        { token: tokenA }
    );
    if (activeAfterCancel.status === 200 && activeAfterCancel.json?.data?.assignment === null) {
        pass('2. Client-scoped active assignment returns null');
    } else {
        fail('2. Client-scoped active assignment returns null', JSON.stringify(activeAfterCancel.json));
    }

    // 3. Cancelled assignment remains in plan-scoped history
    const history = await request('GET', `/nutrition-plans/${planOneId}/assignments`, {
        token: tokenA,
    });
    const historyRow = history.json?.data?.assignments?.find((a) => a.id === assignmentOneId);
    if (history.status === 200 && historyRow?.status === 'cancelled') {
        pass('3. Cancelled assignment remains in plan-scoped history');
    } else {
        fail('3. Cancelled assignment remains in plan-scoped history', JSON.stringify(history.json));
    }

    // 4. Same client can be assigned the same plan again
    const reassign = await request('POST', `/nutrition-plans/${planOneId}/assignments`, {
        token: tokenA,
        body: assignmentBody([clientOne._id.toString()]),
    });
    const assignmentTwoId = reassign.json?.data?.assignments?.[0]?.id;
    if (reassign.status === 201 && assignmentTwoId) {
        pass('4. Same client reassigned to same plan after cancellation');
    } else {
        fail('4. Same client reassigned to same plan after cancellation', JSON.stringify(reassign.json));
    }

    // 5. Foreign trainer cannot cancel
    const foreignCancel = await request(
        'PATCH',
        `/nutrition-plans/${planOneId}/assignments/${assignmentTwoId}`,
        { token: tokenB, body: { status: 'cancelled' } }
    );
    if (foreignCancel.status === 404) pass('5. Foreign trainer cannot cancel → 404');
    else fail('5. Foreign trainer cannot cancel → 404', JSON.stringify(foreignCancel.json));

    // 6. Completed assignment cannot be cancelled
    const completedAssignment = await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: planTwoId,
        clientId: clientCompleted._id,
        startDate: new Date(),
        status: 'completed',
    });
    const cancelCompleted = await request(
        'PATCH',
        `/nutrition-plans/${planTwoId}/assignments/${completedAssignment._id}`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    if (cancelCompleted.status === 409) pass('6. Completed assignment → 409');
    else fail('6. Completed assignment → 409', `status=${cancelCompleted.status} body=${JSON.stringify(cancelCompleted.json)}`);

    // 7. Paused assignment cannot be cancelled
    const pausedAssignment = await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: planTwoId,
        clientId: clientPaused._id,
        startDate: new Date(),
        status: 'paused',
    });
    const cancelPaused = await request(
        'PATCH',
        `/nutrition-plans/${planTwoId}/assignments/${pausedAssignment._id}`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    if (cancelPaused.status === 409) pass('7. Paused assignment → 409');
    else fail('7. Paused assignment → 409', `status=${cancelPaused.status} body=${JSON.stringify(cancelPaused.json)}`);

    // 8. Already-cancelled assignment cannot be cancelled again
    const cancelAgain = await request(
        'PATCH',
        `/nutrition-plans/${planOneId}/assignments/${assignmentOneId}`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    if (cancelAgain.status === 409) pass('8. Already-cancelled assignment → 409');
    else fail('8. Already-cancelled assignment → 409', `status=${cancelAgain.status} body=${JSON.stringify(cancelAgain.json)}`);

    // 9. Invalid / unknown assignment IDs
    const malformedId = await request(
        'PATCH',
        `/nutrition-plans/${planOneId}/assignments/not-an-id`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    if (malformedId.status === 400) pass('9a. Malformed assignmentId → 400');
    else fail('9a. Malformed assignmentId → 400', `status=${malformedId.status} body=${JSON.stringify(malformedId.json)}`);

    const unknownId = await request(
        'PATCH',
        `/nutrition-plans/${planOneId}/assignments/000000000000000000000000`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    if (unknownId.status === 404) pass('9b. Unknown assignmentId → 404');
    else fail('9b. Unknown assignmentId → 404', `status=${unknownId.status} body=${JSON.stringify(unknownId.json)}`);

    // 10. Unauthenticated
    const unauth = await request(
        'PATCH',
        `/nutrition-plans/${planOneId}/assignments/${assignmentTwoId}`,
        { body: { status: 'cancelled' } }
    );
    if (unauth.status === 401) pass('10. Unauthenticated → 401');
    else fail('10. Unauthenticated → 401', `status=${unauth.status} body=${JSON.stringify(unauth.json)}`);

    // 11. Client role
    if (tokenClient) {
        const asClient = await request(
            'PATCH',
            `/nutrition-plans/${planOneId}/assignments/${assignmentTwoId}`,
            { token: tokenClient, body: { status: 'cancelled' } }
        );
        if (asClient.status === 403) pass('11. Client role → 403');
        else fail('11. Client role → 403', `status=${asClient.status} body=${JSON.stringify(asClient.json)}`);
    } else {
        fail('11. Client role → 403', 'client login failed');
    }

    // 12. Invalid / forbidden request bodies
    const invalidBodies = [
        ['status paused', { status: 'paused' }],
        ['status active', { status: 'active' }],
        ['empty body', {}],
        ['forbidden trainerId', { status: 'cancelled', trainerId: trainerB._id.toString() }],
        ['forbidden endDate', { status: 'cancelled', endDate: new Date().toISOString() }],
    ];

    let bodyFailures = [];
    for (const [label, body] of invalidBodies) {
        const res = await request(
            'PATCH',
            `/nutrition-plans/${planOneId}/assignments/${assignmentTwoId}`,
            { token: tokenA, body }
        );
        if (res.status !== 400) {
            bodyFailures.push(`${label}: status=${res.status}`);
        }
    }
    if (bodyFailures.length === 0) pass('12. Invalid/forbidden bodies → 400');
    else fail('12. Invalid/forbidden bodies → 400', bodyFailures.join('; '));

    const stillActive = await NutritionPlanAssignment.findById(assignmentTwoId).lean();
    if (stillActive?.status === 'active') {
        pass('12b. Rejected requests did not mutate the assignment');
    } else {
        fail('12b. Rejected requests did not mutate the assignment', JSON.stringify(stillActive?.status));
    }

    // 13. Mismatched plan cannot reach the assignment
    const mismatchedPlan = await request(
        'PATCH',
        `/nutrition-plans/${planTwoId}/assignments/${assignmentTwoId}`,
        { token: tokenA, body: { status: 'cancelled' } }
    );
    if (mismatchedPlan.status === 404) pass('13. Mismatched planId → 404');
    else fail('13. Mismatched planId → 404', `status=${mismatchedPlan.status} body=${JSON.stringify(mismatchedPlan.json)}`);

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);

    await NutritionPlanAssignment.deleteMany({ trainerId: { $in: [trainerA._id, trainerB._id] } });
    await NutritionPlan.deleteMany({ trainerId: { $in: [trainerA._id, trainerB._id] } });
    await User.deleteMany({
        _id: {
            $in: [
                trainerA._id,
                trainerB._id,
                clientOne._id,
                clientCompleted._id,
                clientPaused._id,
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
