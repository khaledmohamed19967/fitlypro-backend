/**
 * Nutrition Plan Assignment — canonical enums
 */

export const ASSIGNMENT_STATUSES = Object.freeze([
    'active',
    'completed',
    'paused',
    'cancelled',
]);

/** Statuses a "Remove from Client" cancellation may transition from. */
export const CANCELLABLE_ASSIGNMENT_STATUSES = Object.freeze(['active']);
