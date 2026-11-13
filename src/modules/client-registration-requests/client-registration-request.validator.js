import Joi from 'joi';
import { CLIENT_REGISTRATION_REQUEST_STATUSES } from './client-registration-request.constants.js';

const ownershipForbidden = {
    trainerId: Joi.forbidden(),
    trainer: Joi.forbidden(),
    approvalStatus: Joi.forbidden(),
    createdUserId: Joi.forbidden(),
    reviewedAt: Joi.forbidden(),
    reviewedBy: Joi.forbidden(),
    invitationId: Joi.forbidden(),
    email: Joi.forbidden(),
    password: Joi.forbidden(),
    role: Joi.forbidden(),
    isActive: Joi.forbidden(),
    joinedCoachAt: Joi.forbidden(),
    registrationRequestId: Joi.forbidden(),
};

/**
 * GET /client-registration-requests — trainer inbox list query.
 * Ownership always comes from the authenticated trainer.
 */
export const validateListRegistrationRequestsQuery = Joi.object({
    approvalStatus: Joi.string()
        .valid(...CLIENT_REGISTRATION_REQUEST_STATUSES)
        .optional()
        .messages({
            'any.only': 'Approval status must be pending, approved, or rejected',
        }),
    search: Joi.string().trim().max(100).optional().allow(''),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(24),
    trainerId: Joi.forbidden(),
    trainer: Joi.forbidden(),
    password: Joi.forbidden(),
    token: Joi.forbidden(),
    tokenHash: Joi.forbidden(),
    passwordInvitationClaimedAt: Joi.forbidden(),
}).unknown(false);

/**
 * POST /client-registration-requests/:id/approve
 * Ownership and profile fields are never accepted from the body.
 */
export const validateApproveRegistrationRequest = Joi.object({
    ...ownershipForbidden,
    rejectionReason: Joi.forbidden(),
})
    .unknown(false)
    .default({});

/**
 * POST /client-registration-requests/:id/reject
 * Optional note only. Trainer id always comes from the authenticated user.
 */
export const validateRejectRegistrationRequest = Joi.object({
    ...ownershipForbidden,
    rejectionReason: Joi.string().trim().max(500).optional().allow(null, ''),
})
    .unknown(false)
    .default({});
