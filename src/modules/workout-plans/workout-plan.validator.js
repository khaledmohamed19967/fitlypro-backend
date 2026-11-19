import Joi from 'joi';
import {
    WORKOUT_GOALS,
    WORKOUT_LEVELS,
    WORKOUT_PLAN_STATUSES,
    WEIGHT_UNITS,
    WORKOUT_PLAN_SORT_OPTIONS,
    OWNERSHIP_FILTERS,
    WARMUP_ACTIVITY_TYPES,
    CARDIO_ACTIVITY_TYPES,
    ACTIVITY_INTENSITIES,
    CARDIO_PROTOCOLS,
    ACTIVITY_DURATION_MINUTES_MIN,
    ACTIVITY_DURATION_MINUTES_MAX,
    MAX_DAY_ACTIVITIES,
} from './workout-plan.constants.js';
import {
    validateUniqueDayNumbers,
    validateUniqueExerciseOrders,
    validateUniqueSetNumbers,
    validateUniqueActivityOrders,
} from './workout-plan.helpers.js';

/**
 * Workout Plan validation schemas (Joi)
 * Body schemas are intended for use with existing `validate()` middleware.
 * Query schema is exported for Phase 2; no query middleware in Phase 1.
 */

const objectIdSchema = Joi.string()
    .hex()
    .length(24)
    .messages({
        'string.hex': 'Must be a valid ObjectId',
        'string.length': 'Must be a valid ObjectId',
    });

const forbiddenServerFields = {
    trainerId: Joi.forbidden(),
    clientId: Joi.forbidden(),
    startDate: Joi.forbidden(),
    endDate: Joi.forbidden(),
    createdAt: Joi.forbidden(),
    updatedAt: Joi.forbidden(),
    ownership: Joi.forbidden(),
    source: Joi.forbidden(),
    templateKey: Joi.forbidden(),
};

const exerciseSnapshotSchema = Joi.object({
    name: Joi.string().trim().min(1).max(120).required().messages({
        'any.required': 'Exercise snapshot name is required',
    }),
    thumbnailUrl: Joi.string().uri().allow(null, '').optional(),
});

const exerciseSetSchema = Joi.object({
    _id: objectIdSchema.optional(),
    setNumber: Joi.number().integer().min(1).required().messages({
        'any.required': 'Set number is required',
        'number.min': 'Set number must be at least 1',
    }),
    reps: Joi.number().integer().min(0).optional().allow(null),
    weight: Joi.number().min(0).optional().allow(null),
    weightUnit: Joi.string()
        .valid(...WEIGHT_UNITS)
        .default('kg')
        .messages({
            'any.only': 'Weight unit must be kg or lbs',
        }),
    isWarmup: Joi.boolean().optional().default(false),
    isDropset: Joi.boolean().optional().default(false),
});

const exerciseSetArraySchema = Joi.array()
    .items(exerciseSetSchema)
    .max(20)
    .custom((sets, helpers) => {
        const result = validateUniqueSetNumbers(sets);
        if (!result.valid) {
            return helpers.error('sets.uniqueSetNumbers');
        }
        return sets;
    })
    .messages({
        'sets.uniqueSetNumbers': 'Set numbers must be unique within each exercise',
    })
    .default([]);

const planExerciseSchema = Joi.object({
    _id: objectIdSchema.optional(),
    exerciseId: objectIdSchema.required().messages({
        'any.required': 'Exercise ID is required',
    }),
    order: Joi.number().integer().min(1).required().messages({
        'any.required': 'Exercise order is required',
        'number.min': 'Exercise order must be at least 1',
    }),
    sets: exerciseSetArraySchema,
    restBetweenSets: Joi.number().min(0).required().messages({
        'any.required': 'Rest between sets is required',
        'number.min': 'Rest between sets cannot be negative',
    }),
    notes: Joi.string().trim().max(500).optional().allow('', null),
    tempo: Joi.string().trim().max(20).optional().allow('', null),
    supersetWith: objectIdSchema.optional().allow(null),
    exerciseSnapshot: exerciseSnapshotSchema.optional().allow(null),
});

const planExerciseArraySchema = Joi.array()
    .items(planExerciseSchema)
    .max(50)
    .custom((exercises, helpers) => {
        const result = validateUniqueExerciseOrders(exercises);
        if (!result.valid) {
            return helpers.error('exercises.uniqueOrders');
        }
        return exercises;
    })
    .messages({
        'exercises.uniqueOrders': 'Exercise order values must be unique within each day',
    })
    .default([]);

const activitySnapshotSchema = Joi.object({
    name: Joi.string().trim().min(1).max(120).required().messages({
        'any.required': 'Activity snapshot name is required',
    }),
    thumbnailUrl: Joi.string().uri().allow(null, '').optional(),
});

const warmupActivitySchema = Joi.object({
    _id: objectIdSchema.optional(),
    activityType: Joi.string()
        .valid(...WARMUP_ACTIVITY_TYPES)
        .required()
        .messages({
            'any.required': 'Warm-up activity type is required',
            'any.only': 'Invalid warm-up activity type',
        }),
    order: Joi.number().integer().min(1).required().messages({
        'any.required': 'Warm-up activity order is required',
        'number.min': 'Warm-up activity order must be at least 1',
    }),
    durationMinutes: Joi.number()
        .integer()
        .min(ACTIVITY_DURATION_MINUTES_MIN)
        .max(ACTIVITY_DURATION_MINUTES_MAX)
        .required()
        .messages({
            'any.required': 'Warm-up duration is required',
            'number.min': `Warm-up duration must be at least ${ACTIVITY_DURATION_MINUTES_MIN} minute`,
            'number.max': `Warm-up duration cannot exceed ${ACTIVITY_DURATION_MINUTES_MAX} minutes`,
        }),
    intensity: Joi.string()
        .valid(...ACTIVITY_INTENSITIES)
        .required()
        .messages({
            'any.required': 'Warm-up intensity is required',
            'any.only': 'Intensity must be low, moderate, or high',
        }),
    notes: Joi.string().trim().max(500).optional().allow('', null),
    exerciseId: objectIdSchema.optional().allow(null),
    activitySnapshot: activitySnapshotSchema.optional().allow(null),
});

const warmupActivityArraySchema = Joi.array()
    .items(warmupActivitySchema)
    .max(MAX_DAY_ACTIVITIES)
    .custom((activities, helpers) => {
        const result = validateUniqueActivityOrders(activities, 'Warm-up');
        if (!result.valid) {
            return helpers.error('warmupActivities.uniqueOrders');
        }
        return activities;
    })
    .messages({
        'warmupActivities.uniqueOrders':
            'Warm-up activity order values must be unique within each day',
    });

const cardioActivitySchema = Joi.object({
    _id: objectIdSchema.optional(),
    activityType: Joi.string()
        .valid(...CARDIO_ACTIVITY_TYPES)
        .required()
        .messages({
            'any.required': 'Cardio activity type is required',
            'any.only': 'Invalid cardio activity type',
        }),
    protocol: Joi.string()
        .valid(...CARDIO_PROTOCOLS)
        .default('continuous')
        .messages({
            'any.only': 'Cardio protocol must be continuous or interval',
        }),
    order: Joi.number().integer().min(1).required().messages({
        'any.required': 'Cardio activity order is required',
        'number.min': 'Cardio activity order must be at least 1',
    }),
    durationMinutes: Joi.number()
        .integer()
        .min(ACTIVITY_DURATION_MINUTES_MIN)
        .max(ACTIVITY_DURATION_MINUTES_MAX)
        .required()
        .messages({
            'any.required': 'Cardio duration is required',
            'number.min': `Cardio duration must be at least ${ACTIVITY_DURATION_MINUTES_MIN} minute`,
            'number.max': `Cardio duration cannot exceed ${ACTIVITY_DURATION_MINUTES_MAX} minutes`,
        }),
    intensity: Joi.string()
        .valid(...ACTIVITY_INTENSITIES)
        .required()
        .messages({
            'any.required': 'Cardio intensity is required',
            'any.only': 'Intensity must be low, moderate, or high',
        }),
    distanceKm: Joi.number().min(0).max(1000).optional().allow(null),
    targetHeartRate: Joi.number().integer().min(0).max(250).optional().allow(null),
    workSeconds: Joi.number().integer().min(1).max(3600).optional().allow(null),
    recoverySeconds: Joi.number().integer().min(1).max(3600).optional().allow(null),
    rounds: Joi.number().integer().min(1).max(100).optional().allow(null),
    notes: Joi.string().trim().max(500).optional().allow('', null),
    exerciseId: objectIdSchema.optional().allow(null),
    activitySnapshot: activitySnapshotSchema.optional().allow(null),
}).custom((value, helpers) => {
    const protocol = value.protocol || 'continuous';
    const hasIntervalField =
        value.workSeconds != null || value.recoverySeconds != null || value.rounds != null;

    if (protocol === 'interval') {
        if (value.workSeconds == null || value.recoverySeconds == null || value.rounds == null) {
            return helpers.error('cardio.intervalFieldsRequired');
        }
    }

    if (protocol === 'continuous' && hasIntervalField) {
        return helpers.error('cardio.continuousForbidsIntervalFields');
    }

    return value;
}).messages({
    'cardio.intervalFieldsRequired':
        'Interval cardio requires workSeconds, recoverySeconds, and rounds',
    'cardio.continuousForbidsIntervalFields':
        'Continuous cardio cannot include workSeconds, recoverySeconds, or rounds',
});

const cardioActivityArraySchema = Joi.array()
    .items(cardioActivitySchema)
    .max(MAX_DAY_ACTIVITIES)
    .custom((activities, helpers) => {
        const result = validateUniqueActivityOrders(activities, 'Cardio');
        if (!result.valid) {
            return helpers.error('cardioActivities.uniqueOrders');
        }
        return activities;
    })
    .messages({
        'cardioActivities.uniqueOrders':
            'Cardio activity order values must be unique within each day',
    });

const workoutDaySchema = Joi.object({
    _id: objectIdSchema.optional(),
    dayNumber: Joi.number().integer().min(1).max(7).required().messages({
        'any.required': 'Day number is required',
        'number.min': 'Day number must be between 1 and 7',
        'number.max': 'Day number must be between 1 and 7',
    }),
    name: Joi.string().trim().min(1).max(120).required().messages({
        'any.required': 'Day name is required',
        'string.min': 'Day name is required',
    }),
    description: Joi.string().trim().max(2000).optional().allow('', null),
    // Optional without default: omit preserves on update; create treats omit as [].
    warmupActivities: warmupActivityArraySchema.optional(),
    exercises: planExerciseArraySchema,
    cardioActivities: cardioActivityArraySchema.optional(),
});

const workoutDaysSchema = Joi.array()
    .items(workoutDaySchema)
    .max(7)
    .custom((days, helpers) => {
        const result = validateUniqueDayNumbers(days);
        if (!result.valid) {
            return helpers.error('workoutDays.uniqueDayNumbers');
        }
        return days;
    })
    .messages({
        'workoutDays.uniqueDayNumbers': 'Day numbers must be unique within a plan',
    })
    .default([]);

const workoutPlanContentFields = {
    name: Joi.string().trim().min(2).max(120).messages({
        'string.min': 'Name must be at least 2 characters',
        'string.max': 'Name cannot exceed 120 characters',
    }),
    description: Joi.string().trim().max(2000).optional().allow('', null),
    duration: Joi.number().integer().min(1).messages({
        'number.min': 'Duration must be at least 1 week',
    }),
    daysPerWeek: Joi.number().integer().min(1).max(7).messages({
        'number.min': 'Days per week must be between 1 and 7',
        'number.max': 'Days per week must be between 1 and 7',
    }),
    goal: Joi.string()
        .valid(...WORKOUT_GOALS)
        .messages({
            'any.only': 'Goal must be a valid workout goal',
        }),
    level: Joi.string()
        .valid(...WORKOUT_LEVELS)
        .messages({
            'any.only': 'Level must be a valid workout level',
        }),
    workoutDays: workoutDaysSchema,
    isTemplate: Joi.boolean(),
    status: Joi.string()
        .valid(...WORKOUT_PLAN_STATUSES)
        .messages({
            'any.only': 'Status must be draft, active, or archived',
        }),
    notes: Joi.string().trim().max(500).optional().allow('', null),
    icon: Joi.string().trim().max(64).optional().allow('', null),
};

/**
 * Create workout plan — trainer-controlled fields only.
 */
export const validateCreateWorkoutPlan = Joi.object({
    name: workoutPlanContentFields.name.required().messages({
        'any.required': 'Name is required',
    }),
    description: workoutPlanContentFields.description,
    duration: workoutPlanContentFields.duration.required().messages({
        'any.required': 'Duration is required',
    }),
    daysPerWeek: workoutPlanContentFields.daysPerWeek.required().messages({
        'any.required': 'Days per week is required',
    }),
    goal: workoutPlanContentFields.goal.required().messages({
        'any.required': 'Goal is required',
    }),
    level: workoutPlanContentFields.level.required().messages({
        'any.required': 'Level is required',
    }),
    workoutDays: workoutPlanContentFields.workoutDays,
    isTemplate: workoutPlanContentFields.isTemplate.default(false),
    status: workoutPlanContentFields.status.optional(),
    notes: workoutPlanContentFields.notes,
    icon: workoutPlanContentFields.icon,
    _id: Joi.forbidden(),
    ...forbiddenServerFields,
});

/**
 * Update workout plan — partial metadata or full nested replace when workoutDays present.
 */
export const validateUpdateWorkoutPlan = Joi.object({
    name: workoutPlanContentFields.name.optional(),
    description: workoutPlanContentFields.description,
    duration: workoutPlanContentFields.duration.optional(),
    daysPerWeek: workoutPlanContentFields.daysPerWeek.optional(),
    goal: workoutPlanContentFields.goal.optional(),
    level: workoutPlanContentFields.level.optional(),
    workoutDays: workoutDaysSchema.optional(),
    isTemplate: workoutPlanContentFields.isTemplate.optional(),
    status: workoutPlanContentFields.status.optional(),
    notes: workoutPlanContentFields.notes,
    icon: workoutPlanContentFields.icon,
    _id: Joi.forbidden(),
    ...forbiddenServerFields,
}).min(1);

/**
 * List/search query schema (Phase 2 will wire this; no middleware in Phase 1).
 */
export const validateWorkoutPlanQuery = Joi.object({
    search: Joi.string().trim().max(100).optional().allow(''),
    status: Joi.string()
        .valid(...WORKOUT_PLAN_STATUSES)
        .optional(),
    ownership: Joi.string()
        .valid(...OWNERSHIP_FILTERS)
        .default('trainer'),
    isTemplate: Joi.boolean().truthy('true').falsy('false').optional(),
    goal: Joi.string()
        .valid(...WORKOUT_GOALS)
        .optional(),
    level: Joi.string()
        .valid(...WORKOUT_LEVELS)
        .optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(24),
    sort: Joi.string()
        .valid(...WORKOUT_PLAN_SORT_OPTIONS)
        .default('newest'),
});

/**
 * Workout plan tab counts — same filters as list except status/page/limit.
 */
export const validateWorkoutPlanSummaryQuery = Joi.object({
    search: Joi.string().trim().max(100).optional().allow(''),
    ownership: Joi.string()
        .valid(...OWNERSHIP_FILTERS)
        .default('trainer'),
    isTemplate: Joi.boolean().truthy('true').falsy('false').optional(),
    goal: Joi.string()
        .valid(...WORKOUT_GOALS)
        .optional(),
    level: Joi.string()
        .valid(...WORKOUT_LEVELS)
        .optional(),
    sort: Joi.string()
        .valid(...WORKOUT_PLAN_SORT_OPTIONS)
        .default('newest'),
});

/**
 * Clone template — optional name override only.
 */
export const validateCloneWorkoutPlan = Joi.object({
    name: Joi.string().trim().min(2).max(120).optional(),
    trainerId: Joi.forbidden(),
    ownership: Joi.forbidden(),
    templateKey: Joi.forbidden(),
    clientId: Joi.forbidden(),
    status: Joi.forbidden(),
    isTemplate: Joi.forbidden(),
    workoutDays: Joi.forbidden(),
    createdAt: Joi.forbidden(),
    updatedAt: Joi.forbidden(),
});

/**
 * Create plan assignment — client selection and schedule only.
 */
export const validateCreateAssignment = Joi.object({
    clientIds: Joi.array()
        .items(objectIdSchema)
        .min(1)
        .unique()
        .required()
        .messages({
            'array.min': 'At least one client is required',
            'any.required': 'At least one client is required',
            'array.unique': 'Client IDs must be unique',
        }),
    planVersionId: objectIdSchema.optional().allow(null),
    startDate: Joi.date().required().messages({
        'any.required': 'Start date is required',
    }),
    endDate: Joi.date().greater(Joi.ref('startDate')).optional().allow(null).messages({
        'date.greater': 'End date must be after start date',
    }),
    notes: Joi.string().trim().max(1000).optional().allow('', null),
    trainerId: Joi.forbidden(),
    planId: Joi.forbidden(),
    clientId: Joi.forbidden(),
    status: Joi.forbidden(),
    progress: Joi.forbidden(),
    completedSessions: Joi.forbidden(),
    totalSessions: Joi.forbidden(),
    createdAt: Joi.forbidden(),
    updatedAt: Joi.forbidden(),
});

/**
 * Cancel workout plan assignment ("Remove from Client") — status only.
 * Forbidden keys are declared explicitly because validate() strips unknown keys.
 */
export const validateCancelWorkoutAssignment = Joi.object({
    status: Joi.string().valid('cancelled').required().messages({
        'any.only': 'Only cancellation is supported (status must be cancelled)',
        'any.required': 'Status is required',
    }),
    trainerId: Joi.forbidden(),
    planId: Joi.forbidden(),
    clientId: Joi.forbidden(),
    planVersionId: Joi.forbidden(),
    startDate: Joi.forbidden(),
    endDate: Joi.forbidden(),
    notes: Joi.forbidden(),
    progress: Joi.forbidden(),
    completedSessions: Joi.forbidden(),
    totalSessions: Joi.forbidden(),
    createdAt: Joi.forbidden(),
    updatedAt: Joi.forbidden(),
});

/**
 * Create plan version snapshot — user-provided metadata only.
 * Full snapshot content is assembled server-side from the current plan.
 */
export const validateCreatePlanVersion = Joi.object({
    name: Joi.string().trim().min(2).max(120).optional(),
    changes: Joi.string().trim().max(500).optional().allow('', null),
    planId: Joi.forbidden(),
    trainerId: Joi.forbidden(),
    versionNumber: Joi.forbidden(),
    description: Joi.forbidden(),
    workoutDays: Joi.forbidden(),
    goal: Joi.forbidden(),
    level: Joi.forbidden(),
    duration: Joi.forbidden(),
    daysPerWeek: Joi.forbidden(),
    isActive: Joi.forbidden(),
    createdBy: Joi.forbidden(),
    createdAt: Joi.forbidden(),
}).min(1);
