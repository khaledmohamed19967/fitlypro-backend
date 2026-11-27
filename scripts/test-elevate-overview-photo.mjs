/**
 * Elevate Workout PDF — overview gym photo stays on overview (no next-page bleed).
 * Run: node scripts/test-elevate-overview-photo.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium as localChromium } from 'playwright';

import {
    buildElevateWorkoutHtml,
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
} from '../src/modules/plan-exports/templates/elevate/contentPageSizes.js';
import {
    closeHtmlPdfBrowser,
    renderHtmlToPdf,
} from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp/pdf-samples');

const results = [];
const pass = (name, detail) => results.push({ name, ok: true, detail });
const fail = (name, detail) => results.push({ name, ok: false, detail });

const strength = (name, order) => ({
    name,
    order,
    restBetweenSets: 90,
    notes: null,
    muscles: { primary: 'Chest', secondary: [] },
    sets: [
        {
            setNumber: 1,
            reps: 10,
            weight: 40,
            weightUnit: 'kg',
            isWarmup: false,
            isDropset: false,
        },
    ],
});

const day = (dayNumber, name, parts = {}) => ({
    dayNumber,
    name,
    description: null,
    warmupActivities: parts.warmupActivities || [],
    exercises: parts.exercises || [],
    cardioActivities: parts.cardioActivities || [],
});

const model = {
    type: 'workout',
    plan: {
        id: 'overview-photo',
        name: 'Push Pull Legs',
        duration: 4,
        daysPerWeek: 5,
        goal: 'general_fitness',
        level: 'beginner',
        notes: null,
        status: 'active',
        isTemplate: false,
        totalExercises: 5,
        totalDays: 7,
    },
    trainer: { id: 't', fullName: 'Coach', email: null, phone: null },
    content: {
        workoutDays: [
            day(1, 'Push Day', { exercises: [strength('Bench', 1)] }),
            day(2, 'Pull Day', { exercises: [strength('Row', 1)] }),
            day(3, 'Leg Day', { exercises: [strength('Squat', 1)] }),
            day(4, 'Rest Day', {}),
            day(5, 'Upper', { exercises: [strength('OHP', 1)] }),
            day(6, 'Lower', { exercises: [strength('RDL', 1)] }),
            day(7, 'Rest Day', {}),
        ],
    },
};

const parseMediaBoxes = (pdfBuffer) => {
    const boxes = [];
    const re =
        /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g;
    let match;
    while ((match = re.exec(pdfBuffer.toString('latin1')))) {
        boxes.push({
            widthPt: Math.abs(Number(match[3]) - Number(match[1])),
            heightPt: Math.abs(Number(match[4]) - Number(match[2])),
        });
    }
    return boxes;
};

const inspectPdfPage = async (pdfBuffer, pageNumber, outPath) => {
    const browser = await localChromium.launch({ headless: true });
    const page = await browser.newPage({
        viewport: { width: 1000, height: 1600 },
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
window.__inspect = async (n) => {
  const p = await doc.getPage(n);
  const viewport = p.getViewport({ scale: 1.5 });
  const canvas = document.getElementById('c');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const text = (await p.getTextContent()).items.map((i) => i.str).join(' ');
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rowScore = (y) => {
    let changes = 0;
    let prev = -1;
    let bright = 0;
    for (let x = 40; x < canvas.width - 40; x += 5) {
      const i = (y * canvas.width + x) * 4;
      const v = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
      if (v > 45) bright++;
      if (prev >= 0 && Math.abs(v - prev) > 14) changes++;
      prev = v;
    }
    return { score: changes / ((canvas.width - 80) / 5), bright };
  };
  let photoish = 0;
  let photoishLower = 0;
  let lastContent = 0;
  const lowerStart = Math.floor(canvas.height * 0.55);
  for (let y = 0; y < canvas.height; y++) {
    const s = rowScore(y);
    if (s.score > 0.16 && s.bright > 15) {
      photoish++;
      if (y >= lowerStart) photoishLower++;
    }
    if (s.bright > 3) lastContent = y;
  }
  return {
    w: canvas.width,
    h: canvas.height,
    text,
    photoishRatio: photoish / canvas.height,
    photoishLowerRatio: photoishLower / Math.max(1, canvas.height - lowerStart),
    blankRatio: (canvas.height - 1 - lastContent) / canvas.height,
    hasWorkouts: /WORKOUTS/i.test(text),
    hasWorkoutPlan: /WORKOUT\\s*PLAN/i.test(text),
    hasProgramNotes: /Program\\s*notes/i.test(text),
    hasExampleWeek: /Example\\s*week/i.test(text),
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
    const html = buildElevateWorkoutHtml(model, { inlineAssets: false });

    const overviewChunk = html.slice(
        html.indexOf('page-workouts'),
        html.indexOf('page-workout-details')
    );
    const photoInOverview = /workouts-photo/i.test(overviewChunk);
    const endWrap =
        /workouts-end[\s\S]*workouts-photo[\s\S]*workouts-footer/i.test(
            overviewChunk
        );
    const notesThenPhoto =
        overviewChunk.indexOf('program-notes') >= 0 &&
        overviewChunk.indexOf('program-notes') <
            overviewChunk.indexOf('workouts-photo');
    const photoNotOnDetails = !new RegExp(
        'page-workout-details[\\s\\S]*workouts-photo',
        'i'
    ).test(html.split('</style>')[0] ? html : html);

    // Safer: photo class only as img inside overview chunk.
    const detailsAfter = html.slice(html.indexOf('page-workout-details'));
    const photoImgOnDetails = /<img[^>]*workouts-photo/i.test(detailsAfter);

    if (photoInOverview && endWrap && notesThenPhoto && !photoImgOnDetails) {
        pass(
            'HTML: photo inside .page-workouts after Program Notes (workouts-end)',
            `exampleWeekFlag=${ELEVATE_INCLUDE_EXAMPLE_WEEK_IN_PDF}`
        );
    } else {
        fail(
            'HTML: photo inside .page-workouts after Program Notes (workouts-end)',
            JSON.stringify({
                photoInOverview,
                endWrap,
                notesThenPhoto,
                photoImgOnDetails,
            })
        );
    }

    /** @type {object|null} */
    let probe = null;
    const pdf = await renderHtmlToPdf(html, {
        ...ELEVATE_WORKOUT_PDF_OPTIONS,
        localAssetRoot: ELEVATE_HTML_DIR,
        preparePage: async (page) => {
            await applyElevateWorkoutContentPageSizes(page);
            probe = await page.evaluate(() => {
                const overview = document.querySelector('.page-workouts');
                const details = document.querySelector('.page-workout-details');
                const notes = overview?.querySelector('.program-notes');
                const photo = overview?.querySelector('.workouts-photo');
                const end = overview?.querySelector('.workouts-end');
                const footer = overview?.querySelector('.workouts-footer');
                if (!overview || !photo || !notes) return { missing: true };
                const o = overview.getBoundingClientRect();
                const n = notes.getBoundingClientRect();
                const p = photo.getBoundingClientRect();
                const f = footer?.getBoundingClientRect();
                const d = details?.getBoundingClientRect();
                return {
                    photoParent: photo.parentElement?.className || '',
                    inEnd: Boolean(end && end.contains(photo)),
                    gapNotesToPhoto: p.top - n.bottom,
                    photoBottomRel: p.bottom - o.top,
                    footerBottomRel: f ? f.bottom - o.top : null,
                    overviewH: o.height,
                    photoInsideOverview: p.bottom <= o.bottom + 1 && p.top >= o.top - 1,
                    photoOverlapsDetails:
                        d != null && p.bottom > d.top + 2 && p.top < d.bottom,
                    overflow: getComputedStyle(overview).overflow,
                };
            });
        },
        deadlineMs: 60_000,
    });

    writeFileSync(join(OUT_DIR, 'elevate-overview-photo.pdf'), pdf);

    if (
        probe &&
        !probe.missing &&
        probe.inEnd &&
        probe.photoInsideOverview &&
        !probe.photoOverlapsDetails &&
        probe.gapNotesToPhoto >= 0 &&
        probe.gapNotesToPhoto <= 48 &&
        probe.overviewH - (probe.footerBottomRel || probe.photoBottomRel) <= 48
    ) {
        pass(
            'DOM: photo fully inside overview after notes (tight gap, no details overlap)',
            `gap=${Math.round(probe.gapNotesToPhoto)}px overflow=${probe.overflow}`
        );
    } else {
        fail(
            'DOM: photo fully inside overview after notes (tight gap, no details overlap)',
            JSON.stringify(probe)
        );
    }

    const boxes = parseMediaBoxes(pdf);
    const a4Pt = (ELEVATE_A4_HEIGHT_PX * 72) / 96;
    const overviewPt = boxes[1]?.heightPt;
    const overviewPx = overviewPt != null ? (overviewPt * 96) / 72 : null;
    if (
        boxes[0] &&
        Math.abs(boxes[0].heightPt - a4Pt) < 3 &&
        overviewPt != null &&
        overviewPt < a4Pt - 40 &&
        overviewPx != null &&
        probe?.photoBottomRel != null &&
        overviewPx >= probe.photoBottomRel - 2
    ) {
        pass(
            'PDF MediaBox includes overview photo height (content-sized)',
            `overviewPt=${Math.round(overviewPt)} photoBottom=${Math.round(probe.photoBottomRel)}`
        );
    } else {
        fail(
            'PDF MediaBox includes overview photo height (content-sized)',
            JSON.stringify({ overviewPt, overviewPx, probe, boxes: boxes.slice(0, 3) })
        );
    }

    const overviewPng = join(OUT_DIR, 'elevate-overview-photo-p2.png');
    const detailsPng = join(OUT_DIR, 'elevate-overview-photo-p3.png');
    const page2 = await inspectPdfPage(pdf, 2, overviewPng);
    const page3 = await inspectPdfPage(pdf, 3, detailsPng);

    if (
        page2.hasWorkouts &&
        page2.hasProgramNotes &&
        !page2.hasExampleWeek &&
        page2.photoishLowerRatio >= 0.2 &&
        page2.blankRatio < 0.12
    ) {
        pass(
            'raster overview: photo after notes, no large blank, Example Week hidden',
            `photoishLower=${page2.photoishLowerRatio.toFixed(2)} blank=${page2.blankRatio.toFixed(2)}`
        );
    } else {
        fail(
            'raster overview: photo after notes, no large blank, Example Week hidden',
            JSON.stringify({
                hasWorkouts: page2.hasWorkouts,
                hasProgramNotes: page2.hasProgramNotes,
                hasExampleWeek: page2.hasExampleWeek,
                photoishLowerRatio: page2.photoishLowerRatio,
                blankRatio: page2.blankRatio,
            })
        );
    }

    if (
        page3.hasWorkoutPlan &&
        !page3.hasProgramNotes &&
        page3.photoishRatio < 0.12 &&
        page3.photoishLowerRatio < 0.15
    ) {
        pass(
            'raster detail page: Workout Plan header only — no overview photo bleed',
            `photoish=${page3.photoishRatio.toFixed(2)}`
        );
    } else {
        fail(
            'raster detail page: Workout Plan header only — no overview photo bleed',
            JSON.stringify({
                hasWorkoutPlan: page3.hasWorkoutPlan,
                hasProgramNotes: page3.hasProgramNotes,
                photoishRatio: page3.photoishRatio,
                photoishLowerRatio: page3.photoishLowerRatio,
                sample: page3.text.slice(0, 160),
            })
        );
    }

    // Also exercise the public renderer path once.
    const publicPdf = await renderElevateWorkoutPdf(model);
    writeFileSync(join(OUT_DIR, 'elevate-overview-photo-public.pdf'), publicPdf);
    if (publicPdf.length > 1000) {
        pass('renderElevateWorkoutPdf sample generated', `${publicPdf.length} bytes`);
    } else {
        fail('renderElevateWorkoutPdf sample generated', String(publicPdf.length));
    }

    console.log('\nElevate overview photo checks:');
    for (const r of results) {
        console.log(
            `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`
        );
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    await closeHtmlPdfBrowser().catch(() => {});
    if (failed.length) process.exitCode = 1;
    process.exit(process.exitCode || 0);
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
