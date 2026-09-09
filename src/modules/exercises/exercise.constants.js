/**
 * Exercise Library — canonical taxonomy & enums
 * Shared by Mongoose schema, Joi validators, and future services.
 */

export const MUSCLES = Object.freeze([
    'chest',
    'back',
    'shoulders',
    'biceps',
    'triceps',
    'forearms',
    'quadriceps',
    'hamstrings',
    'glutes',
    'calves',
    'core',
    'full_body',
    'other',
]);

export const EQUIPMENT = Object.freeze([
    'barbell',
    'dumbbell',
    'cable',
    'machine',
    'bodyweight',
    'kettlebell',
    'resistance_band',
    'smith_machine',
    'bench',
    'pull_up_bar',
    'medicine_ball',
    'other',
]);

export const DIFFICULTIES = Object.freeze(['beginner', 'intermediate', 'advanced']);

export const CATEGORIES = Object.freeze([
    'strength',
    'cardio',
    'mobility',
    'stretching',
    'warmup',
    'plyometric',
    'other',
]);

export const OWNERSHIP_TYPES = Object.freeze(['system', 'trainer']);

export const SOURCE_TYPES = Object.freeze(['manual', 'duplicated', 'import', 'seed']);

export const EXERCISE_STATUSES = Object.freeze(['active', 'archived']);

export const OWNERSHIP_FILTERS = Object.freeze(['system', 'trainer', 'all']);
