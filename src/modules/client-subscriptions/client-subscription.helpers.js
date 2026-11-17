/**
 * ClientSubscription — pure helpers (DTO, dates, User snapshot sync).
 */

import User from '../users/user.model.js';
import { resolveCoachingPackageEndDate } from '../clients/client.package-dates.js';
import {
    resolveSubscriptionDaysUntilEnd,
    utcCalendarDayMs,
} from '../clients/client.subscription-attention.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * @param {import('mongoose').Document|object} doc
 * @returns {object}
 */
const toPlainObject = (doc) =>
    typeof doc?.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc ?? {};

/**
 * @param {import('mongoose').Types.ObjectId|string|undefined|null} id
 * @returns {string|null}
 */
const toIdString = (id) => (id != null ? id.toString?.() ?? String(id) : null);

/**
 * @param {Date|string|null|undefined} value
 * @returns {string|null}
 */
const toIso = (value) => {
    if (value == null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * UTC midnight for the calendar day of `now` (default: current instant).
 *
 * @param {Date} [now]
 * @returns {Date}
 */
export const utcMidnightToday = (now = new Date()) => {
    const parsed = now instanceof Date ? now : new Date(now);
    return new Date(
        Date.UTC(
            parsed.getUTCFullYear(),
            parsed.getUTCMonth(),
            parsed.getUTCDate()
        )
    );
};

/**
 * Allowlisted public subscription DTO.
 *
 * @param {import('mongoose').Document|object} doc
 * @returns {object|null}
 */
export const mapClientSubscriptionToPublic = (doc) => {
    if (!doc) {
        return null;
    }

    const plain = toPlainObject(doc);
    const id = toIdString(plain._id ?? plain.id);
    if (!id) {
        return null;
    }

    return {
        id,
        trainerId: toIdString(plain.trainerId),
        clientId: toIdString(plain.clientId),
        packageDuration: plain.packageDuration,
        startDate: toIso(plain.startDate),
        endDate: toIso(plain.endDate),
        status: plain.status,
        createdAt: toIso(plain.createdAt),
        updatedAt: toIso(plain.updatedAt),
    };
};

/**
 * Whether a subscription's inclusive end date is before UTC today.
 * `ongoing` (null end) is never date-expired.
 *
 * @param {object} subscription
 * @param {Date} [now]
 * @returns {boolean}
 */
export const isSubscriptionDateExpired = (subscription, now = new Date()) => {
    if (!subscription || subscription.packageDuration === 'ongoing') {
        return false;
    }

    const resolved = resolveSubscriptionDaysUntilEnd(
        {
            startDate: subscription.startDate,
            packageDuration: subscription.packageDuration,
            endDate: subscription.endDate,
        },
        now
    );

    if (!resolved) {
        return false;
    }

    return resolved.daysUntilEnd < 0;
};

/**
 * @param {{ packageDuration: string, startDate: Date|string }} fields
 * @returns {Date|null}
 */
export const buildSubscriptionEndDate = ({ packageDuration, startDate }) => {
    const resolved = resolveCoachingPackageEndDate({
        packageDuration,
        startDate,
    });
    if (resolved === undefined) {
        return null;
    }
    return resolved;
};

/**
 * Map Mongo duplicate-key races on the active unique index to domain 409.
 *
 * @param {unknown} err
 */
export const throwIfDuplicateActiveSubscription = (err) => {
    if (err?.code === 11000) {
        throw new ApiError(409, 'Client already has an active subscription', [
            {
                field: 'clientId',
                message: 'Client already has an active subscription',
                code: 'ACTIVE_SUBSCRIPTION_EXISTS',
            },
        ]);
    }
};

/**
 * Sync User package snapshot from an active subscription.
 * Only touches startDate / endDate / packageDuration.
 *
 * @param {string|import('mongoose').Types.ObjectId} clientId
 * @param {import('mongoose').Document|object} subscription
 */
export const syncUserPackageSnapshotFromSubscription = async (
    clientId,
    subscription
) => {
    const plain = toPlainObject(subscription);
    const result = await User.updateOne(
        { _id: clientId, role: 'client' },
        {
            $set: {
                startDate: plain.startDate,
                endDate: plain.endDate ?? null,
                packageDuration: plain.packageDuration,
            },
        }
    );

    if (result.matchedCount === 0) {
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
            ]
        );
    }
};

/**
 * Clear User package snapshot only when it still matches the given subscription
 * (avoids clearing a newer subscription's snapshot).
 *
 * @param {string|import('mongoose').Types.ObjectId} clientId
 * @param {import('mongoose').Document|object} subscription
 * @returns {Promise<{ cleared: boolean }>}
 */
export const clearUserPackageSnapshotIfMatchesSubscription = async (
    clientId,
    subscription
) => {
    const plain = toPlainObject(subscription);
    const startMs = utcCalendarDayMs(plain.startDate);

    const client = await User.findOne({ _id: clientId, role: 'client' }).select(
        'startDate endDate packageDuration'
    );

    if (!client) {
        throw new ApiError(
            500,
            'Subscription updated but failed to synchronize client package fields',
            [
                {
                    field: 'clientId',
                    message:
                        'Client package snapshot could not be cleared after subscription update',
                    code: 'SUBSCRIPTION_SNAPSHOT_SYNC_FAILED',
                },
            ]
        );
    }

    const sameDuration = client.packageDuration === plain.packageDuration;
    const sameStart =
        startMs != null && utcCalendarDayMs(client.startDate) === startMs;

    let sameEnd = false;
    if (plain.endDate == null) {
        sameEnd = client.endDate == null;
    } else {
        const subEnd = utcCalendarDayMs(plain.endDate);
        const userEnd = utcCalendarDayMs(client.endDate);
        sameEnd = subEnd != null && userEnd != null && subEnd === userEnd;
    }

    if (!sameDuration || !sameStart || !sameEnd) {
        return { cleared: false };
    }

    await User.updateOne(
        { _id: clientId, role: 'client' },
        {
            $set: {
                startDate: null,
                endDate: null,
                packageDuration: null,
            },
        }
    );

    return { cleared: true };
};

export { resolveCoachingPackageEndDate, utcCalendarDayMs };
