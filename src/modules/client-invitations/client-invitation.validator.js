import Joi from 'joi';

/**
 * POST /clients/:id/invitation — body must not carry ownership or secrets.
 * Empty / missing body is allowed.
 */
export const validateCreateClientInvitation = Joi.object({
    trainerId: Joi.forbidden(),
    clientId: Joi.forbidden(),
    token: Joi.forbidden(),
    password: Joi.forbidden(),
    status: Joi.forbidden(),
    expiresAt: Joi.forbidden(),
    usedAt: Joi.forbidden(),
})
    .unknown(false)
    .default({});


/**
 * POST /client-invitations/:token/accept
 */
export const validateAcceptClientInvitation = Joi.object({
    password: Joi.string()
        .min(6)
        .max(128)
        .required()
        .messages({
            'string.min': 'Password must be at least 6 characters',
            'string.max': 'Password cannot exceed 128 characters',
            'any.required': 'Password is required',
        }),
    role: Joi.forbidden(),
    trainerId: Joi.forbidden(),
    clientId: Joi.forbidden(),
    email: Joi.forbidden(),
    isActive: Joi.forbidden(),
    usedAt: Joi.forbidden(),
    firstName: Joi.forbidden(),
    lastName: Joi.forbidden(),
}).unknown(false);
