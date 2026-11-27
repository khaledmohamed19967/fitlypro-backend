/**
 * Controlled PDF export performance bench (local Chromium).
 * Run: node scripts/bench-plan-export-pdf.mjs
 *
 * Does not call production. Measures HTML build + Playwright stages for
 * increasing plan sizes with optional remote image URLs.
 */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    closeHtmlPdfBrowser,
    renderHtmlToPdf,
} from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';
import {
    countElevateHtmlPages,
    createPdfExportTrace,
    summarizeExportModelMetrics,
} from '../src/modules/plan-exports/pdf/pdfExportTrace.js';
import {
    ELEVATE_WORKOUT_PDF_OPTIONS,
    buildElevateWorkoutHtml,
} from '../src/modules/plan-exports/templates/elevate/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '.preview', 'pdf-export-bench.json');

const REMOTE_THUMB =
    'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/3_4_Sit-Up/0.jpg';

const makeExercise = (index, withImage) => ({
    exerciseId: `ex-${index}`,
    name: `Exercise ${index}`,
    order: index,
    restBetweenSets: 60,
    notes: null,
    tempo: null,
    thumbnailUrl: withImage ? REMOTE_THUMB : null,
    slug: null,
    ownershipType: 'system',
    status: 'active',
    muscles: { primary: 'core', secondary: [] },
    sets: [
        { setNumber: 1, reps: 10, weight: 20, weightUnit: 'kg', isWarmup: false, isDropset: false },
        { setNumber: 2, reps: 10, weight: 20, weightUnit: 'kg', isWarmup: false, isDropset: false },
        { setNumber: 3, reps: 8, weight: 25, weightUnit: 'kg', isWarmup: false, isDropset: false },
    ],
});

const makeWarmup = (index, withImage) => ({
    activityType: 'dynamic_mobility',
    order: index,
    durationMinutes: 5,
    intensity: 'low',
    notes: null,
    thumbnailUrl: withImage ? REMOTE_THUMB : null,
    name: `Warm-up ${index}`,
});

const makeCardio = (index, withImage) => ({
    activityType: 'treadmill',
    protocol: 'continuous',
    order: index,
    durationMinutes: 15,
    intensity: 'moderate',
    notes: null,
    thumbnailUrl: withImage ? REMOTE_THUMB : null,
    name: `Cardio ${index}`,
});

/**
 * Spread exercises across days (max ~12 main + activities per day).
 */
const buildExportModel = ({ exerciseCount, withImages, days = 3 }) => {
    const perDay = Math.max(1, Math.ceil(exerciseCount / days));
    const workoutDays = [];
    let remaining = exerciseCount;
    let exIndex = 1;

    for (let d = 1; d <= days && remaining > 0; d += 1) {
        const count = Math.min(perDay, remaining);
        const exercises = [];
        for (let i = 0; i < count; i += 1) {
            exercises.push(makeExercise(exIndex, withImages));
            exIndex += 1;
        }
        remaining -= count;
        workoutDays.push({
            dayNumber: d,
            name: `Training ${d}`,
            description: null,
            warmupActivities: [
                makeWarmup(1, withImages),
                makeWarmup(2, withImages),
            ],
            exercises,
            cardioActivities: [makeCardio(1, withImages)],
        });
    }

    return {
        type: 'workout',
        plan: {
            id: `bench-${exerciseCount}`,
            name: `Bench ${exerciseCount}`,
            description: null,
            duration: 8,
            daysPerWeek: workoutDays.length,
            goal: 'general_fitness',
            level: 'intermediate',
            notes: null,
            status: 'active',
            isTemplate: false,
            totalExercises: exerciseCount,
            totalDays: workoutDays.length,
        },
        trainer: { fullName: 'Bench Coach', email: null, phone: null },
        content: { workoutDays },
    };
};

const scenarios = [
    { label: 'small-10', exerciseCount: 10, withImages: true, days: 2 },
    { label: 'medium-30', exerciseCount: 30, withImages: true, days: 3 },
    { label: 'large-60', exerciseCount: 60, withImages: true, days: 5 },
    { label: 'xlarge-100', exerciseCount: 100, withImages: true, days: 7 },
    { label: 'large-60-no-images', exerciseCount: 60, withImages: false, days: 5 },
];

const results = [];

for (const scenario of scenarios) {
    const model = buildExportModel(scenario);
    const metrics = summarizeExportModelMetrics(model);
    const exportId = `bench-${scenario.label}-${Date.now()}`;
    const trace = createPdfExportTrace(exportId, {
        planType: 'workout',
        templateId: 'elevate',
        bench: scenario.label,
    });

    const t0 = Date.now();
    try {
        const html = await trace.time('html_template', () =>
            buildElevateWorkoutHtml(model)
        );
        const htmlBytes = Buffer.byteLength(html, 'utf8');
        const htmlPages = countElevateHtmlPages(html);
        trace.log('html_built', { htmlBytes, htmlPages, ...metrics });

        const buffer = await renderHtmlToPdf(html, {
            ...ELEVATE_WORKOUT_PDF_OPTIONS,
            trace,
        });

        const row = {
            label: scenario.label,
            ok: true,
            totalMs: Date.now() - t0,
            htmlBytes,
            htmlPages,
            pdfBytes: buffer.length,
            stages: trace.stages,
            ...metrics,
        };
        results.push(row);
        console.log(
            `OK ${scenario.label}: total=${row.totalMs}ms html=${htmlBytes}B pages=${htmlPages} pdf=${buffer.length}B images=${metrics.uniqueRemoteImageCount}`
        );
        console.log(
            '  stages',
            Object.fromEntries(
                Object.entries(trace.stages).map(([k, v]) => [k, `${v.ms}ms`])
            )
        );
    } catch (error) {
        results.push({
            label: scenario.label,
            ok: false,
            totalMs: Date.now() - t0,
            message: error instanceof Error ? error.message : String(error),
            stages: trace.stages,
            ...metrics,
        });
        console.error(`FAIL ${scenario.label}:`, error);
    }
}

await closeHtmlPdfBrowser();
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
console.log(`\nWrote ${OUT}`);

const slowest = [...results].filter((r) => r.ok).sort((a, b) => b.totalMs - a.totalMs)[0];
const noImg = results.find((r) => r.label === 'large-60-no-images');
const withImg = results.find((r) => r.label === 'large-60');
if (slowest) {
    console.log(`\nSlowest: ${slowest.label} (${slowest.totalMs}ms)`);
}
if (withImg?.ok && noImg?.ok) {
    console.log(
        `Image impact @60: with=${withImg.totalMs}ms without=${noImg.totalMs}ms delta=${withImg.totalMs - noImg.totalMs}ms`
    );
}
