/**
 * Client-scoped active Nutrition Plan Assignment verification.
 * Run: node scripts/test-nutrition-assignment-client-scoped.mjs
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
    name: 'Client Scoped Assign Plan',
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

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Scope',
        lastName: 'Alpha',
        email: `np-scope-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'Scope',
        lastName: 'Beta',
        email: `np-scope-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const client = await User.create({
        firstName: 'Scope',
        lastName: 'Client',
        email: `np-scope-c-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientEmpty = await User.create({
        firstName: 'Scope',
        lastName: 'Empty',
        email: `np-scope-empty-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientHistory = await User.create({
        firstName: 'Scope',
        lastName: 'History',
        email: `np-scope-hist-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientMulti = await User.create({
        firstName: 'Scope',
        lastName: 'Multi',
        email: `np-scope-multi-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const foreignClient = await User.create({
        firstName: 'Scope',
        lastName: 'Foreign',
        email: `np-scope-foreign-${suffix}@test.com`,
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
        body: { email: client.email, password },
    });

    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;
    const tokenClient = loginClient.json?.data?.token;

    if (!tokenA || !tokenB) {
        throw new Error('Failed to login test trainers');
    }

    const createPlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: 'Active Scope Plan' },
    });
    const planId = createPlan.json?.data?.nutritionPlan?.id;
    const planName = createPlan.json?.data?.nutritionPlan?.name;

    const otherPlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: 'Other Scope Plan' },
    });
    const otherPlanId = otherPlan.json?.data?.nutritionPlan?.id;

    const histPlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: 'History Scope Plan' },
    });
    const histPlanId = histPlan.json?.data?.nutritionPlan?.id;

    // Assign active plan to client
    const assign = await request('POST', `/nutrition-plans/${planId}/assignments`, {
        token: tokenA,
        body: assignmentBody([client._id.toString()], { notes: 'scope note' }),
    });
    if (assign.status !== 201) {
        throw new Error(`Setup assign failed: ${JSON.stringify(assign.json)}`);
    }

    // PASS: trainer retrieves active assignment
    const getActive = await request('GET', `/clients/${client._id}/nutrition-plan-assignment`, {
        token: tokenA,
    });
    const assignment = getActive.json?.data?.assignment;

    if (getActive.status === 200 && assignment?.id) pass('trainer can retrieve active assignment for own client');
    else fail('trainer can retrieve active assignment for own client', JSON.stringify(getActive.json));

    if (assignment && assignment.status === 'active') pass('response contains assignment');
    else fail('response contains assignment', JSON.stringify(assignment));

    if (assignment?.plan?.id === planId) pass('response contains plan.id');
    else fail('response contains plan.id', JSON.stringify(assignment?.plan));

    if (assignment?.plan?.name === planName) pass('response contains plan.name');
    else fail('response contains plan.name', JSON.stringify(assignment?.plan));

    const planKeys = assignment?.plan ? Object.keys(assignment.plan).sort() : [];
    if (
        assignment?.plan &&
        planKeys.join(',') === 'id,name' &&
        !assignment.plan.nutritionDays &&
        !assignment.plan.macroTargets &&
        !('days' in (assignment.plan || {}))
    ) {
        pass('no full plan/day/meal payload is returned');
    } else {
        fail('no full plan/day/meal payload is returned', JSON.stringify(assignment?.plan));
    }

    // null when no active
    const getEmpty = await request('GET', `/clients/${clientEmpty._id}/nutrition-plan-assignment`, {
        token: tokenA,
    });
    if (getEmpty.status === 200 && getEmpty.json?.data?.assignment === null) {
        pass('client with no active assignment returns assignment: null');
    } else {
        fail('client with no active assignment returns assignment: null', JSON.stringify(getEmpty.json));
    }

    // foreign client
    const getForeign = await request(
        'GET',
        `/clients/${foreignClient._id}/nutrition-plan-assignment`,
        { token: tokenA }
    );
    if (getForeign.status === 403 || getForeign.status === 404) {
        pass('foreign client is rejected');
    } else {
        fail('foreign client is rejected', JSON.stringify(getForeign.json));
    }

    // unauthenticated
    const getUnauth = await request('GET', `/clients/${client._id}/nutrition-plan-assignment`);
    if (getUnauth.status === 401) pass('unauthenticated request is rejected');
    else fail('unauthenticated request is rejected', JSON.stringify(getUnauth.json));

    // non-trainer (client role)
    if (tokenClient) {
        const getAsClient = await request(
            'GET',
            `/clients/${client._id}/nutrition-plan-assignment`,
            { token: tokenClient }
        );
        if (getAsClient.status === 403) pass('non-trainer/non-admin authorization follows existing rules');
        else fail('non-trainer/non-admin authorization follows existing rules', JSON.stringify(getAsClient.json));
    } else {
        fail('non-trainer/non-admin authorization follows existing rules', 'client login failed');
    }

    // Historical statuses ignored
    await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: histPlanId,
        clientId: clientHistory._id,
        startDate: new Date(),
        status: 'completed',
    });
    await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: histPlanId,
        clientId: clientHistory._id,
        startDate: new Date(),
        status: 'cancelled',
    });
    await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: histPlanId,
        clientId: clientHistory._id,
        startDate: new Date(),
        status: 'paused',
    });

    const getHist = await request(
        'GET',
        `/clients/${clientHistory._id}/nutrition-plan-assignment`,
        { token: tokenA }
    );
    if (getHist.status === 200 && getHist.json?.data?.assignment === null) {
        pass('completed assignment is ignored');
        pass('cancelled assignment is ignored');
        pass('paused assignment is ignored');
    } else {
        fail('completed assignment is ignored', JSON.stringify(getHist.json));
        fail('cancelled assignment is ignored', JSON.stringify(getHist.json));
        fail('paused assignment is ignored', JSON.stringify(getHist.json));
    }

    // One active → returns it
    if (assignment?.planId === planId && assignment?.clientId === client._id.toString()) {
        pass('client with one active plan → returns it');
    } else {
        fail('client with one active plan → returns it', JSON.stringify(assignment));
    }

    // Attempt second active → 409
    const second = await request('POST', `/nutrition-plans/${otherPlanId}/assignments`, {
        token: tokenA,
        body: assignmentBody([client._id.toString()]),
    });
    if (second.status === 409) pass('attempt to assign another active plan to same client → 409');
    else fail('attempt to assign another active plan to same client → 409', JSON.stringify(second.json));

    // Legacy multiple actives → integrity error (not arbitrary pick)
    await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId,
        clientId: clientMulti._id,
        startDate: new Date(),
        status: 'active',
    });
    await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: otherPlanId,
        clientId: clientMulti._id,
        startDate: new Date(),
        status: 'active',
    });
    const getMulti = await request(
        'GET',
        `/clients/${clientMulti._id}/nutrition-plan-assignment`,
        { token: tokenA }
    );
    if (getMulti.status === 500) {
        pass('legacy multiple active assignments → domain/data-integrity error');
    } else {
        fail(
            'legacy multiple active assignments → domain/data-integrity error',
            `status=${getMulti.status} body=${JSON.stringify(getMulti.json)}`
        );
    }

    // Regression: plan-scoped GET still works
    const planScoped = await request('GET', `/nutrition-plans/${planId}/assignments`, {
        token: tokenA,
    });
    if (planScoped.status === 200 && Array.isArray(planScoped.json?.data?.assignments)) {
        pass('existing plan-scoped GET assignments still works');
    } else {
        fail('existing plan-scoped GET assignments still works', JSON.stringify(planScoped.json));
    }

    // Trainer B cannot see trainer A client assignment
    const getAsB = await request('GET', `/clients/${client._id}/nutrition-plan-assignment`, {
        token: tokenB,
    });
    if (getAsB.status === 403 || getAsB.status === 404) {
        pass('other trainer cannot access client assignment');
    } else {
        fail('other trainer cannot access client assignment', JSON.stringify(getAsB.json));
    }

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
                client._id,
                clientEmpty._id,
                clientHistory._id,
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
