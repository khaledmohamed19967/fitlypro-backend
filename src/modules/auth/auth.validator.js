import Joi from 'joi';

/**
 * Auth Validation Schemas
 */

/**
 * Register validation schema
 */
export const validateRegister = Joi.object({
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

    password: Joi.string()
        .min(6)
        .max(128)
        .required()
        .messages({
            'string.min': 'Password must be at least 6 characters',
            'string.max': 'Password cannot exceed 128 characters',
            'any.required': 'Password is required',
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
});

/**
 * Login validation schema
 */
export const validateLogin = Joi.object({
    email: Joi.string()
        .email()
        .required()
        .lowercase()
        .trim()
        .messages({
            'string.email': 'Please provide a valid email address',
            'any.required': 'Email is required',
        }),

    password: Joi.string()
        .required()
        .messages({
            'any.required': 'Password is required',
        }),
});

/**
 * Update password validation schema
 */
export const validateUpdatePassword = Joi.object({
    currentPassword: Joi.string()
        .required()
        .messages({
            'any.required': 'Current password is required',
        }),

    newPassword: Joi.string()
        .min(6)
        .max(128)
        .required()
        .messages({
            'string.min': 'New password must be at least 6 characters',
            'string.max': 'New password cannot exceed 128 characters',
            'any.required': 'New password is required',
        }),

    confirmPassword: Joi.string()
        .valid(Joi.ref('newPassword'))
        .required()
        .messages({
            'any.only': 'Passwords do not match',
            'any.required': 'Please confirm your new password',
        }),
});
