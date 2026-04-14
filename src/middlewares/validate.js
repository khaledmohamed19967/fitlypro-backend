import { ApiError } from '../utils/ApiError.js';

/**
 * Validation Middleware
 * Validates request body against Joi schema
 */
export const validate = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
            abortEarly: false, // Get all errors, not just the first one
            stripUnknown: true, // Remove unknown fields
        });

        if (error) {
            const errors = error.details.map((detail) => ({
                field: detail.path.join('.'),
                message: detail.message,
            }));

            throw new ApiError(400, 'Validation failed', errors);
        }

        // Replace req.body with validated and sanitized value
        req.body = value;
        next();
    };
};
