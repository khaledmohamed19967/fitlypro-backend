/**
 * Chromium HTML → PDF renderer (Playwright).
 * Reuses a single browser instance; creates an isolated page per render.
 */

import { chromium } from 'playwright';
import { ApiError } from '../../../utils/ApiError.js';
import { EXERCISE_IMAGE_FALLBACK } from './exerciseImageFallback.js';

/** @type {import('playwright').Browser | null} */
let sharedBrowser = null;
/** @type {Promise<import('playwright').Browser> | null} */
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

/** Best-effort wait for webfonts (Classic loads Inter from CDN). */
const FONT_READY_TIMEOUT_MS = 2_000;

/**
 * @returns {Promise<import('playwright').Browser>}
 */
const getBrowser = async () => {
    if (sharedBrowser && sharedBrowser.isConnected()) {
        return sharedBrowser;
    }

    if (launching) {
        return launching;
    }

    launching = chromium
        .launch({
            headless: true,
            args: ['--font-render-hinting=medium'],
        })
        .then((browser) => {
            sharedBrowser = browser;
            browser.on('disconnected', () => {
                if (sharedBrowser === browser) {
                    sharedBrowser = null;
                }
            });
            return browser;
        })
        .finally(() => {
            launching = null;
        });

    return launching;
};

/**
 * Wait for remote images in parallel with a per-image timeout.
 * Failed / timed-out images swap to the Elevate exercise SVG placeholder.
 * Data-URI and relative images are left untouched.
 *
 * @param {import('playwright').Page} page
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
 * @param {import('playwright').Page} page
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
 * @param {import('playwright').Page.pdfOptions} [pdfOptions]
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

        const pdf = await page.pdf({
            ...DEFAULT_PDF_OPTIONS,
            ...pdfOptions,
        });

        return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    } catch (error) {
        // Provide a clearer error when Playwright browser binaries are missing
        if (
            error instanceof Error &&
            error.message.includes("Executable doesn't exist")
        ) {
            throw new ApiError(
                500,
                'PDF generation failed: Playwright Chromium binary missing. Ensure "npx playwright install" has been run.'
            );
        }
        if (error instanceof ApiError) {
            throw error;
        }
        const message =
            error instanceof Error ? error.message : 'Unknown PDF renderer error';
        throw new ApiError(500, `PDF generation failed: ${message}`);
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
};
