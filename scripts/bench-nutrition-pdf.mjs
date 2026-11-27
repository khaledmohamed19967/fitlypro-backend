/**
 * Benchmark Nutrition vs Workout PDF stages (safe metrics only).
 * Run: node scripts/bench-nutrition-pdf.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

import {
    buildElevateNutritionHtml,
    buildElevateWorkoutHtml,
    renderElevateNutritionPdf,
    renderElevateWorkoutPdf,
} from '../src/modules/plan-exports/templates/elevate/index.js';
import {
    closeHtmlPdfBrowser,
} from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';
import {
    countElevateHtmlPages,
    createPdfExportTrace,
    summarizeExportModelMetrics,
} from '../src/modules/plan-exports/pdf/pdfExportTrace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'tmp/pdf-samples');
mkdirSync(OUT, { recursive: true });

const countRemote = (html) => (html.match(/src="https?:/gi) || []).length;
const countDataImg = (html) => (html.match(/src="data:image/gi) || []).length;

const makeLargeNutrition = (base) => {
    const next = structuredClone(base);
    const day = next.content.nutritionDays[0];
    const meals = [];
    for (let m = 1; m <= 6; m += 1) {
        const foods = [];
        for (let f = 1; f <= 14; f += 1) {
            foods.push({
                name: `Food item ${m}-${f}`,
                brand: null,
                quantity: 100 + f,
                unit: 'g',
                notes: null,
                itemMacros: { calories: 120, protein: 10, carbs: 12, fat: 4 },
            });
        }
        meals.push({
            order: m,
            name: `Meal ${m}`,
            mealType: ['breakfast', 'lunch', 'dinner', 'snack'][m % 4],
            suggestedTime: null,
            notes: null,
            mealTotals: { calories: 1680, protein: 140, carbs: 168, fat: 56 },
            foodItems: foods,
        });
    }
    next.content.nutritionDays = [{ ...day, meals }];
    next.plan.totalMeals = 6;
    next.plan.totalFoodItems = 84;
    next.plan.supplements = Array.from({ length: 8 }, (_, i) => ({
        id: `s${i}`,
        instruction: `Take supplement ${i + 1} with meals as directed by coach.`,
        order: i + 1,
    }));
    next.plan.vitamins = Array.from({ length: 6 }, (_, i) => ({
        id: `v${i}`,
        instruction: `Vitamin note ${i + 1}: take daily with breakfast.`,
        order: i + 1,
    }));
    return next;
};

const summarizeHtml = (label, html, buildMs, model) => ({
    label,
    htmlBuildMs: Math.round(buildMs),
    htmlBytes: Buffer.byteLength(html),
    pages: countElevateHtmlPages(html),
    remoteImgs: countRemote(html),
    dataImgs: countDataImg(html),
    metrics: summarizeExportModelMetrics(model),
});

const run = async () => {
    const imgDir = join(
        ROOT,
        'src/modules/plan-exports/templates/elevate/html/images'
    );
    console.log('assets:');
    for (const f of readdirSync(imgDir)) {
        const s = statSync(join(imgDir, f));
        console.log(`  ${f}: ${Math.round(s.size / 1024)}KB`);
    }

    const workout = JSON.parse(
        readFileSync(
            join(ROOT, 'src/modules/plan-exports/studio/fixtures/workout-basic.json'),
            'utf8'
        )
    );
    const nutrition = JSON.parse(
        readFileSync(
            join(
                ROOT,
                'src/modules/plan-exports/studio/fixtures/nutrition-basic.json'
            ),
            'utf8'
        )
    );
    const large = makeLargeNutrition(nutrition);

    let t0 = performance.now();
    const nHtml = buildElevateNutritionHtml(nutrition);
    let t1 = performance.now();
    const wHtml = buildElevateWorkoutHtml(workout);
    let t2 = performance.now();
    const lHtml = buildElevateNutritionHtml(large);
    let t3 = performance.now();

    const htmlSummaries = [
        summarizeHtml('nutrition-basic', nHtml, t1 - t0, nutrition),
        summarizeHtml('workout-basic', wHtml, t2 - t1, workout),
        summarizeHtml('nutrition-large', lHtml, t3 - t2, large),
    ];
    console.log('\nHTML:');
    console.log(JSON.stringify(htmlSummaries, null, 2));

    const renderOne = async (label, model, renderFn) => {
        const trace = createPdfExportTrace(`bench-${label}`, {
            planType: model.type,
        });
        const metrics = summarizeExportModelMetrics(model);
        const started = performance.now();
        const pdf = await renderFn(model, { trace, modelMetrics: metrics });
        const totalMs = Math.round(performance.now() - started);
        const stageMs = Object.fromEntries(
            Object.entries(trace.stages).map(([k, v]) => [k, v.ms])
        );
        writeFileSync(join(OUT, `bench-${label}.pdf`), pdf);
        return {
            label,
            totalMs,
            pdfBytes: pdf.length,
            stageMs,
            metrics,
        };
    };

    // Warm browser once.
    await renderElevateWorkoutPdf(workout);
    const warm = [];
    warm.push(
        await renderOne('nutrition-basic', nutrition, renderElevateNutritionPdf)
    );
    warm.push(
        await renderOne('workout-basic', workout, renderElevateWorkoutPdf)
    );
    warm.push(
        await renderOne('nutrition-large', large, renderElevateNutritionPdf)
    );

    // Cold-ish: close browser then nutrition large again.
    await closeHtmlPdfBrowser();
    const cold = await renderOne(
        'nutrition-large-cold',
        large,
        renderElevateNutritionPdf
    );

    console.log('\nPDF renders (warm browser except cold):');
    console.log(JSON.stringify([...warm, cold], null, 2));

    await closeHtmlPdfBrowser();
};

await run();
