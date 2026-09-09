import mongoose from 'mongoose';
import NutritionPlan from './nutrition-plan.model.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginateCollection, countMatchingDocuments } from '../../utils/pagination.js';
import { DEFAULT_NUTRITION_PLAN_ICON } from './nutrition-plan.constants.js';
import {
    normalizeNutritionPlanInput,
    processNutritionDaysFoodItems,
    applyPlanDenormalizedCounters,
    buildNutritionPlanListFilter,
    buildNutritionPlanSummaryFilters,
    buildNutritionPlanVisibilityFilter,
    canReadNutritionPlan,
    canModifyNutritionPlan,
    canCloneNutritionPlan,
    generateCloneName,
    deepCloneNutritionDays,
    isSystemNutritionPlan,
    mapNutritionPlanToDetail,
    mapNutritionPlanListItem,
    validateScheduleModeConstraints,
    resolveScheduleMode,
    isLegacySchedulePlan,
} from './nutrition-plan.helpers.js';

/**
 * Nutrition Plan Service — CRUD (Phase 4)
 */

const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

const emptyToNull = (value) => (value === '' || value === undefined ? null : value);

/**
 * @param {object} query
 * @param {string} trainerId
 */
const getNutritionPlanSummary = async (query, trainerId) => {
    const filters = buildNutritionPlanSummaryFilters(query, trainerId);

    const [myPlans, templates, archived] = await Promise.all([
        countMatchingDocuments(NutritionPlan, filters.myPlans),
        countMatchingDocuments(NutritionPlan, filters.templates),
        countMatchingDocuments(NutritionPlan, filters.archived),
    ]);

    return {
        'my-plans': myPlans,
        templates,
        archived,
    };
};

/**
 * @param {string} sort
 */
const buildSortSpec = (sort) => {
    switch (sort) {
        case 'name':
            return { name: 1 };
        case 'name-desc':
            return { name: -1 };
        case 'oldest':
            return { createdAt: 1 };
        case 'calories-high':
            return { avgDailyCalories: -1, createdAt: -1 };
        case 'calories-low':
            return { avgDailyCalories: 1, createdAt: -1 };
        case 'duration-high':
            return { duration: -1, createdAt: -1 };
        case 'duration-low':
            return { duration: 1, createdAt: -1 };
        case 'newest':
        default:
            return { createdAt: -1 };
    }
};

/**
 * @param {string} planId
 * @param {string} trainerId
 */
const loadReadablePlan = async (planId, trainerId) => {
    if (!isValidObjectId(planId)) {
        throw new ApiError(400, 'Invalid nutrition plan ID');
    }

    const plan = await NutritionPlan.findOne({
        $and: [{ _id: planId }, buildNutritionPlanVisibilityFilter(trainerId)],
    });

    if (!plan || !canReadNutritionPlan(plan, trainerId)) {
        throw new ApiError(404, 'Nutrition plan not found');
    }

    return plan;
};

/**
 * @param {string} planId
 * @param {string} trainerId
 */
const loadModifiablePlan = async (planId, trainerId) => {
    if (!isValidObjectId(planId)) {
        throw new ApiError(400, 'Invalid nutrition plan ID');
    }

    const plan = await NutritionPlan.findById(planId);

    if (!plan) {
        throw new ApiError(404, 'Nutrition plan not found');
    }

    if (isSystemNutritionPlan(plan)) {
        throw new ApiError(403, 'System nutrition templates cannot be modified');
    }

    if (!canModifyNutritionPlan(plan, trainerId)) {
        throw new ApiError(404, 'Nutrition plan not found');
    }

    return plan;
};

/**
 * @param {object[]} nutritionDays
 * @param {string} trainerId
 */
const processNutritionDays = async (nutritionDays, trainerId) => {
    try {
        return await processNutritionDaysFoodItems(nutritionDays, trainerId);
    } catch (err) {
        if (err.errors) {
            throw new ApiError(400, err.message || 'Food item validation failed', err.errors);
        }
        throw err;
    }
};

/**
 * @param {object} query
 * @param {string} trainerId
 */
const listNutritionPlans = async (query, trainerId) => {
    const { page, limit, sort = 'newest' } = query;
    const filter = buildNutritionPlanListFilter(query, trainerId);

    const { docs, pagination } = await paginateCollection({
        model: NutritionPlan,
        filter,
        sort: buildSortSpec(sort),
        page,
        limit,
    });

    return {
        nutritionPlans: docs.map((plan) => mapNutritionPlanListItem(plan)),
        pagination,
    };
};

/**
 * @param {string} planId
 * @param {string} trainerId
 */
const getNutritionPlanById = async (planId, trainerId) => {
    const plan = await loadReadablePlan(planId, trainerId);
    return mapNutritionPlanToDetail(plan);
};

/**
 * @param {object} body
 * @param {string} trainerId
 */
const createNutritionPlan = async (body, trainerId) => {
    const normalized = normalizeNutritionPlanInput(body);
    const nutritionDays = normalized.nutritionDays
        ? await processNutritionDays(normalized.nutritionDays, trainerId)
        : [];

    const scheduleMode = normalized.scheduleMode ?? 'daily';
    const scheduleCheck = validateScheduleModeConstraints(scheduleMode, nutritionDays, { legacy: false });
    if (!scheduleCheck.valid) {
        throw new ApiError(400, scheduleCheck.message);
    }

    const plan = new NutritionPlan({
        trainerId,
        ownership: {
            type: 'trainer',
            trainerId,
        },
        templateKey: null,
        icon: normalized.icon ?? DEFAULT_NUTRITION_PLAN_ICON,
        name: normalized.name,
        description: emptyToNull(normalized.description),
        goal: normalized.goal,
        duration: normalized.duration,
        daysCount: normalized.daysCount,
        scheduleMode,
        macroTargets: normalized.macroTargets,
        nutritionDays,
        isTemplate: normalized.isTemplate ?? false,
        status: normalized.status ?? 'active',
        notes: emptyToNull(normalized.notes),
    });

    applyPlanDenormalizedCounters(plan);
    await plan.save();

    return mapNutritionPlanToDetail(plan);
};

/**
 * @param {string} planId
 * @param {object} body
 * @param {string} trainerId
 */
const updateNutritionPlan = async (planId, body, trainerId) => {
    const plan = await loadModifiablePlan(planId, trainerId);
    const normalized = normalizeNutritionPlanInput(body);

    if (normalized.name !== undefined) plan.name = normalized.name;
    if (normalized.icon !== undefined) {
        plan.icon = normalized.icon ?? DEFAULT_NUTRITION_PLAN_ICON;
    }
    if (normalized.description !== undefined) {
        plan.description = emptyToNull(normalized.description);
    }
    if (normalized.goal !== undefined) plan.goal = normalized.goal;
    if (normalized.duration !== undefined) plan.duration = normalized.duration;
    if (normalized.daysCount !== undefined) plan.daysCount = normalized.daysCount;
    if (normalized.scheduleMode !== undefined) plan.scheduleMode = normalized.scheduleMode;
    if (normalized.macroTargets !== undefined) plan.macroTargets = normalized.macroTargets;
    if (normalized.isTemplate !== undefined) plan.isTemplate = normalized.isTemplate;
    if (normalized.status !== undefined) plan.status = normalized.status;
    if (normalized.notes !== undefined) plan.notes = emptyToNull(normalized.notes);

    if (normalized.nutritionDays !== undefined) {
        plan.nutritionDays = await processNutritionDays(normalized.nutritionDays, trainerId);
        plan.markModified('nutritionDays');
    }

    const effectiveMode = resolveScheduleMode(plan);
    const legacy = isLegacySchedulePlan(plan) && normalized.scheduleMode === undefined;
    const scheduleCheck = validateScheduleModeConstraints(
        effectiveMode,
        plan.nutritionDays ?? [],
        { legacy }
    );
    if (!scheduleCheck.valid) {
        throw new ApiError(400, scheduleCheck.message);
    }

    applyPlanDenormalizedCounters(plan);
    await plan.save();

    return mapNutritionPlanToDetail(plan);
};

/**
 * @param {string} planId
 * @param {string} trainerId
 */
const archiveNutritionPlan = async (planId, trainerId) => {
    const plan = await loadModifiablePlan(planId, trainerId);
    plan.status = 'archived';
    await plan.save();
    return mapNutritionPlanToDetail(plan);
};

/**
 * Clone an active plan into a new trainer-owned plan.
 *
 * @param {string} sourcePlanId
 * @param {string} trainerId
 * @param {{ name?: string }} payload
 */
const cloneNutritionPlan = async (sourcePlanId, trainerId, payload = {}) => {
    if (!isValidObjectId(sourcePlanId)) {
        throw new ApiError(400, 'Invalid nutrition plan ID');
    }

    const source = await NutritionPlan.findById(sourcePlanId);

    if (!source || !canReadNutritionPlan(source, trainerId)) {
        throw new ApiError(404, 'Nutrition plan not found');
    }

    if (source.status !== 'active') {
        throw new ApiError(400, 'Only active plans can be cloned');
    }

    if (!canCloneNutritionPlan(source, trainerId)) {
        throw new ApiError(404, 'Nutrition plan not found');
    }

    let name = payload.name?.trim();
    if (!name) {
        name = await generateCloneName(source.name, async (candidate) => {
            const existing = await NutritionPlan.exists({
                name: candidate,
                $or: [
                    { 'ownership.type': 'trainer', 'ownership.trainerId': trainerId },
                    { ownership: { $exists: false }, trainerId },
                ],
            });
            return Boolean(existing);
        });
    }

    const plan = new NutritionPlan({
        trainerId,
        ownership: {
            type: 'trainer',
            trainerId,
        },
        templateKey: null,
        icon: source.icon ?? DEFAULT_NUTRITION_PLAN_ICON,
        name,
        description: source.description ?? null,
        goal: source.goal,
        duration: source.duration,
        daysCount: source.daysCount,
        scheduleMode: resolveScheduleMode(source),
        macroTargets: source.macroTargets,
        nutritionDays: deepCloneNutritionDays(source.nutritionDays ?? []),
        isTemplate: false,
        status: 'active',
        notes: source.notes ?? null,
    });

    applyPlanDenormalizedCounters(plan);
    await plan.save();

    return mapNutritionPlanToDetail(plan);
};

export default {
    listNutritionPlans,
    getNutritionPlanSummary,
    getNutritionPlanById,
    createNutritionPlan,
    updateNutritionPlan,
    archiveNutritionPlan,
    cloneNutritionPlan,
};
