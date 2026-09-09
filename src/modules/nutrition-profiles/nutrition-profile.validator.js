import Joi from 'joi';
import { ACTIVITY_LEVELS } from './nutrition-profile.constants.js';

const stringList = Joi.array()
    .items(Joi.string().trim().min(1).max(120))
    .max(50)
    .optional();

/**
 * Upsert nutrition profile — nutrition-specific fields only.
 * Forbidden: height, weight, DOB, gender/sex, medicalConditions (owned elsewhere).
 */
export const validateUpsertNutritionProfile = Joi.object({
    activityLevel: Joi.string()
        .valid(...ACTIVITY_LEVELS)
        .allow(null)
        .optional(),
    allergies: stringList,
    dietaryRestrictions: stringList,
    foodPreferences: stringList,
    notes: Joi.string().trim().max(1000).allow('', null).optional(),
    height: Joi.forbidden(),
    heightCm: Joi.forbidden(),
    weight: Joi.forbidden(),
    weightKg: Joi.forbidden(),
    currentWeight: Joi.forbidden(),
    dateOfBirth: Joi.forbidden(),
    gender: Joi.forbidden(),
    sex: Joi.forbidden(),
    medicalConditions: Joi.forbidden(),
    clientId: Joi.forbidden(),
    trainerId: Joi.forbidden(),
});
