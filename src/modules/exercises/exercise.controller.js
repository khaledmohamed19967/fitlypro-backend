import exerciseService from './exercise.service.js';
import { validateExerciseQuery } from './exercise.validator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Exercise Controller — read endpoints (Phase 2)
 */

/**
 * @desc    List exercises (system + current trainer)
 * @route   GET /api/v1/exercises
 * @access  Private (Trainer / Admin)
 */
export const getExercises = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;

    const { error, value } = validateExerciseQuery.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
    });

    if (error) {
        const errors = error.details.map((detail) => ({
            field: detail.path.join('.'),
            message: detail.message,
        }));
        throw new ApiError(400, 'Validation failed', errors);
    }

    const result = await exerciseService.getExercises(value, trainerId);

    res.status(200).json(
        new ApiResponse(200, result, 'Exercises retrieved successfully')
    );
});

/**
 * @desc    Create trainer-owned custom exercise
 * @route   POST /api/v1/exercises
 * @access  Private (Trainer / Admin)
 */
export const createExercise = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const exercise = await exerciseService.createExercise(req.body, trainerId);

    res.status(201).json(
        new ApiResponse(201, exercise, 'Exercise created successfully')
    );
});

/**
 * @desc    Update trainer-owned exercise
 * @route   PATCH /api/v1/exercises/:id
 * @access  Private (Trainer / Admin — own exercises only)
 */
export const updateExercise = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const exercise = await exerciseService.updateExercise(
        req.params.id,
        req.body,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(200, exercise, 'Exercise updated successfully')
    );
});

/**
 * @desc    Get exercise by ID
 * @route   GET /api/v1/exercises/:id
 * @access  Private (Trainer / Admin)
 */
export const getExerciseById = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const exercise = await exerciseService.getExerciseById(req.params.id, trainerId);

    res.status(200).json(
        new ApiResponse(200, exercise, 'Exercise retrieved successfully')
    );
});
