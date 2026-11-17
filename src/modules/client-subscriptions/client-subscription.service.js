import ClientSubscription from './client-subscription.model.js';
import { PACKAGE_DURATION_VALUES } from './client-subscription.constants.js';
import {
    buildSubscriptionEndDate,
    clearUserPackageSnapshotIfMatchesSubscription,
    isSubscriptionDateExpired,
    mapClientSubscriptionToPublic,
    syncUserPackageSnapshotFromSubscription,
    throwIfDuplicateActiveSubscription,
    utcMidnightToday,
} from './client-subscription.helpers.js';
import {
    assertClientActiveForNewActivity,
    loadClientForCoachMutation,
} from '../clients/client.access.js';
import { ApiError } from '../../utils/ApiError.js';

const ACTIVE_CONFLICT = () =>
    new ApiError(409, 'Client already has an active subscription', [
        {
            field: 'clientId',
            message: 'Client already has an active subscription',
            code: 'ACTIVE_SUBSCRIPTION_EXISTS',
        },
    ]);

/**
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @param {string|import('mongoose').Types.ObjectId} clientId
 */
const findActiveSubscription = (trainerId, clientId) =>
    ClientSubscription.findOne({
        trainerId,
        clientId,
        status: 'active',
    });

/**
 * Create a new active subscription for an owned client.
 *
 * @param {{ trainerId: string, clientId: string, packageDuration: string }} params
 * @returns {Promise<object>}
 */
const createSubscription = async ({ trainerId, clientId, packageDuration }) => {
    const client = await loadClientForCoachMutation(clientId, trainerId);
    assertClientActiveForNewActivity(client);

    if (!PACKAGE_DURATION_VALUES.includes(packageDuration)) {
        throw new ApiError(400, 'Invalid package duration', [
            {
                field: 'packageDuration',
                message:
                    'Package duration must be 1_month, 3_months, 6_months, 12_months, or ongoing',
            },
        ]);
    }

    const startDate = utcMidnightToday();
    const endDate = buildSubscriptionEndDate({ packageDuration, startDate });

    const existingActive = await findActiveSubscription(trainerId, clientId);

    if (existingActive) {
        if (isSubscriptionDateExpired(existingActive)) {
            existingActive.status = 'completed';
            await existingActive.save();
        } else {
            throw ACTIVE_CONFLICT();
        }
    }

    let created;
    try {
        created = await ClientSubscription.create({
            trainerId,
            clientId,
            packageDuration,
            startDate,
            endDate,
            status: 'active',
        });
    } catch (err) {
        throwIfDuplicateActiveSubscription(err);
        throw err;
    }

    try {
        await syncUserPackageSnapshotFromSubscription(clientId, created);
    } catch (err) {
        if (err instanceof ApiError) {
            throw err;
        }
        throw new ApiError(
            500,
            'Subscription created but failed to synchronize client package fields',
            [
                {
                    field: 'clientId',
                    message:
                        'Client package snapshot could not be updated after subscription create',
                    code: 'SUBSCRIPTION_SNAPSHOT_SYNC_FAILED',
                },
            ],
            err?.stack
        );
    }

    return mapClientSubscriptionToPublic(created);
};

/**
 * Active subscription for trainer/client (read-only; no status mutation).
 *
 * @param {{ trainerId: string, clientId: string }} params
 * @returns {Promise<object|null>}
 */
const getCurrentSubscription = async ({ trainerId, clientId }) => {
    await loadClientForCoachMutation(clientId, trainerId);

    const active = await findActiveSubscription(trainerId, clientId);
    if (!active) {
        return null;
    }

    return mapClientSubscriptionToPublic(active);
};

/**
 * Paginated subscription history (all statuses), newest first.
 *
 * @param {{ trainerId: string, clientId: string, page?: number, limit?: number }} params
 * @returns {Promise<{ subscriptions: object[], pagination: object }>}
 */
const getSubscriptionHistory = async ({
    trainerId,
    clientId,
    page = 1,
    limit = 10,
}) => {
    await loadClientForCoachMutation(clientId, trainerId);

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 10);
    const skip = (pageNum - 1) * limitNum;

    const filter = { trainerId, clientId };

    const [total, rows] = await Promise.all([
        ClientSubscription.countDocuments(filter),
        ClientSubscription.find(filter)
            .sort({ startDate: -1, createdAt: -1 })
            .skip(skip)
            .limit(limitNum),
    ]);

    return {
        subscriptions: rows.map((row) => mapClientSubscriptionToPublic(row)),
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum) || 0,
        },
    };
};

/**
 * Cancel the current (non-expired) active subscription, or complete if already expired.
 *
 * @param {{ trainerId: string, clientId: string }} params
 * @returns {Promise<object>}
 */
const cancelSubscription = async ({ trainerId, clientId }) => {
    const client = await loadClientForCoachMutation(clientId, trainerId);
    assertClientActiveForNewActivity(client);

    const active = await findActiveSubscription(trainerId, clientId);

    if (!active) {
        throw new ApiError(404, 'Active subscription not found', [
            {
                field: 'clientId',
                message: 'No active subscription to cancel',
                code: 'ACTIVE_SUBSCRIPTION_NOT_FOUND',
            },
        ]);
    }

    if (isSubscriptionDateExpired(active)) {
        active.status = 'completed';
        await active.save();
        await clearUserPackageSnapshotIfMatchesSubscription(clientId, active);
        return mapClientSubscriptionToPublic(active);
    }

    active.status = 'cancelled';
    await active.save();
    await clearUserPackageSnapshotIfMatchesSubscription(clientId, active);

    return mapClientSubscriptionToPublic(active);
};

export default {
    createSubscription,
    getCurrentSubscription,
    getSubscriptionHistory,
    cancelSubscription,
};
