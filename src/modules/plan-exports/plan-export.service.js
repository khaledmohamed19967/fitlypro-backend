import User from '../users/user.model.js';
import workoutPlanService from '../workout-plans/workout-plan.service.js';
import nutritionPlanService from '../nutrition-plans/nutrition-plan.service.js';
import { ApiError } from '../../utils/ApiError.js';
import {
    DEFAULT_PLAN_EXPORT_TEMPLATE_ID,
    PLAN_EXPORT_MIME,
} from './plan-export.constants.js';
import {
    buildExportFilename,
    buildNutritionExportModel,
    buildWorkoutExportModel,
    mapTrainerForExport,
} from './plan-export.helpers.js';
import {
    getTemplateMeta,
    listExportTemplates,
    resolveTemplateRenderer,
} from './templates/index.js';

/**
 * Plan PDF Export Service — shared for workout + nutrition.
 */

const loadTrainerProfile = async (trainerId) => {
    const user = await User.findById(trainerId).select(
        'firstName lastName email phone'
    );
    return mapTrainerForExport(user);
};

/**
 * @param {string} [planType]
 */
const listTemplates = (planType) => ({
    templates: listExportTemplates(planType),
});

/**
 * Generate an authoritative PDF for a plan the trainer can read.
 *
 * @param {{ planType: 'workout'|'nutrition', planId: string, templateId?: string }} input
 * @param {string} trainerId
 */
const exportPlanPdf = async (input, trainerId) => {
    const planType = input.planType;
    const planId = input.planId;
    const templateId = input.templateId || DEFAULT_PLAN_EXPORT_TEMPLATE_ID;

    const templateMeta = getTemplateMeta(templateId);
    if (!templateMeta) {
        throw new ApiError(400, 'Invalid PDF template');
    }

    if (!templateMeta.supportedPlanTypes.includes(planType)) {
        throw new ApiError(400, 'Template does not support this plan type');
    }

    const renderer = resolveTemplateRenderer(templateId, planType);
    if (!renderer) {
        throw new ApiError(400, 'Template renderer is unavailable');
    }

    let plan;
    let exportModel;

    try {
        if (planType === 'workout') {
            plan = await workoutPlanService.getWorkoutPlanById(planId, trainerId);
            const trainer = await loadTrainerProfile(trainerId);
            exportModel = buildWorkoutExportModel(plan, trainer);
        } else if (planType === 'nutrition') {
            plan = await nutritionPlanService.getNutritionPlanById(planId, trainerId);
            const trainer = await loadTrainerProfile(trainerId);
            exportModel = buildNutritionExportModel(plan, trainer);
        } else {
            throw new ApiError(400, 'Invalid plan type');
        }
    } catch (error) {
        throw error;
    }

    let buffer;
    try {
        buffer = await renderer(exportModel);
    } catch (error) {
        throw new ApiError(500, 'PDF generation failed');
    }

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new ApiError(500, 'PDF generation failed');
    }

    return {
        buffer,
        mimeType: PLAN_EXPORT_MIME,
        filename: buildExportFilename(planType, plan.name),
    };
};

export default {
    listTemplates,
    exportPlanPdf,
};
