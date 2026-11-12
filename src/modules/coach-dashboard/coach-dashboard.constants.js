/**
 * Coach Dashboard Overview — Phase 1 constants.
 */

/** Preview list size (aligned with client list summary cards). */
export const DASHBOARD_PREVIEW_LIMIT = 5;

/**
 * Phase 1 timezone policy: all calendar boundaries use UTC
 * (same as client.subscription-attention / package end dates).
 */
export const DASHBOARD_TIMEZONE = 'UTC';

/**
 * Current week = ISO-style Monday–Sunday in UTC calendar days.
 * weekStart = Monday 00:00:00.000Z; weekEnd = Sunday 00:00:00.000Z (same day ms convention).
 */
export const DASHBOARD_WEEK_START_DAY = 'monday';

/** Clients Growth range presets (rolling UTC windows ending end-of-today exclusive). */
export const CLIENTS_GROWTH_RANGES = Object.freeze(['30d', '3m', '6m', '12m']);

/** Clients Growth series grouping. */
export const CLIENTS_GROWTH_GROUP_BY = Object.freeze(['day', 'week', 'month']);

/**
 * Default groupBy per range when query omits groupBy.
 * @type {Readonly<Record<string, 'day'|'week'|'month'>>}
 */
export const CLIENTS_GROWTH_DEFAULT_GROUP_BY = Object.freeze({
    '30d': 'day',
    '3m': 'week',
    '6m': 'week',
    '12m': 'month',
});

/**
 * Rolling window length in UTC calendar days (exclusive end = start of tomorrow).
 * Months use fixed day counts for equivalent previous-period comparison.
 * @type {Readonly<Record<string, number>>}
 */
export const CLIENTS_GROWTH_RANGE_DAYS = Object.freeze({
    '30d': 30,
    '3m': 90,
    '6m': 180,
    '12m': 365,
});
