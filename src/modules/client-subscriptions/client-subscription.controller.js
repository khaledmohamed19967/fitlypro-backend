import clientSubscriptionService from './client-subscription.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

/**
 * @desc    Get client's current (active) subscription
 * @route   GET /api/v1/clients/:id/subscription
 * @access  Private (Trainer / Admin)
 */
export const getCurrentClientSubscription = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const subscription = await clientSubscriptionService.getCurrentSubscription({
        trainerId,
        clientId,
    });

    res.status(200).json(
        new ApiResponse(
            200,
            { subscription },
            subscription
                ? 'Active subscription retrieved successfully'
                : 'No active subscription for this client'
        )
    );
});

/**
 * @desc    Get client subscription history (paginated)
 * @route   GET /api/v1/clients/:id/subscription/history
 * @access  Private (Trainer / Admin)
 */
export const getClientSubscriptionHistory = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;
    const { page, limit } = req.query;

    const result = await clientSubscriptionService.getSubscriptionHistory({
        trainerId,
        clientId,
        page,
        limit,
    });

    res.status(200).json(
        new ApiResponse(
            200,
            result,
            'Subscription history retrieved successfully'
        )
    );
});

/**
 * @desc    Create a new active subscription for a client
 * @route   POST /api/v1/clients/:id/subscription
 * @access  Private (Trainer / Admin)
 */
export const createClientSubscription = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;
    const { packageDuration } = req.body;

    const subscription = await clientSubscriptionService.createSubscription({
        trainerId,
        clientId,
        packageDuration,
    });

    res.status(201).json(
        new ApiResponse(
            201,
            { subscription },
            'Subscription created successfully'
        )
    );
});

/**
 * @desc    Cancel current subscription (or complete if already date-expired)
 * @route   POST /api/v1/clients/:id/subscription/cancel
 * @access  Private (Trainer / Admin)
 */
export const cancelClientSubscription = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const subscription = await clientSubscriptionService.cancelSubscription({
        trainerId,
        clientId,
    });

    const message =
        subscription?.status === 'completed'
            ? 'Expired subscription marked completed successfully'
            : 'Subscription cancelled successfully';

    res.status(200).json(
        new ApiResponse(200, { subscription }, message)
    );
});
