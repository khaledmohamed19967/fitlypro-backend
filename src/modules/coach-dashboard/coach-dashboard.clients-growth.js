/**
 * Clients Growth — date windows, bucketing, and percentage helpers (UTC).
 */

import { utcCalendarDayMs } from '../clients/client.subscription-attention.js';
import {
    CLIENTS_GROWTH_DEFAULT_GROUP_BY,
    CLIENTS_GROWTH_RANGE_DAYS,
} from './coach-dashboard.constants.js';
import { formatUtcDateKey, getUtcWeekRange } from './coach-dashboard.helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve [from, to) for a growth range. `to` is exclusive (start of tomorrow UTC).
 *
 * @param {'30d'|'3m'|'6m'|'12m'} range
 * @param {Date} [now]
 * @returns {{ from: Date, to: Date, dayCount: number }}
 */
export const resolveClientsGrowthWindow = (range, now = new Date()) => {
    const dayCount = CLIENTS_GROWTH_RANGE_DAYS[range];
    if (!dayCount) {
        throw new Error(`Unsupported clients growth range: ${range}`);
    }

    const todayMs = utcCalendarDayMs(now);
    if (todayMs === null) {
        throw new Error('Invalid now date for clients growth window');
    }

    const to = new Date(todayMs + DAY_MS);
    const from = new Date(to.getTime() - dayCount * DAY_MS);

    return { from, to, dayCount };
};

/**
 * Previous period of equal length: [from - dayCount, from).
 *
 * @param {{ from: Date, to: Date, dayCount: number }} window
 */
export const resolvePreviousClientsGrowthWindow = (window) => {
    const from = new Date(window.from.getTime() - window.dayCount * DAY_MS);
    const to = new Date(window.from.getTime());
    return { from, to, dayCount: window.dayCount };
};

/**
 * @param {'30d'|'3m'|'6m'|'12m'} range
 * @param {'day'|'week'|'month'|undefined} groupBy
 */
export const resolveClientsGrowthGroupBy = (range, groupBy) => {
    if (groupBy) {
        return groupBy;
    }
    return CLIENTS_GROWTH_DEFAULT_GROUP_BY[range] ?? 'day';
};

/**
 * UTC Monday 00:00 containing `date`.
 *
 * @param {Date} date
 * @returns {Date}
 */
export const utcWeekStartContaining = (date) => {
    const week = getUtcWeekRange(date);
    return week.weekStart;
};

/**
 * UTC first-of-month 00:00 containing `date`.
 *
 * @param {Date} date
 * @returns {Date}
 */
export const utcMonthStartContaining = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/**
 * Next bucket start after `start` for groupBy.
 *
 * @param {Date} start
 * @param {'day'|'week'|'month'} groupBy
 */
export const nextClientsGrowthBucketStart = (start, groupBy) => {
    if (groupBy === 'day') {
        return new Date(start.getTime() + DAY_MS);
    }
    if (groupBy === 'week') {
        return new Date(start.getTime() + 7 * DAY_MS);
    }
    return new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
    );
};

/**
 * Align a timestamp down to the bucket start that contains it.
 *
 * @param {Date} date
 * @param {'day'|'week'|'month'} groupBy
 */
export const alignClientsGrowthBucketStart = (date, groupBy) => {
    if (groupBy === 'day') {
        const ms = utcCalendarDayMs(date);
        return new Date(ms);
    }
    if (groupBy === 'week') {
        return utcWeekStartContaining(date);
    }
    return utcMonthStartContaining(date);
};

/**
 * Build contiguous zero-filled buckets covering [from, to).
 *
 * Bucket boundaries stay calendar-aligned (UTC day / Monday week / month start).
 * `periodStart` / `periodEnd` are always full calendar bucket bounds (exclusive end).
 * The first bucket may start before `from` and the last may end after `to`.
 * Client counts are still filtered to `[from, to)` — use response `from`/`to` as the
 * reporting window; do not assume every bucket is fully inside that window.
 *
 * @param {Date} from
 * @param {Date} to
 * @param {'day'|'week'|'month'} groupBy
 * @returns {Array<{ periodStart: Date, periodEnd: Date }>}
 */
export const buildClientsGrowthBuckets = (from, to, groupBy) => {
    const buckets = [];
    let cursor = alignClientsGrowthBucketStart(from, groupBy);

    while (cursor.getTime() < to.getTime()) {
        const periodStart = cursor;
        const periodEnd = nextClientsGrowthBucketStart(periodStart, groupBy);
        buckets.push({ periodStart, periodEnd });
        cursor = periodEnd;
    }

    return buckets;
};

/**
 * Mongo $dateTrunc unit for groupBy (MongoDB 5+ / Atlas).
 * Fallback path uses application bucketing if aggregation unit unsupported.
 *
 * @param {'day'|'week'|'month'} groupBy
 */
export const mongoDateTruncUnit = (groupBy) => {
    if (groupBy === 'week') return 'week';
    if (groupBy === 'month') return 'month';
    return 'day';
};

/**
 * Growth % vs previous period. Never Infinity/NaN.
 * previous === 0 && current === 0 → 0
 * previous === 0 && current > 0 → null (no baseline)
 *
 * @param {number} current
 * @param {number} previous
 * @returns {number|null}
 */
export const computeClientsGrowthPercentage = (current, previous) => {
    const cur = Number(current) || 0;
    const prev = Number(previous) || 0;
    if (prev === 0) {
        return cur === 0 ? 0 : null;
    }
    return Math.round(((cur - prev) / prev) * 10000) / 100;
};

/**
 * Map aggregation rows keyed by ISO periodStart to filled series.
 *
 * @param {Array<{ periodStart: Date, periodEnd: Date }>} buckets
 * @param {Map<string, number>} countByPeriodStartKey
 */
export const fillClientsGrowthSeries = (buckets, countByPeriodStartKey) =>
    buckets.map((bucket) => ({
        periodStart: bucket.periodStart.toISOString(),
        periodEnd: bucket.periodEnd.toISOString(),
        newClients: countByPeriodStartKey.get(bucket.periodStart.toISOString()) ?? 0,
    }));

/**
 * Key used when grouping lean documents in application memory.
 *
 * @param {Date} joinedCoachAt
 * @param {'day'|'week'|'month'} groupBy
 */
export const clientsGrowthBucketKey = (joinedCoachAt, groupBy) =>
    alignClientsGrowthBucketStart(joinedCoachAt, groupBy).toISOString();

export { formatUtcDateKey, DAY_MS };
