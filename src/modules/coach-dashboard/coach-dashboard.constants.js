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
