import Joi from 'joi';
import {
    WEIGHT_UNITS,
    WORKOUT_SESSION_STATUSES,
    WORKOUT_SET_LOG_STATUSES,
} from './workout-plan.constants.js';

const objectIdSchema = Joi.string()
    .hex()
    .length(24)
    .messages({
        'string.hex': 'Must be a valid ObjectId',
        'string.length': 'Must be a valid ObjectId',
    });

const ownershipForbidden = {
    clientId: Joi.forbidden(),
    trainerId: Joi.forbidden(),
    planId: Joi.forbidden(),
    assignmentId: Joi.forbidden(),
    sessionId: Joi.forbidden(),
    progress: Joi.forbidden(),
    completedSessions: Joi.forbidden(),
    totalSessions: Joi.forbidden(),
    createdAt: Joi.forbidden(),
    updatedAt: Joi.forbidden(),
};

/**
 * Start a workout session from the player's active assignment.
 * Exactly one of workoutDayId / workoutDayNumber is required.
 */
export const validateStartWorkoutSession = Joi.object({
    workoutDayId: objectIdSchema.optional(),
    workoutDayNumber: Joi.number().integer().min(1).max(7).optional(),
    status: Joi.forbidden(),
    startedAt: Joi.forbidden(),
    completedAt: Joi.forbidden(),
    durationSeconds: Joi.forbidden(),
    completedSets: Joi.forbidden(),
    totalSets: Joi.forbidden(),
    ...ownershipForbidden,
})
    .or('workoutDayId', 'workoutDayNumber')
    .messages({
        'object.missing': 'workoutDayId or workoutDayNumber is required',
    });

/**
 * Log a performed set against a prescribed exercise/set.
 */
export const validateLogWorkoutSet = Joi.object({
    exerciseId: objectIdSchema.required().messages({
        'any.required': 'Exercise ID is required',
    }),
    setNumber: Joi.number().integer().min(1).required().messages({
        'any.required': 'Set number is required',
    }),
    status: Joi.string()
        .valid(...WORKOUT_SET_LOG_STATUSES)
        .default('completed'),
    reps: Joi.number().min(0).optional().allow(null),
    weight: Joi.number().min(0).optional().allow(null),
    weightUnit: Joi.string()
        .valid(...WEIGHT_UNITS)
        .optional()
        .default('kg'),
    durationSeconds: Joi.number().min(0).optional().allow(null),
    distance: Joi.number().min(0).optional().allow(null),
    notes: Joi.string().trim().max(500).optional().allow('', null),
    planExerciseId: Joi.forbidden(),
    workoutDayId: Joi.forbidden(),
    completedAt: Joi.forbidden(),
    ...ownershipForbidden,
});

/**
 * Update performed values on an existing set log.
 */
export const validateUpdateWorkoutSetLog = Joi.object({
    status: Joi.string()
        .valid(...WORKOUT_SET_LOG_STATUSES)
        .optional(),
    reps: Joi.number().min(0).optional().allow(null),
    weight: Joi.number().min(0).optional().allow(null),
    weightUnit: Joi.string()
        .valid(...WEIGHT_UNITS)
        .optional(),
    durationSeconds: Joi.number().min(0).optional().allow(null),
    distance: Joi.number().min(0).optional().allow(null),
    notes: Joi.string().trim().max(500).optional().allow('', null),
    exerciseId: Joi.forbidden(),
    setNumber: Joi.forbidden(),
    planExerciseId: Joi.forbidden(),
    workoutDayId: Joi.forbidden(),
    completedAt: Joi.forbidden(),
    ...ownershipForbidden,
}).min(1);

/**
 * List player sessions.
 */
export const validateListWorkoutSessionsQuery = Joi.object({
    status: Joi.string()
        .valid(...WORKOUT_SESSION_STATUSES)
        .optional(),
    assignmentId: objectIdSchema.optional(),
    from: Joi.date().optional(),
    to: Joi.date().optional(),
    page: Joi.number().integer().min(1).optional().default(1),
    limit: Joi.number().integer().min(1).max(100).optional().default(20),
});
