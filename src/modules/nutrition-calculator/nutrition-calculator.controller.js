import nutritionCalculatorOrchestrator from './nutrition-calculator.orchestrator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

/**
 * @desc    Calculate nutrition recommendation (no persistence)
 * @route   POST /api/v1/clients/:id/nutrition-calculator/calculate
 */
export const calculateNutrition = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const result = await nutritionCalculatorOrchestrator.calculateForClient(
        clientId,
        req.body,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(200, result, 'Nutrition recommendation calculated successfully')
    );
});

/**
 * @desc    Persist / approve a nutrition recommendation snapshot
 * @route   POST /api/v1/clients/:id/nutrition-recommendations
 */
export const createRecommendation = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const nutritionRecommendation =
        await nutritionCalculatorOrchestrator.createRecommendation(
            clientId,
            req.body,
            trainerId
        );

    res.status(201).json(
        new ApiResponse(
            201,
            { nutritionRecommendation },
            'Nutrition recommendation saved successfully'
        )
    );
});

/**
 * @desc    List nutrition recommendation snapshots for a client
 * @route   GET /api/v1/clients/:id/nutrition-recommendations
 */
export const listRecommendations = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const nutritionRecommendations =
        await nutritionCalculatorOrchestrator.listRecommendations(
            clientId,
            trainerId,
            { limit: req.query.limit }
        );

    res.status(200).json(
        new ApiResponse(
            200,
            { nutritionRecommendations },
            'Nutrition recommendations retrieved successfully'
        )
    );
});

/**
 * @desc    Get one nutrition recommendation snapshot
 * @route   GET /api/v1/clients/:id/nutrition-recommendations/:recommendationId
 */
export const getRecommendationById = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const nutritionRecommendation =
        await nutritionCalculatorOrchestrator.getRecommendationById(
            clientId,
            req.params.recommendationId,
            trainerId
        );

    res.status(200).json(
        new ApiResponse(
            200,
            { nutritionRecommendation },
            'Nutrition recommendation retrieved successfully'
        )
    );
});

/**
 * @desc    Plan Builder prefill values from an approved recommendation
 * @route   GET /api/v1/clients/:id/nutrition-recommendations/:recommendationId/plan-prefill
 */
export const getRecommendationPlanPrefill = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const planPrefill = await nutritionCalculatorOrchestrator.getPlanPrefill(
        clientId,
        req.params.recommendationId,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(
            200,
            { planPrefill },
            'Nutrition plan prefill retrieved successfully'
        )
    );
});

/**
 * @desc    Update coach overrides / approval status on a snapshot
 * @route   PATCH /api/v1/clients/:id/nutrition-recommendations/:recommendationId
 */
export const updateRecommendation = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const nutritionRecommendation =
        await nutritionCalculatorOrchestrator.updateRecommendation(
            clientId,
            req.params.recommendationId,
            req.body,
            trainerId
        );

    res.status(200).json(
        new ApiResponse(
            200,
            { nutritionRecommendation },
            'Nutrition recommendation updated successfully'
        )
    );
});
