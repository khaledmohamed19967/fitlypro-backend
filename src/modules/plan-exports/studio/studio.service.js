/**
 * Studio preview service — authorized plan load, fixtures, HTML/PDF build.
 */

import mongoose from 'mongoose';
import User from '../../users/user.model.js';
import workoutPlanService from '../../workout-plans/workout-plan.service.js';
import nutritionPlanService from '../../nutrition-plans/nutrition-plan.service.js';
import { ApiError } from '../../../utils/ApiError.js';
import {
    buildExportFilename,
    buildNutritionExportModel,
    buildWorkoutExportModel,
    mapTrainerForExport,
} from '../plan-export.helpers.js';
import { PLAN_EXPORT_MIME } from '../plan-export.constants.js';
import { loadStudioFixtureExportModel } from './studio.fixtures.js';
import {
    resolveStudioHtmlBuilder,
    resolveStudioPdfOptions,
    renderStudioPdfBuffer,
} from './studio.renderers.js';

let connecting = null;

/**
 * Connect to APP_DB_URL when real plans are requested.
 */
export const ensureStudioMongo = async () => {
    if (mongoose.connection.readyState === 1) return;

    const url = process.env.APP_DB_URL;
    if (!url) {
        throw new ApiError(503, 'Database is not configured for real-plan preview');
    }

    if (!connecting) {
        connecting = mongoose.connect(url).finally(() => {
            connecting = null;
        });
    }
    await connecting;
};

const loadTrainerProfile = async (trainerId) => {
    const user = await User.findById(trainerId).select(
        'firstName lastName email phone'
    );
    return mapTrainerForExport(user);
};

/**
 * Load export model via production ownership-scoped plan services.
 *
 * @param {{ planType: string, planId: string, trainerId: string }} input
 */
export const loadExportModel = async ({ planType, planId, trainerId }) => {
    await ensureStudioMongo();

    if (planType === 'workout') {
        const plan = await workoutPlanService.getWorkoutPlanById(
            planId,
            trainerId
        );
        const trainer = await loadTrainerProfile(trainerId);
        return {
            exportModel: buildWorkoutExportModel(plan, trainer),
            planName: plan.name,
        };
    }

    if (planType === 'nutrition') {
        const plan = await nutritionPlanService.getNutritionPlanById(
            planId,
            trainerId
        );
        const trainer = await loadTrainerProfile(trainerId);
        return {
            exportModel: buildNutritionExportModel(plan, trainer),
            planName: plan.name,
        };
    }

    throw new ApiError(400, 'Invalid plan type');
};

/**
 * @param {{ planType: string, fixtureId: string }} input
 */
export const loadFixtureExportModel = ({ planType, fixtureId }) => {
    const loaded = loadStudioFixtureExportModel(fixtureId, planType);
    if (!loaded.ok) {
        throw new ApiError(loaded.status, loaded.message);
    }
    return {
        exportModel: loaded.exportModel,
        planName: loaded.exportModel?.plan?.name || fixtureId,
        fixtureId: loaded.fixtureId,
    };
};

/**
 * @param {{ templateId: string, planType: string, pageId: string, exportModel: object }} input
 */
export const buildStudioHtml = async ({
    templateId,
    planType,
    pageId,
    exportModel,
}) => {
    const builder = await resolveStudioHtmlBuilder(
        templateId,
        planType,
        pageId
    );
    const html = builder(exportModel);
    if (!html || typeof html !== 'string') {
        throw new ApiError(500, 'HTML generation failed');
    }
    return html;
};

/**
 * @param {string} html
 * @param {string} templateId
 * @param {string} [planType]
 */
export const renderStudioPdf = async (html, templateId, planType) => {
    const pdfOptions = await resolveStudioPdfOptions(templateId, planType);
    const buffer = await renderStudioPdfBuffer(html, pdfOptions);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new ApiError(500, 'PDF generation failed');
    }
    return { buffer, mimeType: PLAN_EXPORT_MIME, pdfOptions };
};

/**
 * Full preview orchestration.
 *
 * @param {{
 *   planType: string,
 *   source: 'fixture'|'plan',
 *   fixtureId?: string,
 *   planId?: string,
 *   templateId: string,
 *   pageId: string,
 *   format: 'html'|'pdf',
 *   trainerId?: string|null,
 * }} input
 */
export const createStudioPreview = async (input) => {
    let exportModel;
    let planName;

    if (input.source === 'fixture') {
        const loaded = loadFixtureExportModel({
            planType: input.planType,
            fixtureId: input.fixtureId,
        });
        exportModel = loaded.exportModel;
        planName = loaded.planName;
    } else if (input.source === 'plan') {
        if (!input.trainerId) {
            throw new ApiError(401, 'Not authorized to access this route');
        }
        const loaded = await loadExportModel({
            planType: input.planType,
            planId: input.planId,
            trainerId: input.trainerId,
        });
        exportModel = loaded.exportModel;
        planName = loaded.planName;
    } else {
        throw new ApiError(400, 'Invalid preview source');
    }

    const html = await buildStudioHtml({
        templateId: input.templateId,
        planType: input.planType,
        pageId: input.pageId,
        exportModel,
    });

    if (input.format === 'html') {
        return {
            format: 'html',
            html,
            mimeType: 'text/html; charset=utf-8',
            planName,
            filename: null,
        };
    }

    if (input.format === 'pdf') {
        const pdf = await renderStudioPdf(
            html,
            input.templateId,
            input.planType
        );
        return {
            format: 'pdf',
            buffer: pdf.buffer,
            mimeType: pdf.mimeType,
            planName,
            filename: buildExportFilename(input.planType, planName),
            pdfOptions: pdf.pdfOptions,
        };
    }

    throw new ApiError(400, 'Invalid preview format');
};

export default {
    ensureStudioMongo,
    loadExportModel,
    loadFixtureExportModel,
    buildStudioHtml,
    renderStudioPdf,
    createStudioPreview,
};
