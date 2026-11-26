/**
 * Elevate PDF — Rest Day overview rows + no empty detail pages.
 * Run: node scripts/test-elevate-rest-days.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import {
    buildElevateWorkoutHtml,
    deriveElevateViewModel,
} from '../src/modules/plan-exports/templates/elevate/page.js';
import { renderElevateWorkoutPdf } from '../src/modules/plan-exports/templates/elevate/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp/pdf-samples');

const results = [];
const pass = (name) => results.push({ name, ok: true });
const fail = (name, detail) => results.push({ name, ok: false, detail });

const trainingDay = (dayNumber, name, exerciseName = 'Squat') => ({
    dayNumber,
    name,
    description: null,
    warmupActivities: [],
    exercises: [
        {
            name: exerciseName,
            order: 1,
            restBetweenSets: 90,
            notes: null,
            muscles: { primary: 'Legs', secondary: [] },
            sets: [
                {
                    setNumber: 1,
                    reps: 8,
                    weight: 50,
                    weightUnit: 'kg',
                    isWarmup: false,
                    isDropset: false,
                },
            ],
        },
    ],
    cardioActivities: [],
});

const restDay = (dayNumber, name = 'Rest day') => ({
    dayNumber,
    name,
    description: null,
    warmupActivities: [],
    exercises: [],
    cardioActivities: [],
});

const modelFromDays = (days, planName = 'Rest Day Probe') => ({
    type: 'workout',
    plan: {
        id: 'rest-probe',
        name: planName,
        duration: 4,
        daysPerWeek: days.length,
        goal: 'general_fitness',
        level: 'beginner',
        notes: null,
        status: 'active',
        isTemplate: false,
        totalExercises: days.reduce(
            (sum, day) => sum + (day.exercises?.length || 0),
            0
        ),
        totalDays: days.length,
    },
    trainer: { id: 't', fullName: 'Coach', email: null, phone: null },
    content: { workoutDays: days },
});

function assertViewModel() {
    const days = [
        trainingDay(1, 'Full Body A', 'Goblet Squat'),
        trainingDay(2, 'Full Body B', 'Push-Up'),
        restDay(3),
        trainingDay(4, 'Full Body C', 'Row'),
        restDay(5, 'Rest day'),
    ];
    const view = deriveElevateViewModel(modelFromDays(days));

    const summaries = view.workoutSummaries;
    if (summaries.length === 5) pass('overview includes all 5 schedule rows');
    else fail('overview includes all 5 schedule rows', String(summaries.length));

    const restRows = summaries.filter((row) => row.isRest);
    if (
        restRows.length === 2 &&
        restRows.every(
            (row) =>
                row.name === 'Rest Day' &&
                row.meta === 'Take a long day recovery and rest' &&
                row.muscles.length === 0 &&
                row.exerciseCount === 0
        )
    ) {
        pass('rest rows use Rest Day title + recovery copy');
    } else {
        fail('rest rows use Rest Day title + recovery copy', JSON.stringify(restRows));
    }

    if (summaries[2]?.letter === 'C' && summaries[4]?.letter === 'E') {
        pass('rest days keep sequence letters C and E');
    } else {
        fail(
            'rest days keep sequence letters C and E',
            JSON.stringify(summaries.map((r) => ({ letter: r.letter, isRest: r.isRest })))
        );
    }

    if (
        view.workoutCount === 3 &&
        view.workoutsValue === '3 · A, B, D' &&
        view.pickStepDetail === 'A, B, D — any order'
    ) {
        pass('cover/training counts exclude rest days');
    } else {
        fail(
            'cover/training counts exclude rest days',
            JSON.stringify({
                count: view.workoutCount,
                workoutsValue: view.workoutsValue,
                pickStepDetail: view.pickStepDetail,
            })
        );
    }

    if (
        view.detailWorkouts.length === 3 &&
        view.detailWorkouts.every((w) => w.activityCount > 0) &&
        view.detailWorkouts.map((w) => w.letter).join(',') === 'A,B,D'
    ) {
        pass('detail pages only for training days A,B,D');
    } else {
        fail(
            'detail pages only for training days A,B,D',
            JSON.stringify(
                view.detailWorkouts.map((w) => ({
                    letter: w.letter,
                    activityCount: w.activityCount,
                }))
            )
        );
    }

    const html = buildElevateWorkoutHtml(modelFromDays(days));
    const restArticles = (html.match(/class="workout-row is-rest"/g) || []).length;
    if (restArticles === 2) pass('HTML renders two muted rest overview rows');
    else fail('HTML renders two muted rest overview rows', String(restArticles));

    if (
        html.includes('Take a long day recovery and rest') &&
        !html.includes('0 exercises · 0 sets')
    ) {
        pass('rest meta replaces exercise/set counts');
    } else {
        fail('rest meta replaces exercise/set counts', 'missing recovery copy or still showing 0 sets');
    }

    // Named "Rest Day" with exercises must still be training (title alone is not enough).
    const namedOnly = deriveElevateViewModel(
        modelFromDays([
            {
                ...trainingDay(1, 'Rest Day', 'Deadlift'),
            },
        ])
    );
    if (
        namedOnly.workoutSummaries[0]?.isRest === false &&
        namedOnly.detailWorkouts.length === 1
    ) {
        pass('title alone does not mark a training day as rest');
    } else {
        fail('title alone does not mark a training day as rest', 'false positive rest');
    }
}

async function writeSamplePdf() {
    mkdirSync(OUT_DIR, { recursive: true });
    const days = [
        trainingDay(1, 'Full Body A', 'Goblet Squat'),
        restDay(2),
        trainingDay(3, 'Full Body B', 'Push-Up'),
        restDay(4),
    ];
    const model = modelFromDays(days, 'Full Body + Rest Days');
    const view = deriveElevateViewModel(model);
    const html = buildElevateWorkoutHtml(model);
    const htmlPath = join(OUT_DIR, 'elevate-rest-days.html');
    const pdfPath = join(OUT_DIR, 'elevate-rest-days.pdf');
    writeFileSync(htmlPath, html, 'utf8');

    const pdf = await renderElevateWorkoutPdf(model);
    writeFileSync(pdfPath, pdf);

    const expectedDetailPages = view.detailPages.length;
    const expectedTotal = 2 + expectedDetailPages;
    if (view.workoutSummaries.filter((r) => r.isRest).length === 2) {
        pass('sample model has workout + rest + workout + rest');
    } else {
        fail('sample model has workout + rest + workout + rest', 'summary mismatch');
    }
    if (view.detailWorkouts.length === 2) {
        pass('sample has no rest detail workouts');
    } else {
        fail('sample has no rest detail workouts', String(view.detailWorkouts.length));
    }
    if (expectedTotal >= 3 && expectedDetailPages >= 1) {
        pass(
            `sample page count coherent (total=${expectedTotal}, detail=${expectedDetailPages})`
        );
    } else {
        fail('sample page count coherent', String(expectedTotal));
    }
    if (pdf?.length > 1000) pass(`wrote PDF (${pdf.length} bytes) → ${pdfPath}`);
    else fail('wrote PDF', 'empty or tiny buffer');

    return { pdfPath, htmlPath, view };
}

assertViewModel();
const sample = await writeSamplePdf();

console.log('\nElevate Rest Day checks:');
for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
const failed = results.filter((r) => !r.ok);
console.log(
    `\n${results.length - failed.length}/${results.length} passed` +
        (sample?.pdfPath ? `\nPDF: ${sample.pdfPath}` : '')
);
if (failed.length) process.exitCode = 1;
