/**
 * Map Nutrition Recommendation → Nutrition Plan Builder prefill values.
 * Copy-only: no persistent link between recommendation and plan.
 */

import { NUTRITION_GOALS } from '../nutrition-plans/nutrition-plan.constants.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Calculator goals → Nutrition Plan goal enum.
 * Do NOT rename plan enums — map at this boundary only.
 */
export const CALCULATOR_GOAL_TO_PLAN_GOAL = Object.freeze({
    maintenance: 'maintenance',
    muscle_gain: 'muscle_gain',
    weight_loss: 'weight_loss',
    body_recomposition: 'body_recomp',
});

/**
 * @param {string} calculatorGoal
 * @returns {string} Nutrition Plan goal
 */
export const mapCalculatorGoalToPlanGoal = (calculatorGoal) => {
    const mapped = CALCULATOR_GOAL_TO_PLAN_GOAL[calculatorGoal];
    if (!mapped || !NUTRITION_GOALS.includes(mapped)) {
        throw new ApiError(400, 'Recommendation goal cannot be mapped to a nutrition plan goal');
    }
    return mapped;
};

/**
 * Prefer coach final macros when present; otherwise recommended macros.
 *
 * @param {{ proteinG: number, carbsG: number, fatG: number }|null|undefined} macros
 * @returns {{ protein: number, carbs: number, fat: number }}
 */
const mapMacrosToPlanTargets = (macros) => {
    if (
        !macros ||
        macros.proteinG == null ||
        macros.carbsG == null ||
        macros.fatG == null
    ) {
        throw new ApiError(400, 'Recommendation macros are incomplete');
    }

    return {
        protein: Number(macros.proteinG),
        carbs: Number(macros.carbsG),
        fat: Number(macros.fatG),
    };
};

/**
 * Build Nutrition Plan Builder prefill from a recommendation document or public DTO.
 *
 * @param {object} recommendation — mongoose doc or mapped public recommendation
 * @returns {{
 *   goal: string,
 *   macroTargets: { calories: number, protein: number, carbs: number, fat: number },
 *   source: object
 * }}
 */
export const mapRecommendationToPlanPrefill = (recommendation) => {
    if (!recommendation) {
        throw new ApiError(404, 'Nutrition recommendation not found');
    }

    const status = recommendation.status;
    if (status !== 'approved') {
        throw new ApiError(400, 'Only approved recommendations can be used for plan prefill');
    }

    const calculatorGoal =
        recommendation.goal ??
        recommendation.inputs?.goal ??
        null;

    const planGoal = mapCalculatorGoalToPlanGoal(calculatorGoal);

    const hasFinalCalories =
        recommendation.finalCalories != null && recommendation.finalCalories !== '';
    const hasFinalMacros = recommendation.finalMacros != null;

    const calories = hasFinalCalories
        ? Number(recommendation.finalCalories)
        : Number(
              recommendation.recommendedCalories ??
                  recommendation.results?.recommendedCalories
          );

    if (!Number.isFinite(calories) || calories <= 0) {
        throw new ApiError(400, 'Recommendation calories are invalid');
    }

    const macrosSource = hasFinalMacros
        ? recommendation.finalMacros
        : recommendation.recommendedMacros ??
          recommendation.results?.recommendedMacros;

    const { protein, carbs, fat } = mapMacrosToPlanTargets(macrosSource);

    if (protein < 0 || carbs < 0 || fat < 0) {
        throw new ApiError(400, 'Recommendation macros are invalid');
    }

    const recommendationId =
        recommendation.id ??
        recommendation._id?.toString?.() ??
        null;

    return {
        goal: planGoal,
        macroTargets: {
            calories,
            protein,
            carbs,
            fat,
        },
        source: {
            recommendationId,
            status,
            calculatorGoal,
            usedFinalCalories: Boolean(hasFinalCalories),
            usedFinalMacros: Boolean(hasFinalMacros),
        },
    };
};
