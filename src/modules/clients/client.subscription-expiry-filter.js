import {
    EXPIRING_SOON_DAYS_MAX,
    SUBSCRIPTION_PACKAGE_BUCKETS,
    classifySubscriptionPackage,
    isEffectiveEndInRecentlyExpiredWindow,
    resolveSubscriptionDaysUntilEnd,
} from './client.subscription-attention.js';

/**
 * GET /clients `subscriptionExpiry` values (omit param for all).
 * UTC calendar-day categories. `expired` and `recently_expired` intentionally overlap.
 */
export const SUBSCRIPTION_EXPIRY_FILTER_VALUES = Object.freeze([
    'expiring_soon',
    'expires_today',
    'recently_expired',
    'expired',
    'active',
]);

export const SUBSCRIPTION_EXPIRY_FILTERS = new Set(SUBSCRIPTION_EXPIRY_FILTER_VALUES);

/**
 * @param {unknown} value
 * @returns {value is typeof SUBSCRIPTION_EXPIRY_FILTER_VALUES[number]}
 */
export function isSubscriptionExpiryFilter(value) {
    return typeof value === 'string' && SUBSCRIPTION_EXPIRY_FILTERS.has(value);
}

/**
 * @param {object} client — startDate / packageDuration / endDate
 * @param {string} filter — one of SUBSCRIPTION_EXPIRY_FILTER_VALUES
 * @param {Date} [now]
 */
export function matchesSubscriptionExpiryFilter(client, filter, now = new Date()) {
    if (!isSubscriptionExpiryFilter(filter)) {
        return true;
    }

    if (filter === 'active') {
        if (client?.packageDuration === 'ongoing') {
            return true;
        }
        const resolved = resolveSubscriptionDaysUntilEnd(client, now);
        return (
            resolved !== null &&
            resolved.daysUntilEnd > EXPIRING_SOON_DAYS_MAX
        );
    }

    if (filter === 'expiring_soon') {
        const classified = classifySubscriptionPackage(client, now);
        return classified?.bucket === SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRING_SOON;
    }

    if (filter === 'expires_today') {
        const classified = classifySubscriptionPackage(client, now);
        return classified?.bucket === SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRES_TODAY;
    }

    if (filter === 'recently_expired') {
        const resolved = resolveSubscriptionDaysUntilEnd(client, now);
        if (!resolved) {
            return false;
        }
        return isEffectiveEndInRecentlyExpiredWindow(resolved.effectiveEnd, now);
    }

    if (filter === 'expired') {
        const classified = classifySubscriptionPackage(client, now);
        return classified?.bucket === SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRED;
    }

    return true;
}

/**
 * @param {Array<object>} clients — User docs or lean objects with package fields
 * @param {string|undefined} filter
 * @param {Date} [now]
 */
export function filterClientsBySubscriptionExpiry(clients, filter, now = new Date()) {
    if (!isSubscriptionExpiryFilter(filter)) {
        return clients;
    }
    return clients.filter((client) =>
        matchesSubscriptionExpiryFilter(
            {
                startDate: client.startDate,
                packageDuration: client.packageDuration,
                endDate: client.endDate,
            },
            filter,
            now
        )
    );
}
