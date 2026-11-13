import Joi from 'joi';
import { healthOptionIdList } from '../health-reference/health-reference.validator.js';
import { normalizeProspectPhone } from './client-prospect-invitation.helpers.js';

/**
 * POST /api/v1/client-prospect-invitations
 * Coach supplies prospect display name + WhatsApp phone only.
 */
export const validateCreateClientProspectInvitation = Joi.object({
    clientName: Joi.string()
        .min(2)
        .max(100)
        .trim()
        .required()
        .messages({
            'string.empty': 'Client name is required',
            'string.min': 'Client name must be at least 2 characters',
            'string.max': 'Client name cannot exceed 100 characters',
            'any.required': 'Client name is required',
        }),

    phone: Joi.string()
        .required()
        .custom((value, helpers) => {
            const normalized = normalizeProspectPhone(value);
            if (!/^[0-9]{10,15}$/.test(normalized)) {
                return helpers.error('any.invalid');
            }
            return normalized;
        })
        .messages({
            'string.empty': 'Phone number is required',
            'any.required': 'Phone number is required',
            'any.invalid': 'Please provide a valid phone number (10-15 digits)',
        }),

    // Block privilege / lifecycle injection
    trainerId: Joi.forbidden(),
    token: Joi.forbidden(),
    tokenHash: Joi.forbidden(),
    status: Joi.forbidden(),
    expiresAt: Joi.forbidden(),
    usedAt: Joi.forbidden(),
    revokedAt: Joi.forbidden(),
    role: Joi.forbidden(),
    password: Joi.forbidden(),
}).unknown(false);

/**
 * Public prospect registration — same fields as Add Client (`validateCreateClient`)
 * except password (forbidden). Privilege / ownership / approval fields are forbidden.
 */
export const validateProspectRegistration = Joi.object({
    firstName: Joi.string()
        .min(2)
        .max(50)
        .trim()
        .required()
        .messages({
            'string.empty': 'First name is required',
            'string.min': 'First name must be at least 2 characters',
            'string.max': 'First name cannot exceed 50 characters',
            'any.required': 'First name is required',
        }),

    lastName: Joi.string()
        .min(2)
        .max(50)
        .trim()
        .required()
        .messages({
            'string.empty': 'Last name is required',
            'string.min': 'Last name must be at least 2 characters',
            'string.max': 'Last name cannot exceed 50 characters',
            'any.required': 'Last name is required',
        }),

    email: Joi.string()
        .email()
        .lowercase()
        .trim()
        .required()
        .messages({
            'string.empty': 'Email is required',
            'string.email': 'Please provide a valid email address',
            'any.required': 'Email is required',
        }),

    phone: Joi.string()
        .optional()
        .allow('', null)
        .custom((value, helpers) => {
            if (value == null || value === '') {
                return undefined;
            }
            const normalized = normalizeProspectPhone(value);
            if (!/^[0-9]{10,15}$/.test(normalized)) {
                return helpers.error('any.invalid');
            }
            return normalized;
        })
        .messages({
            'any.invalid': 'Please provide a valid phone number (10-15 digits)',
        }),

    dateOfBirth: Joi.date()
        .max('now')
        .optional()
        .messages({
            'date.max': 'Date of birth cannot be in the future',
        }),

    gender: Joi.string().valid('male', 'female', 'other').optional(),

    primaryFitnessGoal: Joi.string()
        .valid(
            'weight_loss',
            'muscle_gain',
            'general_fitness',
            'endurance',
            'strength',
            'flexibility',
            'sports_performance',
            'rehabilitation'
        )
        .required()
        .messages({
            'any.required': 'Primary fitness goal is required',
            'any.only': 'Please select a valid fitness goal',
        }),

    currentWeight: Joi.number()
        .min(20)
        .max(300)
        .optional()
        .messages({
            'number.min': 'Current weight must be at least 20 kg',
            'number.max': 'Current weight cannot exceed 300 kg',
        }),

    targetWeight: Joi.number()
        .min(20)
        .max(300)
        .optional()
        .messages({
            'number.min': 'Target weight must be at least 20 kg',
            'number.max': 'Target weight cannot exceed 300 kg',
        }),

    height: Joi.number()
        .min(50)
        .max(250)
        .optional()
        .messages({
            'number.min': 'Height must be at least 50 cm',
            'number.max': 'Height cannot exceed 250 cm',
        }),

    experienceLevel: Joi.string()
        .valid('beginner', 'intermediate', 'advanced', 'expert')
        .default('beginner')
        .optional(),

    programType: Joi.string()
        .valid(
            'personal_training',
            'group_training',
            'online_coaching',
            'nutrition_only',
            'hybrid'
        )
        .optional(),

    sessionsPerWeek: Joi.number()
        .min(1)
        .max(7)
        .optional()
        .messages({
            'number.min': 'Sessions per week must be at least 1',
            'number.max': 'Sessions per week cannot exceed 7',
        }),

    startDate: Joi.date().optional(),

    packageDuration: Joi.string()
        .valid('1_month', '3_months', '6_months', '12_months', 'ongoing')
        .optional(),

    endDate: Joi.date()
        .greater(Joi.ref('startDate'))
        .optional()
        .messages({
            'date.greater': 'End date must be after start date',
        }),

    additionalNotes: Joi.string()
        .max(1000)
        .trim()
        .optional()
        .messages({
            'string.max': 'Additional notes cannot exceed 1000 characters',
        }),

    medicalConditions: Joi.string()
        .max(500)
        .trim()
        .optional()
        .messages({
            'string.max': 'Medical conditions cannot exceed 500 characters',
        }),

    injuries: Joi.string()
        .max(500)
        .trim()
        .optional()
        .messages({
            'string.max': 'Injuries cannot exceed 500 characters',
        }),

    injuryAreaOptionIds: healthOptionIdList,
    injuryDetails: Joi.string()
        .max(500)
        .trim()
        .allow('', null)
        .optional()
        .messages({
            'string.max': 'Injury details cannot exceed 500 characters',
        }),

    allergyOptionIds: healthOptionIdList,
    dietaryRestrictionOptionIds: healthOptionIdList,

    // Never accept privilege / ownership / auth / approval from the public body
    password: Joi.forbidden(),
    role: Joi.forbidden(),
    trainerId: Joi.forbidden(),
    trainer: Joi.forbidden(),
    isActive: Joi.forbidden(),
    invitationId: Joi.forbidden(),
    approvalStatus: Joi.forbidden(),
    createdUserId: Joi.forbidden(),
    reviewedAt: Joi.forbidden(),
    reviewedBy: Joi.forbidden(),
    rejectionReason: Joi.forbidden(),
    joinedCoachAt: Joi.forbidden(),
    token: Joi.forbidden(),
    tokenHash: Joi.forbidden(),
    status: Joi.forbidden(),
}).unknown(false);
