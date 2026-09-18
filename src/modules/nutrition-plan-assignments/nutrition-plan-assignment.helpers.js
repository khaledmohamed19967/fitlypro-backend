/**
 * Nutrition Plan Assignment — pure helpers
 */

import { mapNutritionPlanToPublic } from '../nutrition-plans/nutrition-plan.helpers.js';

/**
 * @param {import('mongoose').Document|object} doc
 * @returns {object}
 */
const toPlainObject = (doc) =>
    typeof doc?.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc ?? {};

/**
 * @param {import('mongoose').Types.ObjectId|string|undefined|null} id
 * @returns {string|null}
 */
const toIdString = (id) => (id != null ? id.toString?.() ?? String(id) : null);

/**
 * Map food snapshot for Player (no Mongo internals).
 *
 * @param {object|null|undefined} snapshot
 * @returns {object|null}
 */
const mapPlayerFoodSnapshot = (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') {
        return null;
    }

    return {
        name: snapshot.name,
        brand: snapshot.brand ?? null,
        category: snapshot.category,
        nutritionPer100g: snapshot.nutritionPer100g
            ? {
                  calories: snapshot.nutritionPer100g.calories,
                  protein: snapshot.nutritionPer100g.protein,
                  carbs: snapshot.nutritionPer100g.carbs,
                  fat: snapshot.nutritionPer100g.fat,
                  fiber: snapshot.nutritionPer100g.fiber ?? null,
                  sugar: snapshot.nutritionPer100g.sugar ?? null,
                  sodium: snapshot.nutritionPer100g.sodium ?? null,
              }
            : null,
        defaultServing: snapshot.defaultServing
            ? {
                  quantity: snapshot.defaultServing.quantity,
                  unit: snapshot.defaultServing.unit,
                  gramWeight: snapshot.defaultServing.gramWeight,
              }
            : null,
    };
};

/**
 * Player-safe assignment metadata (no trainerId / clientId / planId).
 *
 * @param {import('mongoose').Document|object} assignment
 * @returns {object}
 */
export const mapPlayerNutritionAssignment = (assignment) => {
    const doc = toPlainObject(assignment);

    return {
        id: toIdString(doc._id ?? doc.id),
        status: doc.status,
        startDate: doc.startDate,
        endDate: doc.endDate ?? null,
    };
};

/**
 * Player-safe live NutritionPlan DTO for Nutrition Player v1.
 * Strips trainer ownership, audit timestamps, and trainer-only metadata.
 *
 * @param {import('mongoose').Document|object} plan
 * @returns {object|null}
 */
export const mapPlayerNutritionPlan = (plan) => {
    const full = mapNutritionPlanToPublic(plan);
    if (!full) {
        return null;
    }

    return {
        id: full.id,
        name: full.name,
        description: full.description ?? null,
        goal: full.goal,
        duration: full.duration,
        daysCount: full.daysCount,
        scheduleMode: full.scheduleMode,
        icon: full.icon,
        status: full.status,
        notes: full.notes ?? null,
        macroTargets: full.macroTargets
            ? {
                  calories: full.macroTargets.calories,
                  protein: full.macroTargets.protein,
                  carbs: full.macroTargets.carbs,
                  fat: full.macroTargets.fat,
              }
            : null,
        nutritionDays: Array.isArray(full.nutritionDays)
            ? full.nutritionDays.map((day) => ({
                  id: day.id,
                  dayNumber: day.dayNumber,
                  name: day.name,
                  notes: day.notes ?? null,
                  meals: Array.isArray(day.meals)
                      ? day.meals.map((meal) => ({
                            id: meal.id,
                            order: meal.order,
                            name: meal.name,
                            mealType: meal.mealType ?? null,
                            suggestedTime: meal.suggestedTime ?? null,
                            notes: meal.notes ?? null,
                            foodItems: Array.isArray(meal.foodItems)
                                ? meal.foodItems.map((item) => ({
                                      id: item.id,
                                      foodId: item.foodId,
                                      order: item.order,
                                      quantity: item.quantity,
                                      unit: item.unit,
                                      notes: item.notes ?? null,
                                      foodSnapshot: mapPlayerFoodSnapshot(item.foodSnapshot),
                                      itemMacros: item.itemMacros ?? null,
                                  }))
                                : [],
                            mealTotals: meal.mealTotals ?? null,
                        }))
                      : [],
                  dailyTotals: day.dailyTotals ?? null,
              }))
            : [],
        totalMeals: full.totalMeals,
        totalFoodItems: full.totalFoodItems,
    };
};

/**
 * Resolve planId whether stored as ObjectId or populated NutritionPlan.
 *
 * @param {import('mongoose').Types.ObjectId|object|string|null|undefined} planIdField
 * @returns {string|null}
 */
const resolvePlanId = (planIdField) => {
    if (planIdField == null) return null;
    if (typeof planIdField === 'object' && (planIdField._id != null || planIdField.id != null)) {
        return toIdString(planIdField._id ?? planIdField.id);
    }
    return toIdString(planIdField);
};

/**
 * Map populated plan to Client Details summary only (id + name).
 * Returns null when planId is not populated — keeps plan-scoped list responses stable.
 *
 * @param {import('mongoose').Types.ObjectId|object|string|null|undefined} planIdField
 * @returns {{ id: string|null, name: string }|null}
 */
const mapPlanSummary = (planIdField) => {
    if (
        planIdField &&
        typeof planIdField === 'object' &&
        typeof planIdField.name === 'string'
    ) {
        return {
            id: toIdString(planIdField._id ?? planIdField.id),
            name: planIdField.name,
        };
    }
    return null;
};

/**
 * Map assignment to public API shape.
 *
 * @param {import('mongoose').Document|object} assignment
 * @param {import('mongoose').Document|object|null} [client]
 * @returns {object}
 */
export const mapNutritionAssignmentToPublic = (assignment, client = null) => {
    const doc = toPlainObject(assignment);

    return {
        id: toIdString(doc._id ?? doc.id),
        planId: resolvePlanId(doc.planId),
        planVersionId: toIdString(doc.planVersionId),
        clientId: toIdString(doc.clientId),
        client:
            client && typeof client.getPublicProfile === 'function'
                ? client.getPublicProfile()
                : null,
        plan: mapPlanSummary(doc.planId),
        startDate: doc.startDate,
        endDate: doc.endDate ?? null,
        status: doc.status,
        notes: doc.notes ?? null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};
