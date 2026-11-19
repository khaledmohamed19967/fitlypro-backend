/**
 * Studio-facing PDF template registry (development discovery only).
 *
 * Production template ids / plan types / display metadata come from
 * plan-export.constants.js. This file adds only Studio page metadata.
 *
 * Phase C: discovery + page validation + live-reload source metadata.
 * HTML builders live in studio.renderers/modules so this stays free of Playwright.
 */

import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
    PLAN_EXPORT_TEMPLATES,
    PLAN_EXPORT_TYPES,
} from '../plan-export.constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_ROOT = join(__dirname, '../templates');

const FULL_PAGE = Object.freeze({
    id: 'full',
    label: 'Full document',
    isDefault: true,
});

/**
 * Studio-only page declarations keyed by templateId → planType → pages[].
 * Combinations must also exist in PLAN_EXPORT_TEMPLATES.supportedPlanTypes.
 */
const STUDIO_PAGES = Object.freeze({
    classic: Object.freeze({
        workout: Object.freeze([FULL_PAGE]),
        nutrition: Object.freeze([FULL_PAGE]),
    }),
    elevate: Object.freeze({
        // Single cover page: author's html/ design via page.js
        workout: Object.freeze([FULL_PAGE]),
    }),
});

/** Public URL path where Studio serves the Elevate cover HTML design folder. */
export const ELEVATE_HTML_ASSET_MOUNT = '/studio-assets/elevate/html';
/**
 * Trusted Studio source metadata for live reload (never accept client paths).
 * `watchDir` is the only filesystem root watched for each templateId.
 * `modules` lists HTML builder modules loaded via cache-busted dynamic import.
 */
const toModuleHref = (absolutePath) => pathToFileURL(absolutePath).href;

export const STUDIO_TEMPLATE_SOURCES = Object.freeze({
    classic: Object.freeze({
        templateId: 'classic',
        watchDir: join(TEMPLATES_ROOT, 'classic'),
        modules: Object.freeze([
            Object.freeze({
                planType: 'workout',
                exportName: 'buildClassicWorkoutHtml',
                filePath: join(TEMPLATES_ROOT, 'classic', 'workout.js'),
                href: toModuleHref(join(TEMPLATES_ROOT, 'classic', 'workout.js')),
            }),
            Object.freeze({
                planType: 'nutrition',
                exportName: 'buildClassicNutritionHtml',
                filePath: join(TEMPLATES_ROOT, 'classic', 'nutrition.js'),
                href: toModuleHref(join(TEMPLATES_ROOT, 'classic', 'nutrition.js')),
            }),
        ]),
    }),
    elevate: Object.freeze({
        templateId: 'elevate',
        watchDir: join(TEMPLATES_ROOT, 'elevate'),
        modules: Object.freeze([
            Object.freeze({
                planType: 'workout',
                pageId: 'full',
                exportName: 'buildElevateWorkoutHtml',
                filePath: join(TEMPLATES_ROOT, 'elevate', 'page.js'),
                href: toModuleHref(join(TEMPLATES_ROOT, 'elevate', 'page.js')),
            }),
        ]),
    }),
});
/**
 * @returns {{ templateId: string, watchDir: string }[]}
 */
export const listStudioWatchRoots = () =>
    Object.values(STUDIO_TEMPLATE_SOURCES).map((source) => ({
        templateId: source.templateId,
        watchDir: source.watchDir,
    }));

/**
 * Resolve trusted module import metadata for a Studio page.
 * Prefer an exact pageId match; fall back to planType-only entries (classic).
 *
 * @param {string} templateId
 * @param {string} planType
 * @param {string} [pageId]
 */
export const resolveStudioModuleSpec = (templateId, planType, pageId) => {
    const source = STUDIO_TEMPLATE_SOURCES[templateId];
    if (!source) return null;

    const forPlan = source.modules.filter((entry) => entry.planType === planType);
    if (!forPlan.length) return null;

    if (pageId) {
        const exact = forPlan.find((entry) => entry.pageId === pageId);
        if (exact) return exact;
    }

    return forPlan.find((entry) => !entry.pageId) ?? null;
};

const clonePage = (page) => ({
    id: page.id,
    label: page.label,
    isDefault: Boolean(page.isDefault),
});

const getProductionMeta = (templateId) =>
    PLAN_EXPORT_TEMPLATES.find((template) => template.id === templateId) ?? null;

/**
 * Validate Studio page declarations against production template metadata.
 * Throws with an actionable message when invariants fail.
 *
 * Invariants:
 * - Every declared page list is non-empty
 * - Exactly one page has isDefault: true
 * - Page ids within a list are unique
 * - No orphan Studio declarations (unknown template or unsupported plan type)
 * - Every production-supported template/planType has Studio pages
 * - No duplicate (templateId, planType) pairs (map key collision check)
 *
 * @param {Record<string, Record<string, object[]>>} studioPages
 * @param {readonly object[]} [productionTemplates=PLAN_EXPORT_TEMPLATES]
 */
export const validateStudioRegistry = (
    studioPages,
    productionTemplates = PLAN_EXPORT_TEMPLATES
) => {
    const errors = [];
    const seenPairs = new Set();

    if (!studioPages || typeof studioPages !== 'object') {
        throw new Error('Studio registry STUDIO_PAGES must be an object');
    }

    for (const [templateId, byPlanType] of Object.entries(studioPages)) {
        const meta = productionTemplates.find((t) => t.id === templateId) ?? null;
        if (!meta) {
            errors.push(
                `Orphan Studio declaration: template "${templateId}" is not in production PLAN_EXPORT_TEMPLATES`
            );
            continue;
        }

        if (!byPlanType || typeof byPlanType !== 'object') {
            errors.push(
                `Studio pages for "${templateId}" must be an object keyed by planType`
            );
            continue;
        }

        for (const [planType, pages] of Object.entries(byPlanType)) {
            const pairKey = `${templateId}:${planType}`;
            if (seenPairs.has(pairKey)) {
                errors.push(`Duplicate Studio declaration for ${pairKey}`);
            }
            seenPairs.add(pairKey);

            if (!PLAN_EXPORT_TYPES.includes(planType)) {
                errors.push(
                    `Orphan Studio declaration: ${pairKey} uses unknown planType`
                );
                continue;
            }

            if (!meta.supportedPlanTypes.includes(planType)) {
                errors.push(
                    `Orphan Studio declaration: ${pairKey} is not in production supportedPlanTypes [${meta.supportedPlanTypes.join(', ')}]`
                );
                continue;
            }

            if (!Array.isArray(pages) || pages.length === 0) {
                errors.push(
                    `Studio pages for ${pairKey} must be a non-empty array`
                );
                continue;
            }

            const defaults = pages.filter((page) => page && page.isDefault);
            if (defaults.length !== 1) {
                errors.push(
                    `Studio pages for ${pairKey} must have exactly one isDefault: true (found ${defaults.length})`
                );
            }

            const ids = pages.map((page) => page?.id);
            const uniqueIds = new Set(ids);
            if (ids.some((id) => !id) || uniqueIds.size !== ids.length) {
                errors.push(
                    `Studio pages for ${pairKey} must have unique non-empty page ids`
                );
            }
        }
    }

    for (const meta of productionTemplates) {
        for (const planType of meta.supportedPlanTypes) {
            const pages = studioPages?.[meta.id]?.[planType];
            if (!Array.isArray(pages) || pages.length === 0) {
                errors.push(
                    `Missing Studio pages for production combination ${meta.id}:${planType}. Add an entry under STUDIO_PAGES in studio.registry.js.`
                );
            }
        }
    }

    if (errors.length) {
        throw new Error(
            `Invalid Studio registry:\n- ${errors.join('\n- ')}`
        );
    }

    return true;
};

// Fail fast at import if declarations drift from production metadata.
validateStudioRegistry(STUDIO_PAGES);

/**
 * @param {unknown} planType
 * @returns {string|null} normalized plan type or null if invalid
 */
export const normalizeStudioPlanType = (planType) => {
    if (planType == null || planType === '') return null;
    if (typeof planType !== 'string') return null;
    return PLAN_EXPORT_TYPES.includes(planType) ? planType : null;
};

/**
 * @returns {string[]}
 */
export const listStudioPlanTypes = () => [...PLAN_EXPORT_TYPES];

/**
 * Whether a templateId + planType pair is registered for Studio.
 *
 * @param {string} templateId
 * @param {string} planType
 * @returns {boolean}
 */
export const isStudioCombinationSupported = (templateId, planType) => {
    const meta = getProductionMeta(templateId);
    if (!meta) return false;
    if (!meta.supportedPlanTypes.includes(planType)) return false;
    const pages = STUDIO_PAGES[templateId]?.[planType];
    return Array.isArray(pages) && pages.length > 0;
};

/**
 * @param {string} templateId
 * @param {string} planType
 * @returns {{ ok: true, pages: object[], defaultPageId: string } | { ok: false, status: number, message: string }}
 */
export const resolveStudioPages = (templateId, planType) => {
    const meta = getProductionMeta(templateId);
    if (!meta) {
        return { ok: false, status: 404, message: 'Unknown template id' };
    }

    if (!PLAN_EXPORT_TYPES.includes(planType)) {
        return { ok: false, status: 400, message: 'Invalid plan type' };
    }

    if (!meta.supportedPlanTypes.includes(planType)) {
        return {
            ok: false,
            status: 400,
            message: 'Template does not support this plan type',
        };
    }

    const pages = STUDIO_PAGES[templateId]?.[planType];
    if (!Array.isArray(pages) || pages.length === 0) {
        return {
            ok: false,
            status: 400,
            message: 'Template/plan type is not registered in Studio',
        };
    }

    const cloned = pages.map(clonePage);
    const defaultPage = cloned.find((page) => page.isDefault);
    if (!defaultPage) {
        return {
            ok: false,
            status: 500,
            message: 'Studio registry is missing a default page',
        };
    }

    return {
        ok: true,
        templateId: meta.id,
        name: meta.name,
        description: meta.description,
        planType,
        pages: cloned,
        defaultPageId: defaultPage.id,
    };
};

/**
 * Validate a page id for a registered combination.
 *
 * @param {string} templateId
 * @param {string} planType
 * @param {string} pageId
 * @returns {{ ok: true, page: object } | { ok: false, status: number, message: string }}
 */
export const resolveStudioPage = (templateId, planType, pageId) => {
    const resolved = resolveStudioPages(templateId, planType);
    if (!resolved.ok) return resolved;

    const page = resolved.pages.find((entry) => entry.id === pageId);
    if (!page) {
        return { ok: false, status: 400, message: 'Unknown page id' };
    }

    return { ok: true, page, ...resolved };
};

/**
 * List Studio template entries (one per templateId + planType).
 *
 * @param {string|null|undefined} planTypeFilter
 * @returns {{ ok: true, planTypes: string[], templates: object[] } | { ok: false, status: number, message: string }}
 */
export const listStudioTemplates = (planTypeFilter) => {
    let planType = null;

    if (planTypeFilter != null && planTypeFilter !== '') {
        planType = normalizeStudioPlanType(planTypeFilter);
        if (!planType) {
            return { ok: false, status: 400, message: 'Invalid plan type' };
        }
    }

    const templates = [];
    const seen = new Set();

    for (const meta of PLAN_EXPORT_TEMPLATES) {
        const planTypes = planType
            ? meta.supportedPlanTypes.filter((type) => type === planType)
            : [...meta.supportedPlanTypes];

        for (const type of planTypes) {
            const pairKey = `${meta.id}:${type}`;
            if (seen.has(pairKey)) {
                return {
                    ok: false,
                    status: 500,
                    message: `Duplicate Studio template entry for ${pairKey}`,
                };
            }
            seen.add(pairKey);

            const pages = resolveStudioPages(meta.id, type);
            if (!pages.ok) {
                return {
                    ok: false,
                    status: 500,
                    message: `Studio registry drift for ${pairKey}: ${pages.message}`,
                };
            }

            templates.push({
                templateId: meta.id,
                name: meta.name,
                description: meta.description,
                planType: type,
                supportedPlanTypes: [...meta.supportedPlanTypes],
                pages: pages.pages,
                defaultPageId: pages.defaultPageId,
            });
        }
    }

    return {
        ok: true,
        planTypes: listStudioPlanTypes(),
        templates,
    };
};

export const STUDIO_REGISTRY_PHASE = 'C';

export default {
    STUDIO_REGISTRY_PHASE,
    listStudioPlanTypes,
    listStudioTemplates,
    resolveStudioPages,
    resolveStudioPage,
    isStudioCombinationSupported,
    normalizeStudioPlanType,
    validateStudioRegistry,
    listStudioWatchRoots,
    resolveStudioModuleSpec,
    STUDIO_TEMPLATE_SOURCES,
};
