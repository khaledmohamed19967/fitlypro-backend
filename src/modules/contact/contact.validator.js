import Joi from 'joi';
import {
    CONTACT_EMAIL_MAX,
    CONTACT_FULL_NAME_MAX,
    CONTACT_FULL_NAME_MIN,
    CONTACT_MESSAGE_MAX,
    CONTACT_MESSAGE_MIN,
} from './contact.constants.js';

/**
 * POST /contact — public Contact Us form body.
 */
export const validateCreateContactMessage = Joi.object({
    fullName: Joi.string()
        .trim()
        .min(CONTACT_FULL_NAME_MIN)
        .max(CONTACT_FULL_NAME_MAX)
        .required()
        .messages({
            'string.empty': 'Full name is required',
            'any.required': 'Full name is required',
            'string.min': `Full name must be at least ${CONTACT_FULL_NAME_MIN} characters`,
            'string.max': `Full name cannot exceed ${CONTACT_FULL_NAME_MAX} characters`,
        }),
    email: Joi.string()
        .trim()
        .email({ tlds: { allow: false } })
        .max(CONTACT_EMAIL_MAX)
        .required()
        .messages({
            'string.empty': 'Email is required',
            'any.required': 'Email is required',
            'string.email': 'Please provide a valid email address',
            'string.max': `Email cannot exceed ${CONTACT_EMAIL_MAX} characters`,
        }),
    message: Joi.string()
        .trim()
        .min(CONTACT_MESSAGE_MIN)
        .max(CONTACT_MESSAGE_MAX)
        .required()
        .messages({
            'string.empty': 'Message is required',
            'any.required': 'Message is required',
            'string.min': 'Message is required',
            'string.max': `Message cannot exceed ${CONTACT_MESSAGE_MAX} characters`,
        }),
}).required();
