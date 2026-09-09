import Joi from 'joi';

const objectIdSchema = Joi.string()
    .hex()
    .length(24)
    .messages({
        'string.hex': 'Must be a valid ObjectId',
        'string.length': 'Must be a valid ObjectId',
    });

/**
 * Create nutrition plan assignment — client selection and schedule only.
 */
export const validateCreateNutritionAssignment = Joi.object({
    clientIds: Joi.array()
        .items(objectIdSchema)
        .min(1)
        .unique()
        .required()
        .messages({
            'array.min': 'At least one client is required',
            'any.required': 'At least one client is required',
            'array.unique': 'Client IDs must be unique',
        }),
    planVersionId: objectIdSchema.optional().allow(null),
    startDate: Joi.date().required().messages({
        'any.required': 'Start date is required',
    }),
    endDate: Joi.date().greater(Joi.ref('startDate')).optional().allow(null).messages({
        'date.greater': 'End date must be after start date',
    }),
    notes: Joi.string().trim().max(1000).optional().allow('', null),
    trainerId: Joi.forbidden(),
    planId: Joi.forbidden(),
    clientId: Joi.forbidden(),
    status: Joi.forbidden(),
    createdAt: Joi.forbidden(),
    updatedAt: Joi.forbidden(),
});

/**
 * Cancel nutrition plan assignment ("Remove from Client") — status only.
 * Forbidden keys are declared explicitly because validate() strips unknown keys.
 */
export const validateCancelNutritionAssignment = Joi.object({
    status: Joi.string().valid('cancelled').required().messages({
        'any.only': 'Only cancellation is supported (status must be cancelled)',
        'any.required': 'Status is required',
    }),
    trainerId: Joi.forbidden(),
    planId: Joi.forbidden(),
    clientId: Joi.forbidden(),
    planVersionId: Joi.forbidden(),
    startDate: Joi.forbidden(),
    endDate: Joi.forbidden(),
    notes: Joi.forbidden(),
    createdAt: Joi.forbidden(),
    updatedAt: Joi.forbidden(),
});
