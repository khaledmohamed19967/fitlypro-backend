import clientProspectInvitationService from './client-prospect-invitation.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

/**
 * @desc    Create a prospect client invitation (coach copies URL / shares via WhatsApp)
 * @route   POST /api/v1/client-prospect-invitations
 * @access  Private (Trainer, Admin)
 */
export const createClientProspectInvitation = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;

    const result = await clientProspectInvitationService.createProspectInvitation(
        req.body,
        trainerId
    );

    res.status(201).json(
        new ApiResponse(201, result, 'Prospect invitation created successfully')
    );
});

/**
 * @desc    Reissue a pending prospect invitation (revokes prior pending for same phone)
 * @route   POST /api/v1/client-prospect-invitations/:invitationId/reissue
 * @access  Private (Trainer, Admin)
 */
export const reissueClientProspectInvitation = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;

    const result = await clientProspectInvitationService.reissueProspectInvitation(
        req.params.invitationId,
        trainerId
    );

    res.status(201).json(
        new ApiResponse(201, result, 'Prospect invitation reissued successfully')
    );
});

/**
 * @desc    Cancel / revoke a pending prospect invitation (no replacement created)
 * @route   POST /api/v1/client-prospect-invitations/:invitationId/revoke
 * @access  Private (Trainer, Admin)
 */
export const revokeClientProspectInvitation = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;

    const result = await clientProspectInvitationService.revokeProspectInvitation(
        req.params.invitationId,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(200, result, 'Prospect invitation cancelled successfully')
    );
});

/**
 * @desc    Preview / validate prospect invitation token (public)
 * @route   GET /api/v1/client-prospect-invitations/:token
 * @access  Public
 */
export const previewClientProspectInvitation = asyncHandler(async (req, res) => {
    const result = await clientProspectInvitationService.previewProspectInvitation(
        req.params.token
    );

    res.status(200).json(new ApiResponse(200, result, 'Invitation is valid'));
});

/**
 * @desc    Submit prospect registration (public) — creates pending ClientRegistrationRequest
 * @route   POST /api/v1/client-prospect-invitations/:token/register
 * @access  Public
 */
export const registerClientProspectInvitation = asyncHandler(async (req, res) => {
    const result = await clientProspectInvitationService.registerFromProspectInvitation(
        req.params.token,
        req.body
    );

    res.status(201).json(
        new ApiResponse(
            201,
            result,
            'Registration request submitted successfully'
        )
    );
});
