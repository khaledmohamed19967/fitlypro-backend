import workoutSessionService from './workout-session.service.js';
import {
    validateStartWorkoutSession,
    validateLogWorkoutSet,
    validateUpdateWorkoutSetLog,
    validateListWorkoutSessionsQuery,
} from './workout-session.validator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Player Workout Session Controller
 */

export const startWorkoutSession = asyncHandler(async (req, res) => {
    const clientId = req.user.id;
    const session = await workoutSessionService.startSession(clientId, req.body);

    res.status(201).json(
        new ApiResponse(201, { session }, 'Workout session started successfully')
    );
});

export const logWorkoutSet = asyncHandler(async (req, res) => {
    const clientId = req.user.id;
    const setLog = await workoutSessionService.logSet(
        req.params.sessionId,
        clientId,
        req.body
    );

    res.status(201).json(new ApiResponse(201, { setLog }, 'Set logged successfully'));
});

export const updateWorkoutSetLog = asyncHandler(async (req, res) => {
    const clientId = req.user.id;
    const setLog = await workoutSessionService.updateSetLog(
        req.params.sessionId,
        req.params.setLogId,
        clientId,
        req.body
    );

    res.status(200).json(new ApiResponse(200, { setLog }, 'Set log updated successfully'));
});

export const completeWorkoutSession = asyncHandler(async (req, res) => {
    const clientId = req.user.id;
    const session = await workoutSessionService.completeSession(
        req.params.sessionId,
        clientId
    );

    res.status(200).json(
        new ApiResponse(200, { session }, 'Workout session completed successfully')
    );
});

export const abandonWorkoutSession = asyncHandler(async (req, res) => {
    const clientId = req.user.id;
    const session = await workoutSessionService.abandonSession(
        req.params.sessionId,
        clientId
    );

    res.status(200).json(
        new ApiResponse(200, { session }, 'Workout session abandoned successfully')
    );
});

export const listMyWorkoutSessions = asyncHandler(async (req, res) => {
    const clientId = req.user.id;

    const { error, value } = validateListWorkoutSessionsQuery.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
    });

    if (error) {
        const errors = error.details.map((detail) => ({
            field: detail.path.join('.'),
            message: detail.message,
        }));
        throw new ApiError(400, 'Validation failed', errors);
    }

    const result = await workoutSessionService.listSessions(clientId, value);

    res.status(200).json(
        new ApiResponse(200, result, 'Workout sessions retrieved successfully')
    );
});

export const getMyWorkoutSession = asyncHandler(async (req, res) => {
    const clientId = req.user.id;
    const session = await workoutSessionService.getSession(req.params.sessionId, clientId);

    res.status(200).json(
        new ApiResponse(200, { session }, 'Workout session retrieved successfully')
    );
});

export {
    validateStartWorkoutSession,
    validateLogWorkoutSet,
    validateUpdateWorkoutSetLog,
};
