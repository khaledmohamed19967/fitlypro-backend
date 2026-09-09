import Joi from 'joi';
import {
    DEFAULT_PLAN_EXPORT_TEMPLATE_ID,
    PLAN_EXPORT_TEMPLATE_IDS,
    PLAN_EXPORT_TYPES,
} from './plan-export.constants.js';

const objectIdSchema = Joi.string().hex().length(24).messages({
    'string.hex': 'Must be a valid ObjectId',
    'string.length': 'Must be a valid ObjectId',
});

export const validatePlanExportBody = Joi.object({
    planType: Joi.string()
        .valid(...PLAN_EXPORT_TYPES)
        .required()
        .messages({
            'any.required': 'planType is required',
            'any.only': `planType must be one of: ${PLAN_EXPORT_TYPES.join(', ')}`,
        }),
    planId: objectIdSchema.required().messages({
        'any.required': 'planId is required',
    }),
    templateId: Joi.string()
        .valid(...PLAN_EXPORT_TEMPLATE_IDS)
        .default(DEFAULT_PLAN_EXPORT_TEMPLATE_ID)
        .messages({
            'any.only': `templateId must be one of: ${PLAN_EXPORT_TEMPLATE_IDS.join(', ')}`,
        }),
});

export const validatePlanExportTemplatesQuery = Joi.object({
    planType: Joi.string()
        .valid(...PLAN_EXPORT_TYPES)
        .optional(),
});
