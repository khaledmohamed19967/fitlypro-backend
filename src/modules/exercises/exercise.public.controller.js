import publicExerciseService from './exercise.public.service.js';
import { validatePublicExerciseQuery } from './exercise.validator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * @desc    Public Fitly exercise catalog (active system exercises only)
 * @route   GET /api/v1/public/exercises
 * @access  Public
 */
export const listPublicExercises = asyncHandler(async (req, res) => {
    const { error, value } = validatePublicExerciseQuery.validate(req.query, {
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

    const result = await publicExerciseService.listPublicExercises(value);

    res.status(200).json(
        new ApiResponse(200, result, 'Exercises retrieved successfully')
    );
});

/**
 * @desc    Public Fitly exercise detail (active system only)
 * @route   GET /api/v1/public/exercises/:idOrSlug
 * @access  Public
 */
export const getPublicExercise = asyncHandler(async (req, res) => {
    const exercise = await publicExerciseService.getPublicExercise(req.params.idOrSlug);

    res.status(200).json(
        new ApiResponse(200, exercise, 'Exercise retrieved successfully')
    );
});
