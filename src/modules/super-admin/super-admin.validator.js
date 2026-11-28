import Joi from 'joi';

const objectId = Joi.string().hex().length(24).messages({
    'string.hex': 'id must be a valid ObjectId',
    'string.length': 'id must be a valid ObjectId',
});

/**
 * Shared list query: page / limit / search.
 */
export const validateSuperAdminListQuery = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().trim().allow('').max(200).optional(),
});

/**
 * Trainer clients list query.
 */
export const validateSuperAdminTrainerClientsQuery = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().trim().allow('').max(200).optional(),
    status: Joi.string().valid('active', 'inactive').optional(),
});

/**
 * Route param :trainerId
 */
export const validateTrainerIdParam = Joi.object({
    trainerId: objectId.required(),
});

export default {
    validateSuperAdminListQuery,
    validateSuperAdminTrainerClientsQuery,
    validateTrainerIdParam,
};
