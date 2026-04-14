import Joi from 'joi';

/**
 * Client Validation Schemas
 */

// Validation schema for creating a new client
export const validateCreateClient = Joi.object({
    // Personal Information (for User model)
    firstName: Joi.string()
        .min(2)
        .max(50)
        .trim()
        .required()
        .messages({
            'string.empty': 'First name is required',
            'string.min': 'First name must be at least 2 characters',
            'string.max': 'First name cannot exceed 50 characters',
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
        }),

    email: Joi.string()
        .email()
        .lowercase()
        .trim()
        .required()
        .messages({
            'string.empty': 'Email is required',
            'string.email': 'Please provide a valid email address',
        }),

    phone: Joi.string()
        .pattern(/^[0-9]{10,15}$/)
        .trim()
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
        .optional(),

    password: Joi.string()
        .min(6)
        .required()
        .messages({
            'string.empty': 'Password is required',
            'string.min': 'Password must be at least 6 characters',
        }),

    // Fitness Information (for Client model)
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

    // Program Details (for Client model)
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

    startDate: Joi.date()
        .optional(),

    packageDuration: Joi.string()
        .valid('1_month', '3_months', '6_months', '12_months', 'ongoing')
        .optional(),

    endDate: Joi.date()
        .greater(Joi.ref('startDate'))
        .optional()
        .messages({
            'date.greater': 'End date must be after start date',
        }),

    // Additional Information
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
});

// Validation schema for updating client fitness data
export const validateUpdateClient = Joi.object({
    // Fitness Information
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
        .optional(),

    currentWeight: Joi.number()
        .min(20)
        .max(300)
        .optional(),

    targetWeight: Joi.number()
        .min(20)
        .max(300)
        .optional(),

    height: Joi.number()
        .min(50)
        .max(250)
        .optional(),

    experienceLevel: Joi.string()
        .valid('beginner', 'intermediate', 'advanced', 'expert')
        .optional(),

    // Program Details
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
        .optional(),

    startDate: Joi.date()
        .optional(),

    packageDuration: Joi.string()
        .valid('1_month', '3_months', '6_months', '12_months', 'ongoing')
        .optional(),

    endDate: Joi.date()
        .optional(),

    // Additional Information
    additionalNotes: Joi.string()
        .max(1000)
        .trim()
        .optional(),

    medicalConditions: Joi.string()
        .max(500)
        .trim()
        .optional(),

    injuries: Joi.string()
        .max(500)
        .trim()
        .optional(),

    status: Joi.string()
        .valid('active', 'inactive', 'completed', 'on_hold')
        .optional(),
});

// Validation schema for adding progress note
export const validateProgressNote = Joi.object({
    weight: Joi.number()
        .min(20)
        .max(300)
        .optional()
        .messages({
            'number.min': 'Weight must be at least 20 kg',
            'number.max': 'Weight cannot exceed 300 kg',
        }),

    notes: Joi.string()
        .max(500)
        .trim()
        .optional()
        .messages({
            'string.max': 'Notes cannot exceed 500 characters',
        }),
});
