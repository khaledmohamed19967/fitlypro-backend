import Joi from 'joi';
import {
    CLIENTS_GROWTH_GROUP_BY,
    CLIENTS_GROWTH_RANGES,
} from './coach-dashboard.constants.js';

/**
 * GET /coach-dashboard/clients-growth query.
 */
export const validateClientsGrowthQuery = Joi.object({
    range: Joi.string()
        .valid(...CLIENTS_GROWTH_RANGES)
        .required()
        .messages({
            'any.required': 'range is required',
            'any.only': `range must be one of: ${CLIENTS_GROWTH_RANGES.join(', ')}`,
        }),
    groupBy: Joi.string()
        .valid(...CLIENTS_GROWTH_GROUP_BY)
        .optional()
        .messages({
            'any.only': `groupBy must be one of: ${CLIENTS_GROWTH_GROUP_BY.join(', ')}`,
        }),
});
