/**
 * Workout Plan — canonical taxonomy & enums
 * Shared by Mongoose schemas, Joi validators, and future services.
 */

export const WORKOUT_GOALS = Object.freeze([
    'muscle_gain',
    'strength',
    'fat_loss',
    'endurance',
    'athletic_performance',
    'general_fitness',
    'rehabilitation',
]);

export const WORKOUT_LEVELS = Object.freeze([
    'beginner',
    'intermediate',
    'advanced',
    'expert',
]);

export const WORKOUT_PLAN_STATUSES = Object.freeze(['draft', 'active', 'archived']);

export const ASSIGNMENT_STATUSES = Object.freeze([
    'active',
    'completed',
    'paused',
    'cancelled',
]);

/** Statuses a "Remove from Client" cancellation may transition from. */
export const CANCELLABLE_ASSIGNMENT_STATUSES = Object.freeze(['active']);

export const WEIGHT_UNITS = Object.freeze(['kg', 'lbs']);

/** Player workout session lifecycle */
export const WORKOUT_SESSION_STATUSES = Object.freeze([
    'in_progress',
    'completed',
    'abandoned',
]);

/** Performed set log statuses */
export const WORKOUT_SET_LOG_STATUSES = Object.freeze(['completed', 'skipped']);

export const WORKOUT_PLAN_SORT_OPTIONS = Object.freeze([
    'name',
    'name-desc',
    'newest',
    'oldest',
    'exercises-high',
    'exercises-low',
]);

export const OWNERSHIP_TYPES = Object.freeze(['system', 'trainer']);

export const OWNERSHIP_FILTERS = Object.freeze(['system', 'trainer', 'all']);

/** Default Iconify identifier for workout plans without an explicit icon (Heroicons solid). */
export const DEFAULT_WORKOUT_PLAN_ICON = 'heroicons:bolt-20-solid';
