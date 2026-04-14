import Joi from 'joi';

/**
 * User Validation Schemas
 */

export const validateUser = Joi.object({
    firstName: Joi.string()
        .min(2)
        .max(50)
        .required()
        .trim()
        .messages({
            'string.min': 'First name must be at least 2 characters',
            'string.max': 'First name cannot exceed 50 characters',
            'any.required': 'First name is required',
        }),

    lastName: Joi.string()
        .min(2)
        .max(50)
        .required()
        .trim()
        .messages({
            'string.min': 'Last name must be at least 2 characters',
            'string.max': 'Last name cannot exceed 50 characters',
            'any.required': 'Last name is required',
        }),

    email: Joi.string()
        .email()
        .required()
        .lowercase()
        .trim()
        .messages({
            'string.email': 'Please provide a valid email address',
            'any.required': 'Email is required',
        }),

    phone: Joi.string()
        .pattern(/^[0-9]{10,15}$/)
        .optional()
        .messages({
            'string.pattern.base': 'Please provide a valid phone number (10-15 digits)',
        }),

    dateOfBirth: Joi.date()
        .max('now')
        .optional()
        .messages({
            'date.max': 'Date of birth cannot be in the future',
        }),

    gender: Joi.string()
        .valid('male', 'female', 'other')
        .optional()
        .messages({
            'any.only': 'Gender must be either male, female, or other',
        }),

    role: Joi.string()
        .valid('client', 'trainer', 'admin')
        .optional()
        .default('client')
        .messages({
            'any.only': 'Role must be either client, trainer, or admin',
        }),

    trainer: Joi.string()
        .regex(/^[0-9a-fA-F]{24}$/)
        .optional()
        .allow(null)
        .messages({
            'string.pattern.base': 'Invalid trainer ID format',
        }),
});

export const validateUpdateUser = Joi.object({
    firstName: Joi.string().min(2).max(50).trim().optional(),
    lastName: Joi.string().min(2).max(50).trim().optional(),
    email: Joi.string().email().lowercase().trim().optional(),
    phone: Joi.string().pattern(/^[0-9]{10,15}$/).optional(),
    dateOfBirth: Joi.date().max('now').optional(),
    gender: Joi.string().valid('male', 'female', 'other').optional(),
    isActive: Joi.boolean().optional(),
    role: Joi.string().valid('client', 'trainer', 'admin').optional(),
    trainer: Joi.string()
        .regex(/^[0-9a-fA-F]{24}$/)
        .optional()
        .allow(null)
        .messages({
            'string.pattern.base': 'Invalid trainer ID format',
        }),
}).min(1); // At least one field must be provided for update
