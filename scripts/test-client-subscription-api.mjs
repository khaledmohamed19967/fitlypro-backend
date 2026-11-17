/**
 * Client Subscription HTTP API (Phase 4.2).
 * Run: node scripts/test-client-subscription-api.mjs
 *
 * Prerequisites:
 * - Dev server running (with latest code)
 * - APP_DB_URL
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js';
import PlanAssignment from '../src/modules/workout-plans/plan-assignment.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import NutritionPlanAssignment from '../src/modules/nutrition-plan-assignments/nutrition-plan-assignment.model.js';
import ClientSubscription from '../src/modules/client-subscriptions/client-subscription.model.js';
import clientSubscriptionService from '../src/modules/client-subscriptions/client-subscription.service.js';
import {
    addCalendarMonthsUtc,
} from '../src/modules/clients/client.package-dates.js';
import { utcMidnightToday } from '../src/modules/client-subscriptions/client-subscription.helpers.js';
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

const subPath = (clientId, suffix = '') =>
    `/clients/${clientId}/subscription${suffix}`;

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);
    await ClientSubscription.syncIndexes();

    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'SubApi',
        lastName: 'TrainerA',
        email: `cs-api-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const trainerB = await User.create({
        firstName: 'SubApi',
        lastName: 'TrainerB',
        email: `cs-api-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const client = await User.create({
        firstName: 'SubApi',
        lastName: 'Client',
        email: `cs-api-c-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
        isActive: true,
    });
    const clientEmpty = await User.create({
        firstName: 'SubApi',
        lastName: 'Empty',
        email: `cs-api-e-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });
    const foreign = await User.create({
        firstName: 'SubApi',
        lastName: 'Foreign',
        email: `cs-api-f-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerB._id,
    });
    const raceClient = await User.create({
        firstName: 'SubApi',
        lastName: 'Race',
        email: `cs-api-r-${suffix}@test.com`,
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
        body: { email: client.email, password },
    });

    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;
    const tokenClient = loginClient.json?.data?.token;

    if (!tokenA || !tokenB) {
        throw new Error(
            `Login failed: A=${loginA.status} B=${loginB.status} ${JSON.stringify(loginA.json)}`
        );
    }

    const clientId = String(client._id);
    const trainerId = String(trainerA._id);

    // --- Auth ---
    const unauth = await request('GET', subPath(clientId));
    if (unauth.status === 401) pass('Unauthenticated → 401');
    else fail('Unauthenticated → 401', `status ${unauth.status}`);

    if (tokenClient) {
        const asClient = await request('GET', subPath(clientId), {
            token: tokenClient,
        });
        if (asClient.status === 403) pass('Client role → 403');
        else fail('Client role → 403', `status ${asClient.status}`);
    } else {
        fail('Client role → 403', 'client login failed');
    }

    const cross = await request('GET', subPath(String(foreign._id)), {
        token: tokenA,
    });
    if (cross.status === 403) pass('Cross-trainer isolation → 403');
    else fail('Cross-trainer isolation → 403', `status ${cross.status}`);

    const badId = await request('GET', subPath('not-an-objectid'), {
        token: tokenA,
    });
    if (badId.status === 400) pass('Invalid client ObjectId → 400');
    else fail('Invalid client ObjectId → 400', `status ${badId.status}`);

    const missing = await request(
        'GET',
        subPath(new mongoose.Types.ObjectId().toString()),
        { token: tokenA }
    );
    if (missing.status === 404) pass('Client not found → 404');
    else fail('Client not found → 404', `status ${missing.status}`);

    // --- Current null ---
    const emptyCurrent = await request(
        'GET',
        subPath(String(clientEmpty._id)),
        { token: tokenA }
    );
    if (
        emptyCurrent.status === 200 &&
        emptyCurrent.json?.data?.subscription === null
    ) {
        pass('GET current → null when none');
    } else {
        fail('GET current → null when none', JSON.stringify(emptyCurrent.json));
    }

    // --- Create ---
    const forbiddenBody = await request('POST', subPath(clientId), {
        token: tokenA,
        body: {
            packageDuration: '3_months',
            trainerId: String(trainerB._id),
            status: 'completed',
            startDate: '2030-01-01',
            endDate: '2030-02-01',
        },
    });
    if (forbiddenBody.status === 400) {
        pass('Create rejects forbidden server-owned fields → 400');
    } else {
        fail(
            'Create rejects forbidden server-owned fields → 400',
            `status ${forbiddenBody.status} ${JSON.stringify(forbiddenBody.json)}`
        );
    }

    const invalidDuration = await request('POST', subPath(clientId), {
        token: tokenA,
        body: { packageDuration: '8_weeks' },
    });
    if (invalidDuration.status === 400) pass('Invalid packageDuration → 400');
    else fail('Invalid packageDuration → 400', `status ${invalidDuration.status}`);

    const missingDuration = await request('POST', subPath(clientId), {
        token: tokenA,
        body: {},
    });
    if (missingDuration.status === 400) pass('Missing packageDuration → 400');
    else fail('Missing packageDuration → 400', `status ${missingDuration.status}`);

    const created = await request('POST', subPath(clientId), {
        token: tokenA,
        body: { packageDuration: '3_months' },
    });
    const expectedStart = utcMidnightToday().toISOString();
    const expectedEnd = addCalendarMonthsUtc(expectedStart, 3).toISOString();
    if (
        created.status === 201 &&
        created.json?.data?.subscription?.status === 'active' &&
        created.json.data.subscription.packageDuration === '3_months' &&
        created.json.data.subscription.startDate === expectedStart &&
        created.json.data.subscription.endDate === expectedEnd
    ) {
        pass('POST create → 201 with public DTO');
    } else {
        fail('POST create → 201 with public DTO', JSON.stringify(created.json));
    }

    const userAfterCreate = await User.findById(clientId).lean();
    if (
        userAfterCreate?.packageDuration === '3_months' &&
        new Date(userAfterCreate.startDate).toISOString() === expectedStart &&
        new Date(userAfterCreate.endDate).toISOString() === expectedEnd
    ) {
        pass('Create synchronizes User snapshot');
    } else {
        fail('Create synchronizes User snapshot', JSON.stringify(userAfterCreate));
    }

    const current = await request('GET', subPath(clientId), { token: tokenA });
    if (
        current.status === 200 &&
        current.json?.data?.subscription?.id ===
            created.json.data.subscription.id
    ) {
        pass('GET current returns active subscription');
    } else {
        fail('GET current returns active subscription', JSON.stringify(current.json));
    }

    const conflict = await request('POST', subPath(clientId), {
        token: tokenA,
        body: { packageDuration: '1_month' },
    });
    if (
        conflict.status === 409 &&
        conflict.json?.errors?.some?.(
            (e) => e.code === 'ACTIVE_SUBSCRIPTION_EXISTS'
        )
    ) {
        pass('Existing active → 409 ACTIVE_SUBSCRIPTION_EXISTS');
    } else {
        fail(
            'Existing active → 409 ACTIVE_SUBSCRIPTION_EXISTS',
            JSON.stringify(conflict.json)
        );
    }

    // Seed history statuses
    await ClientSubscription.create({
        trainerId: trainerA._id,
        clientId: client._id,
        packageDuration: '1_month',
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-02-01T00:00:00.000Z'),
        status: 'completed',
    });
    await ClientSubscription.create({
        trainerId: trainerA._id,
        clientId: client._id,
        packageDuration: '1_month',
        startDate: new Date('2024-03-01T00:00:00.000Z'),
        endDate: new Date('2024-04-01T00:00:00.000Z'),
        status: 'cancelled',
    });

    const history = await request('GET', `${subPath(clientId)}/history?page=1&limit=50`, {
        token: tokenA,
    });
    const statuses = new Set(
        (history.json?.data?.subscriptions || []).map((s) => s.status)
    );
    const ordered = (history.json?.data?.subscriptions || []).every((row, i, arr) => {
        if (i === 0) return true;
        return (
            new Date(arr[i - 1].startDate).getTime() >=
            new Date(row.startDate).getTime()
        );
    });
    if (
        history.status === 200 &&
        statuses.has('active') &&
        statuses.has('completed') &&
        statuses.has('cancelled') &&
        ordered &&
        history.json.data.pagination?.total >= 3
    ) {
        pass('GET history includes all statuses, newest-first');
    } else {
        fail(
            'GET history includes all statuses, newest-first',
            JSON.stringify(history.json)
        );
    }

    const page1 = await request(
        'GET',
        `${subPath(clientId)}/history?page=1&limit=2`,
        { token: tokenA }
    );
    if (
        page1.status === 200 &&
        page1.json?.data?.subscriptions?.length === 2 &&
        page1.json.data.pagination.page === 1 &&
        page1.json.data.pagination.limit === 2 &&
        page1.json.data.pagination.pages >= 2
    ) {
        pass('GET history pagination metadata');
    } else {
        fail('GET history pagination metadata', JSON.stringify(page1.json));
    }

    // Assignments must survive cancel
    const workoutPlan = await WorkoutPlan.create({
        name: 'SubApi Workout',
        trainerId: trainerA._id,
        ownership: { type: 'trainer', trainerId: trainerA._id },
        status: 'active',
        isTemplate: false,
        duration: 4,
        daysPerWeek: 3,
        goal: 'strength',
        level: 'beginner',
        workoutDays: [],
    });
    const nutritionPlan = await NutritionPlan.create({
        name: 'SubApi Nutrition',
        trainerId: trainerA._id,
        ownership: { type: 'trainer', trainerId: trainerA._id },
        status: 'active',
        isTemplate: false,
        duration: 4,
        daysCount: 7,
        scheduleMode: 'weekly',
        goal: 'maintenance',
        macroTargets: { calories: 2000, protein: 120, carbs: 200, fat: 60 },
        nutritionDays: [],
    });
    const wa = await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: workoutPlan._id,
        clientId: client._id,
        startDate: utcMidnightToday(),
        status: 'active',
        completedSessions: 0,
        totalSessions: 0,
    });
    const na = await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: nutritionPlan._id,
        clientId: client._id,
        startDate: utcMidnightToday(),
        status: 'active',
    });

    const cancelled = await request('POST', `${subPath(clientId)}/cancel`, {
        token: tokenA,
    });
    const userAfterCancel = await User.findById(clientId);
    const waAfter = await PlanAssignment.findById(wa._id);
    const naAfter = await NutritionPlanAssignment.findById(na._id);

    if (
        cancelled.status === 200 &&
        cancelled.json?.data?.subscription?.status === 'cancelled'
    ) {
        pass('POST cancel → 200 cancelled');
    } else {
        fail('POST cancel → 200 cancelled', JSON.stringify(cancelled.json));
    }

    if (
        userAfterCancel.packageDuration == null &&
        userAfterCancel.startDate == null &&
        userAfterCancel.endDate == null
    ) {
        pass('Cancel clears matching User snapshot');
    } else {
        fail('Cancel clears matching User snapshot', JSON.stringify({
            packageDuration: userAfterCancel.packageDuration,
            startDate: userAfterCancel.startDate,
            endDate: userAfterCancel.endDate,
        }));
    }

    if (userAfterCancel.isActive === true) {
        pass('Cancel preserves User.isActive');
    } else {
        fail('Cancel preserves User.isActive', String(userAfterCancel.isActive));
    }

    if (waAfter?.status === 'active' && naAfter?.status === 'active') {
        pass('Cancel leaves workout/nutrition assignments unchanged');
    } else {
        fail(
            'Cancel leaves workout/nutrition assignments unchanged',
            `w=${waAfter?.status} n=${naAfter?.status}`
        );
    }

    const cancelNone = await request('POST', `${subPath(clientId)}/cancel`, {
        token: tokenA,
    });
    if (cancelNone.status === 404) pass('Cancel with no active → 404');
    else fail('Cancel with no active → 404', `status ${cancelNone.status}`);

    // --- Concurrency (service-level, required) ---
    const raceId = String(raceClient._id);
    const today = utcMidnightToday();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    await ClientSubscription.create({
        trainerId: trainerA._id,
        clientId: raceClient._id,
        packageDuration: '1_month',
        startDate: addCalendarMonthsUtc(yesterday, -1),
        endDate: yesterday,
        status: 'active',
    });

    const concurrent = await Promise.allSettled([
        clientSubscriptionService.createSubscription({
            trainerId,
            clientId: raceId,
            packageDuration: '1_month',
        }),
        clientSubscriptionService.createSubscription({
            trainerId,
            clientId: raceId,
            packageDuration: '6_months',
        }),
    ]);

    const fulfilled = concurrent.filter((r) => r.status === 'fulfilled');
    const rejected = concurrent.filter((r) => r.status === 'rejected');
    const activeCount = await ClientSubscription.countDocuments({
        trainerId: trainerA._id,
        clientId: raceClient._id,
        status: 'active',
    });
    const winner = fulfilled[0]?.value;
    const loserErr = rejected[0]?.reason;
    const raceUser = await User.findById(raceClient._id).lean();

    const loserIs409 =
        loserErr instanceof ApiError &&
        loserErr.statusCode === 409 &&
        loserErr.errors?.some?.((e) => e.code === 'ACTIVE_SUBSCRIPTION_EXISTS');

    const snapshotMatchesWinner =
        winner &&
        raceUser?.packageDuration === winner.packageDuration &&
        new Date(raceUser.startDate).toISOString() === winner.startDate &&
        (winner.endDate == null
            ? raceUser.endDate == null
            : new Date(raceUser.endDate).toISOString() === winner.endDate);

    if (
        fulfilled.length === 1 &&
        rejected.length === 1 &&
        activeCount === 1 &&
        loserIs409 &&
        snapshotMatchesWinner
    ) {
        pass(
            'Concurrency: one active, loser 409, snapshot matches winner'
        );
    } else {
        fail(
            'Concurrency: one active, loser 409, snapshot matches winner',
            JSON.stringify({
                fulfilled: fulfilled.length,
                rejected: rejected.length,
                activeCount,
                loserStatus: loserErr?.statusCode,
                loserCodes: loserErr?.errors,
                snapshot: {
                    packageDuration: raceUser?.packageDuration,
                    startDate: raceUser?.startDate,
                    endDate: raceUser?.endDate,
                },
                winner,
            })
        );
    }

    // Optional HTTP smoke: parallel create on empty client after ensuring no active
    await ClientSubscription.updateMany(
        { clientId: raceClient._id, status: 'active' },
        { $set: { status: 'completed' } }
    );
    await User.updateOne(
        { _id: raceClient._id },
        { $set: { startDate: null, endDate: null, packageDuration: null } }
    );

    const httpRace = await Promise.all([
        request('POST', subPath(raceId), {
            token: tokenA,
            body: { packageDuration: '1_month' },
        }),
        request('POST', subPath(raceId), {
            token: tokenA,
            body: { packageDuration: '12_months' },
        }),
    ]);
    const httpWins = httpRace.filter((r) => r.status === 201);
    const httpLose = httpRace.filter((r) => r.status === 409);
    const httpActive = await ClientSubscription.countDocuments({
        clientId: raceClient._id,
        status: 'active',
    });
    if (httpWins.length === 1 && httpLose.length === 1 && httpActive === 1) {
        pass('HTTP concurrency smoke: one 201, one 409, one active');
    } else {
        fail(
            'HTTP concurrency smoke: one 201, one 409, one active',
            JSON.stringify({
                statuses: httpRace.map((r) => r.status),
                httpActive,
            })
        );
    }

    // Cleanup
    await PlanAssignment.deleteMany({ _id: wa._id });
    await NutritionPlanAssignment.deleteMany({ _id: na._id });
    await WorkoutPlan.deleteMany({ _id: workoutPlan._id });
    await NutritionPlan.deleteMany({ _id: nutritionPlan._id });
    await ClientSubscription.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await User.deleteMany({
        _id: {
            $in: [
                trainerA._id,
                trainerB._id,
                client._id,
                clientEmpty._id,
                foreign._id,
                raceClient._id,
            ],
        },
    });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(
        `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
    );
    process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
