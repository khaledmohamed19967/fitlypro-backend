/**
 * Nutrition Plan — canonical taxonomy & enums
 * Shared by Mongoose schemas, Joi validators, and future services.
 */

export const NUTRITION_GOALS = Object.freeze([
    'weight_loss',
    'maintenance',
    'muscle_gain',
    'body_recomp',
    'high_protein',
    'general_health',
]);

export const NUTRITION_PLAN_STATUSES = Object.freeze(['draft', 'active', 'archived']);

export const MEAL_TYPES = Object.freeze([
    'breakfast',
    'morning_snack',
    'lunch',
    'afternoon_snack',
    'dinner',
    'evening_snack',
    'pre_workout',
    'post_workout',
    'snack',
    'other',
]);

export const OWNERSHIP_TYPES = Object.freeze(['system', 'trainer']);

export const OWNERSHIP_FILTERS = Object.freeze(['system', 'trainer', 'all']);

/** Default Iconify identifier for nutrition plans. */
export const DEFAULT_NUTRITION_PLAN_ICON = 'lucide:apple';

export const MAX_NUTRITION_DAYS = 14;

/** Weekly schedule mode — max distinct day templates in a week. */
export const MAX_WEEKLY_NUTRITION_DAYS = 7;

export const SCHEDULE_MODES = Object.freeze(['daily', 'weekly']);

export const DEFAULT_SCHEDULE_MODE = 'daily';

export const MAX_MEALS_PER_DAY = 12;

export const MAX_FOOD_ITEMS_PER_MEAL = 30;

export const NUTRITION_PLAN_SORT_OPTIONS = Object.freeze([
    'name',
    'name-desc',
    'newest',
    'oldest',
    'calories-high',
    'calories-low',
    'duration-high',
    'duration-low',
]);
