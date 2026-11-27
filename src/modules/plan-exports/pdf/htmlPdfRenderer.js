/**
 * Chromium HTML → PDF renderer (Playwright).
 * Reuses a single browser instance; creates an isolated page per render.
 *
 * Local: full `playwright` + locally installed Chromium.
 * Vercel/serverless: `playwright-core` + `@sparticuz/chromium`.
 */

import { ApiError } from '../../../utils/ApiError.js';
import { EXERCISE_IMAGE_FALLBACK } from './exerciseImageFallback.js';

/** @type {import('playwright-core').Browser | null} */
let sharedBrowser = null;
/** @type {Promise<import('playwright-core').Browser> | null} */
let launching = null;

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

    await page.evaluate(
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
 * Render a full HTML document to a PDF Buffer.
 *
 * @param {string} html
 * @param {import('playwright-core').Page.pdfOptions & {
 *   preparePage?: (page: import('playwright-core').Page) => Promise<void> | void
 * }} [pdfOptions]
 * @returns {Promise<Buffer>}
 */
export const renderHtmlToPdf = async (html, pdfOptions = {}) => {
    if (!html || typeof html !== 'string') {
        throw new ApiError(500, 'PDF generation failed');
    }

    let page = null;

    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        // domcontentloaded: do not block on remote image networkidle.
        await page.setContent(html, {
            waitUntil: 'domcontentloaded',
            timeout: SET_CONTENT_TIMEOUT_MS,
        });

        await settleRemoteImages(page);
        await waitForFontsReady(page);

        const { preparePage, ...chromePdfOptions } = pdfOptions;
        if (typeof preparePage === 'function') {
            await preparePage(page);
        }

        const pdf = await page.pdf({
            ...DEFAULT_PDF_OPTIONS,
            ...chromePdfOptions,
        });

        return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
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
        if (page) {
            await page.close().catch(() => {});
        }
    }
};

/**
 * Close the shared browser (tests / graceful shutdown).
 */
export const closeHtmlPdfBrowser = async () => {
    if (sharedBrowser) {
        const browser = sharedBrowser;
        sharedBrowser = null;
        await browser.close().catch(() => {});
    }
};

export default {
    renderHtmlToPdf,
    settleRemoteImages,
    closeHtmlPdfBrowser,
    isServerlessPdfRuntime,
    resolvePdfBrowserLaunchPlan,
};
