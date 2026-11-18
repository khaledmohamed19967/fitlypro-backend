/**
 * Studio-only template module cache with cache-busted dynamic imports.
 *
 * - Resolves modules only from STUDIO_TEMPLATE_SOURCES (never client paths).
 * - Keeps last-known-good builder if a reload import fails.
 * - In-flight builds hold a function reference; cache swaps do not mutate it.
 * - Reloads for a given templateId are single-flighted.
 */

import {
    resolveStudioModuleSpec,
    STUDIO_TEMPLATE_SOURCES,
} from './studio.registry.js';

/** @type {Map<string, { version: number, builder: Function|null, reloadError: string|null }>} */
const cache = new Map();

/** @type {Map<string, Promise<object>>} */
const reloadFlights = new Map();

const cacheKey = (templateId, planType, pageId) =>
    `${templateId}:${planType}:${pageId || 'default'}`;

const defaultImport = (href) => import(href);

/**
 * @param {string} templateId
 * @param {string} planType
 * @param {string} [pageId]
 * @param {{ bust?: boolean, importFn?: (href: string) => Promise<object> }} [options]
 */
export const loadStudioHtmlBuilder = async (
    templateId,
    planType,
    pageId,
    options = {}
) => {
    // Back-compat: older call shape loadStudioHtmlBuilder(id, plan, { bust })
    if (pageId && typeof pageId === 'object' && !Array.isArray(pageId)) {
        options = pageId;
        pageId = options.pageId || 'full';
    }

    const resolvedPageId = pageId || 'full';
    const { bust = false, importFn = defaultImport } = options;
    const key = cacheKey(templateId, planType, resolvedPageId);
    const existing = cache.get(key);

    if (!bust && existing?.builder) {
        return {
            builder: existing.builder,
            version: existing.version,
            reloadError: existing.reloadError,
        };
    }

    const spec = resolveStudioModuleSpec(
        templateId,
        planType,
        resolvedPageId
    );
    if (!spec) {
        const err = new Error('Template renderer is unavailable');
        err.statusCode = 400;
        throw err;
    }

    const href = bust ? `${spec.href}?studioReload=${Date.now()}` : spec.href;

    try {
        const mod = await importFn(href);
        const builder = mod?.[spec.exportName];
        if (typeof builder !== 'function') {
            throw new Error(
                `Module export "${spec.exportName}" is not a function`
            );
        }

        const prevVersion = existing?.version ?? 0;
        const next = {
            version: bust ? prevVersion + 1 : existing?.builder ? prevVersion : 1,
            builder,
            reloadError: null,
        };

        cache.set(key, next);
        return {
            builder: next.builder,
            version: next.version,
            reloadError: null,
        };
    } catch (err) {
        if (existing?.builder) {
            const kept = {
                ...existing,
                reloadError: err?.message || String(err),
            };
            cache.set(key, kept);
            return {
                builder: kept.builder,
                version: kept.version,
                reloadError: kept.reloadError,
            };
        }
        const wrapped = new Error(err?.message || 'Template module load failed');
        wrapped.statusCode = 500;
        throw wrapped;
    }
};

/**
 * Reload all builder modules for a templateId (serialized per template).
 *
 * @param {string} templateId
 * @param {{ importFn?: (href: string) => Promise<object> }} [options]
 */
export const reloadStudioTemplateModules = async (templateId, options = {}) => {
    const source = STUDIO_TEMPLATE_SOURCES[templateId];
    if (!source) {
        return { ok: false, message: 'Unknown template id' };
    }

    const existingFlight = reloadFlights.get(templateId);
    if (existingFlight) {
        return existingFlight;
    }

    const flight = (async () => {
        const results = [];
        let anyError = null;

        for (const mod of source.modules) {
            const loaded = await loadStudioHtmlBuilder(
                templateId,
                mod.planType,
                mod.pageId || 'full',
                { bust: true, importFn: options.importFn }
            );
            results.push({
                planType: mod.planType,
                pageId: mod.pageId || 'full',
                version: loaded.version,
                reloadError: loaded.reloadError,
            });
            if (loaded.reloadError) anyError = loaded.reloadError;
        }

        return {
            ok: !anyError,
            templateId,
            results,
            message: anyError || null,
        };
    })().finally(() => {
        reloadFlights.delete(templateId);
    });

    reloadFlights.set(templateId, flight);
    return flight;
};

/**
 * Test helper: clear Studio module cache.
 */
export const resetStudioModuleCache = () => {
    cache.clear();
    reloadFlights.clear();
};

/**
 * @param {string} templateId
 * @param {string} planType
 * @param {string} [pageId]
 */
export const getStudioModuleCacheEntry = (templateId, planType, pageId = 'full') =>
    cache.get(cacheKey(templateId, planType, pageId)) ?? null;

export default {
    loadStudioHtmlBuilder,
    reloadStudioTemplateModules,
    resetStudioModuleCache,
    getStudioModuleCacheEntry,
};
