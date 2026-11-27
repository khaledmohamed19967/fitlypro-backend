/**
 * Studio HTML builder + PDF option resolution.
 *
 * HTML builders come from studio.modules (cache-busted, last-good retained).
 * Playwright loads only when PDF rendering is requested.
 */

import { resolveStudioPage } from './studio.registry.js';
import { loadStudioHtmlBuilder } from './studio.modules.js';

/**
 * Resolve the production HTML builder for a Studio combination.
 *
 * @param {string} templateId
 * @param {string} planType
 * @param {string} pageId
 * @returns {Promise<(exportModel: object) => string>}
 */
export const resolveStudioHtmlBuilder = async (
    templateId,
    planType,
    pageId
) => {
    const page = resolveStudioPage(templateId, planType, pageId);
    if (!page.ok) {
        const err = new Error(page.message);
        err.statusCode = page.status;
        throw err;
    }

    const loaded = await loadStudioHtmlBuilder(templateId, planType, pageId);
    return loaded.builder;
};

/**
 * Template-specific Playwright PDF options (same values as production renderers).
 *
 * @param {string} templateId
 */
export const resolveStudioPdfOptions = async (templateId, planType) => {
    if (templateId === 'elevate') {
        const mod = await import('../templates/elevate/index.js');
        if (planType === 'nutrition') {
            return { ...mod.ELEVATE_NUTRITION_PDF_OPTIONS };
        }
        if (planType === 'workout') {
            return { ...mod.ELEVATE_WORKOUT_PDF_OPTIONS };
        }
        return { ...mod.ELEVATE_PDF_OPTIONS };
    }
    return {};
};

/**
 * @param {string} html
 * @param {object} pdfOptions
 * @returns {Promise<Buffer>}
 */
export const renderStudioPdfBuffer = async (html, pdfOptions) => {
    const { renderHtmlToPdf } = await import('../pdf/htmlPdfRenderer.js');
    return renderHtmlToPdf(html, pdfOptions);
};

export default {
    resolveStudioHtmlBuilder,
    resolveStudioPdfOptions,
    renderStudioPdfBuffer,
};
