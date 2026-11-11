import coachDashboardService from './coach-dashboard.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

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
