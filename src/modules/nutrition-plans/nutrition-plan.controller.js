import nutritionPlanService from './nutrition-plan.service.js';
import {
    validateNutritionPlanQuery,
    validateNutritionPlanSummaryQuery,
    validateCreateNutritionPlan,
    validateUpdateNutritionPlan,
    validateCloneNutritionPlan,
} from './nutrition-plan.validator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Nutrition Plan Controller — CRUD (Phase 4)
 */

/**
 * @desc    List trainer nutrition plans
 * @route   GET /api/v1/nutrition-plans
 * @access  Private (Trainer / Admin)
 */
export const getNutritionPlans = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;

    const { error, value } = validateNutritionPlanQuery.validate(req.query, {
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

    const result = await nutritionPlanService.listNutritionPlans(value, trainerId);

    res.status(200).json(
        new ApiResponse(200, result, 'Nutrition plans retrieved successfully')
    );
});

/**
 * @desc    Nutrition plan tab counts for the current filter context
 * @route   GET /api/v1/nutrition-plans/summary
 * @access  Private (Trainer / Admin)
 */
export const getNutritionPlanSummary = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;

    const { error, value } = validateNutritionPlanSummaryQuery.validate(req.query, {
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

    const counts = await nutritionPlanService.getNutritionPlanSummary(value, trainerId);

    res.status(200).json(
        new ApiResponse(200, counts, 'Nutrition plan summary retrieved successfully')
    );
});

/**
 * @desc    Get nutrition plan by ID
 * @route   GET /api/v1/nutrition-plans/:id
 * @access  Private (Trainer / Admin)
 */
export const getNutritionPlanById = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const nutritionPlan = await nutritionPlanService.getNutritionPlanById(
        req.params.id,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(200, { nutritionPlan }, 'Nutrition plan retrieved successfully')
    );
});

/**
 * @desc    Create nutrition plan
 * @route   POST /api/v1/nutrition-plans
 * @access  Private (Trainer / Admin)
 */
export const createNutritionPlan = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const nutritionPlan = await nutritionPlanService.createNutritionPlan(req.body, trainerId);

    res.status(201).json(
        new ApiResponse(201, { nutritionPlan }, 'Nutrition plan created successfully')
    );
});

/**
 * @desc    Update nutrition plan
 * @route   PATCH /api/v1/nutrition-plans/:id
 * @access  Private (Trainer / Admin)
 */
export const updateNutritionPlan = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const nutritionPlan = await nutritionPlanService.updateNutritionPlan(
        req.params.id,
        req.body,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(200, { nutritionPlan }, 'Nutrition plan updated successfully')
    );
});

/**
 * @desc    Archive nutrition plan
 * @route   DELETE /api/v1/nutrition-plans/:id
 * @access  Private (Trainer / Admin)
 */
export const archiveNutritionPlan = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const nutritionPlan = await nutritionPlanService.archiveNutritionPlan(
        req.params.id,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(200, { nutritionPlan }, 'Nutrition plan archived successfully')
    );
});

/**
 * @desc    Clone an active plan into a new trainer-owned plan
 * @route   POST /api/v1/nutrition-plans/:id/clone
 * @access  Private (Trainer / Admin)
 */
export const cloneNutritionPlan = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const nutritionPlan = await nutritionPlanService.cloneNutritionPlan(
        req.params.id,
        trainerId,
        req.body
    );

    res.status(201).json(
        new ApiResponse(201, { nutritionPlan }, 'Nutrition plan cloned successfully')
    );
});
