/**
 * Chromium HTML → PDF renderer (Playwright).
 * Reuses a single browser instance; creates an isolated page per render.
 *
 * Local: full `playwright` + locally installed Chromium.
 * Vercel/serverless: `playwright-core` + `@sparticuz/chromium`.
 *
 * Supports local template asset routing (avoids duplicated data-URI HTML bloat)
 * and remote image cache/coalescing with stage budgets + export deadline.
 */

import { existsSync, readFileSync } from 'fs';
import { extname, join, normalize, sep } from 'path';
import { ApiError } from '../../../utils/ApiError.js';
import { EXERCISE_IMAGE_FALLBACK } from './exerciseImageFallback.js';
import { htmlHasRemoteImages } from './pdfExportTrace.js';

/** @type {import('playwright-core').Browser | null} */
let sharedBrowser = null;
/** @type {Promise<import('playwright-core').Browser> | null} */
let launching = null;
/** Active render pages holding the shared browser open. */
let activeRenders = 0;

/** Origin used with Playwright routing for relative Elevate template assets. */
export const ELEVATE_PDF_ASSET_ORIGIN = 'http://elevate-pdf.local';

const LOCAL_ASSET_MIME_BY_EXT = Object.freeze({
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
const REMOTE_IMAGE_TIMEOUT_MS = 3_000;

/** Hard wall-clock budget for the entire image settle stage. */
const REMOTE_IMAGE_STAGE_BUDGET_MS = 8_000;

/** Best-effort wait for webfonts (bundled or CDN fonts). */
const FONT_READY_TIMEOUT_MS = 2_000;

/** Default total render deadline (leave headroom under Vercel maxDuration 60s). */
const DEFAULT_RENDER_DEADLINE_MS = 50_000;

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
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export const resolvePdfRenderDeadlineMs = (env = process.env) => {
    const raw = Number(env.PDF_EXPORT_DEADLINE_MS);
    if (Number.isFinite(raw) && raw >= 5_000 && raw <= 300_000) {
        return Math.floor(raw);
    }
    return DEFAULT_RENDER_DEADLINE_MS;
};

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
        if (typeof serverlessChromium.setGraphicsMode === 'function') {
            serverlessChromium.setGraphicsMode(false);
        }

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
 * @returns {Promise<{ browser: import('playwright-core').Browser, reused: boolean }>}
 */
const getBrowser = async () => {
    if (sharedBrowser && sharedBrowser.isConnected()) {
        return { browser: sharedBrowser, reused: true };
    }

    if (launching) {
        const browser = await launching;
        return { browser, reused: true };
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

    const browser = await launching;
    return { browser, reused: false };
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
    const contentType =
        LOCAL_ASSET_MIME_BY_EXT[ext] || 'application/octet-stream';
    return { body: readFileSync(absolute), contentType };
};

/**
 * `page.setContent` does not reliably honor context baseURL for every relative
 * URL — rewrite Elevate asset refs to the routed origin.
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
            if (
                !/^(images|fonts|styles\.css)/i.test(url) &&
                !/\.(css|png|jpe?g|webp|gif|svg|woff2?|ttf|otf)$/i.test(url)
            ) {
                return match;
            }
            return `${attr}="${ELEVATE_PDF_ASSET_ORIGIN}/${url}"`;
        }
    );

/**
 * Serve local template assets + cache identical remote image responses
 * within a single page render (in-flight coalescing).
 *
 * @param {import('playwright-core').Page} page
 * @param {{ localAssetRoot?: string }} [options]
 * @returns {Promise<() => Promise<void>>}
 */
const installResourceRouting = async (page, options = {}) => {
    const localAssetRoot = options.localAssetRoot;
    /** @type {Map<string, { status: number, headers: Record<string, string>, body: Buffer }>} */
    const cache = new Map();
    /** @type {Map<string, Promise<{ status: number, headers: Record<string, string>, body: Buffer }>>} */
    const inflight = new Map();

    await page.route('**/*', async (route) => {
        const request = route.request();
        const resourceType = request.resourceType();
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

        if (resourceType !== 'image' || !/^https?:\/\//i.test(url)) {
            await route.continue();
            return;
        }

        const cached = cache.get(url);
        if (cached) {
            await route.fulfill(cached);
            return;
        }

        try {
            let pending = inflight.get(url);
            if (!pending) {
                pending = (async () => {
                    const response = await route.fetch({
                        timeout: REMOTE_IMAGE_TIMEOUT_MS,
                    });
                    const body = await response.body();
                    return {
                        status: response.status(),
                        headers: response.headers(),
                        body,
                    };
                })().finally(() => {
                    inflight.delete(url);
                });
                inflight.set(url, pending);
            }

            const entry = await pending;
            if (entry.status >= 200 && entry.status < 400) {
                cache.set(url, entry);
            }
            await route.fulfill(entry);
        } catch {
            // Let settleRemoteImages swap the <img> to the local SVG fallback.
            await route.abort('failed').catch(() => {});
        }
    });

    return async () => {
        await page.unroute('**/*').catch(() => {});
        cache.clear();
        inflight.clear();
    };
};

/**
 * Wait for remote images in parallel with a per-image timeout + stage budget.
 * Failed / timed-out images swap to the Elevate exercise SVG placeholder.
 * Data-URI and relative images are left untouched.
 *
 * @param {import('playwright-core').Page} page
 * @param {{ timeoutMs?: number, stageBudgetMs?: number, fallbackSrc?: string }} [options]
 * @returns {Promise<{ settled: number, failed: number, timedOutStage: boolean }>}
 */
export const settleRemoteImages = async (page, options = {}) => {
    const timeoutMs = options.timeoutMs ?? REMOTE_IMAGE_TIMEOUT_MS;
    const stageBudgetMs = options.stageBudgetMs ?? REMOTE_IMAGE_STAGE_BUDGET_MS;
    const fallbackSrc = options.fallbackSrc ?? EXERCISE_IMAGE_FALLBACK;

    const settlePromise = page.evaluate(
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

    const budgetPromise = new Promise((resolve) => {
        setTimeout(
            () => resolve({ settled: -1, failed: -1, timedOutStage: true }),
            stageBudgetMs
        );
    });

    const result = await Promise.race([settlePromise, budgetPromise]);

    if (result.timedOutStage) {
        // Force remaining remote images to fallback so pdf() is not blocked on decode.
        await page
            .evaluate((fallback) => {
                for (const img of document.images) {
                    const src = img.currentSrc || img.getAttribute('src') || '';
                    if (!/^https?:\/\//i.test(src)) continue;
                    if (!img.complete || img.naturalWidth === 0) {
                        img.removeAttribute('srcset');
                        img.src = fallback;
                    }
                }
            }, fallbackSrc)
            .catch(() => {});
        return { settled: 0, failed: 0, timedOutStage: true };
    }

    return { ...result, timedOutStage: false };
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
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} phase
 * @returns {Promise<T>}
 */
const withDeadline = async (promise, ms, phase) => {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const error = new ApiError(
                        504,
                        'PDF generation timed out'
                    );
                    error.pdfPhase = phase;
                    reject(error);
                }, ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

/**
 * Render a full HTML document to a PDF Buffer.
 *
 * @param {string} html
 * @param {import('playwright-core').Page.pdfOptions & {
 *   preparePage?: (page: import('playwright-core').Page) => Promise<void> | void,
 *   trace?: {
 *     time?: (stage: string, fn: () => Promise<any>, detail?: object) => Promise<any>,
 *     log?: (event: string, payload?: object) => void,
 *   },
 *   deadlineMs?: number,
 *   localAssetRoot?: string,
 * }} [pdfOptions]
 * @returns {Promise<Buffer>}
 */
export const renderHtmlToPdf = async (html, pdfOptions = {}) => {
    if (!html || typeof html !== 'string') {
        throw new ApiError(500, 'PDF generation failed');
    }

    const {
        preparePage,
        trace = null,
        deadlineMs = resolvePdfRenderDeadlineMs(),
        localAssetRoot,
        ...chromePdfOptions
    } = pdfOptions;

    const time =
        trace && typeof trace.time === 'function'
            ? trace.time
            : async (_stage, fn) => fn();

    let page = null;
    /** @type {import('playwright-core').BrowserContext | null} */
    let context = null;
    let uninstallRoute = null;
    const renderStarted = Date.now();
    activeRenders += 1;

    try {
        return await withDeadline(
            (async () => {
                const { browser, reused } = await time(
                    'browser_launch_or_reuse',
                    () => getBrowser(),
                    {}
                );

                if (trace?.log) {
                    trace.log('browser', {
                        reused,
                        activeRenders,
                        mode: isServerlessPdfRuntime() ? 'serverless' : 'local',
                        localAssetRouting: Boolean(localAssetRoot),
                    });
                }

                if (localAssetRoot) {
                    context = await time('page_create', () =>
                        browser.newContext({
                            baseURL: `${ELEVATE_PDF_ASSET_ORIGIN}/`,
                        })
                    );
                    page = await context.newPage();
                } else {
                    page = await time('page_create', () => browser.newPage());
                }

                const htmlForPage = localAssetRoot
                    ? absolutizeElevateAssetUrls(html)
                    : html;

                // Remote image pipeline is optional. Local asset routing is
                // required when production HTML keeps relative Elevate paths.
                const needsRemoteImagePipeline =
                    htmlHasRemoteImages(htmlForPage);
                if (localAssetRoot || needsRemoteImagePipeline) {
                    uninstallRoute = await installResourceRouting(page, {
                        localAssetRoot,
                    });
                } else if (trace?.log) {
                    trace.log('image_pipeline_skipped', {
                        reason: 'no_remote_images',
                    });
                }

                await time('set_content', () =>
                    page.setContent(htmlForPage, {
                        // load: ensure routed CSS/fonts/images apply before measure.
                        waitUntil: localAssetRoot
                            ? 'load'
                            : 'domcontentloaded',
                        timeout: SET_CONTENT_TIMEOUT_MS,
                    })
                );

                const remainingAfterContent = Math.max(
                    1_000,
                    deadlineMs - (Date.now() - renderStarted)
                );
                const imageBudget = Math.min(
                    REMOTE_IMAGE_STAGE_BUDGET_MS,
                    Math.floor(remainingAfterContent * 0.35)
                );

                const imageStats = needsRemoteImagePipeline
                    ? await time(
                          'image_settle',
                          () =>
                              settleRemoteImages(page, {
                                  stageBudgetMs: imageBudget,
                              }),
                          { stageBudgetMs: imageBudget }
                      )
                    : await time(
                          'image_settle',
                          async () => ({
                              settled: 0,
                              failed: 0,
                              timedOutStage: false,
                              skipped: true,
                          }),
                          { skipped: true, reason: 'no_remote_images' }
                      );

                await time('font_ready', () => waitForFontsReady(page));

                if (typeof preparePage === 'function') {
                    await time('prepare_page', () => preparePage(page));
                }

                const remainingForPdf = Math.max(
                    2_000,
                    deadlineMs - (Date.now() - renderStarted)
                );

                const pdf = await time('page_pdf', () =>
                    withDeadline(
                        page.pdf({
                            ...DEFAULT_PDF_OPTIONS,
                            ...chromePdfOptions,
                        }),
                        remainingForPdf,
                        'page_pdf'
                    )
                );

                const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);

                if (trace?.log) {
                    trace.log('pdf_buffer', {
                        pdfBytes: buffer.length,
                        imageSettleTimedOut: Boolean(imageStats?.timedOutStage),
                        imagesSettled: imageStats?.settled ?? null,
                        imagesFailed: imageStats?.failed ?? null,
                    });
                }

                return buffer;
            })(),
            deadlineMs,
            'render_deadline'
        );
    } catch (error) {
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
        if (typeof uninstallRoute === 'function') {
            await uninstallRoute().catch(() => {});
        }
        if (page) {
            await page.close().catch(() => {});
        }
        if (context) {
            await context.close().catch(() => {});
        }
        activeRenders = Math.max(0, activeRenders - 1);

        // Recreate on next request if the shared browser died mid-render.
        if (sharedBrowser && !sharedBrowser.isConnected()) {
            sharedBrowser = null;
        }
    }
};

/**
 * Close the shared browser (tests / graceful shutdown).
 * Refuses to close while other renders are active.
 */
export const closeHtmlPdfBrowser = async () => {
    if (activeRenders > 0) {
        return false;
    }
    if (sharedBrowser) {
        const browser = sharedBrowser;
        sharedBrowser = null;
        await browser.close().catch(() => {});
    }
    return true;
};

export const getActivePdfRenderCount = () => activeRenders;

/** Alias used by older Nutrition PDF regression tests. */
export const getHtmlPdfActivePageCount = getActivePdfRenderCount;

export default {
    renderHtmlToPdf,
    settleRemoteImages,
    closeHtmlPdfBrowser,
    isServerlessPdfRuntime,
    resolvePdfBrowserLaunchPlan,
    resolvePdfRenderDeadlineMs,
    getActivePdfRenderCount,
    getHtmlPdfActivePageCount,
    absolutizeElevateAssetUrls,
    ELEVATE_PDF_ASSET_ORIGIN,
};
