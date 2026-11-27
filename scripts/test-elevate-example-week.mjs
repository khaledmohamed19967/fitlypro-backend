/**
 * Elevate PDF — Example Week must stay content-sized through the full
 * production render sequence (setContent → preparePage → page.pdf).
 *
 * This suite:
 *  1) measures DOM after preparePage (compact cards + visible day content)
 *  2) renders a real PDF and checks MediaBox sizes
 *  3) rasterizes overview + details pages for visual bounds / no merge
 *
 * Run: node scripts/test-elevate-example-week.mjs
 * Optional: PDF_USE_SERVERLESS_CHROMIUM=1 (falls back to local on Windows)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium as localChromium } from 'playwright';

import {
    buildElevateWorkoutHtml,
    deriveElevateViewModel,
} from '../src/modules/plan-exports/templates/elevate/page.js';
import { renderElevateWorkoutPdf } from '../src/modules/plan-exports/templates/elevate/index.js';
import {
    applyElevateWorkoutContentPageSizes,
    ELEVATE_A4_HEIGHT_PX,
} from '../src/modules/plan-exports/templates/elevate/contentPageSizes.js';
import {
    closeHtmlPdfBrowser,
    resolvePdfBrowserLaunchPlan,
} from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp/pdf-samples');
const FIXTURE = join(
    ROOT,
    'src/modules/plan-exports/studio/fixtures/workout-basic.json'
);

const MAX_COMPACT_DAY_HEIGHT_PX = 120;
const MAX_EXAMPLE_WEEK_HEIGHT_PX = 220;

const results = [];
const pass = (name, detail) => results.push({ name, ok: true, detail });
const fail = (name, detail) => results.push({ name, ok: false, detail });

const parseMediaBoxes = (pdfBuffer) => {
    const text = pdfBuffer.toString('latin1');
    const boxes = [];
    const re =
        /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g;
    let match;
    while ((match = re.exec(text))) {
        boxes.push({
            widthPt: Math.abs(Number(match[3]) - Number(match[1])),
            heightPt: Math.abs(Number(match[4]) - Number(match[2])),
        });
    }
    return boxes;
};

const launchChromium = async () => {
    const preferred = await resolvePdfBrowserLaunchPlan();
    const attempts = [preferred];
    if (preferred.mode === 'serverless') {
        attempts.push(await resolvePdfBrowserLaunchPlan({}));
    }

    let lastError = null;
    for (const plan of attempts) {
        const api =
            plan.mode === 'serverless'
                ? (await import('playwright-core')).chromium
                : (await import('playwright')).chromium;
        try {
            const browser = await api.launch(plan.launchOptions);
            return {
                browser,
                mode: plan.mode,
                fallbackFrom:
                    preferred.mode !== plan.mode ? preferred.mode : null,
            };
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        }
    }
    return { browser: null, mode: preferred.mode, launchError: lastError };
};

const measureExampleWeek = async (page) =>
    page.evaluate(() => {
        const week = document.querySelector('.example-week');
        const grid = document.querySelector('.example-week-grid');
        const days = [...document.querySelectorAll('.week-day')];
        const overview = document.querySelector('.page-workouts');
        const notes = document.querySelector('.program-notes');
        const details = document.querySelector('.page-workout-details');
        return {
            overviewHeight: overview
                ? Math.round(overview.getBoundingClientRect().height)
                : null,
            weekHeight: week
                ? Math.round(week.getBoundingClientRect().height)
                : null,
            gridHeight: grid
                ? Math.round(grid.getBoundingClientRect().height)
                : null,
            notesTop: notes
                ? Math.round(notes.getBoundingClientRect().top)
                : null,
            weekBottom: week
                ? Math.round(week.getBoundingClientRect().bottom)
                : null,
            dayCount: days.length,
            dayHeights: days.map((d) =>
                Math.round(d.getBoundingClientRect().height)
            ),
            dayLabels: days.map((d) =>
                (d.querySelector('strong')?.textContent || '').trim()
            ),
            dayStatuses: days.map((d) =>
                (d.querySelector('span')?.textContent || '').trim()
            ),
            dayIconCount: days.filter((d) => d.querySelector('.week-day-icon'))
                .length,
            nesting: {
                weekContainsDetails: Boolean(
                    week && details && week.contains(details)
                ),
                weekContainsNotes: Boolean(week?.querySelector('.program-notes')),
            },
            gridDisplay: grid ? getComputedStyle(grid).display : null,
            dayDisplay: days[0] ? getComputedStyle(days[0]).display : null,
        };
    });

const assertCompact = (label, metrics) => {
    if (!metrics || metrics.dayCount !== 7) {
        fail(label, `expected 7 day cards, got ${JSON.stringify(metrics)}`);
        return false;
    }
    if (metrics.nesting?.weekContainsDetails || metrics.nesting?.weekContainsNotes) {
        fail(label, `broken nesting ${JSON.stringify(metrics.nesting)}`);
        return false;
    }
    const expectedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    if (
        !Array.isArray(metrics.dayLabels) ||
        metrics.dayLabels.join(',') !== expectedDays.join(',')
    ) {
        fail(label, `missing day names ${JSON.stringify(metrics.dayLabels)}`);
        return false;
    }
    if (
        metrics.dayIconCount !== 7 ||
        !metrics.dayStatuses?.every(
            (s) => s === 'Rest' || /^Workout(?:\s+[A-Z0-9]+)?$/i.test(s)
        )
    ) {
        fail(
            label,
            `missing day content icons=${metrics.dayIconCount} statuses=${JSON.stringify(metrics.dayStatuses)}`
        );
        return false;
    }
    const maxDay = Math.max(...metrics.dayHeights);
    if (maxDay > MAX_COMPACT_DAY_HEIGHT_PX) {
        fail(
            label,
            `day cards too tall max=${maxDay}px heights=${JSON.stringify(metrics.dayHeights)}`
        );
        return false;
    }
    if (metrics.weekHeight > MAX_EXAMPLE_WEEK_HEIGHT_PX) {
        fail(label, `Example Week too tall week=${metrics.weekHeight}px`);
        return false;
    }
    if (
        metrics.notesTop != null &&
        metrics.weekBottom != null &&
        metrics.notesTop < metrics.weekBottom - 2
    ) {
        fail(
            label,
            `Program notes overlap Example Week notesTop=${metrics.notesTop} weekBottom=${metrics.weekBottom}`
        );
        return false;
    }
    pass(
        label,
        `week=${metrics.weekHeight}px grid=${metrics.gridHeight}px days=${metrics.dayHeights.join(',')} display=${metrics.gridDisplay}/${metrics.dayDisplay}`
    );
    return true;
};

const inspectPdfPage = async (pdfBuffer, pageNumber, outPath) => {
    const browser = await localChromium.launch({ headless: true });
    const page = await browser.newPage({
        viewport: { width: 1000, height: 1400 },
    });
    try {
        const b64 = pdfBuffer.toString('base64');
        const html = `<!DOCTYPE html><html><body style="margin:0;background:#111">
<canvas id="c"></canvas>
<script type="module">
import * as pdfjs from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
const data = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
const doc = await pdfjs.getDocument({ data }).promise;
window.__pages = doc.numPages;
window.__inspect = async (n) => {
  const p = await doc.getPage(n);
  const viewport = p.getViewport({ scale: 1.5 });
  const canvas = document.getElementById('c');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const textContent = await p.getTextContent();
  const text = textContent.items.map((item) => item.str).join(' ');
  return {
    w: canvas.width,
    h: canvas.height,
    pages: doc.numPages,
    text,
  };
};
window.__ready = true;
</script></body></html>`;
        await page.setContent(html, {
            waitUntil: 'networkidle',
            timeout: 120_000,
        });
        await page.waitForFunction(() => window.__ready === true, {
            timeout: 120_000,
        });
        const info = await page.evaluate(
            async (n) => window.__inspect(n),
            pageNumber
        );
        await page.locator('#c').screenshot({ path: outPath });
        return info;
    } finally {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
    }
};

async function run() {
    mkdirSync(OUT_DIR, { recursive: true });
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const html = buildElevateWorkoutHtml(fixture);
    const view = deriveElevateViewModel(fixture);

    const { browser, mode, launchError, fallbackFrom } = await launchChromium();
    if (!browser) {
        fail(`launch Chromium (${mode})`, launchError || 'launch failed');
        console.log('\nElevate Example Week checks:');
        for (const r of results) {
            console.log(
                `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`
            );
        }
        process.exit(1);
    }

    pass(
        `launch Chromium (${mode})`,
        fallbackFrom
            ? `fell back from ${fallbackFrom} — not production-runtime verified`
            : mode === 'serverless'
              ? 'production/serverless runtime'
              : 'local runtime (not serverless)'
    );
    if (fallbackFrom === 'serverless' && mode === 'local') {
        delete process.env.PDF_USE_SERVERLESS_CHROMIUM;
    }

    try {
        const page = await browser.newPage();
        await page.setContent(html, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        });
        await page.evaluate(async () => {
            if (document.fonts?.ready) await document.fonts.ready;
        });

        await applyElevateWorkoutContentPageSizes(page);
        const afterPrepare = await measureExampleWeek(page);
        assertCompact(
            'after preparePage: compact Example Week with visible day content',
            afterPrepare
        );

        await page.emulateMedia({ media: 'print' });
        const afterPrint = await measureExampleWeek(page);
        assertCompact(
            'print media after preparePage: compact Example Week with visible day content',
            afterPrint
        );
        await page.close();

        const pdf = await renderElevateWorkoutPdf(fixture);
        writeFileSync(join(OUT_DIR, `example-week-${mode}.pdf`), pdf);
        writeFileSync(join(OUT_DIR, `example-week-${mode}.html`), html, 'utf8');

        const boxes = parseMediaBoxes(pdf);
        const a4Pt = (ELEVATE_A4_HEIGHT_PX * 72) / 96;
        if (
            pdf.length > 1000 &&
            boxes.length === view.totalPageCount &&
            boxes[0] &&
            Math.abs(boxes[0].heightPt - a4Pt) < 3 &&
            boxes[1] &&
            boxes[1].heightPt < a4Pt - 40
        ) {
            pass(
                'PDF MediaBoxes: A4 cover + content-sized overview',
                `pages=${boxes.length} overviewPt=${Math.round(boxes[1].heightPt)}`
            );
        } else {
            fail(
                'PDF MediaBoxes: A4 cover + content-sized overview',
                JSON.stringify({ pages: boxes.length, expected: view.totalPageCount, boxes })
            );
        }

        // Overview is page 2 in the PDF (cover=1). Rasterize + extract text so
        // empty day cards (borders without Mon/Tue content) fail the suite.
        const overviewPng = join(OUT_DIR, `example-week-pdf-overview-${mode}.png`);
        const raster = await inspectPdfPage(pdf, 2, overviewPng);
        if (raster.h < 1100) {
            pass(
                'rasterized overview PDF page is content-short (not A4-tall stretch)',
                `png=${raster.w}x${raster.h}`
            );
        } else {
            fail(
                'rasterized overview PDF page is content-short (not A4-tall stretch)',
                `png=${raster.w}x${raster.h}`
            );
        }

        const expectedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const overviewText = String(raster.text || '');
        // PDF.js often inserts spaces between glyphs ("E x a m p l e").
        const compactOverview = overviewText.replace(/\s+/g, '');
        const missingDays = expectedDays.filter(
            (d) => !compactOverview.includes(d)
        );
        const hasExampleWeek = /Example\s*week/i.test(overviewText);
        const hasProgramNotes = /Program\s*notes/i.test(overviewText);
        const hasDayStatuses =
            /Rest/i.test(overviewText) && /Workout/i.test(overviewText);
        if (
            missingDays.length === 0 &&
            hasExampleWeek &&
            hasProgramNotes &&
            hasDayStatuses
        ) {
            pass(
                'overview PDF text includes all 7 day labels + Example Week + Program notes',
                `textChars=${overviewText.length}`
            );
        } else {
            fail(
                'overview PDF text includes all 7 day labels + Example Week + Program notes',
                JSON.stringify({
                    missingDays,
                    hasExampleWeek,
                    hasProgramNotes,
                    hasDayStatuses,
                    sample: overviewText.slice(0, 220),
                })
            );
        }

        if (
            afterPrepare.notesTop != null &&
            afterPrepare.weekBottom != null &&
            afterPrepare.notesTop - afterPrepare.weekBottom >= 8 &&
            afterPrepare.notesTop - afterPrepare.weekBottom <= 48
        ) {
            pass(
                'Program Notes follows Example Week with reasonable gap',
                `gap=${afterPrepare.notesTop - afterPrepare.weekBottom}px`
            );
        } else {
            fail(
                'Program Notes follows Example Week with reasonable gap',
                `notesTop=${afterPrepare.notesTop} weekBottom=${afterPrepare.weekBottom}`
            );
        }

        if (
            afterPrepare.overviewHeight != null &&
            afterPrepare.weekHeight != null &&
            afterPrepare.overviewHeight < ELEVATE_A4_HEIGHT_PX - 80 &&
            afterPrepare.overviewHeight >
                afterPrepare.weekHeight + 120
        ) {
            pass(
                'overview page height matches content (not inherited tall A4)',
                `overview=${afterPrepare.overviewHeight}px week=${afterPrepare.weekHeight}px`
            );
        } else {
            fail(
                'overview page height matches content (not inherited tall A4)',
                JSON.stringify({
                    overview: afterPrepare.overviewHeight,
                    week: afterPrepare.weekHeight,
                })
            );
        }

        // Details page must remain a separate raster page (no forced merge).
        const detailsPng = join(OUT_DIR, `example-week-pdf-details-${mode}.png`);
        const detailsRaster = await inspectPdfPage(pdf, 3, detailsPng);
        const detailsText = String(detailsRaster.text || '');
        const compactDetails = detailsText.replace(/\s+/g, '');
        const detailsStartsClean =
            /WORKOUT\s*PLAN/i.test(detailsText) &&
            !/Exampleweek/i.test(compactDetails);
        if (
            detailsRaster.pages === view.totalPageCount &&
            detailsRaster.h > 100 &&
            detailsStartsClean
        ) {
            pass(
                'next page starts with its own Workout Plan content (no Example Week bleed)',
                `pages=${detailsRaster.pages} detailsPng=${detailsRaster.w}x${detailsRaster.h}`
            );
        } else {
            fail(
                'next page starts with its own Workout Plan content (no Example Week bleed)',
                JSON.stringify({
                    pages: detailsRaster.pages,
                    h: detailsRaster.h,
                    detailsStartsClean,
                    sample: detailsText.slice(0, 220),
                })
            );
        }
    } finally {
        await browser.close().catch(() => {});
        await closeHtmlPdfBrowser().catch(() => {});
    }

    console.log('\nElevate Example Week checks:');
    for (const r of results) {
        console.log(
            `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`
        );
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    console.log(
        `\nRuntime note: ${
            mode === 'serverless' && !fallbackFrom
                ? 'Verified on production/serverless Chromium.'
                : 'Verified on local Chromium fallback — serverless binary unavailable on this host.'
        }`
    );
    if (failed.length) process.exitCode = 1;
    process.exit(process.exitCode || 0);
}

await run();
