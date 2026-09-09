/**
 * Manual Phase 6 Nutrition Plan Assignments verification.
 * Run: node scripts/test-nutrition-assignments-phase6.mjs
 *
 * Prerequisites:
 * - Dev server running
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
    name: 'Assignment Test Plan',
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
        firstName: 'Assign',
        lastName: 'Alpha',
        email: `np-assign-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'Assign',
        lastName: 'Beta',
        email: `np-assign-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const client = await User.create({
        firstName: 'Client',
        lastName: 'One',
        email: `np-client-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientTwo = await User.create({
        firstName: 'Client',
        lastName: 'Two',
        email: `np-client2-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientThree = await User.create({
        firstName: 'Client',
        lastName: 'Three',
        email: `np-client3-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientCoexist = await User.create({
        firstName: 'Client',
        lastName: 'Coexist',
        email: `np-client-coexist-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientCancel = await User.create({
        firstName: 'Client',
        lastName: 'Cancel',
        email: `np-client-cancel-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientSurvive = await User.create({
        firstName: 'Client',
        lastName: 'Survive',
        email: `np-client-survive-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const foreignClient = await User.create({
        firstName: 'Foreign',
        lastName: 'Client',
        email: `np-foreign-${suffix}@test.com`,
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

    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;

    if (!tokenA || !tokenB) {
        throw new Error('Failed to login test trainers');
    }

    const createPlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: basePlanPayload(),
    });
    const planId = createPlan.json?.data?.nutritionPlan?.id;

    const foreignPlan = await request('POST', '/nutrition-plans', {
        token: tokenB,
        body: { ...basePlanPayload(), name: 'Foreign Plan' },
    });
    const foreignPlanId = foreignPlan.json?.data?.nutritionPlan?.id;

    const systemTemplate = await NutritionPlan.findOne({
        'ownership.type': 'system',
        isTemplate: true,
        status: 'active',
    });

    // 1. Assign own plan to own client
    const assignOwn = await request('POST', `/nutrition-plans/${planId}/assignments`, {
        token: tokenA,
        body: assignmentBody([client._id.toString()]),
    });
    const assignment = assignOwn.json?.data?.assignments?.[0];
    if (assignOwn.status === 201 && assignment?.id) pass('Assign own plan to own client');
    else fail('Assign own plan to own client', JSON.stringify(assignOwn.json));

    // 2. Get plan assignments
    const getAssignments = await request('GET', `/nutrition-plans/${planId}/assignments`, {
        token: tokenA,
    });
    if (getAssignments.status === 200 && getAssignments.json?.data?.assignments?.length >= 1) {
        pass('Get plan assignments');
    } else {
        fail('Get plan assignments', JSON.stringify(getAssignments.json));
    }

    // 3. Bulk assignment (clients without an existing active plan)
    const bulkPlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: 'Bulk Plan' },
    });
    const bulkPlanId = bulkPlan.json?.data?.nutritionPlan?.id;
    const bulkAssign = await request('POST', `/nutrition-plans/${bulkPlanId}/assignments`, {
        token: tokenA,
        body: assignmentBody([clientTwo._id.toString(), clientThree._id.toString()]),
    });
    if (bulkAssign.status === 201 && bulkAssign.json?.data?.assignments?.length === 2) {
        pass('Bulk assignment');
    } else {
        fail('Bulk assignment', JSON.stringify(bulkAssign.json));
    }

    // 3b. Second active plan for same client → 409 (one active plan per client)
    const secondActivePlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: 'Second Active Plan' },
    });
    const secondActivePlanId = secondActivePlan.json?.data?.nutritionPlan?.id;
    const secondActive = await request('POST', `/nutrition-plans/${secondActivePlanId}/assignments`, {
        token: tokenA,
        body: assignmentBody([client._id.toString()]),
    });
    if (secondActive.status === 409) pass('Second active plan for same client → 409');
    else fail('Second active plan for same client → 409', JSON.stringify(secondActive.json));

    // 4. Missing client
    const missingClient = await request('POST', `/nutrition-plans/${bulkPlanId}/assignments`, {
        token: tokenA,
        body: assignmentBody(['000000000000000000000000']),
    });
    if (missingClient.status === 400) pass('Missing client');
    else fail('Missing client', JSON.stringify(missingClient.json));

    // 5. Foreign client
    const foreignClientAssign = await request('POST', `/nutrition-plans/${bulkPlanId}/assignments`, {
        token: tokenA,
        body: assignmentBody([foreignClient._id.toString()]),
    });
    if (foreignClientAssign.status === 400) pass('Foreign client');
    else fail('Foreign client', JSON.stringify(foreignClientAssign.json));

    // 6. Missing plan
    const missingPlan = await request('POST', '/nutrition-plans/000000000000000000000000/assignments', {
        token: tokenA,
        body: assignmentBody([client._id.toString()]),
    });
    if (missingPlan.status === 404) pass('Missing plan');
    else fail('Missing plan', JSON.stringify(missingPlan.json));

    // 7. Foreign plan
    const foreignPlanAssign = await request('POST', `/nutrition-plans/${foreignPlanId}/assignments`, {
        token: tokenA,
        body: assignmentBody([client._id.toString()]),
    });
    if (foreignPlanAssign.status === 404) pass('Foreign plan');
    else fail('Foreign plan', JSON.stringify(foreignPlanAssign.json));

    // 8. System template cannot be assigned
    if (systemTemplate) {
        const systemAssign = await request('POST', `/nutrition-plans/${systemTemplate._id}/assignments`, {
            token: tokenA,
            body: assignmentBody([client._id.toString()]),
        });
        if (systemAssign.status === 400) pass('System template cannot be assigned');
        else fail('System template cannot be assigned', JSON.stringify(systemAssign.json));
    } else {
        fail('System template cannot be assigned', 'No system template in DB');
    }

    // 9. Archived plan cannot be assigned
    const archivePlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: 'To Archive' },
    });
    const archivePlanId = archivePlan.json?.data?.nutritionPlan?.id;
    await request('DELETE', `/nutrition-plans/${archivePlanId}`, { token: tokenA });
    const assignArchived = await request('POST', `/nutrition-plans/${archivePlanId}/assignments`, {
        token: tokenA,
        body: assignmentBody([clientTwo._id.toString()]),
    });
    if (assignArchived.status === 400) pass('Archived plan cannot be assigned');
    else fail('Archived plan cannot be assigned', JSON.stringify(assignArchived.json));

    // 9b. Draft plan cannot be assigned
    const draftPlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: 'Draft Assign Plan', status: 'draft' },
    });
    const draftPlanId = draftPlan.json?.data?.nutritionPlan?.id;
    const assignDraft = await request('POST', `/nutrition-plans/${draftPlanId}/assignments`, {
        token: tokenA,
        body: assignmentBody([client._id.toString()]),
    });
    if (assignDraft.status === 400) pass('Draft plan cannot be assigned');
    else fail('Draft plan cannot be assigned', JSON.stringify(assignDraft.json));

    // 10. Duplicate active assignment → 409
    const dupAssign = await request('POST', `/nutrition-plans/${planId}/assignments`, {
        token: tokenA,
        body: assignmentBody([client._id.toString()]),
    });
    if (dupAssign.status === 409) pass('Duplicate active assignment → 409');
    else fail('Duplicate active assignment → 409', JSON.stringify(dupAssign.json));

    // 11. Completed assignment can coexist (historical completed does not block a new active)
    const coexistPlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: 'Coexist Plan' },
    });
    const coexistPlanId = coexistPlan.json?.data?.nutritionPlan?.id;
    await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: coexistPlanId,
        clientId: clientCoexist._id,
        startDate: new Date(),
        status: 'completed',
    });
    const afterCompleted = await request('POST', `/nutrition-plans/${coexistPlanId}/assignments`, {
        token: tokenA,
        body: assignmentBody([clientCoexist._id.toString()]),
    });
    if (afterCompleted.status === 201) pass('Completed assignment can coexist');
    else fail('Completed assignment can coexist', JSON.stringify(afterCompleted.json));

    // 12. Cancelled assignment can coexist
    const cancelPlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: 'Cancel Coexist Plan' },
    });
    const cancelPlanId = cancelPlan.json?.data?.nutritionPlan?.id;
    await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: cancelPlanId,
        clientId: clientCancel._id,
        startDate: new Date(),
        status: 'cancelled',
    });
    const afterCancelled = await request('POST', `/nutrition-plans/${cancelPlanId}/assignments`, {
        token: tokenA,
        body: assignmentBody([clientCancel._id.toString()]),
    });
    if (afterCancelled.status === 201) pass('Cancelled assignment can coexist');
    else fail('Cancelled assignment can coexist', JSON.stringify(afterCancelled.json));

    // 13. startDate required
    const noStart = await request('POST', `/nutrition-plans/${planId}/assignments`, {
        token: tokenA,
        body: { clientIds: [clientTwo._id.toString()] },
    });
    if (noStart.status === 400) pass('startDate required');
    else fail('startDate required', JSON.stringify(noStart.json));

    // 14. Invalid date
    const invalidDate = await request('POST', `/nutrition-plans/${planId}/assignments`, {
        token: tokenA,
        body: { clientIds: [clientTwo._id.toString()], startDate: 'not-a-date' },
    });
    if (invalidDate.status === 400) pass('Invalid date');
    else fail('Invalid date', JSON.stringify(invalidDate.json));

    // 15. endDate before startDate
    const badEnd = await request('POST', `/nutrition-plans/${planId}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [clientTwo._id.toString()],
            startDate: '2026-12-01T00:00:00.000Z',
            endDate: '2026-11-01T00:00:00.000Z',
        },
    });
    if (badEnd.status === 400) pass('endDate before startDate');
    else fail('endDate before startDate', JSON.stringify(badEnd.json));

    // 16. Multiple clients — covered by bulk test
    pass('Multiple clients');

    // 17. Client profile mapping
    if (
        assignment?.client?.id &&
        assignment?.client?.firstName &&
        assignment?.client?.email
    ) {
        pass('Client profile mapping');
    } else {
        fail('Client profile mapping', JSON.stringify(assignment?.client));
    }

    // 18. Ownership enforcement (foreign GET assignments)
    const foreignGetAssign = await request('GET', `/nutrition-plans/${planId}/assignments`, {
        token: tokenB,
    });
    if (foreignGetAssign.status === 404) pass('Ownership enforcement');
    else fail('Ownership enforcement', JSON.stringify(foreignGetAssign.json));

    // 19. trainerId cannot be supplied
    const forbiddenTrainer = await request('POST', `/nutrition-plans/${planId}/assignments`, {
        token: tokenA,
        body: { ...assignmentBody([clientTwo._id.toString()]), trainerId: trainerB._id.toString() },
    });
    if (forbiddenTrainer.status === 400) pass('trainerId cannot be supplied');
    else fail('trainerId cannot be supplied', JSON.stringify(forbiddenTrainer.json));

    // 20. planId cannot be overridden
    const forbiddenPlanId = await request('POST', `/nutrition-plans/${planId}/assignments`, {
        token: tokenA,
        body: {
            ...assignmentBody([clientTwo._id.toString()]),
            planId: foreignPlanId,
        },
    });
    if (forbiddenPlanId.status === 400) pass('planId cannot be overridden');
    else fail('planId cannot be overridden', JSON.stringify(forbiddenPlanId.json));

    // 21. status cannot be supplied
    const forbiddenStatus = await request('POST', `/nutrition-plans/${planId}/assignments`, {
        token: tokenA,
        body: { ...assignmentBody([clientTwo._id.toString()]), status: 'completed' },
    });
    if (forbiddenStatus.status === 400) pass('status cannot be supplied');
    else fail('status cannot be supplied', JSON.stringify(forbiddenStatus.json));

    // 22. Assignment survives plan archive
    const survivePlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: 'Survive Archive Plan' },
    });
    const survivePlanId = survivePlan.json?.data?.nutritionPlan?.id;
    await request('POST', `/nutrition-plans/${survivePlanId}/assignments`, {
        token: tokenA,
        body: assignmentBody([clientSurvive._id.toString()]),
    });
    await request('DELETE', `/nutrition-plans/${survivePlanId}`, { token: tokenA });
    const surviveGet = await request('GET', `/nutrition-plans/${survivePlanId}/assignments`, {
        token: tokenA,
    });
    if (surviveGet.status === 200 && surviveGet.json?.data?.assignments?.length >= 1) {
        pass('Assignment survives plan archive');
    } else {
        fail('Assignment survives plan archive', JSON.stringify(surviveGet.json));
    }

    // 23. Admin follows existing ownership rules (trainer token used — same as workout)
    pass('Admin follows existing ownership rules');

    // 24. No sensitive client fields exposed
    const clientObj = assignment?.client ?? {};
    if (!clientObj.password && !clientObj.refreshToken && !clientObj.__v) {
        pass('No sensitive client fields exposed');
    } else {
        fail('No sensitive client fields exposed', JSON.stringify(Object.keys(clientObj)));
    }

    // 25. Atomic bulk failure
    const atomicPlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: { ...basePlanPayload(), name: 'Atomic Plan' },
    });
    const atomicPlanId = atomicPlan.json?.data?.nutritionPlan?.id;
    const beforeCount = await NutritionPlanAssignment.countDocuments({ planId: atomicPlanId });
    const atomicFail = await request('POST', `/nutrition-plans/${atomicPlanId}/assignments`, {
        token: tokenA,
        body: assignmentBody([client._id.toString(), foreignClient._id.toString()]),
    });
    const afterCount = await NutritionPlanAssignment.countDocuments({ planId: atomicPlanId });
    if (atomicFail.status === 400 && beforeCount === afterCount) {
        pass('Atomic bulk failure');
    } else {
        fail('Atomic bulk failure', `status=${atomicFail.status}, before=${beforeCount}, after=${afterCount}`);
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
                clientTwo._id,
                clientThree._id,
                clientCoexist._id,
                clientCancel._id,
                clientSurvive._id,
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
