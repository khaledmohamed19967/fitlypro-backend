import healthReferenceService from './health-reference.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

/**
 * @desc    List system health reference options
 * @route   GET /api/v1/health-reference-options
 */
export const listHealthReferenceOptions = asyncHandler(async (req, res) => {
    const { category, includeInactive } = req.query;

    const options = await healthReferenceService.listHealthReferenceOptions({
        category: category ? String(category) : undefined,
        includeInactive: includeInactive === 'true' || includeInactive === true,
    });

    res.status(200).json(
        new ApiResponse(200, { options }, 'Health reference options retrieved successfully')
    );
});
