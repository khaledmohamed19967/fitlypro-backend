/**
 * Capture Example Week computed layout immediately before page.pdf().
 * Mirrors the production render sequence (setContent → images → fonts → prepare → measure).
 *
 * Run:
 *   node scripts/diagnose-example-week-layout.mjs
 *   PDF_USE_SERVERLESS_CHROMIUM=1 node scripts/diagnose-example-week-layout.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { buildElevateWorkoutHtml } from '../src/modules/plan-exports/templates/elevate/page.js';
import { applyElevateWorkoutContentPageSizes } from '../src/modules/plan-exports/templates/elevate/contentPageSizes.js';
import {
    isServerlessPdfRuntime,
    resolvePdfBrowserLaunchPlan,
    closeHtmlPdfBrowser,
} from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp/pdf-samples');
const FIXTURE = join(
    ROOT,
    'src/modules/plan-exports/studio/fixtures/workout-basic.json'
);

const snapshotLayout = async (page) =>
    page.evaluate(() => {
        const pick = (el) => {
            if (!el) return null;
            const cs = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return {
                className: String(el.className || ''),
                display: cs.display,
                position: cs.position,
                overflow: cs.overflow,
                height: cs.height,
                minHeight: cs.minHeight,
                maxHeight: cs.maxHeight,
                flex: cs.flex,
                flexGrow: cs.flexGrow,
                alignSelf: cs.alignSelf,
                alignItems: cs.alignItems,
                alignContent: cs.alignContent,
                justifyContent: cs.justifyContent,
                gridTemplateRows: cs.gridTemplateRows,
                gridAutoRows: cs.gridAutoRows,
                gridTemplateColumns: cs.gridTemplateColumns,
                top: cs.top,
                bottom: cs.bottom,
                inset: cs.inset,
                rectH: Math.round(rect.height),
                rectTop: Math.round(rect.top),
                rectBottom: Math.round(rect.bottom),
                scrollH: el.scrollHeight,
                offsetH: el.offsetHeight,
                clientH: el.clientHeight,
                inlineHeight: el.style.height || null,
                inlineFlex: el.style.flex || null,
                inlineAlignItems: el.style.alignItems || null,
            };
        };

        const week = document.querySelector('.example-week');
        const grid = document.querySelector('.example-week-grid');
        const days = [...document.querySelectorAll('.week-day')];
        const overview = document.querySelector('.page-workouts');
        const details = document.querySelector('.page-workout-details');
        const programNotes = document.querySelector('.program-notes');

        const ancestors = [];
        let node = grid;
        while (node && node !== document.documentElement) {
            ancestors.push(pick(node));
            node = node.parentElement;
        }

        return {
            nesting: {
                weekContainsDetails: week && details ? week.contains(details) : null,
                weekContainsProgramNotes: Boolean(week?.querySelector('.program-notes')),
                overviewContainsDetails: overview && details
                    ? overview.contains(details)
                    : null,
                weekChildren: [...(week?.children || [])].map((c) => c.className),
                pageCount: document.querySelectorAll('.page').length,
            },
            overview: pick(overview),
            workoutsGrid: pick(document.querySelector('.workouts-grid')),
            week: pick(week),
            grid: pick(grid),
            programNotes: pick(programNotes),
            details: pick(details),
            days: days.map((d) => ({
                ...pick(d),
                text: (d.innerText || '').replace(/\s+/g, ' ').trim(),
            })),
            ancestors,
            namedPageRules: [
                ...document.querySelectorAll(
                    'style[data-elevate-content-page-sizes]'
                ),
            ].map((s) => s.textContent),
            body: pick(document.body),
        };
    });

const launch = async () => {
    const preferred = await resolvePdfBrowserLaunchPlan();
    const plans = [preferred];
    if (preferred.mode === 'serverless') {
        plans.push(await resolvePdfBrowserLaunchPlan({}));
    }

    for (const plan of plans) {
        const api =
            plan.mode === 'serverless'
                ? (await import('playwright-core')).chromium
                : (await import('playwright')).chromium;
        try {
            const browser = await api.launch(plan.launchOptions);
            return {
                browser,
                mode: plan.mode,
                fallback: preferred.mode !== plan.mode,
            };
        } catch (err) {
            console.error(`launch ${plan.mode} failed:`, err.message);
        }
    }
    throw new Error('No Chromium runtime available');
};

const run = async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const html = buildElevateWorkoutHtml(fixture);
    writeFileSync(join(OUT_DIR, 'diagnose-example-week.html'), html, 'utf8');

    const { browser, mode, fallback } = await launch();
    console.log(
        JSON.stringify({
            mode,
            fallback,
            envServerless: isServerlessPdfRuntime(),
        })
    );

    const page = await browser.newPage();
    try {
        await page.setContent(html, {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        });
        await page.evaluate(async () => {
            if (document.fonts?.ready) await document.fonts.ready;
        });

        const beforePrepare = await snapshotLayout(page);
        await applyElevateWorkoutContentPageSizes(page);
        const afterPrepare = await snapshotLayout(page);

        await page.emulateMedia({ media: 'print' });
        const afterPrint = await snapshotLayout(page);

        // Force a layout that previously inflated cards, then re-measure.
        await page.evaluate(() => {
            const overview = document.querySelector('.page-workouts');
            if (overview) {
                overview.style.height = '1123px';
            }
            void document.body.offsetHeight;
        });
        const afterForcedA4 = await snapshotLayout(page);

        const report = {
            mode,
            fallback,
            beforePrepare,
            afterPrepare,
            afterPrint,
            afterForcedA4,
        };
        writeFileSync(
            join(OUT_DIR, `diagnose-example-week-${mode}.json`),
            JSON.stringify(report, null, 2)
        );

        const summarize = (label, snap) => ({
            label,
            overviewH: snap.overview?.rectH,
            weekH: snap.week?.rectH,
            gridH: snap.grid?.rectH,
            dayHeights: snap.days?.map((d) => d.rectH),
            gridAlignItems: snap.grid?.alignItems,
            gridTemplateRows: snap.grid?.gridTemplateRows,
            weekFlex: snap.week?.flex,
            nesting: snap.nesting,
        });

        console.log(
            JSON.stringify(
                [
                    summarize('beforePrepare', beforePrepare),
                    summarize('afterPrepare', afterPrepare),
                    summarize('afterPrint', afterPrint),
                    summarize('afterForcedA4', afterForcedA4),
                ],
                null,
                2
            )
        );

        await page.locator('.page-workouts').screenshot({
            path: join(OUT_DIR, `diagnose-overview-${mode}.png`),
        });
    } finally {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
        await closeHtmlPdfBrowser().catch(() => {});
    }
};

await run();
