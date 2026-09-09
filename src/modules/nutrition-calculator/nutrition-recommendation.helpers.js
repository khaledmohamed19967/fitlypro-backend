/**
 * Map nutrition recommendation documents to public API shape.
 */

const toIdString = (id) => (id != null ? id.toString?.() ?? String(id) : null);

/**
 * @param {import('mongoose').Document|object} doc
 */
export const mapNutritionRecommendationToPublic = (doc) => {
    if (!doc) return null;
    const plain = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc;

    return {
        id: toIdString(plain._id ?? plain.id),
        clientId: toIdString(plain.clientId),
        trainerId: toIdString(plain.trainerId),
        calculatedAt: plain.calculatedAt,
        status: plain.status,
        inputs: {
            sex: plain.sex,
            age: plain.age,
            dateOfBirth: plain.dateOfBirth ?? null,
            heightCm: plain.heightCm,
            weightKg: plain.weightKg,
            activityLevel: plain.activityLevel,
            goal: plain.goal,
        },
        results: {
            bmr: plain.bmr,
            activityFactor: plain.activityFactor,
            maintenanceCalories: plain.maintenanceCalories,
            calorieAdjustment: plain.calorieAdjustment,
            recommendedCalories: plain.recommendedCalories,
            recommendedMacros: plain.recommendedMacros,
            macroMethodology: plain.macroMethodology ?? null,
        },
        finalCalories: plain.finalCalories ?? null,
        finalMacros: plain.finalMacros ?? null,
        notes: plain.notes ?? null,
        createdAt: plain.createdAt,
        updatedAt: plain.updatedAt,
    };
};
