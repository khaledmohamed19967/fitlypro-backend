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
import {
    createExportId,
    createPdfExportTrace,
    resolvePdfExportDeadlineMs,
} from './pdf/pdfExportTrace.js';

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
 * @param {{ planType: 'workout'|'nutrition', planId: string, templateId?: string, exportId?: string }} input
 * @param {string} trainerId
 */
const exportPlanPdf = async (input, trainerId) => {
    const planType = input.planType;
    const planId = input.planId;
    const templateId = input.templateId || DEFAULT_PLAN_EXPORT_TEMPLATE_ID;
    const exportId = createExportId(input.exportId);
    const deadlineMs = resolvePdfExportDeadlineMs();
    const trace = createPdfExportTrace({
        exportId,
        planType,
        templateId,
        deadlineMs,
    });

    const templateMeta = getTemplateMeta(templateId);
    if (!templateMeta) {
        trace.finish({
            ok: false,
            error: new ApiError(400, 'Invalid PDF template'),
        });
        throw new ApiError(400, 'Invalid PDF template');
    }

    if (!templateMeta.supportedPlanTypes.includes(planType)) {
        trace.finish({
            ok: false,
            error: new ApiError(400, 'Template does not support this plan type'),
        });
        throw new ApiError(400, 'Template does not support this plan type');
    }

    const renderer = resolveTemplateRenderer(templateId, planType);
    if (!renderer) {
        trace.finish({
            ok: false,
            error: new ApiError(400, 'Template renderer is unavailable'),
        });
        throw new ApiError(400, 'Template renderer is unavailable');
    }

    let plan;
    let exportModel;

    try {
        trace.mark('data_load_start');
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
        trace.mark('data_prepare', {
            hasPlan: Boolean(plan),
        });
    } catch (error) {
        trace.setFailureStage('data_prepare');
        trace.finish({ ok: false, error });
        throw error;
    }

    let buffer;
    try {
        buffer = await renderer(exportModel, {
            trace,
            deadlineAt: trace.deadlineAt,
            exportId,
        });
    } catch (error) {
        // Keep client response generic for unexpected failures; deadline stays 504.
        const phase =
            error && typeof error === 'object' && 'pdfPhase' in error
                ? error.pdfPhase
                : 'unknown';
        console.error('[plan-export] PDF generation failed', {
            exportId,
            planType,
            planId,
            templateId,
            phase,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        trace.finish({ ok: false, error });

        if (
            error instanceof ApiError &&
            error.statusCode === 504 &&
            error.pdfPhase === 'deadline'
        ) {
            throw error;
        }

        throw new ApiError(500, 'PDF generation failed');
    }

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        console.error('[plan-export] PDF generation returned empty buffer', {
            exportId,
            planType,
            planId,
            templateId,
        });
        trace.finish({
            ok: false,
            error: new ApiError(500, 'PDF generation failed'),
        });
        throw new ApiError(500, 'PDF generation failed');
    }

    trace.finish({
        ok: true,
        extra: { pdfBytes: buffer.length },
    });

    return {
        buffer,
        mimeType: PLAN_EXPORT_MIME,
        filename: buildExportFilename(planType, plan.name),
        exportId,
    };
};

export default {
    listTemplates,
    exportPlanPdf,
};
