/**
 * Food catalog — pure domain helpers
 */

import { GRAM_WEIGHT_REQUIRED_UNITS } from './food.constants.js';

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
 * Normalize ownership for API / auth checks.
 *
 * @param {object} food
 * @returns {{ type: 'system'|'trainer', trainerId: string|null }}
 */
export const resolveFoodOwnership = (food) => {
    if (!food) {
        return { type: 'trainer', trainerId: null };
    }

    const doc = toPlainObject(food);
    if (doc.ownership?.type === 'system') {
        return { type: 'system', trainerId: null };
    }

    if (doc.ownership?.type === 'trainer') {
        return {
            type: 'trainer',
            trainerId: toIdString(doc.ownership.trainerId ?? doc.trainerId),
        };
    }

    if (doc.trainerId) {
        return { type: 'trainer', trainerId: toIdString(doc.trainerId) };
    }

    return { type: 'trainer', trainerId: null };
};

/**
 * Mongo filter: system foods ∪ current trainer's foods.
 *
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @returns {object}
 */
export const buildFoodVisibilityFilter = (trainerId) => ({
    $or: [
        { 'ownership.type': 'system' },
        { 'ownership.type': 'trainer', 'ownership.trainerId': trainerId },
    ],
});

/**
 * Build list ownership scope for query param ownership=system|trainer|all.
 *
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @param {'system'|'trainer'|'all'} ownership
 * @returns {object}
 */
export const buildFoodOwnershipFilter = (trainerId, ownership = 'all') => {
    if (ownership === 'system') {
        return { 'ownership.type': 'system' };
    }

    if (ownership === 'trainer') {
        return {
            'ownership.type': 'trainer',
            'ownership.trainerId': trainerId,
        };
    }

    return buildFoodVisibilityFilter(trainerId);
};

/**
 * @param {object} food
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 */
export const canReadFood = (food, trainerId) => {
    const ownership = resolveFoodOwnership(food);
    if (ownership.type === 'system') return true;
    return ownership.trainerId != null && String(ownership.trainerId) === String(trainerId);
};

/**
 * @param {object} food
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 */
export const canModifyFood = (food, trainerId) => {
    const ownership = resolveFoodOwnership(food);
    if (ownership.type === 'system') return false;
    return ownership.trainerId != null && String(ownership.trainerId) === String(trainerId);
};

/**
 * Escape user input for safe use inside a RegExp.
 *
 * @param {string} value
 * @returns {string}
 */
export const escapeRegex = (value) =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Validate defaultServing has gramWeight when unit requires it.
 *
 * @param {{ unit?: string, gramWeight?: number|null }} defaultServing
 * @returns {{ valid: boolean, message?: string }}
 */
export const validateDefaultServing = (defaultServing = {}) => {
    if (!defaultServing?.unit) {
        return { valid: false, message: 'Default serving unit is required' };
    }

    if (
        GRAM_WEIGHT_REQUIRED_UNITS.includes(defaultServing.unit) &&
        (defaultServing.gramWeight == null || defaultServing.gramWeight <= 0)
    ) {
        return {
            valid: false,
            message: 'Gram weight is required and must be greater than 0 for piece/serving units',
        };
    }

    if (defaultServing.gramWeight != null && defaultServing.gramWeight <= 0) {
        return { valid: false, message: 'Gram weight must be greater than 0' };
    }

    return { valid: true };
};

/**
 * Normalize nutrition per 100g input — trim optional fields.
 *
 * @param {object} nutrition
 * @returns {object}
 */
export const normalizeNutritionPer100g = (nutrition = {}) => {
    const normalized = {
        calories: nutrition.calories,
        protein: nutrition.protein,
        carbs: nutrition.carbs,
        fat: nutrition.fat,
    };

    if (nutrition.fiber != null) normalized.fiber = nutrition.fiber;
    if (nutrition.sugar != null) normalized.sugar = nutrition.sugar;
    if (nutrition.sodium != null) normalized.sodium = nutrition.sodium;

    return normalized;
};

/**
 * Build food snapshot for future NutritionPlan PlanFoodItem embedding.
 *
 * @param {import('mongoose').Document|object} food
 * @returns {object|null}
 */
export const buildFoodSnapshot = (food) => {
    if (!food) {
        return null;
    }

    const doc = toPlainObject(food);

    return {
        name: doc.name,
        brand: doc.brand ?? null,
        category: doc.category,
        nutritionPer100g: {
            calories: doc.nutritionPer100g?.calories ?? 0,
            protein: doc.nutritionPer100g?.protein ?? 0,
            carbs: doc.nutritionPer100g?.carbs ?? 0,
            fat: doc.nutritionPer100g?.fat ?? 0,
            ...(doc.nutritionPer100g?.fiber != null
                ? { fiber: doc.nutritionPer100g.fiber }
                : {}),
            ...(doc.nutritionPer100g?.sugar != null
                ? { sugar: doc.nutritionPer100g.sugar }
                : {}),
            ...(doc.nutritionPer100g?.sodium != null
                ? { sodium: doc.nutritionPer100g.sodium }
                : {}),
        },
        defaultServing: {
            quantity: doc.defaultServing?.quantity,
            unit: doc.defaultServing?.unit,
            gramWeight: doc.defaultServing?.gramWeight,
        },
        ...(doc.image?.url || doc.image?.thumbnailUrl
            ? {
                  image: {
                      url: doc.image?.url ?? null,
                      thumbnailUrl: doc.image?.thumbnailUrl ?? null,
                  },
              }
            : {}),
    };
};

/**
 * Public API representation of a Food document.
 *
 * @param {import('mongoose').Document|object} food
 * @returns {object|null}
 */
export const toPublicFood = (food) => {
    if (!food) {
        return null;
    }

    const doc = toPlainObject(food);
    const ownership = resolveFoodOwnership(doc);

    return {
        id: toIdString(doc._id ?? doc.id),
        trainerId: ownership.trainerId,
        name: doc.name,
        brand: doc.brand ?? null,
        category: doc.category,
        status: doc.status,
        nutritionPer100g: {
            calories: doc.nutritionPer100g?.calories ?? 0,
            protein: doc.nutritionPer100g?.protein ?? 0,
            carbs: doc.nutritionPer100g?.carbs ?? 0,
            fat: doc.nutritionPer100g?.fat ?? 0,
            fiber: doc.nutritionPer100g?.fiber ?? null,
            sugar: doc.nutritionPer100g?.sugar ?? null,
            sodium: doc.nutritionPer100g?.sodium ?? null,
        },
        defaultServing: {
            quantity: doc.defaultServing?.quantity,
            unit: doc.defaultServing?.unit,
            gramWeight: doc.defaultServing?.gramWeight,
        },
        ...(doc.image?.url || doc.image?.thumbnailUrl
            ? {
                  image: {
                      url: doc.image?.url ?? null,
                      thumbnailUrl: doc.image?.thumbnailUrl ?? null,
                  },
              }
            : {}),
        ownership: {
            type: ownership.type,
            trainerId: ownership.trainerId,
        },
        source: {
            type: doc.source?.type ?? 'manual',
            externalProvider: doc.source?.externalProvider ?? null,
            externalId: doc.source?.externalId ?? null,
            barcode: doc.source?.barcode ?? null,
        },
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};

/**
 * Resolve Mongo sort option for list queries.
 *
 * @param {string} sort
 * @returns {object}
 */
export const resolveFoodSort = (sort = 'newest') => {
    switch (sort) {
        case 'name':
            return { name: 1 };
        case 'name-desc':
            return { name: -1 };
        case 'oldest':
            return { createdAt: 1 };
        case 'calories-high':
            return { 'nutritionPer100g.calories': -1, name: 1 };
        case 'calories-low':
            return { 'nutritionPer100g.calories': 1, name: 1 };
        case 'newest':
        default:
            return { createdAt: -1 };
    }
};
