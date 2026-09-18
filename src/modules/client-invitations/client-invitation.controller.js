import clientInvitationService from './client-invitation.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

/**
 * @desc    Create a client invitation (trainer copies URL to client)
 * @route   POST /api/v1/clients/:id/invitation
 * @access  Private (Trainer)
 */
export const createClientInvitation = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const result = await clientInvitationService.createInvitation(clientId, trainerId);

    res.status(201).json(
        new ApiResponse(201, result, 'Client invitation created successfully')
    );
});

/**
 * @desc    Preview / validate invitation token (public)
 * @route   GET /api/v1/client-invitations/:token
 * @access  Public
 */
export const previewClientInvitation = asyncHandler(async (req, res) => {
    const result = await clientInvitationService.previewInvitation(req.params.token);

    res.status(200).json(
        new ApiResponse(200, result, 'Invitation is valid')
    );
});

/**
 * @desc    Accept invitation and set password (public)
 * @route   POST /api/v1/client-invitations/:token/accept
 * @access  Public
 */
export const acceptClientInvitation = asyncHandler(async (req, res) => {
    const result = await clientInvitationService.acceptInvitation(
        req.params.token,
        req.body.password
    );

    res.status(200).json(
        new ApiResponse(200, result, 'Invitation accepted successfully')
    );
});
