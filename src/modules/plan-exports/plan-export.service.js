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
    countElevateHtmlPages,
    createPdfExportId,
    createPdfExportTrace,
    summarizeExportModelMetrics,
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
 * @param {{ planType: 'workout'|'nutrition', planId: string, templateId?: string }} input
 * @param {string} trainerId
 * @param {{ req?: import('express').Request }} [options]
 */
const exportPlanPdf = async (input, trainerId, options = {}) => {
    const planType = input.planType;
    const planId = input.planId;
    const templateId = input.templateId || DEFAULT_PLAN_EXPORT_TEMPLATE_ID;
    const exportId = createPdfExportId(options.req);

    const trace = createPdfExportTrace(exportId, {
        planType,
        templateId,
        // planId is an opaque ObjectId — useful for ops correlation, not PII.
        planId,
    });

    trace.log('request_received');

    const templateMeta = getTemplateMeta(templateId);
    if (!templateMeta) {
        trace.fail({ phase: 'validate_template', message: 'Invalid PDF template' });
        throw new ApiError(400, 'Invalid PDF template');
    }

    if (!templateMeta.supportedPlanTypes.includes(planType)) {
        trace.fail({
            phase: 'validate_template',
            message: 'Template does not support this plan type',
        });
        throw new ApiError(400, 'Template does not support this plan type');
    }

    const renderer = resolveTemplateRenderer(templateId, planType);
    if (!renderer) {
        trace.fail({
            phase: 'validate_template',
            message: 'Template renderer is unavailable',
        });
        throw new ApiError(400, 'Template renderer is unavailable');
    }

    let plan;
    let exportModel;
    let modelMetrics = {};

    try {
        await trace.time('auth_ready', async () => null, {
            // Auth already completed in middleware; mark the handoff.
            trainerAuthenticated: Boolean(trainerId),
        });

        if (planType === 'workout') {
            plan = await trace.time('db_load_plan', () =>
                workoutPlanService.getWorkoutPlanById(planId, trainerId)
            );
            const trainer = await trace.time('db_load_trainer', () =>
                loadTrainerProfile(trainerId)
            );
            exportModel = await trace.time('transform_export_model', () =>
                buildWorkoutExportModel(plan, trainer)
            );
        } else if (planType === 'nutrition') {
            plan = await trace.time('db_load_plan', () =>
                nutritionPlanService.getNutritionPlanById(planId, trainerId)
            );
            const trainer = await trace.time('db_load_trainer', () =>
                loadTrainerProfile(trainerId)
            );
            exportModel = await trace.time('transform_export_model', () =>
                buildNutritionExportModel(plan, trainer)
            );
        } else {
            throw new ApiError(400, 'Invalid plan type');
        }

        modelMetrics = summarizeExportModelMetrics(exportModel);
        trace.log('model_metrics', modelMetrics);
    } catch (error) {
        trace.fail({
            phase: 'data_load',
            message: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }

    let buffer;
    try {
        buffer = await trace.time(
            'render_pdf',
            () =>
                renderer(exportModel, {
                    trace,
                    modelMetrics,
                }),
            modelMetrics
        );
    } catch (error) {
        const phase =
            error && typeof error === 'object' && 'pdfPhase' in error
                ? error.pdfPhase
                : 'unknown';
        trace.fail({
            phase,
            message: error instanceof Error ? error.message : String(error),
            ...modelMetrics,
        });
        // Keep client response generic; retain diagnostics for server logs only.
        console.error('[plan-export] PDF generation failed', {
            exportId,
            planType,
            planId,
            templateId,
            phase,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            ...modelMetrics,
        });
        if (error instanceof ApiError && error.statusCode === 504) {
            throw new ApiError(504, 'PDF generation timed out');
        }
        throw new ApiError(500, 'PDF generation failed');
    }

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        trace.fail({ phase: 'pdf_buffer_validation', ...modelMetrics });
        console.error('[plan-export] PDF generation returned empty buffer', {
            exportId,
            planType,
            planId,
            templateId,
            ...modelMetrics,
        });
        throw new ApiError(500, 'PDF generation failed');
    }

    trace.finish({
        phase: 'response_ready',
        pdfBytes: buffer.length,
        ...modelMetrics,
    });

    return {
        buffer,
        mimeType: PLAN_EXPORT_MIME,
        filename: buildExportFilename(planType, plan.name),
        exportId,
        metrics: {
            ...modelMetrics,
            pdfBytes: buffer.length,
            totalMs: trace.totalMs(),
        },
    };
};

export default {
    listTemplates,
    exportPlanPdf,
    // Exported for tests / bench scripts.
    countElevateHtmlPages,
    summarizeExportModelMetrics,
};
