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

/** Warm-up section presets — aligned with frontend BuilderWarmupActivityType. */
export const WARMUP_ACTIVITY_TYPES = Object.freeze([
    'walking',
    'light_treadmill',
    'arm_circles',
    'leg_swings',
    'dynamic_mobility',
    'other',
]);

/** Cardio section presets — aligned with frontend BuilderCardioActivityType. */
export const CARDIO_ACTIVITY_TYPES = Object.freeze([
    'treadmill',
    'outdoor_running',
    'walking',
    'cycling',
    'elliptical',
    'rowing',
    'hiit',
    'other',
]);

/** Shared warm-up / cardio intensity — distinct from Exercise difficulty. */
export const ACTIVITY_INTENSITIES = Object.freeze(['low', 'moderate', 'high']);

/** Cardio protocol. */
export const CARDIO_PROTOCOLS = Object.freeze(['continuous', 'interval']);

/** Duration limits (minutes) — matches frontend builder clamp. */
export const ACTIVITY_DURATION_MINUTES_MIN = 1;
export const ACTIVITY_DURATION_MINUTES_MAX = 300;

/** Max warm-up or cardio rows per workout day. */
export const MAX_DAY_ACTIVITIES = 20;
