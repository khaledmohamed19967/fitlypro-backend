/**
 * Classic template — HTML/CSS → Chromium PDF.
 */

import { renderHtmlToPdf } from '../../pdf/htmlPdfRenderer.js';
import { buildClassicNutritionHtml } from './nutrition.js';
import { buildClassicWorkoutHtml } from './workout.js';

/** Classic PDF: margins live in CSS @page (applied on every printed page). */
const CLASSIC_PDF_OPTIONS = {
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    preferCSSPageSize: true,
};

/**
 * @param {object} exportModel
 * @returns {Promise<Buffer>}
 */
export const renderClassicNutritionPdf = async (exportModel) => {
    const html = buildClassicNutritionHtml(exportModel);
    return renderHtmlToPdf(html, CLASSIC_PDF_OPTIONS);
};

/**
 * @param {object} exportModel
 * @returns {Promise<Buffer>}
 */
export const renderClassicWorkoutPdf = async (exportModel) => {
    const html = buildClassicWorkoutHtml(exportModel);
    return renderHtmlToPdf(html, CLASSIC_PDF_OPTIONS);
};

export { buildClassicNutritionHtml, buildClassicWorkoutHtml };
