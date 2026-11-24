/**
 * Elevate workout PDF — Warm-up / Main / Cardio section checks + sample PDFs.
 * Run: node scripts/test-elevate-workout-sections.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import {
    buildElevateWorkoutHtml,
    deriveElevateViewModel,
} from '../src/modules/plan-exports/templates/elevate/page.js';
import { buildClassicWorkoutHtml } from '../src/modules/plan-exports/templates/classic/workout.js';
import { renderElevateWorkoutPdf } from '../src/modules/plan-exports/templates/elevate/index.js';
import { renderClassicWorkoutPdf } from '../src/modules/plan-exports/templates/classic/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIXTURE_SECTIONS = join(
    ROOT,
    'src/modules/plan-exports/studio/fixtures/workout-sections.json'
);
const FIXTURE_BASIC = join(
    ROOT,
    'src/modules/plan-exports/studio/fixtures/workout-basic.json'
);
const OUT_DIR = join(ROOT, 'tmp/pdf-samples');

const results = [];
const pass = (name) => results.push({ name, ok: true });
const fail = (name, detail) => results.push({ name, ok: false, detail });

const loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const cloneDay = (overrides = {}) => ({
    dayNumber: 1,
    name: 'Test Day',
    description: null,
    warmupActivities: [],
    exercises: [
        {
            name: 'Squat',
            order: 1,
            restBetweenSets: 90,
            notes: null,
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
    ...overrides,
});

const modelFromDays = (days, planName = 'Section Test') => ({
    type: 'workout',
    plan: {
        id: 'test',
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
    const fixture = loadJson(FIXTURE_SECTIONS);
    const view = deriveElevateViewModel(fixture);
    const dayA = view.detailWorkouts[0];
    const dayB = view.detailWorkouts[1];

    if (
        dayA?.sections?.map((s) => s.id).join(',') === 'warmup,main,cardio' &&
        dayA.activityCount === 9 &&
        dayA.meta === '9 exercises'
    ) {
        pass('all three sections mapped on day A');
    } else {
        fail(
            'all three sections mapped on day A',
            JSON.stringify({
                ids: dayA?.sections?.map((s) => s.id),
                activityCount: dayA?.activityCount,
                meta: dayA?.meta,
            })
        );
    }

    const warmupRows = dayA.sections.find((s) => s.id === 'warmup')?.rows || [];
    const warmupRow = warmupRows[0];
    const warmupLinked = warmupRows[1];
    if (
        warmupRow?.usesMetricSpan === true &&
        warmupRow?.metricLabel === '2 min' &&
        warmupRow?.checkboxCount === 1 &&
        !warmupRow?.imageUrl &&
        !warmupRow?.publicUrl
    ) {
        pass('warm-up uses duration metric (not fabricated sets)');
    } else {
        fail('warm-up uses duration metric (not fabricated sets)', JSON.stringify(warmupRow));
    }

    if (
        warmupLinked?.imageUrl?.includes('band-pull-apart.png') &&
        typeof warmupLinked?.publicUrl === 'string' &&
        warmupLinked.publicUrl.includes('/exercises/band-pull-apart')
    ) {
        pass('warm-up linked exercise gets image + public URL');
    } else {
        fail(
            'warm-up linked exercise gets image + public URL',
            JSON.stringify({
                imageUrl: warmupLinked?.imageUrl,
                publicUrl: warmupLinked?.publicUrl,
            })
        );
    }

    const mainRow = dayA.sections.find((s) => s.id === 'main')?.rows?.[0];
    const mainFiveSets = dayA.sections
        .find((s) => s.id === 'main')
        ?.rows?.find((r) => r.name === 'Bent-Over Two-Dumbbell Row');
    if (
        mainRow?.usesMetricSpan === false &&
        mainRow?.setCountLabel === '3' &&
        mainRow?.repsLabel === '10' &&
        mainRow?.checkboxCount === 3 &&
        mainFiveSets?.checkboxCount === 5
    ) {
        pass('main keeps sets/reps/ticks');
    } else {
        fail(
            'main keeps sets/reps/ticks',
            JSON.stringify({ mainRow, five: mainFiveSets?.checkboxCount })
        );
    }

    const cardioRows = dayA.sections.find((s) => s.id === 'cardio')?.rows || [];
    const cardioRow = cardioRows[0];
    const cardioUnlinked = cardioRows[1];
    if (
        cardioRow?.metricLabel === '15 min' &&
        String(cardioRow?.notes || '').includes('Moderate') &&
        cardioRow?.imageUrl?.includes('treadmill.png') &&
        typeof cardioRow?.publicUrl === 'string' &&
        cardioRow.publicUrl.includes('/exercises/treadmill-brisk-walk') &&
        !cardioUnlinked?.imageUrl &&
        !cardioUnlinked?.publicUrl
    ) {
        pass('cardio duration + notes mapped');
    } else {
        fail('cardio duration + notes mapped', JSON.stringify({ cardioRow, cardioUnlinked }));
    }

    if (
        dayB?.sections?.map((s) => s.id).join(',') === 'main,cardio' &&
        !dayB.sections.some((s) => s.id === 'warmup')
    ) {
        pass('empty warm-up section omitted on day B');
    } else {
        fail(
            'empty warm-up section omitted on day B',
            JSON.stringify(dayB?.sections?.map((s) => s.id))
        );
    }

    const mainOnly = deriveElevateViewModel(
        modelFromDays([cloneDay({ warmupActivities: [], cardioActivities: [] })])
    );
    if (mainOnly.detailWorkouts[0]?.sections?.map((s) => s.id).join(',') === 'main') {
        pass('main-only plan hides warm-up and cardio');
    } else {
        fail(
            'main-only plan hides warm-up and cardio',
            JSON.stringify(mainOnly.detailWorkouts[0]?.sections)
        );
    }

    const warmMain = deriveElevateViewModel(
        modelFromDays([
            cloneDay({
                cardioActivities: [],
                warmupActivities: [
                    {
                        activityType: 'walking',
                        name: 'Easy Walk',
                        order: 1,
                        durationMinutes: 5,
                        intensity: 'low',
                        notes: null,
                    },
                ],
            }),
        ])
    );
    if (warmMain.detailWorkouts[0]?.sections?.map((s) => s.id).join(',') === 'warmup,main') {
        pass('warm-up + main combination');
    } else {
        fail(
            'warm-up + main combination',
            JSON.stringify(warmMain.detailWorkouts[0]?.sections?.map((s) => s.id))
        );
    }

    if (view.detailPages?.length >= 1 && view.totalPageCount >= 3) {
        pass('pagination produces detail pages');
    } else {
        fail(
            'pagination produces detail pages',
            JSON.stringify({
                detailPages: view.detailPages?.length,
                totalPageCount: view.totalPageCount,
            })
        );
    }
}

function assertHtmlContracts() {
    const fixture = loadJson(FIXTURE_SECTIONS);
    const html = buildElevateWorkoutHtml(fixture);

    const checks = [
        ['elevate html has Warm-up label', /Warm-up/],
        ['elevate html has Main label', />\s*Main\s*</],
        ['elevate html has Cardio label', /Cardio/],
        ['elevate html has section head warm-up', /details-section-head--warmup/],
        ['elevate html has section head main', /details-section-head--main/],
        ['elevate html has section head cardio', /details-section-head--cardio/],
        ['elevate html has duration/done on section bar', /details-section-col-duration[\s\S]*Duration[\s\S]*details-section-col-done[\s\S]*Done/],
        ['elevate html has sets/reps/ticks on main bar', /details-section-head--main[\s\S]*details-section-col-sets[\s\S]*Sets[\s\S]*details-section-col-reps[\s\S]*Reps[\s\S]*details-section-col-ticks[\s\S]*Tick each set/],
        ['elevate html has activity table', /details-table--activity/],
        ['elevate html has strength table', /details-table--strength/],
        ['elevate html has no global day thead', /details-card-head[\s\S]*?details-card-body--sections/],
        ['elevate html has Barbell Squat', /Barbell Squat/],
        ['elevate html has Arm Circles', /Arm Circles/],
        ['elevate html has treadmill', /Treadmill, brisk walk/],
        [
            'elevate html links warm-up library activity',
            /details-section--warmup[\s\S]*details-ex-link[\s\S]*band-pull-apart/,
        ],
        [
            'elevate html shows warm-up library image',
            /details-section--warmup[\s\S]*band-pull-apart\.png/,
        ],
        [
            'elevate html keeps warm-up fallback icon',
            /details-section--warmup[\s\S]*details-thumb-icon--warmup/,
        ],
        [
            'elevate html links cardio library activity',
            /details-section--cardio[\s\S]*details-ex-link[\s\S]*treadmill-brisk-walk/,
        ],
        [
            'elevate html shows cardio library image',
            /details-section--cardio[\s\S]*treadmill\.png/,
        ],
        [
            'elevate html keeps cardio fallback icon',
            /details-section--cardio[\s\S]*details-thumb-icon--cardio/,
        ],
    ];

    for (const [name, re] of checks) {
        if (re.test(html)) pass(name);
        else fail(name, 'pattern not found');
    }

    if (!/details-section-count/.test(html)) {
        pass('elevate html has no section exercise counts');
    } else {
        fail('elevate html has no section exercise counts', 'details-section-count still present');
    }

    const stackMatch = html.match(
        /data-elevate="workout-details-stack">([\s\S]*?)<footer class="details-footer">/i
    );
    const stack = stackMatch?.[1] || '';
    if (
        !/<thead[\s>]/i.test(stack) &&
        !/details-col-activity/.test(stack) &&
        !/details-col-exercise/.test(stack)
    ) {
        pass('elevate html has no duplicate table column headers');
    } else {
        fail(
            'elevate html has no duplicate table column headers',
            'internal thead / col headers still present'
        );
    }

    const basic = loadJson(FIXTURE_BASIC);
    const basicHtml = buildElevateWorkoutHtml(basic);
    const basicStackMatch = basicHtml.match(
        /data-elevate="workout-details-stack">([\s\S]*?)<footer class="details-footer">/i
    );
    const basicStack = basicStackMatch?.[1] || '';
    if (
        /Goblet Squat/.test(basicStack) &&
        /details-section-head--main/.test(basicStack) &&
        !/details-section-head--warmup/.test(basicStack) &&
        !/details-section-head--cardio/.test(basicStack) &&
        !/Arm Circles/.test(basicStack)
    ) {
        pass('basic fixture renders Main only (no empty sections)');
    } else {
        fail(
            'basic fixture renders Main only (no empty sections)',
            `stack markers unexpected (len=${basicStack.length})`
        );
    }

    const classicHtml = buildClassicWorkoutHtml(fixture);
    if (
        /Warm-up/.test(classicHtml) &&
        /Cardio/.test(classicHtml) &&
        /Arm Circles/.test(classicHtml) &&
        /15 min/.test(classicHtml)
    ) {
        pass('classic html includes warm-up and cardio');
    } else {
        fail('classic html includes warm-up and cardio', 'missing labels or duration');
    }
}

async function generateSamples() {
    mkdirSync(OUT_DIR, { recursive: true });
    const fixture = loadJson(FIXTURE_SECTIONS);
    const basic = loadJson(FIXTURE_BASIC);

    const elevateSections = await renderElevateWorkoutPdf(fixture);
    const elevateBasic = await renderElevateWorkoutPdf(basic);
    const classicSections = await renderClassicWorkoutPdf(fixture);

    const paths = {
        elevateSections: join(OUT_DIR, 'elevate-workout-sections.pdf'),
        elevateBasic: join(OUT_DIR, 'elevate-workout-main-only.pdf'),
        classicSections: join(OUT_DIR, 'classic-workout-sections.pdf'),
    };

    writeFileSync(paths.elevateSections, elevateSections);
    writeFileSync(paths.elevateBasic, elevateBasic);
    writeFileSync(paths.classicSections, classicSections);

    if (elevateSections.length > 1000 && classicSections.length > 1000) {
        pass('PDF samples generated');
    } else {
        fail('PDF samples generated', 'PDF buffers too small');
    }

    return paths;
}

async function main() {
    console.log('Elevate workout section tests\n');
    assertViewModel();
    assertHtmlContracts();
    let paths = null;
    try {
        paths = await generateSamples();
    } catch (error) {
        fail('PDF samples generated', error.message);
    }

    const failed = results.filter((r) => !r.ok);
    for (const r of results) {
        console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (paths) {
        console.log('\nSamples:');
        for (const [key, path] of Object.entries(paths)) {
            console.log(`  ${key}: ${path}`);
        }
    }
    if (failed.length) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
