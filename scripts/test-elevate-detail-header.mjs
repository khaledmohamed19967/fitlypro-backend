/**
 * Elevate PDF — single-line WORKOUT PLAN title; intro only on first detail page.
 * Run: node scripts/test-elevate-detail-header.mjs
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

import {
    buildElevateWorkoutHtml,
    deriveElevateViewModel,
} from '../src/modules/plan-exports/templates/elevate/page.js';
import { renderElevateWorkoutPdf } from '../src/modules/plan-exports/templates/elevate/index.js';
import { applyElevateWorkoutContentPageSizes } from '../src/modules/plan-exports/templates/elevate/contentPageSizes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'tmp/pdf-samples');

const results = [];
const pass = (name) => results.push({ name, ok: true });
const fail = (name, detail) => results.push({ name, ok: false, detail });

const strength = (name, order) => ({
    name,
    order,
    restBetweenSets: 90,
    notes: null,
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

const model = {
    type: 'workout',
    plan: {
        id: 'header-probe',
        name: 'Header Probe',
        duration: 4,
        daysPerWeek: 3,
        goal: 'general_fitness',
        level: 'beginner',
        notes: null,
        status: 'active',
        isTemplate: false,
        totalExercises: 6,
        totalDays: 3,
    },
    trainer: { id: 't', fullName: 'Coach', email: null, phone: null },
    content: {
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Push Day',
                description: null,
                warmupActivities: [
                    {
                        activityType: 'mobility',
                        name: 'Arm Circles',
                        order: 1,
                        durationMinutes: 3,
                        intensity: 'low',
                        notes: null,
                    },
                ],
                exercises: [strength('Bench Press', 1), strength('OHP', 2)],
                cardioActivities: [],
            },
            {
                dayNumber: 2,
                name: 'Pull Day',
                description: null,
                warmupActivities: [],
                exercises: [strength('Barbell Row', 1), strength('Curl', 2)],
                cardioActivities: [],
            },
            {
                dayNumber: 3,
                name: 'Leg Day',
                description: null,
                warmupActivities: [],
                exercises: [strength('Squat', 1), strength('RDL', 2)],
                cardioActivities: [
                    {
                        activityType: 'steady_state',
                        name: 'Bike',
                        order: 1,
                        durationMinutes: 10,
                        intensity: 'moderate',
                        protocol: 'steady',
                        notes: null,
                    },
                ],
            },
        ],
    },
};

mkdirSync(OUT_DIR, { recursive: true });
const view = deriveElevateViewModel(model);
const html = buildElevateWorkoutHtml(model);
writeFileSync(join(OUT_DIR, 'elevate-detail-header.html'), html, 'utf8');

const detailSections = [
    ...html.matchAll(
        /<section class="page page-workout-details[^"]*"[^>]*>([\s\S]*?)<footer class="details-footer">/g
    ),
].map((m) => m[1]);

if (detailSections.length === view.detailPages.length && detailSections.length >= 3) {
    pass(`detail pages rendered (${detailSections.length})`);
} else {
    fail(
        `detail pages rendered`,
        `html=${detailSections.length} view=${view.detailPages.length}`
    );
}

const titleCounts = detailSections.map(
    (s) => (s.match(/class="details-title"/g) || []).length
);
const dekCounts = detailSections.map(
    (s) => (s.match(/class="details-dek"/g) || []).length
);
const compactFlags = [
    ...html.matchAll(/<section class="(page page-workout-details[^"]*)"/g),
].map((m) => m[1].includes('page-workout-details--compact'));

if (
    titleCounts[0] === 1 &&
    titleCounts.slice(1).every((n) => n === 0) &&
    dekCounts[0] === 1 &&
    dekCounts.slice(1).every((n) => n === 0)
) {
    pass('WORKOUT PLAN title + dek only on first detail page');
} else {
    fail(
        'WORKOUT PLAN title + dek only on first detail page',
        JSON.stringify({ titleCounts, dekCounts })
    );
}

if (compactFlags[0] === false && compactFlags.slice(1).every(Boolean)) {
    pass('subsequent detail pages use compact class');
} else {
    fail('subsequent detail pages use compact class', JSON.stringify(compactFlags));
}

if (
    /class="details-title">WORKOUT <span>PLAN<\/span><\/h1>/.test(html) &&
    !/details-title">\s*WORKOUT\s*<br/i.test(html)
) {
    pass('title markup is single-line WORKOUT PLAN');
} else {
    fail('title markup is single-line WORKOUT PLAN', 'br or markup mismatch');
}

const dekText = 'Warm-up, main exercises, and cardio. Tick a box for every set you finish.';
const dekOccurrences = (html.match(new RegExp(dekText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || [])
    .length;
if (dekOccurrences === 1) {
    pass('description text appears once in HTML');
} else {
    fail('description text appears once in HTML', String(dekOccurrences));
}

if (/>\s*Exercise\s*</.test(html) && !/>\s*Main\s*</.test(html)) {
    pass('Exercise label preserved');
} else {
    fail('Exercise label preserved', 'label regression');
}

// Visual / geometry checks via Chromium
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
    viewport: { width: 900, height: 1600 },
    deviceScaleFactor: 1.5,
});
await page.setContent(html, { waitUntil: 'domcontentloaded' });
await applyElevateWorkoutContentPageSizes(page);

const geometry = await page.evaluate(() => {
    const pages = Array.from(
        document.querySelectorAll('section.page-workout-details')
    );
    return pages.map((el, index) => {
        const title = el.querySelector('.details-title');
        const dek = el.querySelector('.details-dek');
        const card = el.querySelector('.details-card');
        const titleBox = title?.getBoundingClientRect();
        const dekBox = dek?.getBoundingClientRect();
        const cardBox = card?.getBoundingClientRect();
        const titleOneLine = title
            ? title.getBoundingClientRect().height < 40
            : null;
        const titleText = title?.textContent?.replace(/\s+/g, ' ').trim() || null;
        return {
            index,
            compact: el.classList.contains('page-workout-details--compact'),
            hasTitle: Boolean(title),
            hasDek: Boolean(dek),
            titleText,
            titleOneLine,
            titleBottom: titleBox ? titleBox.bottom : null,
            dekTop: dekBox ? dekBox.top : null,
            cardTop: cardBox ? cardBox.top : null,
            overlapTitleDek:
                titleBox && dekBox
                    ? titleBox.bottom > dekBox.top + 1
                    : false,
        };
    });
});

const first = geometry[0];
if (
    first?.hasTitle &&
    first.titleText === 'WORKOUT PLAN' &&
    first.titleOneLine === true &&
    first.overlapTitleDek === false &&
    first.cardTop > first.dekTop
) {
    pass('first page: single-line title, no overlap, card below dek');
} else {
    fail('first page: single-line title, no overlap, card below dek', JSON.stringify(first));
}

if (
    geometry.slice(1).every(
        (g) => g.compact && !g.hasTitle && !g.hasDek && g.cardTop != null
    )
) {
    pass('later pages: no title/dek, card present');
} else {
    fail('later pages: no title/dek, card present', JSON.stringify(geometry.slice(1)));
}

for (let i = 0; i < Math.min(geometry.length, 3); i += 1) {
    await page
        .locator('section.page-workout-details')
        .nth(i)
        .screenshot({
            path: join(
                OUT_DIR,
                `elevate-detail-header-p${String(i + 3).padStart(2, '0')}.png`
            ),
        });
}

await browser.close();

const pdf = await renderElevateWorkoutPdf(model);
writeFileSync(join(OUT_DIR, 'elevate-detail-header.pdf'), pdf);
if (pdf.length > 1000) pass('multi-page PDF generated');
else fail('multi-page PDF generated', String(pdf.length));

console.log('\nElevate detail header checks:');
for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log('\nGeometry:', JSON.stringify(geometry, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
process.exit(process.exitCode || 0);
