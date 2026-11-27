/**
 * Elevate PDF — Example Week day cards must stay content-sized (not page-tall).
 * Run: node scripts/test-elevate-example-week.mjs
 *
 * Optionally forces the serverless Chromium path when available:
 *   PDF_USE_SERVERLESS_CHROMIUM=1 node scripts/test-elevate-example-week.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import {
    buildElevateWorkoutHtml,
    deriveElevateViewModel,
} from '../src/modules/plan-exports/templates/elevate/page.js';
import { renderElevateWorkoutPdf } from '../src/modules/plan-exports/templates/elevate/index.js';
import {
    applyElevateWorkoutContentPageSizes,
    ELEVATE_A4_HEIGHT_PX,
} from '../src/modules/plan-exports/templates/elevate/contentPageSizes.js';
import { resolvePdfBrowserLaunchPlan } from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp/pdf-samples');
const FIXTURE = join(
    ROOT,
    'src/modules/plan-exports/studio/fixtures/workout-basic.json'
);

/** Compact day card: min-height 78px + small padding budget. */
const MAX_COMPACT_DAY_HEIGHT_PX = 120;
/** Example Week section should not fill most of an A4 page. */
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
        const x1 = Number(match[1]);
        const y1 = Number(match[2]);
        const x2 = Number(match[3]);
        const y2 = Number(match[4]);
        boxes.push({
            widthPt: Math.abs(x2 - x1),
            heightPt: Math.abs(y2 - y1),
        });
    }
    return boxes;
};

const launchChromium = async () => {
    const preferredPlan = await resolvePdfBrowserLaunchPlan();
    const attempts = [preferredPlan];
    // Windows cannot run @sparticuz/chromium; fall back to local Playwright.
    if (preferredPlan.mode === 'serverless') {
        attempts.push(await resolvePdfBrowserLaunchPlan({}));
    }

    let lastError = null;
    for (const plan of attempts) {
        const useServerless = plan.mode === 'serverless';
        const chromiumApi = useServerless
            ? (await import('playwright-core')).chromium
            : (await import('playwright')).chromium;
        try {
            const browser = await chromiumApi.launch(plan.launchOptions);
            return {
                browser,
                mode: plan.mode,
                launchError: null,
                fallbackFrom: preferredPlan.mode !== plan.mode ? preferredPlan.mode : null,
            };
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        }
    }
    return {
        browser: null,
        mode: preferredPlan.mode,
        launchError: lastError,
        fallbackFrom: null,
    };
};

const measureExampleWeek = async (page) =>
    page.evaluate(() => {
        const week = document.querySelector('.example-week');
        const grid = document.querySelector('.example-week-grid');
        const days = [...document.querySelectorAll('.week-day')];
        const overview = document.querySelector('.page-workouts');
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
            dayCount: days.length,
            dayHeights: days.map((d) =>
                Math.round(d.getBoundingClientRect().height)
            ),
            dayLabels: days.map((d) =>
                (d.querySelector('strong')?.textContent || '').trim()
            ),
            dayDetails: days.map((d) =>
                (d.querySelector('span')?.textContent || '').trim()
            ),
        };
    });

const assertCompact = (label, metrics) => {
    if (!metrics || metrics.dayCount !== 7) {
        fail(label, `expected 7 day cards, got ${JSON.stringify(metrics)}`);
        return false;
    }
    const maxDay = Math.max(...metrics.dayHeights);
    const minDay = Math.min(...metrics.dayHeights);
    if (maxDay > MAX_COMPACT_DAY_HEIGHT_PX) {
        fail(
            label,
            `day cards too tall max=${maxDay}px heights=${JSON.stringify(metrics.dayHeights)}`
        );
        return false;
    }
    if (metrics.weekHeight > MAX_EXAMPLE_WEEK_HEIGHT_PX) {
        fail(
            label,
            `Example Week section too tall week=${metrics.weekHeight}px`
        );
        return false;
    }
    if (metrics.gridHeight > MAX_COMPACT_DAY_HEIGHT_PX + 8) {
        fail(label, `grid too tall grid=${metrics.gridHeight}px`);
        return false;
    }
    // Equal-width row: heights should stay near the shared min-height band.
    if (maxDay - minDay > 40) {
        fail(
            label,
            `day heights diverge too much min=${minDay} max=${maxDay}`
        );
        return false;
    }
    pass(
        label,
        `week=${metrics.weekHeight}px grid=${metrics.gridHeight}px days=${metrics.dayHeights.join(',')}`
    );
    return true;
};

async function run() {
    mkdirSync(OUT_DIR, { recursive: true });
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const html = buildElevateWorkoutHtml(fixture);
    const view = deriveElevateViewModel(fixture);

    const { browser, mode, launchError, fallbackFrom } = await launchChromium();
    if (!browser) {
        fail(
            `launch Chromium (${mode})`,
            launchError || 'unknown launch failure'
        );
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
        fallbackFrom ? `fell back from ${fallbackFrom}` : undefined
    );
    // renderElevateWorkoutPdf reads process.env; keep PDF path aligned with
    // the browser we actually launched (Windows cannot run sparticuz).
    if (fallbackFrom === 'serverless' && mode === 'local') {
        delete process.env.PDF_USE_SERVERLESS_CHROMIUM;
    }

    try {
        const page = await browser.newPage();
        await page.setContent(html, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });
        await applyElevateWorkoutContentPageSizes(page);

        const afterPrepare = await measureExampleWeek(page);
        assertCompact('after preparePage: compact Example Week', afterPrepare);

        // Prod-like failure: grid gets a definite tall height (flex leftover /
        // page box). Default CSS Grid stretch would inflate .week-day; our
        // align-items/grid-auto-rows rules must keep cards content-sized.
        await page.evaluate(() => {
            document
                .querySelectorAll('style[data-example-week-stretch-probe]')
                .forEach((n) => n.remove());
            const style = document.createElement('style');
            style.setAttribute('data-example-week-stretch-probe', '1');
            style.textContent = `
              .page-workouts { height: 1123px !important; min-height: 1123px !important; }
              .page-workouts .workouts-grid { flex: 1 1 auto !important; }
              .example-week {
                flex: 1 1 auto !important;
                display: flex !important;
                flex-direction: column !important;
                align-self: stretch !important;
                height: auto !important;
              }
              .example-week-grid {
                flex: 1 1 auto !important;
                height: 100% !important;
                min-height: 280px !important;
              }
            `;
            document.head.appendChild(style);
            void document.body.offsetHeight;
        });
        const stretchedMetrics = await measureExampleWeek(page);
        const maxStretchedDay = Math.max(...stretchedMetrics.dayHeights);
        if (maxStretchedDay <= MAX_COMPACT_DAY_HEIGHT_PX) {
            pass(
                'tall-grid stretch probe: day cards stay content-sized',
                `maxDay=${maxStretchedDay}px grid=${stretchedMetrics.gridHeight}px days=${stretchedMetrics.dayHeights.join(',')}`
            );
        } else {
            fail(
                'tall-grid stretch probe: day cards stay content-sized',
                JSON.stringify(stretchedMetrics)
            );
        }

        // Drop the probe stylesheet, then preparePage must keep content sizing
        // even if ancestors still have leftover A4 height from prior layout.
        await page.evaluate(() => {
            document
                .querySelectorAll('style[data-example-week-stretch-probe]')
                .forEach((n) => n.remove());
            const overview = document.querySelector('.page-workouts');
            if (overview) {
                overview.style.height = '1123px';
                overview.style.minHeight = '1123px';
            }
            const workoutsGrid = document.querySelector('.workouts-grid');
            if (workoutsGrid) {
                workoutsGrid.style.flex = '1 1 auto';
            }
            const week = document.querySelector('.example-week');
            if (week) {
                week.style.flex = '1 1 auto';
                week.style.display = 'flex';
                week.style.flexDirection = 'column';
            }
            const grid = document.querySelector('.example-week-grid');
            if (grid) {
                grid.style.flex = '1 1 auto';
                grid.style.height = '100%';
            }
        });
        await applyElevateWorkoutContentPageSizes(page);
        const afterRestretchPrepare = await measureExampleWeek(page);
        assertCompact(
            'preparePage restores compact Example Week after stretch probe',
            afterRestretchPrepare
        );

        await page.emulateMedia({ media: 'print' });
        const afterPrint = await measureExampleWeek(page);
        assertCompact('print media: compact Example Week', afterPrint);

        // Screenshot overview for visual regression artifact.
        const overview = page.locator('.page-workouts');
        await overview.screenshot({
            path: join(OUT_DIR, `example-week-overview-${mode}.png`),
        });
        await page.close();

        const pdf = await renderElevateWorkoutPdf(fixture);
        const pdfPath = join(OUT_DIR, `example-week-${mode}.pdf`);
        writeFileSync(pdfPath, pdf);
        writeFileSync(
            join(OUT_DIR, `example-week-${mode}.html`),
            html,
            'utf8'
        );

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
                'PDF page count + MediaBoxes unchanged (A4 cover, short overview)',
                `pages=${boxes.length} overviewPt=${Math.round(boxes[1].heightPt)}`
            );
        } else {
            fail(
                'PDF page count + MediaBoxes unchanged (A4 cover, short overview)',
                JSON.stringify({
                    bytes: pdf.length,
                    pages: boxes.length,
                    expectedPages: view.totalPageCount,
                    boxes,
                })
            );
        }

        // Re-open rendered HTML path through the same browser and confirm
        // post-prepare metrics again (local ↔ requested serverless path).
        const verifyPage = await browser.newPage();
        await verifyPage.setContent(html, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });
        await applyElevateWorkoutContentPageSizes(verifyPage);
        await verifyPage.emulateMedia({ media: 'print' });
        const verified = await measureExampleWeek(verifyPage);
        assertCompact(
            `${mode} runtime: Example Week dimensions content-based`,
            verified
        );
        if (
            verified.dayLabels.some(Boolean) &&
            verified.dayDetails.some(Boolean)
        ) {
            pass(
                'day cards retain labels/details',
                verified.dayLabels.join('|')
            );
        } else {
            fail(
                'day cards retain labels/details',
                JSON.stringify(verified)
            );
        }
        await verifyPage.close();
    } finally {
        await browser.close().catch(() => {});
    }

    console.log('\nElevate Example Week checks:');
    for (const r of results) {
        console.log(
            `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`
        );
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
    process.exit(process.exitCode || 0);
}

await run();
