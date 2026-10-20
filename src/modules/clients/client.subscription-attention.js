import { resolveCoachingPackageEndDate } from './client.package-dates.js';

/**
 * Subscription-only Needs Attention for trainer client list (phase 1).
 *
 * Calendar-day policy: UTC date components (aligned with resolveCoachingPackageEndDate /
 * addCalendarMonthsUtc). Compare effective package end date to "today" in UTC, not local
 * timezone or raw timestamps.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const SUBSCRIPTION_NEEDS_ATTENTION_KINDS = Object.freeze({
    EXPIRED: 'subscription_expired',
    EXPIRES_TODAY: 'subscription_expires_today',
});

export const SUBSCRIPTION_NEEDS_ATTENTION_ACTIONS = Object.freeze({
    RENEW_OR_ARCHIVE: 'renew_or_archive',
    SEND_RENEWAL_REMINDER: 'send_renewal_reminder',
});

/** Expiry Soon card: calendar days after today through this many days (inclusive). */
export const EXPIRING_SOON_DAYS_MIN = 1;
export const EXPIRING_SOON_DAYS_MAX = 7;

export const SUBSCRIPTION_PACKAGE_BUCKETS = Object.freeze({
    EXPIRED: 'expired',
    EXPIRES_TODAY: 'expires_today',
    EXPIRING_SOON: 'expiring_soon',
});

/**
 * @param {Date|string|number} value
 * @returns {number|null} Ms at UTC midnight for that calendar day
 */
export const utcCalendarDayMs = (value) => {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate()
    );
};

/**
 * @param {object} client
 * @param {Date} [now]
 * @returns {{ daysUntilEnd: number, effectiveEnd: Date } | null}
 */
export const resolveSubscriptionDaysUntilEnd = (
    { startDate, packageDuration, endDate } = {},
    now = new Date()
) => {
    const effectiveEnd = resolveCoachingPackageEndDate({
        startDate,
        packageDuration,
        endDate,
    });

    if (effectiveEnd === undefined || effectiveEnd === null) {
        return null;
    }

    const endDay = utcCalendarDayMs(effectiveEnd);
    const todayDay = utcCalendarDayMs(now);
    if (endDay === null || todayDay === null) {
        return null;
    }

    const daysUntilEnd = Math.round((endDay - todayDay) / DAY_MS);
    const endDateValue =
        effectiveEnd instanceof Date ? effectiveEnd : new Date(effectiveEnd);

    return { daysUntilEnd, effectiveEnd: endDateValue };
};

/**
 * @param {object} client
 * @param {Date} [now]
 * @returns {{ bucket: string, daysUntilEnd: number, effectiveEnd: Date } | null}
 */
export const classifySubscriptionPackage = (client, now = new Date()) => {
    const resolved = resolveSubscriptionDaysUntilEnd(client, now);
    if (!resolved) {
        return null;
    }

    const { daysUntilEnd, effectiveEnd } = resolved;

    if (daysUntilEnd < 0) {
        return {
            bucket: SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRED,
            daysUntilEnd,
            effectiveEnd,
        };
    }
    if (daysUntilEnd === 0) {
        return {
            bucket: SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRES_TODAY,
            daysUntilEnd,
            effectiveEnd,
        };
    }
    if (
        daysUntilEnd >= EXPIRING_SOON_DAYS_MIN &&
        daysUntilEnd <= EXPIRING_SOON_DAYS_MAX
    ) {
        return {
            bucket: SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRING_SOON,
            daysUntilEnd,
            effectiveEnd,
        };
    }

    return null;
};

/**
 * @param {object} client
 * @param {Date|string|number} [client.startDate]
 * @param {string} [client.packageDuration]
 * @param {Date|string|null} [client.endDate]
 * @param {Date} [now]
 * @returns {{ kind: string, suggestedAction: string } | null}
 */
export const resolveSubscriptionNeedsAttention = (
    client = {},
    now = new Date()
) => {
    const classified = classifySubscriptionPackage(client, now);
    if (!classified) {
        return null;
    }

    if (classified.bucket === SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRED) {
        return {
            kind: SUBSCRIPTION_NEEDS_ATTENTION_KINDS.EXPIRED,
            suggestedAction: SUBSCRIPTION_NEEDS_ATTENTION_ACTIONS.RENEW_OR_ARCHIVE,
        };
    }

    if (classified.bucket === SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRES_TODAY) {
        return {
            kind: SUBSCRIPTION_NEEDS_ATTENTION_KINDS.EXPIRES_TODAY,
            suggestedAction: SUBSCRIPTION_NEEDS_ATTENTION_ACTIONS.SEND_RENEWAL_REMINDER,
        };
    }

    return null;
};
