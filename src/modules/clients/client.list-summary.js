import User from '../users/user.model.js';
import {
    SUBSCRIPTION_PACKAGE_BUCKETS,
    classifySubscriptionPackage,
    resolveSubscriptionDaysUntilEnd,
    resolveSubscriptionNeedsAttention,
    utcCalendarDayMs,
} from './client.subscription-attention.js';

export const SUMMARY_PREVIEW_LIMIT = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Completed UTC calendar days before today: yesterday through 7 days ago (inclusive). */
export const RECENTLY_EXPIRED_WINDOW_DAYS = 7;

/**
 * @param {Date|string|number} effectiveEnd
 * @param {Date} [now]
 */
export function isEffectiveEndInRecentlyExpiredWindow(effectiveEnd, now = new Date()) {
    const endDay = utcCalendarDayMs(effectiveEnd);
    const todayDay = utcCalendarDayMs(now);
    if (endDay === null || todayDay === null) {
        return false;
    }

    const windowStartDay = todayDay - RECENTLY_EXPIRED_WINDOW_DAYS * DAY_MS;
    const windowEndDay = todayDay - DAY_MS;

    return endDay >= windowStartDay && endDay <= windowEndDay;
}

const SUMMARY_CLIENT_SELECT =
    '_id firstName lastName startDate packageDuration endDate';

/**
 * @param {import('mongoose').LeanDocument|object} client
 */
export const mapClientSummaryItem = (client, extra = {}) => {
    const id = String(client._id ?? client.id);
    const name = [client.firstName, client.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();

    const payload = {
        id,
        name,
        avatar: null,
        ...extra,
    };

    return payload;
};

/**
 * @param {Array<{ id: string, sortEndMs: number }>} entries
 */
export function sortSummaryEntries(entries) {
    return [...entries].sort((a, b) => {
        if (a.sortEndMs !== b.sortEndMs) {
            return a.sortEndMs - b.sortEndMs;
        }
        return a.id.localeCompare(b.id);
    });
}

export function buildSummarySection(entries, previewLimit = SUMMARY_PREVIEW_LIMIT) {
    const sorted = sortSummaryEntries(entries);
    return {
        count: sorted.length,
        clients: sorted.slice(0, previewLimit).map((entry) => entry.item),
    };
}

/**
 * @param {Array<object>} roster — lean User client docs in list scope
 * @param {Date} [now]
 */
export function summarizeClientRoster(roster, now = new Date()) {
    const needAttentionEntries = [];
    const expiringSoonEntries = [];
    const expiresTodayEntries = [];
    const recentlyExpiredEntries = [];

    for (const client of roster) {
        const packageFields = {
            startDate: client.startDate,
            packageDuration: client.packageDuration,
            endDate: client.endDate,
        };

        const resolvedEnd = resolveSubscriptionDaysUntilEnd(packageFields, now);
        if (
            resolvedEnd &&
            isEffectiveEndInRecentlyExpiredWindow(resolvedEnd.effectiveEnd, now)
        ) {
            const id = String(client._id);
            const sortEndMs = utcCalendarDayMs(resolvedEnd.effectiveEnd) ?? 0;
            const endDate =
                resolvedEnd.effectiveEnd instanceof Date
                    ? resolvedEnd.effectiveEnd.toISOString()
                    : new Date(resolvedEnd.effectiveEnd).toISOString();

            recentlyExpiredEntries.push({
                id,
                sortEndMs,
                item: mapClientSummaryItem(client, { endDate }),
            });
        }

        const classified = classifySubscriptionPackage(packageFields, now);
        if (!classified) {
            continue;
        }

        const id = String(client._id);
        const sortEndMs = utcCalendarDayMs(classified.effectiveEnd) ?? 0;
        const endDate =
            classified.effectiveEnd instanceof Date
                ? classified.effectiveEnd.toISOString()
                : new Date(classified.effectiveEnd).toISOString();

        const baseItem = () =>
            mapClientSummaryItem(client, {
                endDate,
            });

        if (
            classified.bucket === SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRED ||
            classified.bucket === SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRES_TODAY
        ) {
            const needsAttention = resolveSubscriptionNeedsAttention(
                packageFields,
                now
            );
            needAttentionEntries.push({
                id,
                sortEndMs,
                item: mapClientSummaryItem(client, {
                    endDate,
                    needsAttention,
                }),
            });
        }

        if (classified.bucket === SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRING_SOON) {
            expiringSoonEntries.push({
                id,
                sortEndMs,
                item: baseItem(),
            });
        }

        if (classified.bucket === SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRES_TODAY) {
            const needsAttention = resolveSubscriptionNeedsAttention(
                packageFields,
                now
            );
            expiresTodayEntries.push({
                id,
                sortEndMs,
                item: mapClientSummaryItem(client, {
                    endDate,
                    needsAttention,
                }),
            });
        }
    }

    return {
        totalClients: roster.length,
        needsAttention: buildSummarySection(needAttentionEntries),
        recentlyExpired: buildSummarySection(recentlyExpiredEntries),
        expiringSoon: buildSummarySection(expiringSoonEntries),
        expiresToday: buildSummarySection(expiresTodayEntries),
    };
}

/**
 * One lean roster query for all summary cards in the current list scope.
 *
 * @param {object} scopeQuery — from buildClientListScopeQuery
 * @param {Date} [now]
 */
export async function buildClientListSummary(scopeQuery, now = new Date()) {
    const roster = await User.find(scopeQuery)
        .select(SUMMARY_CLIENT_SELECT)
        .lean();

    return summarizeClientRoster(roster, now);
}
