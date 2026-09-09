/**
 * Template registry — resolve renderers by templateId + planType.
 * Adding a template = register here + implement HTML builders.
 */

import {
    DEFAULT_PLAN_EXPORT_TEMPLATE_ID,
    PLAN_EXPORT_TEMPLATES,
} from '../plan-export.constants.js';
import {
    renderClassicNutritionPdf,
    renderClassicWorkoutPdf,
} from './classic/index.js';

const RENDERERS = Object.freeze({
    classic: Object.freeze({
        workout: renderClassicWorkoutPdf,
        nutrition: renderClassicNutritionPdf,
    }),
});

const cloneAssets = (assets) => {
    if (!assets || typeof assets !== 'object') return {};
    return JSON.parse(JSON.stringify(assets));
};

/**
 * @param {object} template
 * @param {'workout'|'nutrition'|undefined} planType
 */
const getScopedAssets = (template, planType) => {
    const assets = template.assets;
    if (!assets || typeof assets !== 'object') return null;
    if (!planType) return assets;
    return assets[planType] ?? null;
};

/**
 * Resolve the backward-compatible `previewUrl` from template assets.
 * Plan-type-specific previews are only exposed when that planType is requested.
 *
 * @param {object} template
 * @param {'workout'|'nutrition'|undefined} planType
 * @returns {string|null}
 */
export const resolveTemplatePreviewUrl = (template, planType) => {
    const scoped = getScopedAssets(template, planType);
    if (planType) {
        return typeof scoped?.previewImageUrl === 'string'
            ? scoped.previewImageUrl
            : null;
    }
    return typeof template.previewUrl === 'string' ? template.previewUrl : null;
};

/**
 * @param {string} [planType]
 */
export const listExportTemplates = (planType) => {
    const templates = PLAN_EXPORT_TEMPLATES.filter(
        (template) =>
            !planType || template.supportedPlanTypes.includes(planType)
    );

    return templates.map((template) => {
        const scopedAssets = getScopedAssets(template, planType);
        return {
            id: template.id,
            name: template.name,
            description: template.description,
            previewUrl: resolveTemplatePreviewUrl(template, planType),
            supportedPlanTypes: [...template.supportedPlanTypes],
            assets: cloneAssets(scopedAssets),
        };
    });
};

/**
 * @param {string} templateId
 */
export const getTemplateMeta = (templateId) =>
    PLAN_EXPORT_TEMPLATES.find((template) => template.id === templateId) ?? null;

/**
 * Plan-type assets from the registered template (preview or future PDF assets).
 *
 * @param {string} templateId
 * @param {'workout'|'nutrition'} planType
 */
export const getTemplatePlanAssets = (templateId, planType) => {
    const template = getTemplateMeta(templateId);
    if (!template) return null;
    return getScopedAssets(template, planType);
};

/**
 * @param {string} templateId
 * @param {'workout'|'nutrition'} planType
 * @returns {((exportModel: object) => Promise<Buffer>)|null}
 */
export const resolveTemplateRenderer = (
    templateId = DEFAULT_PLAN_EXPORT_TEMPLATE_ID,
    planType
) => {
    const byTemplate = RENDERERS[templateId];
    if (!byTemplate) return null;
    return byTemplate[planType] ?? null;
};
