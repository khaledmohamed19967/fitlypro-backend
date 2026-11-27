/**
 * Elevate Nutrition PDF — content height, intro-once titles, meal packing.
 * Run: node scripts/test-elevate-nutrition-layout.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

import {
    buildElevateNutritionHtml,
    deriveElevateNutritionViewModel,
} from '../src/modules/plan-exports/templates/elevate/nutrition.js';
import { renderElevateNutritionPdf } from '../src/modules/plan-exports/templates/elevate/index.js';
import {
    applyElevateNutritionContentPageSizes,
    ELEVATE_A4_HEIGHT_PX,
    ELEVATE_PAGE_WIDTH_PX,
} from '../src/modules/plan-exports/templates/elevate/contentPageSizes.js';
import {
    buildElevateWorkoutHtml,
    deriveElevateViewModel,
} from '../src/modules/plan-exports/templates/elevate/page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp/pdf-samples');
const FIXTURE = join(
    ROOT,
    'src/modules/plan-exports/studio/fixtures/nutrition-basic.json'
);

const results = [];
const pass = (name) => results.push({ name, ok: true });
const fail = (name, detail) => results.push({ name, ok: false, detail });

const food = (name, order, macros = {}) => ({
    name,
    brand: null,
    quantity: 100,
    unit: 'g',
    notes: null,
    itemMacros: {
        calories: macros.calories ?? 100,
        protein: macros.protein ?? 10,
        carbs: macros.carbs ?? 10,
        fat: macros.fat ?? 2,
    },
});

const meal = (order, name, mealType, foods) => ({
    order,
    name,
    mealType,
    suggestedTime: '12:00',
    notes: null,
    mealTotals: {
        calories: foods.reduce((s, f) => s + (f.itemMacros?.calories || 0), 0),
        protein: foods.reduce((s, f) => s + (f.itemMacros?.protein || 0), 0),
        carbs: foods.reduce((s, f) => s + (f.itemMacros?.carbs || 0), 0),
        fat: foods.reduce((s, f) => s + (f.itemMacros?.fat || 0), 0),
    },
    foodItems: foods,
});

const modelFromMeals = (meals, supplements = [], planName = 'Nutrition Probe') => ({
    type: 'nutrition',
    plan: {
        id: 'nutrition-probe',
        name: planName,
        duration: 4,
        daysCount: 1,
        goal: 'weight_loss',
        scheduleMode: 'daily',
        notes: null,
        status: 'active',
        isTemplate: false,
        totalMeals: meals.length,
        totalFoodItems: meals.reduce((s, m) => s + (m.foodItems?.length || 0), 0),
        avgDailyCalories: 1800,
        macroTargets: { calories: 1800, protein: 140, carbs: 160, fat: 50 },
        computedMacros: {
            avgDailyCalories: 1800,
            avgDailyProtein: 140,
            avgDailyCarbs: 160,
            avgDailyFat: 50,
        },
        supplements: supplements.map((instruction, i) => ({
            id: `s${i + 1}`,
            instruction,
            order: i + 1,
        })),
        vitamins: [],
    },
    trainer: { id: 't', fullName: 'Coach', email: null, phone: null },
    content: {
        nutritionDays: [
            {
                dayNumber: 1,
                name: 'Training Day',
                notes: null,
                dailyTotals: { calories: 1800, protein: 140, carbs: 160, fat: 50 },
                meals,
            },
        ],
    },
});

const parseMediaBoxes = (pdfBuffer) => {
    const text = pdfBuffer.toString('latin1');
    const boxes = [];
    const re = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g;
    let match;
    while ((match = re.exec(text))) {
        boxes.push({
            widthPt: Math.abs(Number(match[3]) - Number(match[1])),
            heightPt: Math.abs(Number(match[4]) - Number(match[2])),
        });
    }
    return boxes;
};

const pxToPt = (px) => (px * 72) / 96;

mkdirSync(OUT_DIR, { recursive: true });

const basic = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const shortModel = modelFromMeals(
    [
        meal(1, 'Breakfast', 'breakfast', [
            food('Oats', 1),
            food('Egg whites', 2),
        ]),
    ],
    ['Whey protein - 30g'],
    'Short Nutrition'
);

const manyFoods = Array.from({ length: 28 }, (_, i) =>
    food(`Food Item ${i + 1}`, i + 1, { calories: 40 + i })
);
const longMealModel = modelFromMeals(
    [meal(1, 'Feast', 'dinner', manyFoods)],
    Array.from({ length: 12 }, (_, i) => `Supplement ${i + 1} - dose - timing`),
    'Long Meal Nutrition'
);

const multiMealModel = modelFromMeals(
    [
        meal(1, 'Breakfast', 'breakfast', [food('Oats', 1), food('Banana', 2)]),
        meal(2, 'Lunch', 'lunch', [food('Chicken', 1), food('Rice', 2), food('Broccoli', 3)]),
        meal(3, 'Snack', 'snack', [food('Greek Yogurt', 1)]),
        meal(4, 'Dinner', 'dinner', [food('Salmon', 1), food('Potato', 2)]),
    ],
    ['Creatine - 5g - Morning', 'Vitamin D - 2000 IU'],
    'Multi Meal Nutrition'
);

// HTML contracts on multi-meal fixture
const multiHtml = buildElevateNutritionHtml(multiMealModel);
const multiView = deriveElevateNutritionViewModel(multiMealModel);
writeFileSync(join(OUT_DIR, 'elevate-nutrition-multi.html'), multiHtml, 'utf8');

const mealPages = [
    ...multiHtml.matchAll(
        /<section class="page page-nutrition-meals[^"]*"[^>]*>([\s\S]*?)<footer class="details-footer">/g
    ),
].map((m) => m[1]);
const notesPages = [
    ...multiHtml.matchAll(
        /<section class="page page-nutrition-notes[^"]*"[^>]*>([\s\S]*?)<footer class="details-footer">/g
    ),
].map((m) => m[1]);

if (mealPages.length >= 1 && notesPages.length >= 1) {
    pass('meals + notes pages rendered');
} else {
    fail(
        'meals + notes pages rendered',
        JSON.stringify({ meals: mealPages.length, notes: notesPages.length })
    );
}

const mealTitleCounts = mealPages.map(
    (s) => (s.match(/class="details-title"/g) || []).length
);
const notesTitleCounts = notesPages.map(
    (s) => (s.match(/class="details-title"/g) || []).length
);

if (
    mealTitleCounts[0] === 1 &&
    mealTitleCounts.slice(1).every((n) => n === 0) &&
    notesTitleCounts[0] === 1 &&
    notesTitleCounts.slice(1).every((n) => n === 0)
) {
    pass('section titles only on first meals/notes pages');
} else {
    fail(
        'section titles only on first meals/notes pages',
        JSON.stringify({ mealTitleCounts, notesTitleCounts })
    );
}

if (
    /class="details-title">DAILY <span>MEAL PLAN<\/span><\/h1>/.test(multiHtml) &&
    /class="details-title">SUPPLEMENTS <span>&amp; NOTES<\/span><\/h1>/.test(
        multiHtml
    ) &&
    !/details-title">\s*DAILY\s*<br/i.test(multiHtml) &&
    !/details-title">\s*SUPPLEMENTS\s*<br/i.test(multiHtml)
) {
    pass('Nutrition titles are single-line');
} else {
    fail('Nutrition titles are single-line', 'br or markup mismatch');
}

// Whole meals stay together when they fit
const packed = multiView.mealPages || [];
const mealNamesPerPage = packed.map((page) =>
    (page.blocks || []).map((b) => b.meal?.name || b.meal?.mealType)
);
if (
    packed.length >= 1 &&
    packed.every((page) => (page.blocks || []).length >= 1) &&
    mealNamesPerPage.flat().includes('Breakfast')
) {
    pass('meal packing keeps meal cards on pages');
} else {
    fail('meal packing keeps meal cards on pages', JSON.stringify(mealNamesPerPage));
}

// Oversized single meal continues
const longView = deriveElevateNutritionViewModel(longMealModel);
const longMealPages = longView.mealPages || [];
const continuedBlocks = longMealPages.flatMap((p) =>
    (p.blocks || []).filter((b) => b.continued)
);
if (longMealPages.length >= 2 && continuedBlocks.length >= 1) {
    pass('oversized meal continues with (continued) header');
} else {
    fail(
        'oversized meal continues with (continued) header',
        JSON.stringify({
            pages: longMealPages.length,
            continued: continuedBlocks.length,
        })
    );
}

// Content-height measurement
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(buildElevateNutritionHtml(shortModel), {
    waitUntil: 'domcontentloaded',
});
await applyElevateNutritionContentPageSizes(page);
const heights = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.page')).map((el) => ({
        classes: el.className,
        height: Math.round(el.getBoundingClientRect().height),
        isCover: el.classList.contains('page-nutrition-cover'),
        isMeals: el.classList.contains('page-nutrition-meals'),
        isNotes: el.classList.contains('page-nutrition-notes'),
        hasTitle: Boolean(el.querySelector('.details-title')),
    }))
);
await browser.close();

const cover = heights.find((h) => h.isCover);
const meals = heights.filter((h) => h.isMeals);
const notes = heights.filter((h) => h.isNotes);
if (
    cover?.height === ELEVATE_A4_HEIGHT_PX &&
    meals.every((h) => h.height < ELEVATE_A4_HEIGHT_PX - 40) &&
    notes.every((h) => h.height < ELEVATE_A4_HEIGHT_PX - 40)
) {
    pass('Nutrition cover A4; meals/notes content-sized');
} else {
    fail(
        'Nutrition cover A4; meals/notes content-sized',
        JSON.stringify(heights)
    );
}

if (meals[0]?.hasTitle && meals.slice(1).every((h) => !h.hasTitle)) {
    pass('DOM: meals title only on first meals page');
} else {
    fail('DOM: meals title only on first meals page', JSON.stringify(meals));
}

// PDF samples
const samples = [
    { name: 'elevate-nutrition-short.pdf', model: shortModel },
    { name: 'elevate-nutrition-basic.pdf', model: basic },
    { name: 'elevate-nutrition-multi.pdf', model: multiMealModel },
    { name: 'elevate-nutrition-long.pdf', model: longMealModel },
];
const a4Pt = pxToPt(ELEVATE_A4_HEIGHT_PX);
const written = [];
for (const sample of samples) {
    const pdf = await renderElevateNutritionPdf(sample.model);
    const path = join(OUT_DIR, sample.name);
    writeFileSync(path, pdf);
    writeFileSync(
        join(OUT_DIR, sample.name.replace(/\.pdf$/, '.html')),
        buildElevateNutritionHtml(sample.model),
        'utf8'
    );
    const boxes = parseMediaBoxes(pdf);
    written.push({
        name: sample.name,
        bytes: pdf.length,
        pages: boxes.length,
        boxes,
        coverIsA4: boxes[0] ? Math.abs(boxes[0].heightPt - a4Pt) < 3 : false,
        laterShorter: boxes.slice(1).some((b) => b.heightPt < a4Pt - 40),
        widthOk: boxes.every(
            (b) => Math.abs(b.widthPt - pxToPt(ELEVATE_PAGE_WIDTH_PX)) < 3
        ),
    });
}

if (written.every((w) => w.bytes > 1000 && w.coverIsA4 && w.widthOk)) {
    pass('Nutrition PDF samples generated with A4 cover');
} else {
    fail('Nutrition PDF samples generated with A4 cover', JSON.stringify(written));
}

if (written.find((w) => w.name.includes('short'))?.laterShorter) {
    pass('short Nutrition PDF has content-sized meals/notes MediaBoxes');
} else {
    fail(
        'short Nutrition PDF has content-sized meals/notes MediaBoxes',
        JSON.stringify(written.find((w) => w.name.includes('short')))
    );
}

// Confirm Workout behavior unchanged this pass (spot-check unified day packing)
const workoutModel = {
    type: 'workout',
    plan: {
        id: 'w',
        name: 'Spot',
        duration: 4,
        daysPerWeek: 1,
        goal: 'general_fitness',
        level: 'beginner',
        notes: null,
        status: 'active',
        isTemplate: false,
        totalExercises: 2,
        totalDays: 1,
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
                exercises: [
                    {
                        name: 'Bench',
                        order: 1,
                        restBetweenSets: 90,
                        notes: null,
                        sets: [
                            {
                                setNumber: 1,
                                reps: 8,
                                weight: 40,
                                weightUnit: 'kg',
                                isWarmup: false,
                                isDropset: false,
                            },
                        ],
                    },
                ],
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
const workoutSpot = deriveElevateViewModel(workoutModel);
const workoutSections =
    workoutSpot.detailPages?.[0]?.blocks?.[0]?.sections?.map((s) => s.id).join('+') ||
    '';
const workoutHtml = buildElevateWorkoutHtml(workoutModel);
if (
    workoutSections === 'warmup+main+cardio' &&
    workoutSpot.detailPages.length === 1 &&
    /WORKOUT <span>PLAN<\/span>/.test(workoutHtml)
) {
    pass('Workout unified-day pagination + title still intact');
} else {
    fail(
        'Workout unified-day pagination + title still intact',
        JSON.stringify({ workoutSections, pages: workoutSpot.detailPages.length })
    );
}

console.log('\nElevate Nutrition layout checks:');
for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log('\nSamples:');
for (const w of written) {
    const heights = w.boxes.map((b) => Math.round(b.heightPt)).join(', ');
    console.log(`- ${w.name}: ${w.pages} pages · MediaBox heights(pt)=[${heights}]`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
process.exit(process.exitCode || 0);
