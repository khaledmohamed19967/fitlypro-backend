import Joi from 'joi';
import {
    ACTIVITY_LEVELS,
    CALCULATOR_GOALS,
    CALCULATOR_SEXES,
    RECOMMENDATION_STATUSES,
} from './nutrition-calculator.constants.js';

/**
 * Calculate — optional overrides; body metrics prefer Client source of truth.
 */
export const validateCalculateNutrition = Joi.object({
    goal: Joi.string()
        .valid(...CALCULATOR_GOALS)
        .required(),
    activityLevel: Joi.string()
        .valid(...ACTIVITY_LEVELS)
        .optional(),
    sex: Joi.string()
        .valid(...CALCULATOR_SEXES)
        .optional(),
    heightCm: Joi.number().min(50).max(250).optional(),
    weightKg: Joi.number().min(20).max(300).optional(),
    age: Joi.number().integer().min(13).max(100).optional(),
    dateOfBirth: Joi.date().iso().optional(),
});

/**
 * Persist / approve a recommendation snapshot.
 * Prefer sending the calculator result; server may recalculate for consistency.
 */
export const validateCreateRecommendation = Joi.object({
    goal: Joi.string()
        .valid(...CALCULATOR_GOALS)
        .required(),
    activityLevel: Joi.string()
        .valid(...ACTIVITY_LEVELS)
        .optional(),
    sex: Joi.string()
        .valid(...CALCULATOR_SEXES)
        .optional(),
    heightCm: Joi.number().min(50).max(250).optional(),
    weightKg: Joi.number().min(20).max(300).optional(),
    age: Joi.number().integer().min(13).max(100).optional(),
    dateOfBirth: Joi.date().iso().optional(),
    status: Joi.string()
        .valid(...RECOMMENDATION_STATUSES)
        .default('approved'),
    finalCalories: Joi.number().min(500).max(10000).allow(null).optional(),
    finalMacros: Joi.object({
        proteinG: Joi.number().min(0).max(1000).required(),
        carbsG: Joi.number().min(0).max(2000).required(),
        fatG: Joi.number().min(0).max(1000).required(),
    })
        .allow(null)
        .optional(),
    notes: Joi.string().trim().max(1000).allow('', null).optional(),
});

export const validateUpdateRecommendation = Joi.object({
    status: Joi.string()
        .valid(...RECOMMENDATION_STATUSES)
        .optional(),
    finalCalories: Joi.number().min(500).max(10000).allow(null).optional(),
    finalMacros: Joi.object({
        proteinG: Joi.number().min(0).max(1000).required(),
        carbsG: Joi.number().min(0).max(2000).required(),
        fatG: Joi.number().min(0).max(1000).required(),
    })
        .allow(null)
        .optional(),
    notes: Joi.string().trim().max(1000).allow('', null).optional(),
}).min(1);
