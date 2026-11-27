/**
 * Elevate PDF — content-based workout detail page heights.
 * Run: node scripts/test-elevate-content-height.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

import {
    buildElevateWorkoutHtml,
    deriveElevateViewModel,
    ELEVATE_HTML_DIR,
    ELEVATE_INCLUDE_EXAMPLE_WEEK_IN_PDF,
} from '../src/modules/plan-exports/templates/elevate/page.js';
import {
    ELEVATE_WORKOUT_PDF_OPTIONS,
    renderElevateWorkoutPdf,
} from '../src/modules/plan-exports/templates/elevate/index.js';
import {
    applyElevateWorkoutContentPageSizes,
    ELEVATE_A4_HEIGHT_PX,
    ELEVATE_PAGE_WIDTH_PX,
} from '../src/modules/plan-exports/templates/elevate/contentPageSizes.js';
import {
    closeHtmlPdfBrowser,
    renderHtmlToPdf,
} from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp/pdf-samples');

const results = [];
const pass = (name) => results.push({ name, ok: true });
const fail = (name, detail) => results.push({ name, ok: false, detail });

const strength = (name, order, sets = 3) => ({
    name,
    order,
    restBetweenSets: 90,
    notes: null,
    muscles: { primary: 'Chest', secondary: [] },
    sets: Array.from({ length: sets }, (_, i) => ({
        setNumber: i + 1,
        reps: 10,
        weight: 40,
        weightUnit: 'kg',
        isWarmup: false,
        isDropset: false,
    })),
});

const warmup = (name, order) => ({
    activityType: 'mobility',
    name,
    order,
    durationMinutes: 3,
    intensity: 'low',
    notes: null,
});

const cardio = (name, order) => ({
    activityType: 'steady_state',
    name,
    order,
    durationMinutes: 10,
    intensity: 'moderate',
    protocol: 'steady',
    notes: null,
});

const day = (dayNumber, name, parts = {}) => ({
    dayNumber,
    name,
    description: null,
    warmupActivities: parts.warmupActivities || [],
    exercises: parts.exercises || [],
    cardioActivities: parts.cardioActivities || [],
});

const modelFromDays = (days, planName) => ({
    type: 'workout',
    plan: {
        id: 'height-probe',
        name: planName,
        duration: 4,
        daysPerWeek: days.length,
        goal: 'general_fitness',
        level: 'beginner',
        notes: null,
        status: 'active',
        isTemplate: false,
        totalExercises: days.reduce((s, d) => s + (d.exercises?.length || 0), 0),
        totalDays: days.length,
    },
    trainer: { id: 't', fullName: 'Coach', email: null, phone: null },
    content: { workoutDays: days },
});

const parseMediaBoxes = (pdfBuffer) => {
    const text = pdfBuffer.toString('latin1');
    const boxes = [];
    const re = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g;
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

const pxToPt = (px) => (px * 72) / 96;

async function measureDomHeights(html) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await page.setContent(html, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });
        await applyElevateWorkoutContentPageSizes(page);
        return await page.evaluate(() =>
            Array.from(document.querySelectorAll('.page')).map((el) => ({
                classes: el.className,
                height: Math.round(el.getBoundingClientRect().height),
                isDetails: el.classList.contains('page-workout-details'),
                isOverview: el.classList.contains('page-workouts'),
                isCover: el.classList.contains('page-cover'),
            }))
        );
    } finally {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

async function run() {
    mkdirSync(OUT_DIR, { recursive: true });

    const shortModel = modelFromDays(
        [
            day(1, 'Push Day', {
                exercises: [strength('Bench Press', 1), strength('OHP', 2)],
            }),
        ],
        'Short Workout'
    );
    const sectionsModel = modelFromDays(
        [
            day(1, 'Full Body', {
                warmupActivities: [warmup('Arm Circles', 1), warmup('Hip Openers', 2)],
                exercises: [
                    strength('Goblet Squat', 1),
                    strength('Push-Up', 2),
                    strength('Row', 3),
                ],
                cardioActivities: [cardio('Treadmill', 1), cardio('Bike', 2)],
            }),
        ],
        'Warmup Exercise Cardio'
    );
    const longModel = modelFromDays(
        [
            day(1, 'Volume Day', {
                exercises: Array.from({ length: 16 }, (_, i) =>
                    strength(`Lift ${i + 1}`, i + 1, 4)
                ),
            }),
        ],
        'Long Workout'
    );
    const multiModel = modelFromDays(
        [
            day(1, 'Push Day', { exercises: [strength('Bench', 1), strength('Fly', 2)] }),
            day(2, 'Pull Day', { exercises: [strength('Row', 1), strength('Curl', 2)] }),
            day(3, 'Leg Day', {
                exercises: [strength('Squat', 1), strength('RDL', 2), strength('Lunge', 3)],
            }),
        ],
        'Push Pull Legs'
    );

    // DOM height checks (short + sections)
    const shortHtml = buildElevateWorkoutHtml(shortModel);
    const shortHeights = await measureDomHeights(shortHtml);
    const shortDetails = shortHeights.filter((p) => p.isDetails);
    const shortCover = shortHeights.filter((p) =>
        String(p.classes || '').includes('page-cover')
    );
    const shortOverview = shortHeights.filter((p) =>
        String(p.classes || '').includes('page-workouts')
    );

    if (
        shortCover.every((p) => p.height === ELEVATE_A4_HEIGHT_PX) &&
        shortOverview.length === 1 &&
        shortOverview[0].height < ELEVATE_A4_HEIGHT_PX - 40 &&
        shortDetails.length >= 1 &&
        shortDetails.every((p) => p.height < ELEVATE_A4_HEIGHT_PX - 80)
    ) {
        pass('overview + detail DOM heights are content-sized (< A4)');
    } else {
        fail(
            'overview + detail DOM heights are content-sized (< A4)',
            JSON.stringify(shortHeights)
        );
    }

    const sectionsHtml = buildElevateWorkoutHtml(sectionsModel);
    const sectionsHeights = await measureDomHeights(sectionsHtml);
    const sectionDetails = sectionsHeights.filter((p) => p.isDetails);
    const view = deriveElevateViewModel(sectionsModel);
    const unifiedSections =
        view.detailPages?.[0]?.blocks?.[0]?.sections?.map((s) => s.id).join('+') || '';
    if (
        sectionDetails.length === view.detailPages.length &&
        sectionDetails.length === 1 &&
        unifiedSections === 'warmup+main+cardio' &&
        sectionDetails[0].height < ELEVATE_A4_HEIGHT_PX - 40
    ) {
        pass('Warm-up/Exercise/Cardio share one content-sized workout page');
    } else {
        fail(
            'Warm-up/Exercise/Cardio share one content-sized workout page',
            JSON.stringify({
                sectionDetails,
                detailPages: view.detailPages.length,
                unifiedSections,
            })
        );
    }

    // PDF generation + MediaBox checks
    const samples = [
        { name: 'elevate-content-height-short.pdf', model: shortModel },
        { name: 'elevate-content-height-sections.pdf', model: sectionsModel },
        { name: 'elevate-content-height-long.pdf', model: longModel },
        { name: 'elevate-content-height-multi.pdf', model: multiModel },
    ];

    const a4Pt = pxToPt(ELEVATE_A4_HEIGHT_PX);
    const written = [];

    for (const sample of samples) {
        const pdf = await renderElevateWorkoutPdf(sample.model);
        const path = join(OUT_DIR, sample.name);
        writeFileSync(path, pdf);
        writeFileSync(
            join(OUT_DIR, sample.name.replace(/\.pdf$/, '.html')),
            buildElevateWorkoutHtml(sample.model),
            'utf8'
        );
        const boxes = parseMediaBoxes(pdf);
        const contentSized = boxes.filter((b) => b.heightPt < a4Pt - 40);
        const fullA4 = boxes.filter((b) => Math.abs(b.heightPt - a4Pt) < 3);
        written.push({
            name: sample.name,
            bytes: pdf.length,
            pages: boxes.length,
            boxes,
            contentSized: contentSized.length,
            fullA4: fullA4.length,
            // First page should remain A4 cover; later pages may shrink.
            coverIsA4: boxes[0] ? Math.abs(boxes[0].heightPt - a4Pt) < 3 : false,
            overviewShorter: boxes[1] ? boxes[1].heightPt < a4Pt - 40 : false,
        });
    }

    const shortPdf = written.find((w) => w.name.includes('short'));
    if (
        shortPdf &&
        shortPdf.bytes > 1000 &&
        shortPdf.coverIsA4 &&
        shortPdf.overviewShorter &&
        shortPdf.contentSized >= 2 &&
        shortPdf.boxes.every((b) => Math.abs(b.widthPt - pxToPt(ELEVATE_PAGE_WIDTH_PX)) < 3)
    ) {
        pass('short PDF: A4 cover + content-sized overview/detail MediaBoxes');
    } else {
        fail(
            'short PDF: A4 cover + content-sized overview/detail MediaBoxes',
            JSON.stringify(shortPdf)
        );
    }

    const sectionsPdf = written.find((w) => w.name.includes('sections'));
    if (
        sectionsPdf &&
        sectionsPdf.coverIsA4 &&
        sectionsPdf.overviewShorter &&
        sectionsPdf.pages === 3 &&
        sectionsPdf.fullA4 === 1
    ) {
        pass('sections PDF: content-sized overview + unified workout detail');
    } else {
        fail(
            'sections PDF: content-sized overview + unified workout detail',
            JSON.stringify(sectionsPdf)
        );
    }

    const longPdf = written.find((w) => w.name.includes('long'));
    const longView = deriveElevateViewModel(longModel);
    if (
        longPdf &&
        longPdf.bytes > 1000 &&
        longPdf.pages === longView.totalPageCount &&
        longView.detailPages.length >= 2
    ) {
        pass('long workout continues across detail pages without blank extras');
    } else {
        fail(
            'long workout continues across detail pages without blank extras',
            JSON.stringify({ longPdf, total: longView.totalPageCount })
        );
    }

    const multiPdf = written.find((w) => w.name.includes('multi'));
    if (
        multiPdf &&
        multiPdf.coverIsA4 &&
        multiPdf.overviewShorter &&
        multiPdf.contentSized >= 4 &&
        multiPdf.fullA4 === 1
    ) {
        pass('multi workout PDF keeps separation with content-sized pages');
    } else {
        fail(
            'multi workout PDF keeps separation with content-sized pages',
            JSON.stringify(multiPdf)
        );
    }

    if (written.every((w) => w.bytes > 1000)) pass('all sample PDFs generated');
    else fail('all sample PDFs generated', JSON.stringify(written.map((w) => w.bytes)));

    // Overview MediaBox must track in-flow content (footer), not leftover A4 /
    // fragmentainer blank space — especially with Example Week excluded.
    const overviewDays = [
        day(1, 'Push', { exercises: [strength('Bench', 1), strength('Fly', 2)] }),
        day(2, 'Pull', { exercises: [strength('Row', 1), strength('Curl', 2)] }),
        day(3, 'Legs', {
            exercises: [
                strength('Squat', 1),
                strength('RDL', 2),
                strength('Lunge', 3),
            ],
        }),
        day(4, 'Rest Day', {}),
        day(5, 'Upper', { exercises: [strength('OHP', 1)] }),
        day(6, 'Lower', { exercises: [strength('Leg Press', 1)] }),
        day(7, 'Rest Day', {}),
    ];
    // Mark rest days empty the way production rest rows are detected.
    overviewDays[3].exercises = [];
    overviewDays[3].warmupActivities = [];
    overviewDays[3].cardioActivities = [];
    overviewDays[6].exercises = [];
    overviewDays[6].warmupActivities = [];
    overviewDays[6].cardioActivities = [];

    const overviewModel = modelFromDays(overviewDays, 'Overview Slack Probe');
    const overviewHtml = buildElevateWorkoutHtml(overviewModel, {
        inlineAssets: false,
    });

    /** @type {{ pageH: number, contentBottom: number, slack: number, hasExampleWeek: boolean } | null} */
    let overviewProbe = null;
    const overviewPdf = await renderHtmlToPdf(overviewHtml, {
        ...ELEVATE_WORKOUT_PDF_OPTIONS,
        localAssetRoot: ELEVATE_HTML_DIR,
        preparePage: async (page) => {
            await applyElevateWorkoutContentPageSizes(page);
            overviewProbe = await page.evaluate(() => {
                const el = document.querySelector('.page-workouts');
                if (!el) return null;
                const footer = el.querySelector('.workouts-footer');
                const pageTop = el.getBoundingClientRect().top;
                const pageH = el.getBoundingClientRect().height;
                const contentBottom = footer
                    ? footer.getBoundingClientRect().bottom - pageTop
                    : pageH;
                return {
                    pageH,
                    contentBottom,
                    slack: pageH - contentBottom,
                    hasExampleWeek: Boolean(el.querySelector('.example-week')),
                };
            });
        },
        deadlineMs: 60_000,
    });
    writeFileSync(join(OUT_DIR, 'elevate-overview-content-slack.pdf'), overviewPdf);

    const overviewBoxes = parseMediaBoxes(overviewPdf);
    const overviewMediaPx =
        overviewBoxes[1] != null
            ? (overviewBoxes[1].heightPt * 96) / 72
            : null;
    const mediaSlack =
        overviewMediaPx != null && overviewProbe != null
            ? overviewMediaPx - overviewProbe.contentBottom
            : null;
    const MAX_OVERVIEW_SLACK_PX = 48;

    if (!ELEVATE_INCLUDE_EXAMPLE_WEEK_IN_PDF && overviewProbe?.hasExampleWeek) {
        fail(
            'TEMP: Example Week stays excluded from overview HTML',
            JSON.stringify(overviewProbe)
        );
    } else if (
        !ELEVATE_INCLUDE_EXAMPLE_WEEK_IN_PDF &&
        !overviewProbe?.hasExampleWeek
    ) {
        pass('TEMP: Example Week stays excluded from overview HTML');
    }

    if (
        overviewProbe &&
        overviewBoxes[0] &&
        Math.abs(overviewBoxes[0].heightPt - a4Pt) < 3 &&
        overviewBoxes[1] &&
        overviewBoxes[1].heightPt < a4Pt - 40 &&
        overviewProbe.slack <= MAX_OVERVIEW_SLACK_PX &&
        mediaSlack != null &&
        mediaSlack <= MAX_OVERVIEW_SLACK_PX &&
        Math.abs(overviewMediaPx - overviewProbe.pageH) < 3
    ) {
        pass(
            'overview MediaBox height matches in-flow content (no excess blank)',
            `slack=${Math.round(mediaSlack)}px pageH=${Math.round(overviewProbe.pageH)}`
        );
    } else {
        fail(
            'overview MediaBox height matches in-flow content (no excess blank)',
            JSON.stringify({
                overviewProbe,
                overviewMediaPx,
                mediaSlack,
                overviewPt: overviewBoxes[1]?.heightPt,
                coverPt: overviewBoxes[0]?.heightPt,
            })
        );
    }

    // Detail pages after overview must remain content-sized (unchanged contract).
    const detailBoxes = overviewBoxes.slice(2);
    if (
        detailBoxes.length >= 1 &&
        detailBoxes.every((b) => b.heightPt < a4Pt - 40)
    ) {
        pass('detail pages stay content-sized while overview slack is tight');
    } else {
        fail(
            'detail pages stay content-sized while overview slack is tight',
            JSON.stringify(detailBoxes)
        );
    }

    console.log('\nElevate content-height checks:');
    for (const r of results) {
        console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    console.log('\nSamples:');
    for (const w of written) {
        const heights = w.boxes.map((b) => Math.round(b.heightPt)).join(', ');
        console.log(`- ${w.name}: ${w.pages} pages · MediaBox heights(pt)=[${heights}]`);
    }
    if (overviewBoxes.length) {
        console.log(
            `- elevate-overview-content-slack.pdf: ${overviewBoxes.length} pages · MediaBox heights(pt)=[${overviewBoxes
                .map((b) => Math.round(b.heightPt))
                .join(', ')}] · slackPx=${mediaSlack != null ? Math.round(mediaSlack) : 'n/a'}`
        );
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    await closeHtmlPdfBrowser().catch(() => {});
    if (failed.length) process.exitCode = 1;
    process.exit(process.exitCode || 0);
}

await run();
