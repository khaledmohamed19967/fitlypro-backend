/**
 * Elevate plan PDF renderers (template id: `elevate`).
 *
 * Workout: templates/elevate/html/ via page.js
 * Nutrition Pages 01–03: templates/elevate/html/nutrition.html via nutrition.js
 * Registered in templates/index.js under RENDERERS.elevate.*
 *
 * Production PDF builds keep relative asset URLs and let htmlPdfRenderer serve
 * each file once (avoids duplicated base64 decorative images per page).
 */

import { renderHtmlToPdf } from '../../pdf/htmlPdfRenderer.js';
import { createPdfExportTrace } from '../../pdf/pdfExportTrace.js';
import {
    buildElevateWorkoutHtml,
    buildHighlightedTitleHtml,
    ELEVATE_HTML_DIR,
} from './page.js';
import {
    buildElevateNutritionHtml,
    deriveElevateNutritionViewModel,
    getNutritionExportSafeMetrics,
} from './nutrition.js';
import {
    applyElevateWorkoutContentPageSizes,
    applyElevateNutritionContentPageSizes,
} from './contentPageSizes.js';

/** Cover page owns its own @page margins (0). Matches html/styles.css @page A4. */
export const ELEVATE_PDF_OPTIONS = Object.freeze({
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
});

/**
 * Workout PDFs: content-height overview + detail pages.
 */
export const ELEVATE_WORKOUT_PDF_OPTIONS = Object.freeze({
    ...ELEVATE_PDF_OPTIONS,
    preparePage: applyElevateWorkoutContentPageSizes,
    localAssetRoot: ELEVATE_HTML_DIR,
});

/**
 * Nutrition PDFs: A4 cover + content-height meals/notes pages.
 */
export const ELEVATE_NUTRITION_PDF_OPTIONS = Object.freeze({
    ...ELEVATE_PDF_OPTIONS,
    preparePage: applyElevateNutritionContentPageSizes,
    localAssetRoot: ELEVATE_HTML_DIR,
});

/**
 * @param {object} exportModel
 * @param {{
 *   trace?: ReturnType<typeof createPdfExportTrace>,
 *   deadlineAt?: number,
 *   exportId?: string,
 * }} [ctx]
 * @returns {Promise<Buffer>}
 */
export const renderElevateWorkoutPdf = async (exportModel, ctx = {}) => {
    const ownsTrace = !ctx.trace;
    const trace =
        ctx.trace ||
        createPdfExportTrace({
            exportId: ctx.exportId || 'workout-render',
            planType: 'workout',
        });
    const deadlineAt = ctx.deadlineAt || trace.deadlineAt;

    try {
        trace.mark('html_generate_start', { planType: 'workout' });
        const html = buildElevateWorkoutHtml(exportModel, {
            inlineAssets: false,
        });
        trace.mark('html_generate', {
            htmlBytes: Buffer.byteLength(html),
            inlinedAssets: false,
        });

        const buffer = await renderHtmlToPdf(html, {
            ...ELEVATE_WORKOUT_PDF_OPTIONS,
            trace,
            deadlineAt,
            exportId: ctx.exportId || trace.exportId,
            planType: 'workout',
        });

        if (ownsTrace) {
            trace.finish({ ok: true, extra: { pdfBytes: buffer.length } });
        }
        return buffer;
    } catch (error) {
        if (ownsTrace) {
            trace.finish({ ok: false, error });
        }
        throw error;
    }
};

/**
 * Elevate Nutrition — Cover, Daily Meal Plan, Supplements & Notes.
 *
 * @param {object} exportModel
 * @param {{
 *   trace?: ReturnType<typeof createPdfExportTrace>,
 *   deadlineAt?: number,
 *   exportId?: string,
 * }} [ctx]
 * @returns {Promise<Buffer>}
 */
export const renderElevateNutritionPdf = async (exportModel, ctx = {}) => {
    const ownsTrace = !ctx.trace;
    const trace =
        ctx.trace ||
        createPdfExportTrace({
            exportId: ctx.exportId || 'nutrition-render',
            planType: 'nutrition',
        });
    const deadlineAt = ctx.deadlineAt || trace.deadlineAt;

    try {
        const metrics = getNutritionExportSafeMetrics(exportModel);
        trace.mark('nutrition_prepare', metrics);

        const html = buildElevateNutritionHtml(exportModel, {
            inlineAssets: false,
        });
        trace.mark('html_generate', {
            htmlBytes: Buffer.byteLength(html),
            inlinedAssets: false,
            totalPages: metrics.totalPages,
            mealPages: metrics.mealPages,
            notesPages: metrics.notesPages,
        });

        const buffer = await renderHtmlToPdf(html, {
            ...ELEVATE_NUTRITION_PDF_OPTIONS,
            trace,
            deadlineAt,
            exportId: ctx.exportId || trace.exportId,
            planType: 'nutrition',
        });

        if (ownsTrace) {
            trace.finish({ ok: true, extra: { pdfBytes: buffer.length } });
        }
        return buffer;
    } catch (error) {
        if (ownsTrace) {
            trace.finish({ ok: false, error });
        }
        throw error;
    }
};

export {
    buildElevateWorkoutHtml,
    buildElevateNutritionHtml,
    buildHighlightedTitleHtml,
    deriveElevateNutritionViewModel,
    getNutritionExportSafeMetrics,
};
