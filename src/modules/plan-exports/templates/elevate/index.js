/**
 * Elevate workout cover renderer (template id: `elevate`).
 *
 * Active design source: templates/elevate/html/ via page.js
 * Registered in templates/index.js under RENDERERS.elevate.workout.
 */

import { renderHtmlToPdf } from '../../pdf/htmlPdfRenderer.js';
import {
    buildElevateWorkoutHtml,
    buildHighlightedTitleHtml,
} from './page.js';

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

export { buildElevateWorkoutHtml, buildHighlightedTitleHtml };
