/**
 * Elevate plan PDF renderers (template id: `elevate`).
 *
 * Workout: templates/elevate/html/ via page.js
 * Nutrition Pages 01–03: templates/elevate/html/nutrition.html via nutrition.js
 * Registered in templates/index.js under RENDERERS.elevate.*
 */

import { renderHtmlToPdf } from '../../pdf/htmlPdfRenderer.js';
import {
    buildElevateWorkoutHtml,
    buildHighlightedTitleHtml,
} from './page.js';
import { buildElevateNutritionHtml } from './nutrition.js';

/** Cover page owns its own @page margins (0). Matches html/styles.css @page A4. */
export const ELEVATE_PDF_OPTIONS = Object.freeze({
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
});

/**
 * @param {object} exportModel
 * @returns {Promise<Buffer>}
 */
export const renderElevateWorkoutPdf = async (exportModel) => {
    const html = buildElevateWorkoutHtml(exportModel);
    return renderHtmlToPdf(html, ELEVATE_PDF_OPTIONS);
};

/**
 * Elevate Nutrition — Pages 01–03 (Cover, Daily Meal Plan, Supplements & Notes).
 *
 * @param {object} exportModel
 * @returns {Promise<Buffer>}
 */
export const renderElevateNutritionPdf = async (exportModel) => {
    const html = buildElevateNutritionHtml(exportModel);
    return renderHtmlToPdf(html, ELEVATE_PDF_OPTIONS);
};

export {
    buildElevateWorkoutHtml,
    buildElevateNutritionHtml,
    buildHighlightedTitleHtml,
};
