/**
 * Nutrition Plan — pure domain helpers (Phase 3 foundation)
 */

import mongoose from 'mongoose';
import Food from '../foods/food.model.js';
import { buildFoodSnapshot, buildFoodVisibilityFilter } from '../foods/food.helpers.js';
import {
    calculatePlanComputedMacros,
    calculateDailyTotals,
    calculateMealTotals,
    calculateFoodItemMacros,
    validatePlanFoodItemUnit,
} from './nutrition-plan.calculations.js';
import { DEFAULT_NUTRITION_PLAN_ICON, MAX_NUTRITION_DAYS, MAX_WEEKLY_NUTRITION_DAYS, SCHEDULE_MODES, DEFAULT_SCHEDULE_MODE } from './nutrition-plan.constants.js';

/**
 * @param {import('mongoose').Types.ObjectId|string} trainerId
 */
const toTrainerObjectId = (trainerId) => {
    if (trainerId instanceof mongoose.Types.ObjectId) {
        return trainerId;
    }
    return new mongoose.Types.ObjectId(String(trainerId));
};

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
 * @param {object} plan
 * @returns {{ type: 'system'|'trainer', trainerId: string|null }}
 */
export const resolvePlanOwnership = (plan) => {
    if (!plan) {
        return { type: 'trainer', trainerId: null };
    }

    const doc = toPlainObject(plan);
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
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @returns {object}
 */
export const buildNutritionPlanVisibilityFilter = (trainerId) => {
    const ownerId = toTrainerObjectId(trainerId);

    return {
        $or: [
            { 'ownership.type': 'system' },
            { 'ownership.type': 'trainer', 'ownership.trainerId': ownerId },
            { ownership: { $exists: false }, trainerId: ownerId },
        ],
    };
};

/**
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @param {'system'|'trainer'|'all'} ownership
 * @returns {object}
 */
export const buildNutritionPlanOwnershipFilter = (trainerId, ownership = 'trainer') => {
    const ownerId = toTrainerObjectId(trainerId);

    if (ownership === 'system') {
        return { 'ownership.type': 'system' };
    }

    if (ownership === 'all') {
        return buildNutritionPlanVisibilityFilter(trainerId);
    }

    return {
        $or: [
            { 'ownership.type': 'trainer', 'ownership.trainerId': ownerId },
            { ownership: { $exists: false }, trainerId: ownerId },
        ],
    };
};

/**
 * Shared search/advanced filters for nutrition plan list + summary counts.
 *
 * @param {object} query
 */
export const buildNutritionPlanSharedListConditions = (query) => {
    const { search, goal } = query;
    const conditions = [];

    if (goal) {
        conditions.push({ goal });
    }

    if (search && String(search).trim()) {
        const regex = new RegExp(escapeRegex(String(search).trim()), 'i');
        conditions.push({
            $or: [{ name: regex }, { description: regex }],
        });
    }

    return conditions;
};

/**
 * Mongo filter for nutrition plan list/summary queries.
 *
 * @param {object} query
 * @param {string} trainerId
 */
export const buildNutritionPlanListFilter = (query, trainerId) => {
    const { status, isTemplate, ownership = 'trainer' } = query;

    const conditions = [
        buildNutritionPlanOwnershipFilter(trainerId, ownership),
        ...buildNutritionPlanSharedListConditions(query),
    ];

    if (status) {
        conditions.push({ status });
    }

    if (isTemplate !== undefined) {
        conditions.push({ isTemplate });
    }

    return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

const mergeMongoConditions = (...parts) => {
    const conditions = parts.flat().filter(Boolean);
    if (conditions.length === 0) return {};
    if (conditions.length === 1) return conditions[0];
    return { $and: conditions };
};

/**
 * Tab-specific filters for nutrition plan summary counts.
 *
 * @param {object} query
 * @param {string} trainerId
 */
export const buildNutritionPlanSummaryFilters = (query, trainerId) => {
    const shared = buildNutritionPlanSharedListConditions(query);

    return {
        myPlans: mergeMongoConditions(
            buildNutritionPlanOwnershipFilter(trainerId, 'trainer'),
            { status: 'active' },
            ...shared
        ),
        templates: mergeMongoConditions(
            buildNutritionPlanOwnershipFilter(trainerId, 'system'),
            { isTemplate: true, status: 'active' },
            ...shared
        ),
        archived: mergeMongoConditions(
            buildNutritionPlanOwnershipFilter(trainerId, 'trainer'),
            { status: 'archived' },
            ...shared
        ),
    };
};

export const isSystemNutritionPlan = (plan) => resolvePlanOwnership(plan).type === 'system';

export const isTrainerNutritionPlan = (plan) => resolvePlanOwnership(plan).type === 'trainer';

/**
 * @param {object} plan
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 */
export const canReadNutritionPlan = (plan, trainerId) => {
    const ownership = resolvePlanOwnership(plan);
    if (ownership.type === 'system') return true;
    return ownership.trainerId != null && String(ownership.trainerId) === String(trainerId);
};

/**
 * @param {object} plan
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 */
export const canModifyNutritionPlan = (plan, trainerId) => {
    const ownership = resolvePlanOwnership(plan);
    if (ownership.type === 'system') return false;
    return ownership.trainerId != null && String(ownership.trainerId) === String(trainerId);
};

/**
 * Active plan clone eligibility: system template (any trainer) or own trainer plan/template.
 *
 * @param {object} plan
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 */
export const canCloneNutritionPlan = (plan, trainerId) => {
    if (!plan || plan.status !== 'active') {
        return false;
    }

    const ownership = resolvePlanOwnership(plan);
    if (ownership.type === 'system') return true;
    return ownership.trainerId != null && String(ownership.trainerId) === String(trainerId);
};

/**
 * Generate a unique clone name within a trainer's plans.
 *
 * @param {string} sourceName
 * @param {(candidate: string) => Promise<boolean>} nameExists
 * @returns {Promise<string>}
 */
export const generateCloneName = async (sourceName, nameExists) => {
    const base = `${String(sourceName || 'Nutrition Plan').trim()} Copy`.slice(0, 120);
    if (!(await nameExists(base))) {
        return base;
    }

    let suffix = 2;
    while (suffix < 1000) {
        const candidate = `${base} ${suffix}`.slice(0, 120);
        if (!(await nameExists(candidate))) {
            return candidate;
        }
        suffix += 1;
    }

    return `${base} ${Date.now()}`.slice(0, 120);
};

/**
 * Deep-clone nutritionDays with fresh embedded ObjectIds.
 * Preserves foodId + foodSnapshot; does not duplicate Food documents.
 *
 * @param {object[]} nutritionDays
 * @returns {object[]}
 */
export const deepCloneNutritionDays = (nutritionDays = []) => {
    const cloneSnapshot = (snapshot) => {
        if (!snapshot) return null;
        return {
            name: snapshot.name,
            brand: snapshot.brand ?? null,
            category: snapshot.category,
            nutritionPer100g: { ...snapshot.nutritionPer100g },
            defaultServing: { ...snapshot.defaultServing },
        };
    };

    return (nutritionDays ?? []).map((day) => ({
        _id: new mongoose.Types.ObjectId(),
        dayNumber: day.dayNumber,
        name: day.name,
        notes: day.notes ?? null,
        meals: (day.meals ?? []).map((meal) => ({
            _id: new mongoose.Types.ObjectId(),
            order: meal.order,
            name: meal.name,
            mealType: meal.mealType ?? null,
            suggestedTime: meal.suggestedTime ?? null,
            notes: meal.notes ?? null,
            foodItems: (meal.foodItems ?? []).map((item) => ({
                _id: new mongoose.Types.ObjectId(),
                foodId: item.foodId,
                order: item.order,
                quantity: item.quantity,
                unit: item.unit,
                notes: item.notes ?? null,
                foodSnapshot: cloneSnapshot(item.foodSnapshot),
            })),
        })),
    }));
};

/**
 * @param {object[]} foodItems
 * @returns {object[]}
 */
export const normalizeFoodItemOrder = (foodItems = []) => {
    if (!Array.isArray(foodItems)) {
        return [];
    }

    return [...foodItems]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((item, index) => ({
            ...item,
            order: index + 1,
        }));
};

/**
 * @param {object[]} meals
 * @returns {object[]}
 */
export const normalizeMealOrder = (meals = []) => {
    if (!Array.isArray(meals)) {
        return [];
    }

    return [...meals]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((meal, index) => ({
            ...meal,
            order: index + 1,
            foodItems: normalizeFoodItemOrder(meal.foodItems),
        }));
};

/**
 * @param {object[]} nutritionDays
 * @returns {object[]}
 */
export const normalizeNutritionDays = (nutritionDays = []) => {
    if (!Array.isArray(nutritionDays)) {
        return [];
    }

    return [...nutritionDays]
        .sort((a, b) => (a.dayNumber ?? 0) - (b.dayNumber ?? 0))
        .map((day, index) => {
            const dayNumber = index + 1;
            const name =
                typeof day.name === 'string' && day.name.trim()
                    ? day.name.trim()
                    : `Day ${dayNumber}`;

            return {
                ...day,
                dayNumber,
                name,
                notes:
                    typeof day.notes === 'string'
                        ? day.notes.trim() || null
                        : day.notes ?? null,
                meals: normalizeMealOrder(day.meals),
            };
        });
};

/**
 * @param {object[]} nutritionDays
 * @returns {{ valid: boolean, message?: string }}
 */
export const validateUniqueDayNumbers = (nutritionDays = []) => {
    if (!Array.isArray(nutritionDays)) {
        return { valid: true };
    }

    const seen = new Set();
    for (const day of nutritionDays) {
        if (day?.dayNumber == null) continue;
        if (seen.has(day.dayNumber)) {
            return {
                valid: false,
                message: 'Day numbers must be unique within a plan',
            };
        }
        seen.add(day.dayNumber);
    }

    return { valid: true };
};

/**
 * @param {object[]} meals
 * @returns {{ valid: boolean, message?: string }}
 */
export const validateUniqueMealOrders = (meals = []) => {
    if (!Array.isArray(meals)) {
        return { valid: true };
    }

    const seen = new Set();
    for (const meal of meals) {
        if (meal?.order == null) continue;
        if (seen.has(meal.order)) {
            return {
                valid: false,
                message: 'Meal order values must be unique within each day',
            };
        }
        seen.add(meal.order);
    }

    return { valid: true };
};

/**
 * @param {object[]} foodItems
 * @returns {{ valid: boolean, message?: string }}
 */
export const validateUniqueFoodItemOrders = (foodItems = []) => {
    if (!Array.isArray(foodItems)) {
        return { valid: true };
    }

    const seen = new Set();
    for (const item of foodItems) {
        if (item?.order == null) continue;
        if (seen.has(item.order)) {
            return {
                valid: false,
                message: 'Food item order values must be unique within each meal',
            };
        }
        seen.add(item.order);
    }

    return { valid: true };
};

/**
 * @param {object[]} nutritionDays
 * @returns {number}
 */
export const countTotalMeals = (nutritionDays = []) => {
    if (!Array.isArray(nutritionDays)) {
        return 0;
    }

    return nutritionDays.reduce(
        (total, day) => total + (Array.isArray(day.meals) ? day.meals.length : 0),
        0
    );
};

/**
 * @param {object[]} nutritionDays
 * @returns {number}
 */
export const countTotalFoodItems = (nutritionDays = []) => {
    if (!Array.isArray(nutritionDays)) {
        return 0;
    }

    return nutritionDays.reduce((total, day) => {
        const meals = Array.isArray(day.meals) ? day.meals : [];
        return (
            total +
            meals.reduce(
                (mealTotal, meal) =>
                    mealTotal + (Array.isArray(meal.foodItems) ? meal.foodItems.length : 0),
                0
            )
        );
    }, 0);
};

/**
 * Update denormalized list counters on a plan document/object.
 *
 * @param {import('mongoose').Document|object} plan
 * @returns {object} plan (mutated when document)
 */
export const applyPlanDenormalizedCounters = (plan) => {
    const days = normalizeNutritionDays(plan.nutritionDays ?? []);
    const computed = calculatePlanComputedMacros(days);

    plan.totalMeals = countTotalMeals(days);
    plan.totalFoodItems = countTotalFoodItems(days);
    plan.avgDailyCalories = computed.avgDailyCalories;

    return plan;
};

/**
 * Normalize trainer-controlled plan input before persistence.
 *
 * @param {object} input
 * @returns {object}
 */
export const normalizeNutritionPlanInput = (input = {}) => {
    const normalized = { ...input };

    if (typeof normalized.name === 'string') {
        normalized.name = normalized.name.trim();
    }

    if (typeof normalized.description === 'string') {
        const trimmed = normalized.description.trim();
        normalized.description = trimmed || null;
    }

    if (typeof normalized.notes === 'string') {
        const trimmed = normalized.notes.trim();
        normalized.notes = trimmed || null;
    }

    if (typeof normalized.icon === 'string') {
        const trimmed = normalized.icon.trim();
        normalized.icon = trimmed || DEFAULT_NUTRITION_PLAN_ICON;
    }

    if (Array.isArray(normalized.nutritionDays)) {
        normalized.nutritionDays = normalizeNutritionDays(
            normalized.nutritionDays.map((day) => {
                const nextDay = { ...day };

                if (typeof nextDay.name === 'string') {
                    const trimmed = nextDay.name.trim();
                    nextDay.name = trimmed || null;
                }

                if (typeof nextDay.notes === 'string') {
                    const trimmed = nextDay.notes.trim();
                    nextDay.notes = trimmed || null;
                }

                if (Array.isArray(nextDay.meals)) {
                    nextDay.meals = nextDay.meals.map((meal) => {
                        const nextMeal = { ...meal };

                        if (typeof nextMeal.name === 'string') {
                            nextMeal.name = nextMeal.name.trim();
                        }

                        if (typeof nextMeal.notes === 'string') {
                            const trimmed = nextMeal.notes.trim();
                            nextMeal.notes = trimmed || null;
                        }

                        if (typeof nextMeal.suggestedTime === 'string') {
                            const trimmed = nextMeal.suggestedTime.trim();
                            nextMeal.suggestedTime = trimmed || null;
                        }

                        if (Array.isArray(nextMeal.foodItems)) {
                            nextMeal.foodItems = nextMeal.foodItems.map((item) => {
                                const nextItem = { ...item };

                                if (typeof nextItem.notes === 'string') {
                                    const trimmed = nextItem.notes.trim();
                                    nextItem.notes = trimmed || null;
                                }

                                return nextItem;
                            });
                        }

                        return nextMeal;
                    });
                }

                return nextDay;
            })
        );
    }

    return normalized;
};

const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

const resolveObjectId = (id) =>
    isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId();

export const escapeRegex = (value) =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const roundCalories = (value) => Math.round(value ?? 0);

const roundMacroValue = (value) => Math.round((value ?? 0) * 10) / 10;

/**
 * Resolve schedule mode for API responses. Does not mutate stored documents.
 *
 * @param {object} plan
 * @returns {'daily'|'weekly'}
 */
export const resolveScheduleMode = (plan) => {
    const doc = toPlainObject(plan);
    const stored = doc?.scheduleMode;
    if (stored === 'daily' || stored === 'weekly') {
        return stored;
    }

    const dayCount = Array.isArray(doc?.nutritionDays) ? doc.nutritionDays.length : 0;
    return dayCount > 1 ? 'weekly' : 'daily';
};

/**
 * Whether the plan was created before scheduleMode existed (no stored value).
 *
 * @param {object} plan
 * @returns {boolean}
 */
export const isLegacySchedulePlan = (plan) => {
    const doc = toPlainObject(plan);
    return doc?.scheduleMode !== 'daily' && doc?.scheduleMode !== 'weekly';
};

/**
 * Validate nutritionDays length against schedule mode.
 *
 * @param {'daily'|'weekly'} scheduleMode
 * @param {object[]} nutritionDays
 * @param {{ legacy?: boolean }} [options]
 * @returns {{ valid: boolean, message?: string }}
 */
export const validateScheduleModeConstraints = (scheduleMode, nutritionDays = [], options = {}) => {
    const count = nutritionDays.length;
    const legacy = Boolean(options.legacy);

    if (legacy) {
        if (count > MAX_NUTRITION_DAYS) {
            return {
                valid: false,
                message: `Nutrition days cannot exceed ${MAX_NUTRITION_DAYS}`,
            };
        }
        return { valid: true };
    }

    if (scheduleMode === 'daily') {
        if (count > 1) {
            return {
                valid: false,
                message: 'Daily plans can contain at most one meal template day',
            };
        }
        return { valid: true };
    }

    if (scheduleMode === 'weekly') {
        if (count > MAX_WEEKLY_NUTRITION_DAYS) {
            return {
                valid: false,
                message: `Weekly plans cannot exceed ${MAX_WEEKLY_NUTRITION_DAYS} configured days`,
            };
        }
    }

    if (count > MAX_NUTRITION_DAYS) {
        return {
            valid: false,
            message: `Nutrition days cannot exceed ${MAX_NUTRITION_DAYS}`,
        };
    }

    return { valid: true };
};

/**
 * @param {{ calories?: number, protein?: number, carbs?: number, fat?: number }} macros
 */
export const roundMacros = (macros = {}) => ({
    calories: roundCalories(macros.calories),
    protein: roundMacroValue(macros.protein),
    carbs: roundMacroValue(macros.carbs),
    fat: roundMacroValue(macros.fat),
});

/**
 * Load foods visible to trainer and index by id string.
 *
 * @param {string[]} foodIds
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @returns {Promise<Map<string, import('mongoose').Document>>}
 */
export const loadVisibleFoodsByIds = async (foodIds, trainerId) => {
    const uniqueIds = [...new Set(foodIds.filter((id) => isValidObjectId(id)))];
    if (uniqueIds.length === 0) {
        return new Map();
    }

    const foods = await Food.find({
        $and: [{ _id: { $in: uniqueIds } }, buildFoodVisibilityFilter(trainerId)],
    });

    const map = new Map();
    for (const food of foods) {
        map.set(food._id.toString(), food);
    }

    return map;
};

/**
 * Validate all foodIds in a nutritionDays tree are visible to the trainer.
 *
 * @param {object[]} nutritionDays
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @returns {Promise<{ valid: boolean, errors?: Array<{ field: string, message: string }> }>}
 */
export const validateFoodVisibilityForPlan = async (nutritionDays = [], trainerId) => {
    const foodIds = [];

    for (const day of nutritionDays ?? []) {
        for (const meal of day?.meals ?? []) {
            for (const item of meal?.foodItems ?? []) {
                if (item?.foodId) {
                    foodIds.push(String(item.foodId));
                }
            }
        }
    }

    const uniqueIds = [...new Set(foodIds)];
    const visibleMap = await loadVisibleFoodsByIds(uniqueIds, trainerId);
    const errors = [];

    for (const foodId of uniqueIds) {
        if (!isValidObjectId(foodId)) {
            errors.push({ field: 'foodId', message: 'Must be a valid ObjectId' });
            continue;
        }
        if (!visibleMap.has(foodId)) {
            errors.push({
                field: 'foodId',
                message: `Food ${foodId} is not available`,
            });
        }
    }

    if (errors.length) {
        return { valid: false, errors };
    }

    return { valid: true };
};

/**
 * Attach server-generated food snapshots and validate units for plan food items.
 *
 * @param {object[]} nutritionDays
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @returns {Promise<object[]>}
 */
export const processNutritionDaysFoodItems = async (nutritionDays = [], trainerId) => {
    const normalizedDays = normalizeNutritionDays(nutritionDays);
    const foodIds = [];

    for (const day of normalizedDays) {
        for (const meal of day.meals ?? []) {
            for (const item of meal.foodItems ?? []) {
                if (item?.foodId) {
                    foodIds.push(String(item.foodId));
                }
            }
        }
    }

    const foodMap = await loadVisibleFoodsByIds(foodIds, trainerId);
    const errors = [];

    const processedDays = normalizedDays.map((day, dayIndex) => ({
        _id: resolveObjectId(day._id),
        dayNumber: day.dayNumber,
        name: day.name,
        notes: day.notes ?? null,
        meals: (day.meals ?? []).map((meal, mealIndex) => ({
            _id: resolveObjectId(meal._id),
            order: meal.order,
            name: meal.name,
            mealType: meal.mealType ?? null,
            suggestedTime: meal.suggestedTime ?? null,
            notes: meal.notes ?? null,
            foodItems: (meal.foodItems ?? []).map((item, itemIndex) => {
                const fieldBase = `nutritionDays[${dayIndex}].meals[${mealIndex}].foodItems[${itemIndex}]`;

                if (!item?.foodId || !isValidObjectId(item.foodId)) {
                    errors.push({
                        field: `${fieldBase}.foodId`,
                        message: 'Must be a valid ObjectId',
                    });
                    return item;
                }

                const foodId = String(item.foodId);
                const food = foodMap.get(foodId);

                if (!food) {
                    errors.push({
                        field: `${fieldBase}.foodId`,
                        message: 'Food is not available',
                    });
                    return item;
                }

                const snapshot = buildFoodSnapshot(food);
                const unitCheck = validatePlanFoodItemUnit(
                    item.quantity,
                    item.unit,
                    snapshot
                );

                if (!unitCheck.valid) {
                    errors.push({
                        field: `${fieldBase}.${unitCheck.field ?? 'unit'}`,
                        message: unitCheck.message ?? 'Invalid food item unit',
                    });
                }

                return {
                    _id: resolveObjectId(item._id),
                    foodId: food._id,
                    order: item.order,
                    quantity: item.quantity,
                    unit: item.unit,
                    notes: item.notes ?? null,
                    foodSnapshot: snapshot,
                };
            }),
        })),
    }));

    if (errors.length) {
        const err = new Error('Food item validation failed');
        err.statusCode = 400;
        err.errors = errors;
        throw err;
    }

    return processedDays;
};

/**
 * Resolve plan icon for API responses.
 *
 * @param {object} doc
 * @returns {string}
 */
export const resolvePlanIcon = (doc) => {
    const icon = doc?.icon;
    if (typeof icon === 'string' && icon.trim()) {
        return icon.trim();
    }
    return DEFAULT_NUTRITION_PLAN_ICON;
};

const mapPlanFoodItemToPublic = (item) => {
    const itemMacros = roundMacros(calculateFoodItemMacros(item));

    return {
        id: toIdString(item._id ?? item.id),
        foodId: toIdString(item.foodId),
        order: item.order,
        quantity: item.quantity,
        unit: item.unit,
        notes: item.notes ?? null,
        foodSnapshot: item.foodSnapshot ?? null,
        itemMacros,
    };
};

const mapMealToPublic = (meal) => {
    const foodItems = Array.isArray(meal.foodItems)
        ? normalizeFoodItemOrder(meal.foodItems).map(mapPlanFoodItemToPublic)
        : [];
    const mealTotals = roundMacros(calculateMealTotals(meal.foodItems ?? []));

    return {
        id: toIdString(meal._id ?? meal.id),
        order: meal.order,
        name: meal.name,
        mealType: meal.mealType ?? null,
        suggestedTime: meal.suggestedTime ?? null,
        notes: meal.notes ?? null,
        foodItems,
        mealTotals,
    };
};

const mapNutritionDayToPublic = (day) => {
    const meals = Array.isArray(day.meals)
        ? normalizeMealOrder(day.meals).map(mapMealToPublic)
        : [];
    const dailyTotals = roundMacros(calculateDailyTotals(day.meals ?? []));

    return {
        id: toIdString(day._id ?? day.id),
        dayNumber: day.dayNumber,
        name: day.name,
        notes: day.notes ?? null,
        meals,
        dailyTotals,
    };
};

/**
 * Full nutrition plan detail for API responses (without computed plan macros).
 *
 * @param {import('mongoose').Document|object} plan
 * @returns {object|null}
 */
export const mapNutritionPlanToPublic = (plan) => {
    if (!plan) {
        return null;
    }

    const doc = toPlainObject(plan);
    const nutritionDays = normalizeNutritionDays(doc.nutritionDays ?? []);
    const ownership = resolvePlanOwnership(doc);
    const computed = calculatePlanComputedMacros(nutritionDays);

    return {
        id: toIdString(doc._id ?? doc.id),
        trainerId: ownership.trainerId,
        ownership: {
            type: ownership.type,
            trainerId: ownership.trainerId,
        },
        templateKey: ownership.type === 'system' ? doc.templateKey ?? null : null,
        icon: resolvePlanIcon(doc),
        name: doc.name,
        description: doc.description ?? null,
        goal: doc.goal,
        duration: doc.duration,
        daysCount: doc.daysCount,
        scheduleMode: resolveScheduleMode(doc),
        macroTargets: doc.macroTargets ?? null,
        nutritionDays: nutritionDays.map(mapNutritionDayToPublic),
        isTemplate: Boolean(doc.isTemplate),
        status: doc.status,
        notes: doc.notes ?? null,
        totalMeals: doc.totalMeals ?? countTotalMeals(nutritionDays),
        totalFoodItems: doc.totalFoodItems ?? countTotalFoodItems(nutritionDays),
        avgDailyCalories: roundCalories(doc.avgDailyCalories ?? computed.avgDailyCalories),
        computedMacros: {
            avgDailyCalories: roundCalories(computed.avgDailyCalories),
            avgDailyProtein: roundMacroValue(computed.avgDailyProtein),
            avgDailyCarbs: roundMacroValue(computed.avgDailyCarbs),
            avgDailyFat: roundMacroValue(computed.avgDailyFat),
        },
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};

/**
 * Compact nutrition plan row for list API responses.
 *
 * @param {import('mongoose').Document|object} plan
 * @returns {object|null}
 */
export const mapNutritionPlanListItem = (plan) => {
    if (!plan) {
        return null;
    }

    const doc = toPlainObject(plan);
    const ownership = resolvePlanOwnership(doc);

    return {
        id: toIdString(doc._id ?? doc.id),
        name: doc.name,
        icon: resolvePlanIcon(doc),
        goal: doc.goal,
        duration: doc.duration,
        daysCount: doc.daysCount,
        macroTargets: doc.macroTargets ?? null,
        isTemplate: Boolean(doc.isTemplate),
        status: doc.status,
        ownership: {
            type: ownership.type,
            trainerId: ownership.trainerId,
        },
        totalMeals: doc.totalMeals ?? 0,
        totalFoodItems: doc.totalFoodItems ?? 0,
        avgDailyCalories: roundCalories(doc.avgDailyCalories ?? 0),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};

/**
 * Detail response alias — includes computed macros on nested tree.
 *
 * @param {import('mongoose').Document|object} plan
 * @returns {object|null}
 */
export const mapNutritionPlanToDetail = (plan) => mapNutritionPlanToPublic(plan);
