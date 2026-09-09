/**
 * Nutrition Calculator — activity factors, goals, and calorie adjustments.
 * Macro methodology is provisional and isolated (see macros.js).
 */

export const ACTIVITY_LEVELS = Object.freeze([
    'sedentary',
    'lightly_active',
    'moderately_active',
    'very_active',
    'extra_active',
]);

/** Mifflin-St Jeor activity multipliers (implementation detail — not user-entered). */
export const ACTIVITY_FACTORS = Object.freeze({
    sedentary: 1.2,
    lightly_active: 1.375,
    moderately_active: 1.55,
    very_active: 1.725,
    extra_active: 1.9,
});

/**
 * Calculator goals (V1).
 * Note: Nutrition Plan goals use `body_recomp`; calculator uses `body_recomposition`.
 */
export const CALCULATOR_GOALS = Object.freeze([
    'maintenance',
    'muscle_gain',
    'weight_loss',
    'body_recomposition',
]);

/**
 * Goal calorie multipliers applied to maintenance calories.
 * Centralized — change here only.
 */
export const GOAL_CALORIE_MULTIPLIERS = Object.freeze({
    maintenance: 1.0,
    muscle_gain: 1.1,
    weight_loss: 0.85,
    body_recomposition: 1.0,
});

/** Sex values accepted by Mifflin-St Jeor. */
export const CALCULATOR_SEXES = Object.freeze(['male', 'female']);

export const RECOMMENDATION_STATUSES = Object.freeze(['calculated', 'approved']);
