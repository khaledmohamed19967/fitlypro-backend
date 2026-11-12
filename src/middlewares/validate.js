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

/**
 * Replace req.query with validated/sanitized values.
 * Express 5 exposes query as a getter-only property, so direct assignment throws.
 * Redefine the property on the request instead of mutating via `req.query = …`.
 *
 * @param {import('express').Request} req
 * @param {Record<string, unknown>} value
 */
const applyValidatedQuery = (req, value) => {
    Object.defineProperty(req, 'query', {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
    });
};

/**
 * Validation Middleware for query strings
 */
export const validateQuery = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.query, {
            abortEarly: false,
            stripUnknown: true,
            convert: true,
        });

        if (error) {
            const errors = error.details.map((detail) => ({
                field: detail.path.join('.'),
                message: detail.message,
            }));

            throw new ApiError(400, 'Validation failed', errors);
        }

        applyValidatedQuery(req, value);
        next();
    };
};
