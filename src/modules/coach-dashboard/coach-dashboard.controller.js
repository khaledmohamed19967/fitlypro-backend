import coachDashboardService from './coach-dashboard.service.js';
import { validateClientsGrowthQuery } from './coach-dashboard.validator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * @desc    Coach dashboard overview (Phase 1 — existing data)
 * @route   GET /api/v1/coach-dashboard/overview
 * @access  Private (trainer, admin)
 */
export const getCoachDashboardOverview = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const overview = await coachDashboardService.getOverview(trainerId);

    res.status(200).json(
        new ApiResponse(200, overview, 'Coach dashboard overview retrieved successfully')
    );
});

/**
 * @desc    Clients Growth time series for the authenticated trainer
 * @route   GET /api/v1/coach-dashboard/clients-growth
 * @access  Private (trainer, admin) — always scoped to req.user.id
 */
export const getCoachDashboardClientsGrowth = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;

    const { error, value } = validateClientsGrowthQuery.validate(req.query, {
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

    const growth = await coachDashboardService.getClientsGrowth(trainerId, value);

    res.status(200).json(
        new ApiResponse(200, growth, 'Clients growth retrieved successfully')
    );
});
