import clientRegistrationRequestService from './client-registration-request.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

/**
 * @desc    List registration requests for the authenticated trainer
 * @route   GET /api/v1/client-registration-requests
 * @access  Private (Trainer)
 */
export const listRegistrationRequests = asyncHandler(async (req, res) => {
    const result = await clientRegistrationRequestService.list(req.user.id, req.query);

    res.status(200).json(
        new ApiResponse(200, result, 'Registration requests retrieved successfully')
    );
});

/**
 * @desc    Get one owned registration request
 * @route   GET /api/v1/client-registration-requests/:id
 * @access  Private (owning trainer)
 */
export const getRegistrationRequestById = asyncHandler(async (req, res) => {
    const result = await clientRegistrationRequestService.getById(req.params.id, req.user.id);

    res.status(200).json(
        new ApiResponse(200, result, 'Registration request retrieved successfully')
    );
});

/**
 * @desc    Approve a prospect registration and create the passwordless client
 * @route   POST /api/v1/client-registration-requests/:id/approve
 * @access  Private (owning trainer)
 */
export const approveRegistrationRequest = asyncHandler(async (req, res) => {
    const result = await clientRegistrationRequestService.approve(req.params.id, req.user.id);

    res.status(200).json(
        new ApiResponse(200, result, 'Registration request approved successfully')
    );
});

/**
 * @desc    Reject a pending prospect registration
 * @route   POST /api/v1/client-registration-requests/:id/reject
 * @access  Private (owning trainer)
 */
export const rejectRegistrationRequest = asyncHandler(async (req, res) => {
    const result = await clientRegistrationRequestService.reject(
        req.params.id,
        req.user.id,
        req.body
    );

    res.status(200).json(
        new ApiResponse(200, result, 'Registration request rejected successfully')
    );
});
