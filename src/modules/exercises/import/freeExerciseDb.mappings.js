/**
 * Free Exercise DB → FitlyPro approved normalization maps (Phase 3B).
 * Do not map unsupported values to `other`.
 */

export const EXTERNAL_PROVIDER = 'free-exercise-db';

export const MEDIA_BASE_URL =
    'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';

/** Direct + approved muscle normalizations */
export const MUSCLE_MAP = Object.freeze({
    abdominals: 'core',
    biceps: 'biceps',
    calves: 'calves',
    chest: 'chest',
    forearms: 'forearms',
    glutes: 'glutes',
    hamstrings: 'hamstrings',
    lats: 'back',
    'lower back': 'back',
    'middle back': 'back',
    quadriceps: 'quadriceps',
    shoulders: 'shoulders',
    traps: 'back', // warning + tag traps
    triceps: 'triceps',
});

export const UNSUPPORTED_MUSCLES = Object.freeze(
    new Set(['abductors', 'adductors', 'neck'])
);

export const EQUIPMENT_MAP = Object.freeze({
    barbell: 'barbell',
    dumbbell: 'dumbbell',
    cable: 'cable',
    machine: 'machine',
    other: 'other',
    'body only': 'bodyweight',
    kettlebells: 'kettlebell',
    bands: 'resistance_band',
    'medicine ball': 'medicine_ball',
    'e-z curl bar': 'barbell', // warning + tag ez-bar
});

export const UNSUPPORTED_EQUIPMENT = Object.freeze(
    new Set(['foam roll', 'exercise ball'])
);

export const CATEGORY_MAP = Object.freeze({
    strength: { category: 'strength', specialtyTag: null },
    stretching: { category: 'stretching', specialtyTag: null },
    cardio: { category: 'cardio', specialtyTag: null },
    plyometrics: { category: 'plyometric', specialtyTag: null },
    powerlifting: { category: 'strength', specialtyTag: 'powerlifting' },
    'olympic weightlifting': {
        category: 'strength',
        specialtyTag: 'olympic-weightlifting',
    },
    strongman: { category: 'strength', specialtyTag: 'strongman' },
});

export const DIFFICULTY_MAP = Object.freeze({
    beginner: 'beginner',
    intermediate: 'intermediate',
    expert: 'advanced',
});

export const FORCE_TAGS = Object.freeze(new Set(['pull', 'push', 'static']));
export const MECHANIC_TAGS = Object.freeze(new Set(['compound', 'isolation']));

export const REJECTION = Object.freeze({
    UNSUPPORTED_PRIMARY_MUSCLE: 'UNSUPPORTED_PRIMARY_MUSCLE',
    UNSUPPORTED_EQUIPMENT: 'UNSUPPORTED_EQUIPMENT',
    NULL_EQUIPMENT: 'NULL_EQUIPMENT',
    INVALID_CATEGORY: 'INVALID_CATEGORY',
    INVALID_DIFFICULTY: 'INVALID_DIFFICULTY',
    MISSING_PRIMARY_MUSCLE: 'MISSING_PRIMARY_MUSCLE',
    INVALID_NAME: 'INVALID_NAME',
    INVALID_SLUG: 'INVALID_SLUG',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    TRAINER_EXERCISE_COLLISION: 'TRAINER_EXERCISE_COLLISION',
});

export const WARNING = Object.freeze({
    WARNING_NULL_EQUIPMENT_NORMALIZED: 'WARNING_NULL_EQUIPMENT_NORMALIZED',
    WARNING_NULL_EQUIPMENT: 'WARNING_NULL_EQUIPMENT',
    WARNING_AMBIGUOUS_EQUIPMENT: 'WARNING_AMBIGUOUS_EQUIPMENT',
    WARNING_TRAPS_NORMALIZED: 'WARNING_TRAPS_NORMALIZED',
    WARNING_UNSUPPORTED_SECONDARY_DROPPED: 'WARNING_UNSUPPORTED_SECONDARY_DROPPED',
    WARNING_INSTRUCTION_TRUNCATED: 'WARNING_INSTRUCTION_TRUNCATED',
    WARNING_INSTRUCTION_SPLIT: 'WARNING_INSTRUCTION_SPLIT',
    WARNING_SLUG_COLLISION: 'WARNING_SLUG_COLLISION',
    WARNING_SPECIALTY_CATEGORY: 'WARNING_SPECIALTY_CATEGORY',
});
