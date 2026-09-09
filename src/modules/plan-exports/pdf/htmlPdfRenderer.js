/**
 * Chromium HTML → PDF renderer (Playwright).
 * Reuses a single browser instance; creates an isolated page per render.
 */

import { chromium } from 'playwright';
import { ApiError } from '../../../utils/ApiError.js';

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
        await page.setContent(html, {
            waitUntil: 'networkidle',
            timeout: 30_000,
        });

        const pdf = await page.pdf({
            ...DEFAULT_PDF_OPTIONS,
            ...pdfOptions,
        });

        return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    } catch (error) {
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
    closeHtmlPdfBrowser,
};
