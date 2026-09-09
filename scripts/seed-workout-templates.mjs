/**
 * System Workout Template seed script (Phase 4A)
 *
 * Usage: pnpm run seed:workout-templates
 *
 * Behavior:
 * - Upserts by (ownership.type=system, isTemplate=true, templateKey)
 * - Never deletes plans
 * - Never modifies trainer-owned plans
 * - Safe / idempotent to re-run
 * - Resolves exercises from system Exercise Library by name
 */

import 'dotenv/config';
import mongoose from 'mongoose';

import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js';
import Exercise from '../src/modules/exercises/exercise.model.js';

const TEMPLATE_KEYS = Object.freeze([
    'full-body-beginner',
    'full-body-intermediate',
    'upper-lower-4',
    'ppl-3',
    'ppl-6',
    'upper-lower-hypertrophy',
    'strength-4',
    'general-fitness-3',
]);

/** Iconify Heroicons solid identifiers for system templates (seeded on upsert). */
const TEMPLATE_ICONS = Object.freeze({
    'full-body-beginner': 'heroicons:user-20-solid',
    'full-body-intermediate': 'heroicons:chart-bar-20-solid',
    'upper-lower-4': 'heroicons:bolt-20-solid',
    'ppl-3': 'heroicons:bolt-20-solid',
    'ppl-6': 'heroicons:fire-20-solid',
    'upper-lower-hypertrophy': 'heroicons:arrow-trending-up-20-solid',
    'strength-4': 'heroicons:bolt-20-solid',
    'general-fitness-3': 'heroicons:heart-20-solid',
});

/**
 * Preferred exercise names with fallbacks (first match wins).
 * Names must exist as system + active exercises.
 */
const EXERCISE_ALIASES = Object.freeze({
    benchPress: ['Barbell Bench Press', 'Barbell Bench Press - Medium Grip', 'Smith Machine Bench Press'],
    inclineDbPress: [
        'Incline Dumbbell Press',
        'Incline Dumbbell Bench Press',
        'Dumbbell Incline Bench Press',
        'Barbell Incline Bench Press - Medium Grip',
    ],
    cableFly: ['Cable Chest Fly', 'Cable Crossover', 'Butterfly'],
    shoulderPress: ['Barbell Overhead Press', 'Barbell Shoulder Press', 'Arnold Dumbbell Press', 'Standing Military Press'],
    lateralRaise: ['Side Lateral Raise', 'Cable Lateral Raise', 'Dumbbell Lateral Raise'],
    tricepsPushdown: ['Triceps Pushdown', 'Cable Triceps Pushdown', 'Triceps Pushdown - Rope Attachment'],
    latPulldown: ['Wide-Grip Lat Pulldown', 'Close-Grip Front Lat Pulldown', 'V-Bar Pulldown'],
    seatedRow: ['Seated Cable Rows', 'Seated Cable Row', 'Cable Seated Row', 'Shotgun Row', 'Chest Supported Row'],
    facePull: ['Face Pull', 'Cable Rope Rear-Delt Rows', 'Cable Rear Delt Fly'],
    dbCurl: ['Dumbbell Bicep Curl', 'Alternate Hammer Curl', 'Concentration Curls', 'Barbell Curl'],
    hammerCurl: ['Alternate Hammer Curl', 'Cross Body Hammer Curl', 'Hammer Curls'],
    legPress: ['Leg Press', 'Smith Machine Leg Press', 'Calf Press On The Leg Press Machine'],
    rdl: [
        'Romanian Deadlift',
        'Stiff-Legged Barbell Deadlift',
        'Stiff-Legged Dumbbell Deadlift',
        'Barbell Deadlift',
    ],
    legCurl: ['Lying Leg Curls', 'Seated Leg Curl', 'Standing Leg Curl', 'Leg Curl'],
    legExtension: ['Leg Extensions', 'Single-Leg Leg Extension', 'Leg Extension'],
    calfRaise: ['Standing Calf Raise', 'Standing Calf Raises', 'Calf Press', 'Seated Calf Raise'],
    bodyweightSquat: ['Bodyweight Squat', 'Barbell Squat', 'Barbell Full Squat'],
    pushUp: ['Pushups', 'Push Up', 'Push-Up', 'Decline Push-Up'],
    plank: ['Plank', 'Side Plank', 'Front Plank'],
    gobletSquat: ['Goblet Squat', 'Dumbbell Goblet Squat', 'Bodyweight Squat'],
    dbRow: ['Bent Over Two-Dumbbell Row', 'One-Arm Dumbbell Row', 'Dumbbell Row', 'Alternating Kettlebell Row'],
    deadlift: ['Barbell Deadlift', 'Conventional Deadlift', 'Sumo Deadlift'],
    squat: ['Barbell Squat', 'Barbell Full Squat', 'Smith Machine Squat'],
    ohp: ['Barbell Overhead Press', 'Standing Military Press', 'Barbell Shoulder Press'],
    pullUp: ['Pullups', 'Chin-Up', 'Chin Up', 'Assisted Pull Up'],
    hipThrust: ['Barbell Hip Thrust', 'Barbell Glute Bridge', 'Butt Lift (Bridge)'],
    lunges: ['Walking Lunge', 'Bodyweight Walking Lunge', 'Barbell Walking Lunge', 'Bulgarian Split Squat'],
    crunch: ['Crunches', 'Cable Crunch', 'Sit-Up'],
    birdDog: ['Bird Dog', 'Superman'],
    gluteBridge: ['Butt Lift (Bridge)', 'Barbell Glute Bridge', 'Single Leg Glute Bridge'],
    closeGripBench: ['Close Grip Bench Press', 'Close-Grip Barbell Bench Press', 'Close-Grip EZ-Bar Press'],
    romanianDeadlift: [
        'Romanian Deadlift',
        'Stiff-Legged Barbell Deadlift',
        'Stiff-Legged Dumbbell Deadlift',
    ],
    frontSquat: ['Front Squat', 'Front Squats', 'Barbell Squat'],
    inclineBench: [
        'Barbell Incline Bench Press - Medium Grip',
        'Incline Dumbbell Press',
        'Smith Machine Incline Bench Press',
    ],
    dip: ['Dips - Triceps Version', 'Triceps Dip', 'Bench Dips', 'Dips - Chest Version'],
    shrug: ['Barbell Shrug', 'Dumbbell Shrug', 'Cable Shrugs'],
});

const sets = (count, reps, rest = 90) =>
    Array.from({ length: count }, (_, i) => ({
        setNumber: i + 1,
        reps,
        weight: null,
        weightUnit: 'kg',
        isWarmup: false,
        isDropset: false,
    }));

const exerciseRow = (exercise, order, setCount, reps, rest) => ({
    exerciseId: exercise._id,
    order,
    restBetweenSets: rest,
    notes: null,
    tempo: null,
    supersetWith: null,
    exerciseSnapshot: {
        name: exercise.name,
        thumbnailUrl: exercise.media?.thumbnailUrl ?? null,
    },
    sets: sets(setCount, reps, rest),
});

/**
 * @param {Map<string, object>} byName
 * @param {string[]} candidates
 * @param {string[]} substitutions
 * @param {string} label
 */
const resolveExercise = (byName, candidates, substitutions, label) => {
    for (const name of candidates) {
        const hit = byName.get(name.toLowerCase());
        if (hit) {
            if (name !== candidates[0]) {
                substitutions.push(`${label}: preferred "${candidates[0]}" → used "${hit.name}"`);
            }
            return hit;
        }
    }

    // Fuzzy: contains first significant token
    const token = candidates[0]?.toLowerCase().split(' ')[0];
    if (token && token.length > 3) {
        for (const [key, value] of byName.entries()) {
            if (key.includes(token)) {
                substitutions.push(`${label}: preferred "${candidates[0]}" → fuzzy "${value.name}"`);
                return value;
            }
        }
    }

    throw new Error(`No system exercise found for ${label}. Tried: ${candidates.join(', ')}`);
};

const buildTemplates = (pick) => [
    {
        templateKey: 'full-body-beginner',
        name: 'Full Body — Beginner',
        description: '3-day full-body starter program for new trainees. Focus on form and consistency.',
        duration: 8,
        daysPerWeek: 3,
        goal: 'general_fitness',
        level: 'beginner',
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Full Body A',
                exercises: [
                    exerciseRow(pick('squat'), 1, 3, 10, 90),
                    exerciseRow(pick('pushUp'), 2, 3, 10, 60),
                    exerciseRow(pick('dbRow'), 3, 3, 10, 75),
                    exerciseRow(pick('gluteBridge'), 4, 3, 12, 60),
                    exerciseRow(pick('plank'), 5, 3, 30, 45),
                ],
            },
            {
                dayNumber: 2,
                name: 'Full Body B',
                exercises: [
                    exerciseRow(pick('gobletSquat'), 1, 3, 10, 90),
                    exerciseRow(pick('shoulderPress'), 2, 3, 10, 75),
                    exerciseRow(pick('latPulldown'), 3, 3, 10, 75),
                    exerciseRow(pick('lunges'), 4, 3, 10, 75),
                    exerciseRow(pick('crunch'), 5, 3, 12, 45),
                ],
            },
            {
                dayNumber: 3,
                name: 'Full Body C',
                exercises: [
                    exerciseRow(pick('bodyweightSquat'), 1, 3, 12, 75),
                    exerciseRow(pick('benchPress'), 2, 3, 10, 90),
                    exerciseRow(pick('seatedRow'), 3, 3, 10, 75),
                    exerciseRow(pick('rdl'), 4, 3, 10, 90),
                    exerciseRow(pick('birdDog'), 5, 3, 10, 45),
                ],
            },
        ],
    },
    {
        templateKey: 'full-body-intermediate',
        name: 'Full Body — Intermediate',
        description: '3-day full-body hypertrophy/strength hybrid for intermediate lifters.',
        duration: 10,
        daysPerWeek: 3,
        goal: 'muscle_gain',
        level: 'intermediate',
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Full Body A',
                exercises: [
                    exerciseRow(pick('squat'), 1, 4, 8, 120),
                    exerciseRow(pick('benchPress'), 2, 4, 8, 120),
                    exerciseRow(pick('seatedRow'), 3, 3, 10, 90),
                    exerciseRow(pick('lateralRaise'), 4, 3, 12, 60),
                    exerciseRow(pick('legCurl'), 5, 3, 12, 75),
                ],
            },
            {
                dayNumber: 2,
                name: 'Full Body B',
                exercises: [
                    exerciseRow(pick('deadlift'), 1, 3, 5, 150),
                    exerciseRow(pick('ohp'), 2, 4, 8, 120),
                    exerciseRow(pick('latPulldown'), 3, 3, 10, 90),
                    exerciseRow(pick('lunges'), 4, 3, 10, 90),
                    exerciseRow(pick('tricepsPushdown'), 5, 3, 12, 60),
                ],
            },
            {
                dayNumber: 3,
                name: 'Full Body C',
                exercises: [
                    exerciseRow(pick('legPress'), 1, 4, 10, 90),
                    exerciseRow(pick('inclineDbPress'), 2, 3, 10, 90),
                    exerciseRow(pick('dbRow'), 3, 3, 10, 90),
                    exerciseRow(pick('dbCurl'), 4, 3, 12, 60),
                    exerciseRow(pick('calfRaise'), 5, 3, 15, 60),
                ],
            },
        ],
    },
    {
        templateKey: 'upper-lower-4',
        name: 'Upper / Lower — 4 Days',
        description: 'Classic 4-day upper/lower split for balanced strength and muscle growth.',
        duration: 12,
        daysPerWeek: 4,
        goal: 'muscle_gain',
        level: 'intermediate',
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Upper A',
                exercises: [
                    exerciseRow(pick('benchPress'), 1, 4, 8, 120),
                    exerciseRow(pick('seatedRow'), 2, 4, 8, 90),
                    exerciseRow(pick('ohp'), 3, 3, 8, 90),
                    exerciseRow(pick('latPulldown'), 4, 3, 10, 75),
                    exerciseRow(pick('tricepsPushdown'), 5, 3, 12, 60),
                    exerciseRow(pick('dbCurl'), 6, 3, 12, 60),
                ],
            },
            {
                dayNumber: 2,
                name: 'Lower A',
                exercises: [
                    exerciseRow(pick('squat'), 1, 4, 8, 150),
                    exerciseRow(pick('rdl'), 2, 3, 8, 120),
                    exerciseRow(pick('legPress'), 3, 3, 10, 90),
                    exerciseRow(pick('legCurl'), 4, 3, 12, 75),
                    exerciseRow(pick('calfRaise'), 5, 3, 15, 60),
                ],
            },
            {
                dayNumber: 3,
                name: 'Upper B',
                exercises: [
                    exerciseRow(pick('inclineDbPress'), 1, 4, 8, 90),
                    exerciseRow(pick('dbRow'), 2, 4, 8, 90),
                    exerciseRow(pick('lateralRaise'), 3, 3, 12, 60),
                    exerciseRow(pick('facePull'), 4, 3, 15, 60),
                    exerciseRow(pick('hammerCurl'), 5, 3, 12, 60),
                    exerciseRow(pick('dip'), 6, 3, 10, 75),
                ],
            },
            {
                dayNumber: 4,
                name: 'Lower B',
                exercises: [
                    exerciseRow(pick('deadlift'), 1, 3, 5, 180),
                    exerciseRow(pick('lunges'), 2, 3, 10, 90),
                    exerciseRow(pick('legExtension'), 3, 3, 12, 75),
                    exerciseRow(pick('hipThrust'), 4, 3, 10, 90),
                    exerciseRow(pick('calfRaise'), 5, 3, 15, 60),
                ],
            },
        ],
    },
    {
        templateKey: 'ppl-3',
        name: 'Push / Pull / Legs — 3 Days',
        description: 'Simple 3-day PPL for intermediates who train three times per week.',
        duration: 10,
        daysPerWeek: 3,
        goal: 'muscle_gain',
        level: 'intermediate',
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Push',
                exercises: [
                    exerciseRow(pick('benchPress'), 1, 4, 8, 120),
                    exerciseRow(pick('inclineDbPress'), 2, 3, 10, 90),
                    exerciseRow(pick('cableFly'), 3, 3, 12, 60),
                    exerciseRow(pick('shoulderPress'), 4, 3, 10, 90),
                    exerciseRow(pick('lateralRaise'), 5, 3, 12, 60),
                    exerciseRow(pick('tricepsPushdown'), 6, 3, 12, 60),
                ],
            },
            {
                dayNumber: 2,
                name: 'Pull',
                exercises: [
                    exerciseRow(pick('deadlift'), 1, 3, 5, 150),
                    exerciseRow(pick('latPulldown'), 2, 4, 10, 90),
                    exerciseRow(pick('seatedRow'), 3, 3, 10, 90),
                    exerciseRow(pick('facePull'), 4, 3, 15, 60),
                    exerciseRow(pick('dbCurl'), 5, 3, 12, 60),
                    exerciseRow(pick('hammerCurl'), 6, 3, 12, 60),
                ],
            },
            {
                dayNumber: 3,
                name: 'Legs',
                exercises: [
                    exerciseRow(pick('squat'), 1, 4, 8, 150),
                    exerciseRow(pick('rdl'), 2, 3, 8, 120),
                    exerciseRow(pick('legPress'), 3, 3, 10, 90),
                    exerciseRow(pick('legCurl'), 4, 3, 12, 75),
                    exerciseRow(pick('legExtension'), 5, 3, 12, 75),
                    exerciseRow(pick('calfRaise'), 6, 3, 15, 60),
                ],
            },
        ],
    },
    {
        templateKey: 'ppl-6',
        name: 'Push / Pull / Legs — 6 Days',
        description: 'High-frequency 6-day PPL for advanced trainees with good recovery.',
        duration: 8,
        daysPerWeek: 6,
        goal: 'muscle_gain',
        level: 'advanced',
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Push A',
                exercises: [
                    exerciseRow(pick('benchPress'), 1, 4, 6, 150),
                    exerciseRow(pick('inclineDbPress'), 2, 3, 10, 90),
                    exerciseRow(pick('shoulderPress'), 3, 3, 8, 90),
                    exerciseRow(pick('lateralRaise'), 4, 3, 12, 60),
                    exerciseRow(pick('tricepsPushdown'), 5, 3, 12, 60),
                ],
            },
            {
                dayNumber: 2,
                name: 'Pull A',
                exercises: [
                    exerciseRow(pick('deadlift'), 1, 3, 5, 180),
                    exerciseRow(pick('latPulldown'), 2, 4, 8, 90),
                    exerciseRow(pick('seatedRow'), 3, 3, 10, 90),
                    exerciseRow(pick('facePull'), 4, 3, 15, 60),
                    exerciseRow(pick('dbCurl'), 5, 3, 12, 60),
                ],
            },
            {
                dayNumber: 3,
                name: 'Legs A',
                exercises: [
                    exerciseRow(pick('squat'), 1, 4, 6, 180),
                    exerciseRow(pick('rdl'), 2, 3, 8, 120),
                    exerciseRow(pick('legPress'), 3, 3, 10, 90),
                    exerciseRow(pick('legCurl'), 4, 3, 12, 75),
                    exerciseRow(pick('calfRaise'), 5, 4, 12, 60),
                ],
            },
            {
                dayNumber: 4,
                name: 'Push B',
                exercises: [
                    exerciseRow(pick('inclineBench'), 1, 4, 8, 120),
                    exerciseRow(pick('cableFly'), 2, 3, 12, 60),
                    exerciseRow(pick('ohp'), 3, 3, 8, 90),
                    exerciseRow(pick('lateralRaise'), 4, 4, 12, 60),
                    exerciseRow(pick('closeGripBench'), 5, 3, 10, 90),
                ],
            },
            {
                dayNumber: 5,
                name: 'Pull B',
                exercises: [
                    exerciseRow(pick('pullUp'), 1, 4, 8, 120),
                    exerciseRow(pick('dbRow'), 2, 4, 8, 90),
                    exerciseRow(pick('facePull'), 3, 3, 15, 60),
                    exerciseRow(pick('shrug'), 4, 3, 12, 75),
                    exerciseRow(pick('hammerCurl'), 5, 3, 12, 60),
                ],
            },
            {
                dayNumber: 6,
                name: 'Legs B',
                exercises: [
                    exerciseRow(pick('frontSquat'), 1, 4, 8, 150),
                    exerciseRow(pick('hipThrust'), 2, 3, 10, 90),
                    exerciseRow(pick('lunges'), 3, 3, 10, 90),
                    exerciseRow(pick('legExtension'), 4, 3, 12, 75),
                    exerciseRow(pick('calfRaise'), 5, 4, 15, 60),
                ],
            },
        ],
    },
    {
        templateKey: 'upper-lower-hypertrophy',
        name: 'Upper / Lower — Hypertrophy',
        description: '4-day hypertrophy-focused upper/lower split with higher volume.',
        duration: 12,
        daysPerWeek: 4,
        goal: 'muscle_gain',
        level: 'intermediate',
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Upper Hypertrophy A',
                exercises: [
                    exerciseRow(pick('benchPress'), 1, 4, 10, 90),
                    exerciseRow(pick('seatedRow'), 2, 4, 10, 90),
                    exerciseRow(pick('inclineDbPress'), 3, 3, 12, 75),
                    exerciseRow(pick('latPulldown'), 4, 3, 12, 75),
                    exerciseRow(pick('lateralRaise'), 5, 4, 15, 45),
                    exerciseRow(pick('tricepsPushdown'), 6, 3, 12, 60),
                    exerciseRow(pick('dbCurl'), 7, 3, 12, 60),
                ],
            },
            {
                dayNumber: 2,
                name: 'Lower Hypertrophy A',
                exercises: [
                    exerciseRow(pick('squat'), 1, 4, 10, 120),
                    exerciseRow(pick('rdl'), 2, 3, 10, 90),
                    exerciseRow(pick('legPress'), 3, 3, 12, 90),
                    exerciseRow(pick('legCurl'), 4, 3, 12, 75),
                    exerciseRow(pick('legExtension'), 5, 3, 15, 60),
                    exerciseRow(pick('calfRaise'), 6, 4, 15, 45),
                ],
            },
            {
                dayNumber: 3,
                name: 'Upper Hypertrophy B',
                exercises: [
                    exerciseRow(pick('ohp'), 1, 4, 10, 90),
                    exerciseRow(pick('dbRow'), 2, 4, 10, 90),
                    exerciseRow(pick('cableFly'), 3, 3, 12, 60),
                    exerciseRow(pick('facePull'), 4, 3, 15, 45),
                    exerciseRow(pick('dip'), 5, 3, 10, 75),
                    exerciseRow(pick('hammerCurl'), 6, 3, 12, 60),
                ],
            },
            {
                dayNumber: 4,
                name: 'Lower Hypertrophy B',
                exercises: [
                    exerciseRow(pick('legPress'), 1, 4, 12, 90),
                    exerciseRow(pick('hipThrust'), 2, 4, 10, 90),
                    exerciseRow(pick('lunges'), 3, 3, 12, 75),
                    exerciseRow(pick('legCurl'), 4, 3, 12, 75),
                    exerciseRow(pick('calfRaise'), 5, 4, 15, 45),
                    exerciseRow(pick('crunch'), 6, 3, 15, 45),
                ],
            },
        ],
    },
    {
        templateKey: 'strength-4',
        name: 'Strength — 4 Days',
        description: '4-day strength focus emphasizing the big compound lifts.',
        duration: 12,
        daysPerWeek: 4,
        goal: 'strength',
        level: 'intermediate',
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Squat Day',
                exercises: [
                    exerciseRow(pick('squat'), 1, 5, 5, 180),
                    exerciseRow(pick('legPress'), 2, 3, 8, 120),
                    exerciseRow(pick('rdl'), 3, 3, 6, 120),
                    exerciseRow(pick('legCurl'), 4, 3, 10, 90),
                    exerciseRow(pick('calfRaise'), 5, 3, 12, 60),
                ],
            },
            {
                dayNumber: 2,
                name: 'Bench Day',
                exercises: [
                    exerciseRow(pick('benchPress'), 1, 5, 5, 180),
                    exerciseRow(pick('inclineDbPress'), 2, 3, 8, 120),
                    exerciseRow(pick('ohp'), 3, 3, 6, 120),
                    exerciseRow(pick('tricepsPushdown'), 4, 3, 10, 75),
                    exerciseRow(pick('lateralRaise'), 5, 3, 12, 60),
                ],
            },
            {
                dayNumber: 3,
                name: 'Deadlift Day',
                exercises: [
                    exerciseRow(pick('deadlift'), 1, 5, 3, 180),
                    exerciseRow(pick('seatedRow'), 2, 3, 8, 120),
                    exerciseRow(pick('latPulldown'), 3, 3, 8, 90),
                    exerciseRow(pick('facePull'), 4, 3, 12, 60),
                    exerciseRow(pick('dbCurl'), 5, 3, 10, 60),
                ],
            },
            {
                dayNumber: 4,
                name: 'Overhead / Accessory',
                exercises: [
                    exerciseRow(pick('ohp'), 1, 5, 5, 150),
                    exerciseRow(pick('closeGripBench'), 2, 3, 6, 120),
                    exerciseRow(pick('dbRow'), 3, 3, 8, 90),
                    exerciseRow(pick('lunges'), 4, 3, 8, 90),
                    exerciseRow(pick('plank'), 5, 3, 30, 45),
                ],
            },
        ],
    },
    {
        templateKey: 'general-fitness-3',
        name: 'General Fitness — 3 Days',
        description: 'Balanced 3-day program for overall fitness and habit building.',
        duration: 8,
        daysPerWeek: 3,
        goal: 'general_fitness',
        level: 'beginner',
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Full Body Strength',
                exercises: [
                    exerciseRow(pick('gobletSquat'), 1, 3, 10, 90),
                    exerciseRow(pick('pushUp'), 2, 3, 10, 60),
                    exerciseRow(pick('dbRow'), 3, 3, 10, 75),
                    exerciseRow(pick('gluteBridge'), 4, 3, 12, 60),
                    exerciseRow(pick('plank'), 5, 3, 30, 45),
                ],
            },
            {
                dayNumber: 2,
                name: 'Upper Focus',
                exercises: [
                    exerciseRow(pick('shoulderPress'), 1, 3, 10, 75),
                    exerciseRow(pick('latPulldown'), 2, 3, 10, 75),
                    exerciseRow(pick('cableFly'), 3, 3, 12, 60),
                    exerciseRow(pick('tricepsPushdown'), 4, 3, 12, 60),
                    exerciseRow(pick('dbCurl'), 5, 3, 12, 60),
                ],
            },
            {
                dayNumber: 3,
                name: 'Lower Focus',
                exercises: [
                    exerciseRow(pick('legPress'), 1, 3, 12, 90),
                    exerciseRow(pick('rdl'), 2, 3, 10, 90),
                    exerciseRow(pick('lunges'), 3, 3, 10, 75),
                    exerciseRow(pick('calfRaise'), 4, 3, 15, 45),
                    exerciseRow(pick('crunch'), 5, 3, 15, 45),
                ],
            },
        ],
    },
];

const backfillLegacyOwnership = async () => {
    const legacyPlans = await WorkoutPlan.find({
        ownership: { $exists: false },
        trainerId: { $ne: null },
    }).select('_id trainerId');

    let modified = 0;
    for (const plan of legacyPlans) {
        await WorkoutPlan.updateOne(
            { _id: plan._id },
            {
                $set: {
                    ownership: {
                        type: 'trainer',
                        trainerId: plan.trainerId,
                    },
                },
            }
        );
        modified += 1;
    }

    return modified;
};

const upsertTemplate = async (template) => {
    const existing = await WorkoutPlan.findOne({
        'ownership.type': 'system',
        isTemplate: true,
        templateKey: template.templateKey,
    });

    const payload = {
        ownership: { type: 'system', trainerId: null },
        trainerId: null,
        templateKey: template.templateKey,
        icon: TEMPLATE_ICONS[template.templateKey] ?? 'heroicons:bolt-20-solid',
        name: template.name,
        description: template.description,
        duration: template.duration,
        daysPerWeek: template.daysPerWeek,
        goal: template.goal,
        level: template.level,
        workoutDays: template.workoutDays,
        isTemplate: true,
        status: 'active',
        notes: null,
    };

    if (existing) {
        Object.assign(existing, payload);
        existing.markModified('workoutDays');
        existing.markModified('ownership');
        await existing.save();
        return 'updated';
    }

    await WorkoutPlan.create(payload);
    return 'created';
};

const main = async () => {
    const dbUrl = process.env.APP_DB_URL;
    if (!dbUrl) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(dbUrl);
    console.log('Connected to MongoDB');

    const backfilled = await backfillLegacyOwnership();
    if (backfilled > 0) {
        console.log(`Backfilled ownership on ${backfilled} legacy trainer plan(s)`);
    }

    const systemExercises = await Exercise.find({
        'ownership.type': 'system',
        status: 'active',
    }).select('name media.thumbnailUrl');

    const byName = new Map();
    for (const exercise of systemExercises) {
        byName.set(exercise.name.toLowerCase(), exercise);
    }

    console.log(`Loaded ${systemExercises.length} system exercises`);

    const substitutions = [];
    const pick = (key) => {
        const aliases = EXERCISE_ALIASES[key];
        if (!aliases) {
            throw new Error(`Unknown exercise alias key: ${key}`);
        }
        return resolveExercise(byName, aliases, substitutions, key);
    };

    // Resolve aliases once so missing exercises fail before writes
    for (const key of Object.keys(EXERCISE_ALIASES)) {
        pick(key);
    }

    const templates = buildTemplates(pick);

    if (templates.length !== TEMPLATE_KEYS.length) {
        throw new Error('Template count mismatch with TEMPLATE_KEYS');
    }

    const stats = { created: 0, updated: 0, skipped: 0, errors: [] };

    for (const template of templates) {
        try {
            const result = await upsertTemplate(template);
            stats[result] += 1;
            console.log(`${result.toUpperCase()}: ${template.templateKey} (${template.name})`);
        } catch (err) {
            stats.errors.push(`${template.templateKey}: ${err.message}`);
            console.error(`ERROR: ${template.templateKey} — ${err.message}`);
        }
    }

    if (substitutions.length) {
        console.log('\nExercise substitutions:');
        for (const line of substitutions) {
            console.log(`  - ${line}`);
        }
    }

    const systemCount = await WorkoutPlan.countDocuments({
        'ownership.type': 'system',
        isTemplate: true,
        templateKey: { $in: TEMPLATE_KEYS },
    });

    console.log('\nSeed summary');
    console.log(`  Created: ${stats.created}`);
    console.log(`  Updated: ${stats.updated}`);
    console.log(`  Skipped: ${stats.skipped}`);
    console.log(`  Errors: ${stats.errors.length}`);
    console.log(`  System templates with seed keys: ${systemCount}`);

    await mongoose.disconnect();

    if (stats.errors.length) {
        process.exit(1);
    }
};

main().catch(async (err) => {
    console.error(err);
    try {
        await mongoose.disconnect();
    } catch {
        // ignore
    }
    process.exit(1);
});
