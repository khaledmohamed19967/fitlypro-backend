import Joi from 'joi';
import {
    HEALTH_OPTION_SELECTION_MAX,
    HEALTH_REFERENCE_CATEGORIES,
} from './health-reference.constants.js';

export const objectIdSchema = Joi.string()
    .hex()
    .length(24)
    .messages({
        'string.hex': 'Must be a valid ObjectId',
        'string.length': 'Must be a valid ObjectId',
    });

export const healthOptionIdList = Joi.array()
    .items(objectIdSchema)
    .unique()
    .max(HEALTH_OPTION_SELECTION_MAX)
    .optional();

export const validateListHealthReferenceOptionsQuery = Joi.object({
    category: Joi.string()
        .valid(...HEALTH_REFERENCE_CATEGORIES)
        .optional()
        .messages({
            'any.only': 'Invalid health reference category',
        }),
    includeInactive: Joi.boolean().optional(),
});
