/**
 * ClientSubscription service layer (Phase 3.2).
 * Run: node scripts/test-client-subscription-service.mjs
 * Requires: APP_DB_URL
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import PlanAssignment from '../src/modules/workout-plans/plan-assignment.model.js';
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import NutritionPlanAssignment from '../src/modules/nutrition-plan-assignments/nutrition-plan-assignment.model.js';
import ClientSubscription from '../src/modules/client-subscriptions/client-subscription.model.js';
import clientSubscriptionService from '../src/modules/client-subscriptions/client-subscription.service.js';
import {
    addCalendarMonthsUtc,
    PACKAGE_DURATION_VALUES,
} from '../src/modules/clients/client.package-dates.js';
import {
    throwIfDuplicateActiveSubscription,
    utcMidnightToday,
    clearUserPackageSnapshotIfMatchesSubscription,
} from '../src/modules/client-subscriptions/client-subscription.helpers.js';
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

const expectApiError = async (name, fn, statusCode) => {
    try {
        await fn();
        fail(name, 'expected ApiError');
    } catch (err) {
        if (err instanceof ApiError && err.statusCode === statusCode) {
            pass(name);
        } else {
            fail(name, `${err?.statusCode ?? err?.name}: ${err?.message}`);
        }
    }
};

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);
    await ClientSubscription.syncIndexes();

    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'SubSvc',
        lastName: 'TrainerA',
        email: `cs-svc-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const trainerB = await User.create({
        firstName: 'SubSvc',
        lastName: 'TrainerB',
        email: `cs-svc-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const client = await User.create({
        firstName: 'SubSvc',
        lastName: 'Client',
        email: `cs-svc-c-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
        isActive: true,
    });
    const clientOther = await User.create({
        firstName: 'SubSvc',
        lastName: 'Other',
        email: `cs-svc-o-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerB._id,
        isActive: true,
    });
    const clientInactive = await User.create({
        firstName: 'SubSvc',
        lastName: 'Inactive',
        email: `cs-svc-i-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
        isActive: false,
    });

    const trainerId = String(trainerA._id);
    const clientId = String(client._id);

    // --- Create: first subscription ---
    const first = await clientSubscriptionService.createSubscription({
        trainerId,
        clientId,
        packageDuration: '3_months',
    });
    const expectedStart = utcMidnightToday().toISOString();
    const expectedEnd = addCalendarMonthsUtc(expectedStart, 3).toISOString();

    if (
        first?.status === 'active' &&
        first.packageDuration === '3_months' &&
        first.startDate === expectedStart &&
        first.endDate === expectedEnd
    ) {
        pass('Create: first subscription + UTC midnight start + 3_months end');
    } else {
        fail('Create: first subscription + UTC midnight start + 3_months end', JSON.stringify(first));
    }

    const refreshed = await User.findById(clientId).lean();
    if (
        refreshed?.packageDuration === '3_months' &&
        new Date(refreshed.startDate).toISOString() === expectedStart &&
        new Date(refreshed.endDate).toISOString() === expectedEnd
    ) {
        pass('Create: User snapshot synchronized');
    } else {
        fail('Create: User snapshot synchronized', JSON.stringify({
            packageDuration: refreshed?.packageDuration,
            startDate: refreshed?.startDate,
            endDate: refreshed?.endDate,
        }));
    }

    await expectApiError(
        'Create: reject current active subscription',
        () =>
            clientSubscriptionService.createSubscription({
                trainerId,
                clientId,
                packageDuration: '1_month',
            }),
        409
    );

    // Cancel first to free active slot for duration matrix
    await clientSubscriptionService.cancelSubscription({ trainerId, clientId });

    for (const duration of PACKAGE_DURATION_VALUES) {
        const created = await clientSubscriptionService.createSubscription({
            trainerId,
            clientId,
            packageDuration: duration,
        });
        const ok =
            duration === 'ongoing'
                ? created.endDate === null && created.packageDuration === 'ongoing'
                : created.endDate ===
                  addCalendarMonthsUtc(
                      created.startDate,
                      { '1_month': 1, '3_months': 3, '6_months': 6, '12_months': 12 }[
                          duration
                      ]
                  ).toISOString();
        if (created.status === 'active' && ok) {
            pass(`Create: packageDuration=${duration}`);
        } else {
            fail(`Create: packageDuration=${duration}`, JSON.stringify(created));
        }
        await clientSubscriptionService.cancelSubscription({ trainerId, clientId });
    }

    // End date today → still current (409)
    const todayStart = utcMidnightToday();
    await ClientSubscription.create({
        trainerId: trainerA._id,
        clientId: client._id,
        packageDuration: '1_month',
        startDate: addCalendarMonthsUtc(todayStart, -1),
        endDate: todayStart,
        status: 'active',
    });
    await User.updateOne(
        { _id: client._id },
        {
            $set: {
                startDate: addCalendarMonthsUtc(todayStart, -1),
                endDate: todayStart,
                packageDuration: '1_month',
            },
        }
    );
    await expectApiError(
        'Create: end date today is still current (409)',
        () =>
            clientSubscriptionService.createSubscription({
                trainerId,
                clientId,
                packageDuration: '1_month',
            }),
        409
    );
    await ClientSubscription.updateMany(
        { clientId: client._id, status: 'active' },
        { $set: { status: 'cancelled' } }
    );

    // End date yesterday → complete then create
    const yesterday = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const expiredActive = await ClientSubscription.create({
        trainerId: trainerA._id,
        clientId: client._id,
        packageDuration: '1_month',
        startDate: addCalendarMonthsUtc(yesterday, -1),
        endDate: yesterday,
        status: 'active',
    });
    const afterExpired = await clientSubscriptionService.createSubscription({
        trainerId,
        clientId,
        packageDuration: '6_months',
    });
    const expiredReloaded = await ClientSubscription.findById(expiredActive._id);
    if (
        expiredReloaded?.status === 'completed' &&
        afterExpired?.status === 'active' &&
        afterExpired.packageDuration === '6_months'
    ) {
        pass('Create: expired active completed before new subscription');
    } else {
        fail(
            'Create: expired active completed before new subscription',
            JSON.stringify({ expired: expiredReloaded?.status, afterExpired })
        );
    }

    // E11000 → 409
    try {
        throwIfDuplicateActiveSubscription({ code: 11000 });
        fail('Duplicate-key E11000 maps to 409', 'no throw');
    } catch (err) {
        if (err instanceof ApiError && err.statusCode === 409) {
            pass('Duplicate-key E11000 maps to 409');
        } else {
            fail('Duplicate-key E11000 maps to 409', err.message);
        }
    }

    // Snapshot sync failure leaves subscription
    await clientSubscriptionService.cancelSubscription({ trainerId, clientId });
    const originalUpdate = User.updateOne.bind(User);
    let syncFailCreatedId = null;
    User.updateOne = async (...args) => {
        const filter = args[0];
        if (filter?.role === 'client' && args[1]?.$set?.packageDuration) {
            return { matchedCount: 0, modifiedCount: 0 };
        }
        return originalUpdate(...args);
    };
    try {
        await clientSubscriptionService.createSubscription({
            trainerId,
            clientId,
            packageDuration: '1_month',
        });
        fail('Snapshot sync failure is reported', 'expected error');
    } catch (err) {
        const orphan = await ClientSubscription.findOne({
            clientId: client._id,
            status: 'active',
            packageDuration: '1_month',
        }).sort({ createdAt: -1 });
        syncFailCreatedId = orphan?._id;
        if (
            err instanceof ApiError &&
            err.statusCode === 500 &&
            orphan &&
            orphan.status === 'active'
        ) {
            pass('Snapshot sync failure reported; subscription not deleted');
        } else {
            fail(
                'Snapshot sync failure reported; subscription not deleted',
                `${err?.statusCode} orphan=${Boolean(orphan)}`
            );
        }
    } finally {
        User.updateOne = originalUpdate;
    }
    if (syncFailCreatedId) {
        await ClientSubscription.updateOne(
            { _id: syncFailCreatedId },
            { $set: { status: 'cancelled' } }
        );
    }

    // --- Current ---
    const currentCreated = await clientSubscriptionService.createSubscription({
        trainerId,
        clientId,
        packageDuration: '12_months',
    });
    const current = await clientSubscriptionService.getCurrentSubscription({
        trainerId,
        clientId,
    });
    if (current?.id === currentCreated.id && current?.status === 'active') {
        pass('Current: returns active subscription');
    } else {
        fail('Current: returns active subscription', JSON.stringify(current));
    }

    const noneB = await clientSubscriptionService.getCurrentSubscription({
        trainerId: String(trainerB._id),
        clientId: String(clientOther._id),
    });
    if (noneB === null) {
        pass('Current: null when no active subscription');
    } else {
        fail('Current: null when no active subscription', JSON.stringify(noneB));
    }

    // GET must not mutate expired active
    await ClientSubscription.updateOne(
        { _id: currentCreated.id },
        {
            $set: {
                status: 'cancelled',
            },
        }
    );
    const expiredForGet = await ClientSubscription.create({
        trainerId: trainerA._id,
        clientId: client._id,
        packageDuration: '1_month',
        startDate: addCalendarMonthsUtc(yesterday, -1),
        endDate: yesterday,
        status: 'active',
    });
    const userBeforeGet = await User.findById(clientId)
        .select('startDate endDate packageDuration')
        .lean();
    const gotExpired = await clientSubscriptionService.getCurrentSubscription({
        trainerId,
        clientId,
    });
    const expiredAfterGet = await ClientSubscription.findById(expiredForGet._id);
    const userAfterGet = await User.findById(clientId)
        .select('startDate endDate packageDuration')
        .lean();
    if (
        gotExpired?.id === String(expiredForGet._id) &&
        expiredAfterGet?.status === 'active' &&
        String(userBeforeGet?.packageDuration) === String(userAfterGet?.packageDuration)
    ) {
        pass('Current: GET does not mutate expired record or User snapshot');
    } else {
        fail(
            'Current: GET does not mutate expired record or User snapshot',
            JSON.stringify({ gotExpired, status: expiredAfterGet?.status })
        );
    }

    // --- History ---
    await ClientSubscription.create({
        trainerId: trainerA._id,
        clientId: client._id,
        packageDuration: '3_months',
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-04-01T00:00:00.000Z'),
        status: 'completed',
    });
    await ClientSubscription.create({
        trainerId: trainerA._id,
        clientId: client._id,
        packageDuration: '1_month',
        startDate: new Date('2024-05-01T00:00:00.000Z'),
        endDate: new Date('2024-06-01T00:00:00.000Z'),
        status: 'cancelled',
    });

    const history = await clientSubscriptionService.getSubscriptionHistory({
        trainerId,
        clientId,
        page: 1,
        limit: 50,
    });
    const statuses = new Set(history.subscriptions.map((s) => s.status));
    const sorted = history.subscriptions.every((row, i, arr) => {
        if (i === 0) return true;
        const prev = new Date(arr[i - 1].startDate).getTime();
        const cur = new Date(row.startDate).getTime();
        return prev >= cur;
    });
    if (
        statuses.has('active') &&
        statuses.has('completed') &&
        statuses.has('cancelled') &&
        sorted &&
        history.pagination.total >= 3
    ) {
        pass('History: includes all statuses, newest-first, pagination');
    } else {
        fail(
            'History: includes all statuses, newest-first, pagination',
            JSON.stringify({ statuses: [...statuses], sorted, pagination: history.pagination })
        );
    }

    const page1 = await clientSubscriptionService.getSubscriptionHistory({
        trainerId,
        clientId,
        page: 1,
        limit: 2,
    });
    if (
        page1.subscriptions.length === 2 &&
        page1.pagination.page === 1 &&
        page1.pagination.limit === 2 &&
        page1.pagination.total >= 3 &&
        page1.pagination.pages >= 2
    ) {
        pass('History: pagination metadata');
    } else {
        fail('History: pagination metadata', JSON.stringify(page1.pagination));
    }

    await expectApiError(
        'Security: trainer cannot access another trainer client',
        () =>
            clientSubscriptionService.getCurrentSubscription({
                trainerId,
                clientId: String(clientOther._id),
            }),
        403
    );

    await expectApiError(
        'Security: deactivated client cannot create subscription',
        () =>
            clientSubscriptionService.createSubscription({
                trainerId,
                clientId: String(clientInactive._id),
                packageDuration: '1_month',
            }),
        403
    );

    // --- Cancel ---
    // Ensure one current active (complete the expired active first via create)
    await clientSubscriptionService.createSubscription({
        trainerId,
        clientId,
        packageDuration: '1_month',
    });

    const workoutPlan = await WorkoutPlan.create({
        name: 'SubSvc Workout',
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
        name: 'SubSvc Nutrition',
        trainerId: trainerA._id,
        ownership: { type: 'trainer', trainerId: trainerA._id },
        status: 'active',
        isTemplate: false,
        duration: 4,
        nutritionDays: [],
        goal: 'maintenance',
        daysCount: 7,
        scheduleMode: 'weekly',
        macroTargets: { calories: 2000, protein: 120, carbs: 200, fat: 60 },
    });
    const wa = await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: workoutPlan._id,
        clientId: client._id,
        startDate: todayStart,
        status: 'active',
        completedSessions: 0,
        totalSessions: 0,
    });
    const na = await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: nutritionPlan._id,
        clientId: client._id,
        startDate: todayStart,
        status: 'active',
    });

    const cancelled = await clientSubscriptionService.cancelSubscription({
        trainerId,
        clientId,
    });
    const userAfterCancel = await User.findById(clientId);
    const waAfter = await PlanAssignment.findById(wa._id);
    const naAfter = await NutritionPlanAssignment.findById(na._id);

    if (cancelled?.status === 'cancelled') {
        pass('Cancel: current subscription cancelled');
    } else {
        fail('Cancel: current subscription cancelled', JSON.stringify(cancelled));
    }

    if (
        userAfterCancel.packageDuration == null &&
        userAfterCancel.startDate == null &&
        userAfterCancel.endDate == null
    ) {
        pass('Cancel: User snapshot cleared');
    } else {
        fail(
            'Cancel: User snapshot cleared',
            JSON.stringify({
                packageDuration: userAfterCancel.packageDuration,
                startDate: userAfterCancel.startDate,
                endDate: userAfterCancel.endDate,
            })
        );
    }

    if (userAfterCancel.isActive === true) {
        pass('Cancel: User.isActive preserved');
    } else {
        fail('Cancel: User.isActive preserved', String(userAfterCancel.isActive));
    }

    if (waAfter?.status === 'active' && naAfter?.status === 'active') {
        pass('Cancel: workout/nutrition assignments unchanged');
    } else {
        fail(
            'Cancel: workout/nutrition assignments unchanged',
            `w=${waAfter?.status} n=${naAfter?.status}`
        );
    }

    await expectApiError(
        'Cancel: no active → 404',
        () => clientSubscriptionService.cancelSubscription({ trainerId, clientId }),
        404
    );

    // Expired active → completed not cancelled
    const expiredToComplete = await ClientSubscription.create({
        trainerId: trainerA._id,
        clientId: client._id,
        packageDuration: '1_month',
        startDate: addCalendarMonthsUtc(yesterday, -1),
        endDate: yesterday,
        status: 'active',
    });
    await User.updateOne(
        { _id: client._id },
        {
            $set: {
                startDate: expiredToComplete.startDate,
                endDate: expiredToComplete.endDate,
                packageDuration: '1_month',
            },
        }
    );
    const completedViaCancel = await clientSubscriptionService.cancelSubscription({
        trainerId,
        clientId,
    });
    if (completedViaCancel?.status === 'completed') {
        pass('Cancel: expired active becomes completed, not cancelled');
    } else {
        fail(
            'Cancel: expired active becomes completed, not cancelled',
            JSON.stringify(completedViaCancel)
        );
    }

    // Do not clear snapshot belonging to newer subscription
    const older = await ClientSubscription.create({
        trainerId: trainerA._id,
        clientId: client._id,
        packageDuration: '3_months',
        startDate: new Date('2025-01-01T00:00:00.000Z'),
        endDate: new Date('2025-04-01T00:00:00.000Z'),
        status: 'cancelled',
    });
    const newer = await clientSubscriptionService.createSubscription({
        trainerId,
        clientId,
        packageDuration: '6_months',
    });
    const clearResult = await clearUserPackageSnapshotIfMatchesSubscription(
        clientId,
        older
    );
    const userAfterGuard = await User.findById(clientId).lean();
    if (
        clearResult.cleared === false &&
        userAfterGuard?.packageDuration === '6_months' &&
        newer.packageDuration === '6_months'
    ) {
        pass('Cancel helper: does not clear snapshot belonging to newer subscription');
    } else {
        fail(
            'Cancel helper: does not clear snapshot belonging to newer subscription',
            JSON.stringify({ clearResult, userAfterGuard })
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
                clientOther._id,
                clientInactive._id,
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
