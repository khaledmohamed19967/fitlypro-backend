/**
 * Chromium HTML → PDF renderer (Playwright).
 * Reuses a single browser instance; creates an isolated page per render.
 *
 * Local: full `playwright` + locally installed Chromium.
 * Vercel/serverless: `playwright-core` + `@sparticuz/chromium`.
 *
 * Supports:
 * - Export deadline (`PDF_EXPORT_DEADLINE_MS`, default 50s under Vercel 60s)
 * - Local asset routing (avoids duplicated base64 image bloat in HTML)
 * - Remote image cache + in-flight coalescing with per-URL timeout
 * - Stage tracing via pdfExportTrace
 */

import { existsSync, readFileSync } from 'fs';
import { extname, join, normalize, sep } from 'path';
import { ApiError } from '../../../utils/ApiError.js';
import { EXERCISE_IMAGE_FALLBACK } from './exerciseImageFallback.js';
import {
    createPdfExportTrace,
    resolvePdfExportDeadlineMs,
} from './pdfExportTrace.js';

/** @type {import('playwright-core').Browser | null} */
let sharedBrowser = null;
/** @type {Promise<import('playwright-core').Browser> | null} */
let launching = null;

/** Active pages holding the shared browser open (cleanup must not close browser while > 0). */
let activePages = 0;

const DEFAULT_PDF_OPTIONS = Object.freeze({
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: {
        top: '14mm',
        right: '12mm',
        bottom: '16mm',
        left: '12mm',
    },
});

/** Bound for setContent — does not wait on remote network idleness. */
const SET_CONTENT_TIMEOUT_MS = 30_000;

/**
 * Per remote http(s) image: wait for load/error, then fall back.
 * Runs in parallel across images (no sequential waterfall).
 */
const REMOTE_IMAGE_TIMEOUT_MS = 4_000;

/** Best-effort wait for webfonts (bundled or CDN fonts). */
const FONT_READY_TIMEOUT_MS = 2_000;

/** Origin used with Playwright baseURL for relative template assets. */
export const ELEVATE_PDF_ASSET_ORIGIN = 'http://elevate-pdf.local';

const MIME_BY_EXT = Object.freeze({
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.html': 'text/html; charset=utf-8',
});

/** @type {Map<string, { body: Buffer, contentType: string }>} */
const remoteImageCache = new Map();
/** @type {Map<string, Promise<{ body: Buffer, contentType: string }>>} */
const remoteImageInflight = new Map();

const FALLBACK_IMAGE_BODY = (() => {
    const raw = EXERCISE_IMAGE_FALLBACK;
    if (raw.startsWith('data:')) {
        const comma = raw.indexOf(',');
        const meta = raw.slice(5, comma);
        const data = raw.slice(comma + 1);
        const isBase64 = /;base64/i.test(meta);
        const contentType = meta.split(';')[0] || 'image/svg+xml';
        return {
            body: isBase64
                ? Buffer.from(data, 'base64')
                : Buffer.from(decodeURIComponent(data), 'utf8'),
            contentType,
        };
    }
    return {
        body: Buffer.from(raw, 'utf8'),
        contentType: 'image/svg+xml',
    };
})();

/**
 * Vercel sets `VERCEL=1`. Lambda sets `AWS_LAMBDA_FUNCTION_NAME`.
 * `PDF_USE_SERVERLESS_CHROMIUM=1` forces the serverless launch path (tests).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export const isServerlessPdfRuntime = (env = process.env) =>
    env.VERCEL === '1' ||
    Boolean(env.AWS_LAMBDA_FUNCTION_NAME) ||
    env.PDF_USE_SERVERLESS_CHROMIUM === '1';

/**
 * Resolve which Playwright package + launch options to use.
 * Does not launch a browser.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{
 *   mode: 'serverless' | 'local',
 *   launchOptions: import('playwright-core').LaunchOptions,
 * }>}
 */
export const resolvePdfBrowserLaunchPlan = async (env = process.env) => {
    if (isServerlessPdfRuntime(env)) {
        const serverlessChromium = (await import('@sparticuz/chromium')).default;
        // PDF export does not need WebGL; reduces extract/work on cold start.
        serverlessChromium.setGraphicsMode = false;

        return {
            mode: 'serverless',
            launchOptions: {
                args: [...serverlessChromium.args, '--font-render-hinting=medium'],
                executablePath: await serverlessChromium.executablePath(),
                headless: true,
            },
        };
    }

    return {
        mode: 'local',
        launchOptions: {
            headless: true,
            args: ['--font-render-hinting=medium'],
        },
    };
};

/**
 * @returns {Promise<typeof import('playwright-core').chromium>}
 */
const loadPlaywrightChromium = async () => {
    if (isServerlessPdfRuntime()) {
        const mod = await import('playwright-core');
        return mod.chromium;
    }
    const mod = await import('playwright');
    return mod.chromium;
};

/**
 * @param {string} stage
 * @returns {ApiError}
 */
const deadlineError = (stage) => {
    const err = new ApiError(504, 'PDF export deadline exceeded');
    err.pdfPhase = 'deadline';
    err.deadlineStage = stage;
    return err;
};

/**
 * Race a promise against the remaining export deadline.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} deadlineAt
 * @param {string} stage
 * @returns {Promise<T>}
 */
const withDeadline = async (promise, deadlineAt, stage) => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
        throw deadlineError(stage);
    }

    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(deadlineError(stage)), remaining);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

/**
 * @returns {Promise<import('playwright-core').Browser>}
 */
const getBrowser = async () => {
    if (sharedBrowser && sharedBrowser.isConnected()) {
        return sharedBrowser;
    }

    if (launching) {
        return launching;
    }

    launching = (async () => {
        try {
            const chromiumApi = await loadPlaywrightChromium();
            const plan = await resolvePdfBrowserLaunchPlan();
            const browser = await chromiumApi.launch(plan.launchOptions);
            sharedBrowser = browser;
            browser.on('disconnected', () => {
                if (sharedBrowser === browser) {
                    sharedBrowser = null;
                }
            });
            return browser;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            const launchError = new ApiError(
                500,
                message.includes("Executable doesn't exist")
                    ? 'PDF generation failed: Playwright Chromium binary missing. Ensure "npx playwright install" has been run (local) or the serverless Chromium package is available (Vercel).'
                    : `PDF generation failed: browser launch error: ${message}`
            );
            launchError.pdfPhase = 'browser_launch';
            throw launchError;
        }
    })().finally(() => {
        launching = null;
    });

    return launching;
};

/**
 * @param {string} assetRoot
 * @param {string} pathname
 * @returns {{ body: Buffer, contentType: string } | null}
 */
const readLocalAsset = (assetRoot, pathname) => {
    const cleaned = decodeURIComponent(String(pathname || ''))
        .replace(/^\/+/, '')
        .replace(/\\/g, '/');
    if (
        !cleaned ||
        cleaned.includes('..') ||
        cleaned.startsWith('/') ||
        /^[a-zA-Z]:/.test(cleaned)
    ) {
        return null;
    }

    const absolute = normalize(join(assetRoot, cleaned));
    const root = normalize(assetRoot + sep);
    if (absolute !== normalize(assetRoot) && !absolute.startsWith(root)) {
        return null;
    }
    if (!existsSync(absolute)) return null;

    const ext = extname(absolute).toLowerCase();
    const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
    return { body: readFileSync(absolute), contentType };
};

/**
 * Fetch a remote image once; coalesce concurrent requests; cache results.
 *
 * @param {string} url
 * @param {number} timeoutMs
 */
const fetchRemoteImageCached = (url, timeoutMs) => {
    const cached = remoteImageCache.get(url);
    if (cached) return Promise.resolve(cached);

    const pending = remoteImageInflight.get(url);
    if (pending) return pending;

    const task = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                redirect: 'follow',
                headers: { Accept: 'image/*,*/*;q=0.8' },
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const contentType =
                response.headers.get('content-type') || 'image/jpeg';
            const body = Buffer.from(await response.arrayBuffer());
            if (!body.length) throw new Error('empty image');
            const entry = { body, contentType };
            remoteImageCache.set(url, entry);
            return entry;
        } catch {
            const entry = { ...FALLBACK_IMAGE_BODY };
            remoteImageCache.set(url, entry);
            return entry;
        } finally {
            clearTimeout(timer);
            remoteImageInflight.delete(url);
        }
    })();

    remoteImageInflight.set(url, task);
    return task;
};

/**
 * Serve template-relative assets and cache remote images for one page.
 *
 * @param {import('playwright-core').Page} page
 * @param {{
 *   localAssetRoot?: string,
 *   remoteImageTimeoutMs?: number,
 * }} options
 */
export const attachPdfResourceRouting = async (page, options = {}) => {
    const localAssetRoot = options.localAssetRoot;
    const remoteImageTimeoutMs =
        options.remoteImageTimeoutMs ?? REMOTE_IMAGE_TIMEOUT_MS;

    // Single catch-all: local template assets + remote image cache.
    // (Separate origin routes + fallback were racing and skipping CSS/fonts.)
    await page.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();

        if (localAssetRoot && url.startsWith(ELEVATE_PDF_ASSET_ORIGIN)) {
            const asset = readLocalAsset(
                localAssetRoot,
                new URL(url).pathname
            );
            if (!asset) {
                await route.abort().catch(() => {});
                return;
            }
            await route
                .fulfill({
                    status: 200,
                    body: asset.body,
                    contentType: asset.contentType,
                    headers: { 'Cache-Control': 'public, max-age=3600' },
                })
                .catch(() => {});
            return;
        }

        if (
            request.resourceType() === 'image' &&
            /^https?:\/\//i.test(url)
        ) {
            const asset = await fetchRemoteImageCached(
                url,
                remoteImageTimeoutMs
            );
            await route
                .fulfill({
                    status: 200,
                    body: asset.body,
                    contentType: asset.contentType,
                    headers: { 'Cache-Control': 'public, max-age=3600' },
                })
                .catch(() => {});
            return;
        }

        await route.continue().catch(() => {});
    });
};

/**
 * Wait for remote images in parallel with a per-image timeout.
 * Failed / timed-out images swap to the Elevate exercise SVG placeholder.
 * Data-URI and relative images are left untouched.
 *
 * @param {import('playwright-core').Page} page
 * @param {{ timeoutMs?: number, fallbackSrc?: string }} [options]
 */
export const settleRemoteImages = async (page, options = {}) => {
    const timeoutMs = options.timeoutMs ?? REMOTE_IMAGE_TIMEOUT_MS;
    const fallbackSrc = options.fallbackSrc ?? EXERCISE_IMAGE_FALLBACK;

    return page.evaluate(
        async ({ timeoutMs: limit, fallbackSrc: fallback }) => {
            const images = [...document.images].filter((img) => {
                const src = img.currentSrc || img.getAttribute('src') || '';
                return /^https?:\/\//i.test(src);
            });

            if (!images.length) return { settled: 0, failed: 0 };

            const results = await Promise.all(
                images.map(
                    (img) =>
                        new Promise((resolve) => {
                            let done = false;
                            const finish = (ok) => {
                                if (done) return;
                                done = true;
                                if (!ok) {
                                    img.removeAttribute('srcset');
                                    img.src = fallback;
                                }
                                resolve(ok ? 'ok' : 'fail');
                            };

                            if (img.complete) {
                                finish(img.naturalWidth > 0);
                                return;
                            }

                            const timer = setTimeout(() => finish(false), limit);
                            img.addEventListener(
                                'load',
                                () => {
                                    clearTimeout(timer);
                                    finish(true);
                                },
                                { once: true }
                            );
                            img.addEventListener(
                                'error',
                                () => {
                                    clearTimeout(timer);
                                    finish(false);
                                },
                                { once: true }
                            );
                        })
                )
            );

            return {
                settled: results.length,
                failed: results.filter((r) => r === 'fail').length,
            };
        },
        { timeoutMs, fallbackSrc }
    );
};

/**
 * Best-effort font readiness so CDN webfonts can apply without blocking forever.
 *
 * @param {import('playwright-core').Page} page
 * @param {number} [timeoutMs]
 */
const waitForFontsReady = async (page, timeoutMs = FONT_READY_TIMEOUT_MS) => {
    try {
        await Promise.race([
            page.evaluate(() => document.fonts.ready),
            page.evaluate(
                (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
                timeoutMs
            ),
        ]);
    } catch {
        // Fonts are optional for export success.
    }
};

/**
 * `page.setContent` does not honor Playwright context `baseURL` for every
 * relative URL in all versions — rewrite local asset refs to the routed origin.
 *
 * @param {string} html
 * @returns {string}
 */
export const absolutizeElevateAssetUrls = (html) =>
    String(html || '').replace(
        /\b(href|src)=["'](?!https?:|data:|mailto:|#)([^"']+)["']/gi,
        (match, attr, rawUrl) => {
            const url = String(rawUrl || '')
                .trim()
                .replace(/^\.\//, '')
                .replace(/^\/+/, '');
            if (!url) return match;
            if (!/^(images|fonts|styles\.css)/i.test(url) && !/\.(css|png|jpe?g|webp|gif|svg|woff2?|ttf|otf)$/i.test(url)) {
                return match;
            }
            return `${attr}="${ELEVATE_PDF_ASSET_ORIGIN}/${url}"`;
        }
    );

/**
 * @param {import('playwright-core').Page | null} page
 * @param {import('playwright-core').BrowserContext | null} [context]
 */
const closePageSafe = async (page, context = null) => {
    if (page) {
        try {
            await page.close();
        } catch {
            // ignore
        } finally {
            activePages = Math.max(0, activePages - 1);
        }
    }
    if (context) {
        await context.close().catch(() => {});
    }
};

/**
 * Render a full HTML document to a PDF Buffer.
 *
 * @param {string} html
 * @param {import('playwright-core').Page.pdfOptions & {
 *   preparePage?: (page: import('playwright-core').Page) => Promise<void> | void,
 *   localAssetRoot?: string,
 *   deadlineAt?: number,
 *   trace?: ReturnType<typeof createPdfExportTrace>,
 *   exportId?: string,
 *   planType?: string,
 * }} [pdfOptions]
 * @returns {Promise<Buffer>}
 */
export const renderHtmlToPdf = async (html, pdfOptions = {}) => {
    if (!html || typeof html !== 'string') {
        throw new ApiError(500, 'PDF generation failed');
    }

    const {
        preparePage,
        localAssetRoot,
        deadlineAt: deadlineAtOption,
        trace: traceOption,
        exportId,
        planType,
        ...chromePdfOptions
    } = pdfOptions;

    const trace =
        traceOption ||
        createPdfExportTrace({
            exportId: exportId || 'local-render',
            planType: planType || 'unknown',
            deadlineMs: resolvePdfExportDeadlineMs(),
        });

    const deadlineAt = deadlineAtOption || trace.deadlineAt;
    const ownsTraceFinish = !traceOption;

    let page = null;
    /** @type {import('playwright-core').BrowserContext | null} */
    let context = null;
    /** @type {string} */
    let currentStage = 'init';

    try {
        currentStage = 'browser_acquire';
        const browserWasCold = !(sharedBrowser && sharedBrowser.isConnected());
        const browser = await withDeadline(
            getBrowser(),
            deadlineAt,
            currentStage
        );
        trace.mark('browser_acquire', {
            coldLaunch: browserWasCold,
            htmlBytes: Buffer.byteLength(html),
            remoteImageCacheSize: remoteImageCache.size,
        });

        currentStage = 'new_page';
        if (localAssetRoot) {
            context = await withDeadline(
                browser.newContext({
                    baseURL: `${ELEVATE_PDF_ASSET_ORIGIN}/`,
                }),
                deadlineAt,
                currentStage
            );
            page = await withDeadline(context.newPage(), deadlineAt, currentStage);
        } else {
            page = await withDeadline(browser.newPage(), deadlineAt, currentStage);
        }
        activePages += 1;

        currentStage = 'resource_routing';
        await attachPdfResourceRouting(page, { localAssetRoot });

        currentStage = 'set_content';
        const setContentTimeout = Math.min(
            SET_CONTENT_TIMEOUT_MS,
            Math.max(1_000, deadlineAt - Date.now())
        );
        const htmlForPage = localAssetRoot
            ? absolutizeElevateAssetUrls(html)
            : html;
        await withDeadline(
            page.setContent(htmlForPage, {
                // load: wait for routed stylesheet/fonts/images to apply.
                waitUntil: localAssetRoot ? 'load' : 'domcontentloaded',
                timeout: setContentTimeout,
            }),
            deadlineAt,
            currentStage
        );
        trace.mark('set_content', {
            htmlBytes: Buffer.byteLength(htmlForPage),
            usedLocalAssetRouting: Boolean(localAssetRoot),
        });

        currentStage = 'settle_images_fonts';
        const imageStats = await withDeadline(
            settleRemoteImages(page),
            deadlineAt,
            currentStage
        );
        await withDeadline(
            waitForFontsReady(page),
            deadlineAt,
            currentStage
        );
        trace.mark('settle_images_fonts', {
            remoteImages: imageStats?.settled ?? 0,
            remoteFailed: imageStats?.failed ?? 0,
        });

        if (typeof preparePage === 'function') {
            currentStage = 'prepare_page';
            await withDeadline(Promise.resolve(preparePage(page)), deadlineAt, currentStage);
            const measured = await page
                .evaluate(() => document.querySelectorAll('.page').length)
                .catch(() => null);
            trace.mark('prepare_page', {
                pageCount: measured,
            });
        }

        currentStage = 'page_pdf';
        const pdf = await withDeadline(
            page.pdf({
                ...DEFAULT_PDF_OPTIONS,
                ...chromePdfOptions,
            }),
            deadlineAt,
            currentStage
        );
        const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
        trace.mark('page_pdf', { pdfBytes: buffer.length });

        if (ownsTraceFinish) {
            trace.finish({ ok: true, extra: { pdfBytes: buffer.length } });
        }

        return buffer;
    } catch (error) {
        const stage =
            (error &&
                typeof error === 'object' &&
                'deadlineStage' in error &&
                error.deadlineStage) ||
            currentStage;
        trace.setFailureStage(
            error && typeof error === 'object' && 'pdfPhase' in error
                ? String(error.pdfPhase)
                : String(stage)
        );

        if (ownsTraceFinish) {
            trace.finish({ ok: false, error });
        }

        if (error instanceof ApiError) {
            if (!error.pdfPhase) {
                error.pdfPhase = 'pdf_render';
            }
            throw error;
        }
        if (
            error instanceof Error &&
            error.message.includes("Executable doesn't exist")
        ) {
            const launchError = new ApiError(
                500,
                'PDF generation failed: Playwright Chromium binary missing. Ensure "npx playwright install" has been run (local) or the serverless Chromium package is available (Vercel).'
            );
            launchError.pdfPhase = 'browser_launch';
            throw launchError;
        }
        const message =
            error instanceof Error ? error.message : 'Unknown PDF renderer error';
        const renderError = new ApiError(
            500,
            `PDF generation failed: ${message}`
        );
        renderError.pdfPhase = 'pdf_render';
        throw renderError;
    } finally {
        await closePageSafe(page, context);
    }
};

/**
 * Close the shared browser (tests / graceful shutdown).
 * Refuses to close while pages from in-flight exports are still open.
 */
export const closeHtmlPdfBrowser = async () => {
    if (activePages > 0) {
        return false;
    }
    if (sharedBrowser) {
        const browser = sharedBrowser;
        sharedBrowser = null;
        await browser.close().catch(() => {});
    }
    return true;
};

/** Test helper — clear remote image memoization. */
export const clearPdfRemoteImageCache = () => {
    remoteImageCache.clear();
    remoteImageInflight.clear();
};

/** Test helper — active page count holding the shared browser. */
export const getHtmlPdfActivePageCount = () => activePages;

export default {
    renderHtmlToPdf,
    settleRemoteImages,
    closeHtmlPdfBrowser,
    isServerlessPdfRuntime,
    resolvePdfBrowserLaunchPlan,
    attachPdfResourceRouting,
    absolutizeElevateAssetUrls,
    clearPdfRemoteImageCache,
    getHtmlPdfActivePageCount,
    ELEVATE_PDF_ASSET_ORIGIN,
};
