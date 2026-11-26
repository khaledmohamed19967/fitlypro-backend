import {
    SUBSCRIPTION_PACKAGE_BUCKETS,
    classifySubscriptionPackage,
    isClientInNeedsAttentionSet,
    resolveNeedsAttentionForClient,
    resolveSubscriptionDaysUntilEnd,
    utcCalendarDayMs,
} from '../clients/client.subscription-attention.js';
import { DASHBOARD_PREVIEW_LIMIT } from './coach-dashboard.constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * UTC calendar week containing `now`: Monday 00:00Z through Sunday 00:00Z (day ms).
 * Used by clients-growth bucketing (not the Subscriptions dashboard timeline).
 *
 * @param {Date} [now]
 * @returns {{ weekStart: Date, weekEnd: Date, weekStartMs: number, weekEndMs: number, days: Date[] }}
 */
export const getUtcWeekRange = (now = new Date()) => {
    const todayMs = utcCalendarDayMs(now);
    if (todayMs === null) {
        throw new Error('Invalid now date for week range');
    }

    const day = new Date(todayMs).getUTCDay(); // 0=Sun … 6=Sat
    const daysFromMonday = day === 0 ? 6 : day - 1;
    const weekStartMs = todayMs - daysFromMonday * DAY_MS;
    const weekEndMs = weekStartMs + 6 * DAY_MS;

    const days = [];
    for (let i = 0; i < 7; i += 1) {
        days.push(new Date(weekStartMs + i * DAY_MS));
    }

    return {
        weekStart: new Date(weekStartMs),
        weekEnd: new Date(weekEndMs),
        weekStartMs,
        weekEndMs,
        days,
    };
};

/**
 * Subscriptions timeline window: today (UTC) through today+7 days (8 columns).
 * First column is always today; remaining columns ascend chronologically.
 *
 * @param {Date} [now]
 * @returns {{ weekStart: Date, weekEnd: Date, weekStartMs: number, weekEndMs: number, days: Date[] }}
 */
export const getUtcRollingEightDayRange = (now = new Date()) => {
    const todayMs = utcCalendarDayMs(now);
    if (todayMs === null) {
        throw new Error('Invalid now date for rolling eight-day range');
    }

    const weekEndMs = todayMs + 7 * DAY_MS;
    const days = [];
    for (let i = 0; i < 8; i += 1) {
        days.push(new Date(todayMs + i * DAY_MS));
    }

    return {
        weekStart: new Date(todayMs),
        weekEnd: new Date(weekEndMs),
        weekStartMs: todayMs,
        weekEndMs,
        days,
    };
};

/**
 * @param {Date} date
 * @returns {string} YYYY-MM-DD (UTC)
 */
export const formatUtcDateKey = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const clientDisplayName = (client) =>
    [client.firstName, client.lastName].filter(Boolean).join(' ').trim();

/**
 * Build subscription week histogram + expiring preview from an active roster.
 * Classification uses the same helpers as Client List summary.
 *
 * @param {Array<object>} roster
 * @param {Date} [now]
 * @param {number} [previewLimit]
 */
export const buildSubscriptionsSection = (
    roster,
    now = new Date(),
    previewLimit = DASHBOARD_PREVIEW_LIMIT
) => {
    const week = getUtcRollingEightDayRange(now);
    const countByDate = new Map(week.days.map((d) => [formatUtcDateKey(d), 0]));
    const previewEntries = [];

    for (const client of roster) {
        const packageFields = {
            startDate: client.startDate,
            packageDuration: client.packageDuration,
            endDate: client.endDate,
        };
        const resolved = resolveSubscriptionDaysUntilEnd(packageFields, now);
        if (!resolved) {
            continue;
        }

        const endDayMs = utcCalendarDayMs(resolved.effectiveEnd);
        if (endDayMs === null) {
            continue;
        }

        if (endDayMs >= week.weekStartMs && endDayMs <= week.weekEndMs) {
            const key = formatUtcDateKey(resolved.effectiveEnd);
            if (countByDate.has(key)) {
                countByDate.set(key, countByDate.get(key) + 1);
            }
        }

        const classified = classifySubscriptionPackage(packageFields, now);
        if (
            !classified ||
            (classified.bucket !== SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRES_TODAY &&
                classified.bucket !== SUBSCRIPTION_PACKAGE_BUCKETS.EXPIRING_SOON)
        ) {
            continue;
        }

        const endDate =
            classified.effectiveEnd instanceof Date
                ? classified.effectiveEnd.toISOString()
                : new Date(classified.effectiveEnd).toISOString();

        previewEntries.push({
            id: String(client._id),
            sortEndMs: endDayMs,
            item: {
                clientId: String(client._id),
                name: clientDisplayName(client),
                packageDuration: client.packageDuration ?? null,
                endDate,
                daysUntilEnd: classified.daysUntilEnd,
                bucket: classified.bucket,
            },
        });
    }

    previewEntries.sort((a, b) => {
        if (a.sortEndMs !== b.sortEndMs) {
            return a.sortEndMs - b.sortEndMs;
        }
        return a.id.localeCompare(b.id);
    });

    return {
        week: {
            weekStart: week.weekStart.toISOString(),
            weekEnd: week.weekEnd.toISOString(),
            convention: 'utc_today_plus_7',
            days: week.days.map((d) => {
                const date = formatUtcDateKey(d);
                return {
                    date,
                    expiringCount: countByDate.get(date) ?? 0,
                };
            }),
        },
        preview: previewEntries.slice(0, previewLimit).map((e) => e.item),
    };
};

/**
 * Needs-attention section: shared membership via `isClientInNeedsAttentionSet`
 * (recently-expired 7-day UTC window + expires_today). Same rules as My Clients filter.
 *
 * @param {Array<object>} roster
 * @param {Date} [now]
 * @param {number} [previewLimit]
 */
export const buildNeedsAttentionSection = (
    roster,
    now = new Date(),
    previewLimit = DASHBOARD_PREVIEW_LIMIT
) => {
    const reasonCounts = new Map();
    const previewEntries = [];

    for (const client of roster) {
        const packageFields = {
            startDate: client.startDate,
            packageDuration: client.packageDuration,
            endDate: client.endDate,
            isActive: client.isActive,
        };

        if (!isClientInNeedsAttentionSet(packageFields, now)) {
            continue;
        }

        const needsAttention = resolveNeedsAttentionForClient(packageFields, now);
        const classified = classifySubscriptionPackage(packageFields, now);
        if (!needsAttention || !classified) {
            continue;
        }

        const kind = needsAttention.kind;
        reasonCounts.set(kind, (reasonCounts.get(kind) ?? 0) + 1);

        const endDate =
            classified.effectiveEnd instanceof Date
                ? classified.effectiveEnd.toISOString()
                : new Date(classified.effectiveEnd).toISOString();

        previewEntries.push({
            id: String(client._id),
            sortEndMs: utcCalendarDayMs(classified.effectiveEnd) ?? 0,
            item: {
                clientId: String(client._id),
                name: clientDisplayName(client),
                reason: kind,
                suggestedAction: needsAttention.suggestedAction,
                endDate,
                daysUntilEnd: classified.daysUntilEnd,
                packageDuration: client.packageDuration ?? null,
            },
        });
    }

    previewEntries.sort((a, b) => {
        if (a.sortEndMs !== b.sortEndMs) {
            return a.sortEndMs - b.sortEndMs;
        }
        return a.id.localeCompare(b.id);
    });

    const byReason = [...reasonCounts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => a.reason.localeCompare(b.reason));

    return {
        total: previewEntries.length,
        byReason,
        preview: previewEntries.slice(0, previewLimit).map((e) => e.item),
    };
};
