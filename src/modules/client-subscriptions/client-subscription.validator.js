import Joi from 'joi';
import { PACKAGE_DURATION_VALUES } from './client-subscription.constants.js';

/**
 * POST /clients/:id/subscription
 * Only packageDuration is client-controlled. Server owns dates/status/ids.
 */
export const validateCreateSubscription = Joi.object({
    packageDuration: Joi.string()
        .valid(...PACKAGE_DURATION_VALUES)
        .required()
        .messages({
            'any.required': 'Package duration is required',
            'any.only': `Package duration must be one of: ${PACKAGE_DURATION_VALUES.join(', ')}`,
        }),
    trainerId: Joi.forbidden(),
    clientId: Joi.forbidden(),
    status: Joi.forbidden(),
    startDate: Joi.forbidden(),
    endDate: Joi.forbidden(),
}).unknown(false);

/**
 * GET /clients/:id/subscription/history
 */
export const validateSubscriptionHistoryQuery = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
});
