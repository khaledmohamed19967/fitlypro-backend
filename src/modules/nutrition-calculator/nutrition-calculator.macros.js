/**
 * Provisional V1 macro recommendation.
 *
 * IMPORTANT:
 * There is no coach-approved macro methodology in the codebase yet.
 * This module is intentionally isolated so ratios can be replaced later
 * without touching BMR / TDEE / goal calorie logic.
 *
 * Do not import these ratios into controllers or models.
 */

/**
 * @typedef {{ proteinG: number, carbsG: number, fatG: number }} MacroGrams
 */

/** @type {Readonly<Record<string, number>>} grams protein per kg body weight (provisional) */
const PROTEIN_G_PER_KG = Object.freeze({
    maintenance: 1.6,
    muscle_gain: 2.0,
    weight_loss: 2.0,
    body_recomposition: 1.8,
});

/** Fraction of recommended calories allocated to fat (provisional). */
const FAT_CALORIE_FRACTION = 0.25;

/**
 * @param {{
 *   recommendedCalories: number,
 *   weightKg: number,
 *   goal: string,
 * }} input
 * @returns {MacroGrams}
 */
export const calculateRecommendedMacros = ({
    recommendedCalories,
    weightKg,
    goal,
}) => {
    const proteinPerKg = PROTEIN_G_PER_KG[goal] ?? PROTEIN_G_PER_KG.maintenance;
    const proteinG = Math.round(weightKg * proteinPerKg);
    const fatG = Math.round((recommendedCalories * FAT_CALORIE_FRACTION) / 9);
    const remainingCalories = recommendedCalories - proteinG * 4 - fatG * 9;
    const carbsG = Math.max(0, Math.round(remainingCalories / 4));

    return { proteinG, carbsG, fatG };
};

export const MACRO_METHODOLOGY = Object.freeze({
    version: 'provisional_v1',
    notes:
        'Isolated placeholder until coach-approved macro methodology is finalized.',
});
