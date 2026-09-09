/**
 * Pure Nutrition Calculator service (no MongoDB I/O).
 * Mifflin-St Jeor BMR → maintenance → goal-adjusted calories → macros.
 */

import { ApiError } from '../../utils/ApiError.js';
import {
    ACTIVITY_FACTORS,
    ACTIVITY_LEVELS,
    CALCULATOR_GOALS,
    CALCULATOR_SEXES,
    GOAL_CALORIE_MULTIPLIERS,
} from './nutrition-calculator.constants.js';
import {
    MACRO_METHODOLOGY,
    calculateRecommendedMacros,
} from './nutrition-calculator.macros.js';

/**
 * @param {Date|string} dateOfBirth
 * @param {Date} [asOf]
 * @returns {number}
 */
export const calculateAgeFromDob = (dateOfBirth, asOf = new Date()) => {
    const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
        throw new ApiError(400, 'Invalid date of birth');
    }

    let age = asOf.getFullYear() - dob.getFullYear();
    const monthDiff = asOf.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < dob.getDate())) {
        age -= 1;
    }

    if (age < 13 || age > 100) {
        throw new ApiError(400, 'Calculated age is outside the supported range (13–100)');
    }

    return age;
};

/**
 * @param {string} sex
 * @param {number} weightKg
 * @param {number} heightCm
 * @param {number} age
 * @returns {number} BMR (unrounded intermediate)
 */
export const calculateBmr = (sex, weightKg, heightCm, age) => {
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    if (sex === 'male') return base + 5;
    if (sex === 'female') return base - 161;
    throw new ApiError(400, 'Sex must be male or female for BMR calculation');
};

/**
 * @param {string} activityLevel
 * @returns {number}
 */
export const resolveActivityFactor = (activityLevel) => {
    if (!ACTIVITY_LEVELS.includes(activityLevel)) {
        throw new ApiError(400, 'Invalid activity level');
    }
    return ACTIVITY_FACTORS[activityLevel];
};

/**
 * @param {number} maintenanceCalories
 * @param {string} goal
 * @returns {{ multiplier: number, recommendedCalories: number }}
 */
export const applyGoalCalorieAdjustment = (maintenanceCalories, goal) => {
    if (!CALCULATOR_GOALS.includes(goal)) {
        throw new ApiError(400, 'Invalid calculator goal');
    }
    const multiplier = GOAL_CALORIE_MULTIPLIERS[goal];
    return {
        multiplier,
        recommendedCalories: Math.round(maintenanceCalories * multiplier),
    };
};

/**
 * @param {object} input
 * @param {'male'|'female'} input.sex
 * @param {number} [input.age] — ignored when dateOfBirth is present
 * @param {Date|string|null} [input.dateOfBirth]
 * @param {number} input.heightCm
 * @param {number} input.weightKg
 * @param {string} input.activityLevel
 * @param {string} input.goal
 */
export const calculateNutritionRecommendation = (input) => {
    const {
        sex,
        dateOfBirth = null,
        heightCm,
        weightKg,
        activityLevel,
        goal,
    } = input ?? {};

    if (!CALCULATOR_SEXES.includes(sex)) {
        throw new ApiError(400, 'Sex must be male or female for BMR calculation');
    }

    if (heightCm == null || Number(heightCm) <= 0) {
        throw new ApiError(400, 'Height must be a positive number (cm)');
    }

    if (weightKg == null || Number(weightKg) <= 0) {
        throw new ApiError(400, 'Weight must be a positive number (kg)');
    }

    const height = Number(heightCm);
    const weight = Number(weightKg);

    if (height < 50 || height > 250) {
        throw new ApiError(400, 'Height must be between 50 and 250 cm');
    }

    if (weight < 20 || weight > 300) {
        throw new ApiError(400, 'Weight must be between 20 and 300 kg');
    }

    let age;
    if (dateOfBirth) {
        age = calculateAgeFromDob(dateOfBirth);
    } else if (input.age != null) {
        age = Number(input.age);
        if (!Number.isFinite(age) || age < 13 || age > 100) {
            throw new ApiError(400, 'Age must be between 13 and 100');
        }
    } else {
        throw new ApiError(400, 'Date of birth or age is required');
    }

    if (!ACTIVITY_LEVELS.includes(activityLevel)) {
        throw new ApiError(400, 'Invalid activity level');
    }

    if (!CALCULATOR_GOALS.includes(goal)) {
        throw new ApiError(400, 'Invalid calculator goal');
    }

    const bmrRaw = calculateBmr(sex, weight, height, age);
    const bmr = Math.round(bmrRaw);
    const activityFactor = resolveActivityFactor(activityLevel);
    const maintenanceCalories = Math.round(bmrRaw * activityFactor);
    const { multiplier, recommendedCalories } = applyGoalCalorieAdjustment(
        maintenanceCalories,
        goal
    );
    const recommendedMacros = calculateRecommendedMacros({
        recommendedCalories,
        weightKg: weight,
        goal,
    });

    return {
        calculatedAt: new Date().toISOString(),
        inputs: {
            sex,
            age,
            dateOfBirth: dateOfBirth
                ? new Date(dateOfBirth).toISOString()
                : null,
            heightCm: height,
            weightKg: weight,
            activityLevel,
            goal,
        },
        results: {
            bmr,
            activityFactor,
            maintenanceCalories,
            calorieAdjustment: {
                goal,
                multiplier,
            },
            recommendedCalories,
            recommendedMacros,
            macroMethodology: MACRO_METHODOLOGY,
        },
    };
};

export default {
    calculateAgeFromDob,
    calculateBmr,
    resolveActivityFactor,
    applyGoalCalorieAdjustment,
    calculateNutritionRecommendation,
};
