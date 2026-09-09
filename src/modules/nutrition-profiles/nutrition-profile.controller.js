import nutritionProfileService from './nutrition-profile.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

/**
 * @desc    Get client nutrition profile
 * @route   GET /api/v1/clients/:id/nutrition-profile
 */
export const getNutritionProfile = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const nutritionProfile = await nutritionProfileService.getNutritionProfile(
        clientId,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(
            200,
            { nutritionProfile },
            nutritionProfile
                ? 'Nutrition profile retrieved successfully'
                : 'Nutrition profile not found for this client'
        )
    );
});

/**
 * @desc    Create or update client nutrition profile
 * @route   PUT /api/v1/clients/:id/nutrition-profile
 */
export const upsertNutritionProfile = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const nutritionProfile = await nutritionProfileService.upsertNutritionProfile(
        clientId,
        req.body,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(200, { nutritionProfile }, 'Nutrition profile saved successfully')
    );
});
