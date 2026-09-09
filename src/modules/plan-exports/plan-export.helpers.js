/**
 * Plan export helpers — filename sanitization & trainer snapshot.
 */

/**
 * @param {string} value
 * @returns {string}
 */
export const sanitizeFilenamePart = (value) => {
    const cleaned = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);

    return cleaned || 'plan';
};

/**
 * @param {'workout'|'nutrition'} planType
 * @param {string} planName
 * @returns {string}
 */
export const buildExportFilename = (planType, planName) => {
    const typePart = planType === 'nutrition' ? 'nutrition-plan' : 'workout-plan';
    return `${typePart}-${sanitizeFilenamePart(planName)}.pdf`;
};

/**
 * @param {object|null|undefined} user
 * @returns {{ id: string|null, fullName: string|null, email: string|null, phone: string|null }}
 */
export const mapTrainerForExport = (user) => {
    if (!user) {
        return { id: null, fullName: null, email: null, phone: null };
    }

    const firstName = user.firstName ? String(user.firstName).trim() : '';
    const lastName = user.lastName ? String(user.lastName).trim() : '';
    const fullName =
        user.fullName ||
        [firstName, lastName].filter(Boolean).join(' ') ||
        null;

    return {
        id: user._id != null ? String(user._id) : user.id != null ? String(user.id) : null,
        fullName,
        email: user.email ? String(user.email) : null,
        phone: user.phone ? String(user.phone) : null,
    };
};

/**
 * Normalize workout plan detail into export DTO (no mongoose docs).
 *
 * @param {object} plan
 * @param {object} trainer
 */
export const buildWorkoutExportModel = (plan, trainer) => ({
    type: 'workout',
    plan: {
        id: plan.id,
        name: plan.name,
        description: plan.description ?? null,
        duration: plan.duration,
        daysPerWeek: plan.daysPerWeek,
        goal: plan.goal,
        level: plan.level,
        notes: plan.notes ?? null,
        status: plan.status,
        isTemplate: Boolean(plan.isTemplate),
        totalExercises: plan.totalExercises ?? 0,
        totalDays: plan.totalDays ?? 0,
    },
    trainer,
    content: {
        workoutDays: (plan.workoutDays ?? []).map((day) => ({
            dayNumber: day.dayNumber,
            name: day.name,
            description: day.description ?? null,
            exercises: (day.exercises ?? []).map((exercise) => ({
                name:
                    exercise.exercise?.name ||
                    exercise.exerciseSnapshot?.name ||
                    'Exercise',
                order: exercise.order,
                restBetweenSets: exercise.restBetweenSets ?? 0,
                notes: exercise.notes ?? null,
                tempo: exercise.tempo ?? null,
                sets: (exercise.sets ?? []).map((set) => ({
                    setNumber: set.setNumber,
                    reps: set.reps,
                    weight: set.weight,
                    weightUnit: set.weightUnit ?? 'kg',
                    isWarmup: Boolean(set.isWarmup),
                    isDropset: Boolean(set.isDropset),
                })),
            })),
        })),
    },
});

/**
 * Normalize nutrition plan detail into export DTO.
 *
 * @param {object} plan
 * @param {object} trainer
 */
export const buildNutritionExportModel = (plan, trainer) => ({
    type: 'nutrition',
    plan: {
        id: plan.id,
        name: plan.name,
        description: plan.description ?? null,
        duration: plan.duration,
        daysCount: plan.daysCount,
        goal: plan.goal,
        scheduleMode: plan.scheduleMode ?? 'daily',
        notes: plan.notes ?? null,
        status: plan.status,
        isTemplate: Boolean(plan.isTemplate),
        totalMeals: plan.totalMeals ?? 0,
        totalFoodItems: plan.totalFoodItems ?? 0,
        avgDailyCalories: plan.avgDailyCalories ?? 0,
        macroTargets: plan.macroTargets ?? null,
        computedMacros: plan.computedMacros ?? null,
    },
    trainer,
    content: {
        nutritionDays: (plan.nutritionDays ?? []).map((day) => ({
            dayNumber: day.dayNumber,
            name: day.name,
            notes: day.notes ?? null,
            dailyTotals: day.dailyTotals ?? null,
            meals: (day.meals ?? []).map((meal) => ({
                order: meal.order,
                name: meal.name,
                mealType: meal.mealType ?? null,
                suggestedTime: meal.suggestedTime ?? null,
                notes: meal.notes ?? null,
                mealTotals: meal.mealTotals ?? null,
                foodItems: (meal.foodItems ?? []).map((item) => ({
                    name: item.foodSnapshot?.name || 'Food',
                    brand: item.foodSnapshot?.brand ?? null,
                    quantity: item.quantity,
                    unit: item.unit,
                    notes: item.notes ?? null,
                    itemMacros: item.itemMacros ?? null,
                })),
            })),
        })),
    },
});
