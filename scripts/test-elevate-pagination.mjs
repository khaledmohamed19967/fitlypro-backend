/**
 * Elevate PDF — one page per workout day (Warm-up + Exercise + Cardio together).
 * Run: node scripts/test-elevate-pagination.mjs
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

const warmup = (name, order, minutes = 3) => ({
    activityType: 'mobility',
    name,
    order,
    durationMinutes: minutes,
    intensity: 'low',
    notes: null,
});

const cardio = (name, order, minutes = 10) => ({
    activityType: 'steady_state',
    name,
    order,
    durationMinutes: minutes,
    intensity: 'moderate',
    protocol: 'steady',
    notes: null,
});

const day = (
    dayNumber,
    name,
    { exercises = [], warmupActivities = [], cardioActivities = [] } = {}
) => ({
    dayNumber,
    name,
    description: null,
    warmupActivities,
    exercises,
    cardioActivities,
});

const rest = (dayNumber) =>
    day(dayNumber, 'Rest day', {
        exercises: [],
        warmupActivities: [],
        cardioActivities: [],
    });

const modelFromDays = (days, planName = 'Pagination Probe') => ({
    type: 'workout',
    plan: {
        id: 'pagination-probe',
        name: planName,
        duration: 6,
        daysPerWeek: days.filter(
            (d) =>
                (d.exercises?.length || 0) +
                    (d.warmupActivities?.length || 0) +
                    (d.cardioActivities?.length || 0) >
                0
        ).length,
        goal: 'general_fitness',
        level: 'intermediate',
        notes: null,
        status: 'active',
        isTemplate: false,
        totalExercises: days.reduce((s, d) => s + (d.exercises?.length || 0), 0),
        totalDays: days.length,
    },
    trainer: { id: 't', fullName: 'Coach', email: null, phone: null },
    content: { workoutDays: days },
});

const pageSectionIds = (view) =>
    (view.detailPages || []).map((page) => {
        const block = page.blocks?.[0];
        const sections = block?.sections || [];
        return {
            letter: block?.workout?.letter || null,
            sections: sections.map((s) => s.id),
            sectionKey: sections.map((s) => s.id).join('+') || null,
            continued: Boolean(block?.continued),
            blockCount: page.blocks?.length || 0,
            sectionCount: sections.length,
            rowCount: sections.reduce((sum, s) => sum + (s.rows?.length || 0), 0),
        };
    });

function assertPushPullLegs() {
    const days = [
        day(1, 'Push Day', {
            exercises: [
                strength('Bench Press', 1),
                strength('Overhead Press', 2),
                strength('Lateral Raise', 3),
            ],
        }),
        day(2, 'Pull Day', {
            exercises: [strength('Barbell Row', 1), strength('Lat Pulldown', 2)],
        }),
        day(3, 'Leg Day', {
            exercises: [
                strength('Squat', 1),
                strength('Romanian Deadlift', 2),
                strength('Leg Press', 3),
            ],
        }),
    ];
    const view = deriveElevateViewModel(modelFromDays(days, 'Push Pull Legs'));
    const pages = pageSectionIds(view);

    if (
        pages.length === 3 &&
        pages.every((p) => p.blockCount === 1 && p.sectionKey === 'main') &&
        pages.map((p) => p.letter).join(',') === 'A,B,C'
    ) {
        pass('Push/Pull/Leg each get a dedicated workout page');
    } else {
        fail('Push/Pull/Leg each get a dedicated workout page', JSON.stringify(pages));
    }
}

function assertWarmupExerciseCardioTogether() {
    const days = [
        day(1, 'Push Day', {
            warmupActivities: [warmup('Arm Circles', 1), warmup('Band Pull-Apart', 2)],
            exercises: [strength('Goblet Squat', 1), strength('Push-Up', 2)],
            cardioActivities: [cardio('Treadmill', 1), cardio('Bike', 2)],
        }),
    ];
    const view = deriveElevateViewModel(modelFromDays(days, 'Unified Push'));
    const pages = pageSectionIds(view);

    if (
        pages.length === 1 &&
        pages[0].sectionKey === 'warmup+main+cardio' &&
        pages[0].letter === 'A' &&
        !pages[0].continued
    ) {
        pass('Warm-up + Exercise + Cardio stay on one Push Day page');
    } else {
        fail(
            'Warm-up + Exercise + Cardio stay on one Push Day page',
            JSON.stringify(pages)
        );
    }
}

function assertRestDaysNoEmptyPages() {
    const days = [
        day(1, 'Upper Day', { exercises: [strength('Pull-Up', 1)] }),
        rest(2),
        day(3, 'Lower Day', { exercises: [strength('Squat', 1)] }),
        rest(4),
    ];
    const view = deriveElevateViewModel(modelFromDays(days, 'Rest Mixed'));
    const pages = pageSectionIds(view);
    const restSummaries = view.workoutSummaries.filter((r) => r.isRest);

    if (
        restSummaries.length === 2 &&
        pages.length === 2 &&
        pages.map((p) => p.letter).join(',') === 'A,C' &&
        pages.every((p) => p.sectionKey === 'main')
    ) {
        pass('Rest Days stay in overview; no empty detail pages');
    } else {
        fail(
            'Rest Days stay in overview; no empty detail pages',
            JSON.stringify({ restSummaries: restSummaries.length, pages })
        );
    }
}

function assertOverflowContinuation() {
    const many = Array.from({ length: 20 }, (_, i) =>
        strength(`Exercise ${i + 1}`, i + 1, 4)
    );
    const view = deriveElevateViewModel(
        modelFromDays([day(1, 'Volume Day', { exercises: many })], 'Overflow Probe')
    );
    const pages = pageSectionIds(view);

    if (
        pages.length >= 2 &&
        pages.every((p) => p.sectionKey === 'main' && p.letter === 'A' && p.blockCount === 1) &&
        pages[0].continued === false &&
        pages.slice(1).every((p) => p.continued === true) &&
        pages.reduce((sum, p) => sum + p.rowCount, 0) === 20
    ) {
        pass('oversized workout continues at row boundaries');
    } else {
        fail('oversized workout continues at row boundaries', JSON.stringify(pages));
    }
}

function assertWorkoutDayPages() {
    const days = [
        day(1, 'Push Day', {
            warmupActivities: [warmup('Jumping Jacks', 1)],
            exercises: [strength('Bench', 1)],
            cardioActivities: [cardio('Row Erg', 1)],
        }),
        day(2, 'Pull Day', {
            exercises: [strength('Row', 1)],
            cardioActivities: [cardio('Assault Bike', 1)],
        }),
        day(3, 'Leg Day', {
            warmupActivities: [warmup('Leg Swings', 1)],
            exercises: [strength('Squat', 1), strength('RDL', 2)],
            cardioActivities: [cardio('Bike', 1)],
        }),
    ];
    const view = deriveElevateViewModel(modelFromDays(days, 'PPL Unified'));
    const pages = pageSectionIds(view);
    const html = buildElevateWorkoutHtml(modelFromDays(days, 'PPL Unified'));
    const detailOpens = (
        html.match(/<section class="page page-workout-details[^"]*"/g) || []
    ).length;

    // Each detail page should contain exactly one workout card.
    const stacks = html.split('data-elevate="workout-details-stack">').slice(1);
    const multiCardStacks = stacks.filter((chunk) => {
        const beforeFooter = chunk.split('<footer class="details-footer">')[0] || '';
        return (beforeFooter.match(/class="details-card /g) || []).length > 1;
    }).length;

    // First stack (Push) should include all three section types together.
    const firstStack = stacks[0]?.split('<footer class="details-footer">')[0] || '';
    const firstHasWarmup = /details-section--warmup/.test(firstStack);
    const firstHasMain = /details-section--main/.test(firstStack);
    const firstHasCardio = /details-section--cardio/.test(firstStack);

    if (
        pages.length === 3 &&
        pages.map((p) => `${p.letter}:${p.sectionKey}`).join('|') ===
            'A:warmup+main+cardio|B:main+cardio|C:warmup+main+cardio' &&
        detailOpens === 3 &&
        multiCardStacks === 0 &&
        firstHasWarmup &&
        firstHasMain &&
        firstHasCardio
    ) {
        pass('each workout day is one page with all its sections');
    } else {
        fail(
            'each workout day is one page with all its sections',
            JSON.stringify({
                pages,
                detailOpens,
                multiCardStacks,
                firstHasWarmup,
                firstHasMain,
                firstHasCardio,
            })
        );
    }

    if (!/>\s*Main\s*</.test(html) && />\s*Exercise\s*</.test(html)) {
        pass('Exercise label preserved (not Main)');
    } else {
        fail('Exercise label preserved (not Main)', 'label regression');
    }

    if (
        html.includes('workout-row is-rest') === false &&
        view.workoutSummaries.every((r) => !r.isRest)
    ) {
        pass('no accidental rest rows in this training-only plan');
    } else {
        fail('no accidental rest rows in this training-only plan', 'unexpected rest');
    }
}

async function writeSamples() {
    mkdirSync(OUT_DIR, { recursive: true });

    const plans = [
        {
            name: 'elevate-pagination-ppl.pdf',
            model: modelFromDays(
                [
                    day(1, 'Push Day', {
                        warmupActivities: [warmup('Arm Circles', 1)],
                        exercises: [
                            strength('Bench Press', 1),
                            strength('Overhead Press', 2),
                            strength('Tricep Pushdown', 3),
                        ],
                        cardioActivities: [cardio('Bike', 1)],
                    }),
                    day(2, 'Pull Day', {
                        warmupActivities: [warmup('Band Pull-Apart', 1)],
                        exercises: [
                            strength('Barbell Row', 1),
                            strength('Lat Pulldown', 2),
                            strength('Face Pull', 3),
                        ],
                        cardioActivities: [cardio('Rower', 1)],
                    }),
                    day(3, 'Leg Day', {
                        warmupActivities: [warmup('Leg Swings', 1)],
                        exercises: [
                            strength('Back Squat', 1),
                            strength('Romanian Deadlift', 2),
                            strength('Walking Lunge', 3),
                        ],
                        cardioActivities: [cardio('Treadmill', 1)],
                    }),
                ],
                'Push Pull Legs'
            ),
        },
        {
            name: 'elevate-pagination-sections.pdf',
            model: modelFromDays(
                [
                    day(1, 'Full Body A', {
                        warmupActivities: [
                            warmup('Arm Circles', 1),
                            warmup('Hip Openers', 2),
                        ],
                        exercises: [
                            strength('Goblet Squat', 1),
                            strength('Push-Up', 2),
                            strength('Dumbbell Row', 3),
                        ],
                        cardioActivities: [cardio('Treadmill', 1), cardio('Bike', 2)],
                    }),
                    rest(2),
                    day(3, 'Full Body B', {
                        exercises: [strength('Deadlift', 1), strength('Pull-Up', 2)],
                        cardioActivities: [cardio('Rower', 1)],
                    }),
                ],
                'Sections + Rest'
            ),
        },
        {
            name: 'elevate-pagination-overflow.pdf',
            model: modelFromDays(
                [
                    day(1, 'Volume Day', {
                        exercises: Array.from({ length: 18 }, (_, i) =>
                            strength(`Volume Lift ${i + 1}`, i + 1, 5)
                        ),
                    }),
                ],
                'Overflow Volume'
            ),
        },
    ];

    const written = [];
    for (const plan of plans) {
        const view = deriveElevateViewModel(plan.model);
        const html = buildElevateWorkoutHtml(plan.model);
        const pdf = await renderElevateWorkoutPdf(plan.model);
        const pdfPath = join(OUT_DIR, plan.name);
        const htmlPath = join(OUT_DIR, plan.name.replace(/\.pdf$/, '.html'));
        writeFileSync(htmlPath, html, 'utf8');
        writeFileSync(pdfPath, pdf);
        written.push({
            name: plan.name,
            bytes: pdf.length,
            detailPages: view.detailPages.length,
            totalPages: view.totalPageCount,
            structure: pageSectionIds(view),
        });
    }

    if (written.every((w) => w.bytes > 1000)) pass('sample PDFs generated');
    else fail('sample PDFs generated', JSON.stringify(written.map((w) => w.bytes)));

    return written;
}

assertPushPullLegs();
assertWarmupExerciseCardioTogether();
assertRestDaysNoEmptyPages();
assertOverflowContinuation();
assertWorkoutDayPages();

const samples = await writeSamples();

console.log('\nElevate pagination checks:');
for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log('\nSamples:');
for (const s of samples) {
    console.log(
        `- ${s.name}: ${s.totalPages} pages (${s.detailPages} detail) · ${s.structure
            .map((p) => `${p.letter}:${p.sectionKey}${p.continued ? '*' : ''}`)
            .join(' → ')}`
    );
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
process.exit(process.exitCode || 0);
