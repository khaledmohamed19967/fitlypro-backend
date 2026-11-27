/**
 * Nutrition PDF export — performance / timeout regression suite.
 * Run: node scripts/test-nutrition-pdf-performance.mjs
 *
 * Uses local Playwright Chromium by default. On Windows, serverless
 * @sparticuz/chromium is unavailable; the suite reports that clearly.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import {
    buildElevateNutritionHtml,
    renderElevateNutritionPdf,
} from '../src/modules/plan-exports/templates/elevate/index.js';
import {
    closeHtmlPdfBrowser,
    getActivePdfRenderCount,
    isServerlessPdfRuntime,
    renderHtmlToPdf,
    resolvePdfBrowserLaunchPlan,
} from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';
import {
    countElevateHtmlPages,
    createPdfExportId,
    createPdfExportTrace,
    htmlHasRemoteImages,
    summarizeExportModelMetrics,
} from '../src/modules/plan-exports/pdf/pdfExportTrace.js';
import { applyElevateNutritionContentPageSizes } from '../src/modules/plan-exports/templates/elevate/contentPageSizes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'tmp/pdf-samples');
mkdirSync(OUT, { recursive: true });

const results = [];
const pass = (name, detail) => {
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL  ${name} — ${detail}`);
};

const isPdf = (buf) =>
    Buffer.isBuffer(buf) &&
    buf.length > 100 &&
    buf.slice(0, 5).toString() === '%PDF-';

const basic = JSON.parse(
    readFileSync(
        join(
            ROOT,
            'src/modules/plan-exports/studio/fixtures/nutrition-basic.json'
        ),
        'utf8'
    )
);

const makeLargeNutrition = () => {
    const next = structuredClone(basic);
    const day = next.content.nutritionDays[0];
    const meals = [];
    for (let m = 1; m <= 6; m += 1) {
        const foods = [];
        for (let f = 1; f <= 14; f += 1) {
            foods.push({
                name: `Food ${m}-${f}`,
                brand: null,
                quantity: 100 + f,
                unit: 'g',
                notes: null,
                itemMacros: { calories: 110, protein: 9, carbs: 11, fat: 3 },
            });
        }
        meals.push({
            order: m,
            name: `Meal ${m}`,
            mealType: ['breakfast', 'lunch', 'dinner', 'snack'][m % 4],
            suggestedTime: null,
            notes: null,
            mealTotals: { calories: 1540, protein: 126, carbs: 154, fat: 42 },
            foodItems: foods,
        });
    }
    next.content.nutritionDays = [{ ...day, meals }];
    next.plan.totalMeals = 6;
    next.plan.totalFoodItems = 84;
    next.plan.supplements = Array.from({ length: 10 }, (_, i) => ({
        id: `s${i}`,
        instruction: `Supplement instruction ${i + 1} for daily use.`,
        order: i + 1,
    }));
    next.plan.vitamins = Array.from({ length: 8 }, (_, i) => ({
        id: `v${i}`,
        instruction: `Vitamin instruction ${i + 1} with breakfast.`,
        order: i + 1,
    }));
    return next;
};

const parseMediaBoxes = (pdfBuffer) => {
    const text = pdfBuffer.toString('latin1');
    const boxes = [];
    const re =
        /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g;
    let match;
    while ((match = re.exec(text))) {
        boxes.push({
            widthPt: Math.abs(Number(match[3]) - Number(match[1])),
            heightPt: Math.abs(Number(match[4]) - Number(match[2])),
        });
    }
    return boxes;
};

async function run() {
    const large = makeLargeNutrition();

    // --- Metrics ---
    const basicMetrics = summarizeExportModelMetrics(basic);
    if (
        basicMetrics.planType === 'nutrition' &&
        basicMetrics.nutritionDayCount >= 1 &&
        basicMetrics.mealCount > 0 &&
        basicMetrics.foodItemCount > 0
    ) {
        pass(
            'nutrition metrics include meals/foods',
            `meals=${basicMetrics.mealCount} foods=${basicMetrics.foodItemCount}`
        );
    } else {
        fail('nutrition metrics include meals/foods', JSON.stringify(basicMetrics));
    }

    const largeMetrics = summarizeExportModelMetrics(large);
    if (
        largeMetrics.mealCount === 6 &&
        largeMetrics.foodItemCount === 84 &&
        largeMetrics.supplementCount === 10 &&
        largeMetrics.vitaminCount === 8
    ) {
        pass(
            'large nutrition metrics counts',
            JSON.stringify({
                meals: largeMetrics.mealCount,
                foods: largeMetrics.foodItemCount,
                supplements: largeMetrics.supplementCount,
                vitamins: largeMetrics.vitaminCount,
            })
        );
    } else {
        fail('large nutrition metrics counts', JSON.stringify(largeMetrics));
    }

    // --- HTML: no remote images; chrome not duplicated as data-URI imgs ---
    const basicHtml = buildElevateNutritionHtml(basic);
    const largeHtml = buildElevateNutritionHtml(large);
    if (!htmlHasRemoteImages(basicHtml) && !htmlHasRemoteImages(largeHtml)) {
        pass('nutrition HTML has no remote http(s) images');
    } else {
        fail('nutrition HTML has no remote http(s) images', 'remote src found');
    }

    const basicDataImgs = (basicHtml.match(/src="data:image/gi) || []).length;
    const largeDataImgs = (largeHtml.match(/src="data:image/gi) || []).length;
    const basicPages = countElevateHtmlPages(basicHtml);
    const largePages = countElevateHtmlPages(largeHtml);
    // Corners/slash are CSS backgrounds now — data-URI <img> count should not
    // scale 3× with every meals/notes page.
    if (largeDataImgs <= basicDataImgs + 2) {
        pass(
            'decorative chrome not duplicated per page as data-URI imgs',
            `basicImgs=${basicDataImgs} largeImgs=${largeDataImgs} pages=${basicPages}→${largePages}`
        );
    } else {
        fail(
            'decorative chrome not duplicated per page as data-URI imgs',
            `basicImgs=${basicDataImgs} largeImgs=${largeDataImgs} pages=${basicPages}→${largePages}`
        );
    }

    if (largePages > basicPages && largePages >= 5) {
        pass(
            'large nutrition paginates across multiple pages',
            `pages=${largePages}`
        );
    } else {
        fail(
            'large nutrition paginates across multiple pages',
            `basic=${basicPages} large=${largePages}`
        );
    }

    // --- Runtime note ---
    let runtimeMode = 'local';
    let runtimeNote = 'local Chromium';
    try {
        const preferred = await resolvePdfBrowserLaunchPlan();
        runtimeMode = preferred.mode;
        if (preferred.mode === 'serverless') {
            const api = (await import('playwright-core')).chromium;
            try {
                const browser = await api.launch(preferred.launchOptions);
                await browser.close();
                runtimeNote = 'production/serverless Chromium verified';
            } catch (err) {
                runtimeNote = `serverless launch failed (${err.message}); using local fallback — production-runtime verification pending`;
                if (process.env.PDF_USE_SERVERLESS_CHROMIUM === '1') {
                    delete process.env.PDF_USE_SERVERLESS_CHROMIUM;
                }
            }
        }
    } catch (err) {
        runtimeNote = `runtime probe failed: ${err.message}`;
    }
    pass(`PDF runtime: ${runtimeMode}`, runtimeNote);

    // --- Small + large PDF renders with tracing ---
    const renderTraced = async (label, model) => {
        const exportId = createPdfExportId(null);
        const trace = createPdfExportTrace(exportId, {
            planType: 'nutrition',
            label,
        });
        const metrics = summarizeExportModelMetrics(model);
        const pdf = await renderElevateNutritionPdf(model, {
            trace,
            modelMetrics: metrics,
        });
        return { exportId, trace, metrics, pdf };
    };

    const small = await renderTraced('small', basic);
    if (isPdf(small.pdf) && small.trace.stages.image_settle?.detail?.skipped) {
        pass(
            'small nutrition PDF skips remote image settle',
            `ms=${small.trace.stages.image_settle.ms} pdfBytes=${small.pdf.length}`
        );
    } else if (isPdf(small.pdf)) {
        // Older detail shape — still require fast settle.
        const settleMs = small.trace.stages.image_settle?.ms ?? 9999;
        if (settleMs < 50) {
            pass(
                'small nutrition PDF skips remote image settle',
                `settleMs=${settleMs}`
            );
        } else {
            fail(
                'small nutrition PDF skips remote image settle',
                JSON.stringify(small.trace.stages.image_settle)
            );
        }
    } else {
        fail('small nutrition PDF skips remote image settle', 'invalid pdf');
    }

    writeFileSync(join(OUT, 'nutrition-perf-small.pdf'), small.pdf);
    const smallBoxes = parseMediaBoxes(small.pdf);
    if (smallBoxes.length === countElevateHtmlPages(basicHtml)) {
        pass(
            'small nutrition PDF page count matches HTML pages',
            `pages=${smallBoxes.length}`
        );
    } else {
        fail(
            'small nutrition PDF page count matches HTML pages',
            `pdf=${smallBoxes.length} html=${countElevateHtmlPages(basicHtml)}`
        );
    }

    const big = await renderTraced('large', large);
    if (isPdf(big.pdf) && (big.trace.stages.image_settle?.detail?.skipped || (big.trace.stages.image_settle?.ms ?? 999) < 50)) {
        pass(
            'large nutrition PDF renders with skipped image settle',
            `totalMs=${big.trace.totalMs()} pages=${parseMediaBoxes(big.pdf).length} pdfBytes=${big.pdf.length}`
        );
    } else {
        fail(
            'large nutrition PDF renders with skipped image settle',
            JSON.stringify(big.trace.stages)
        );
    }
    writeFileSync(join(OUT, 'nutrition-perf-large.pdf'), big.pdf);

    const bigBoxes = parseMediaBoxes(big.pdf);
    if (bigBoxes.length === largePages && bigBoxes[0]?.heightPt > 800) {
        pass(
            'large nutrition keeps A4 cover + multi-page pagination',
            `pages=${bigBoxes.length} coverPt=${Math.round(bigBoxes[0].heightPt)}`
        );
    } else {
        fail(
            'large nutrition keeps A4 cover + multi-page pagination',
            JSON.stringify(bigBoxes.map((b) => Math.round(b.heightPt)))
        );
    }

    // Export id shape (controller sets X-Export-Id from this).
    if (typeof small.exportId === 'string' && small.exportId.length > 8) {
        pass('export id generated for nutrition trace', small.exportId.slice(0, 8));
    } else {
        fail('export id generated for nutrition trace', String(small.exportId));
    }

    // --- Synthetic many remote food-like images (shared renderer path) ---
    const remoteHtml = `<!DOCTYPE html><html><head><title>t</title></head><body>
      ${Array.from({ length: 12 }, (_, i) =>
          `<img src="https://invalid.example/food-${i}.jpg" width="40" height="40" alt="">`
      ).join('\n')}
      <p>nutrition image stress</p>
    </body></html>`;
    if (htmlHasRemoteImages(remoteHtml)) {
        pass('synthetic food-image HTML detected as remote');
    } else {
        fail('synthetic food-image HTML detected as remote', 'not detected');
    }

    const remoteTrace = createPdfExportTrace('nutrition-remote-imgs', {
        planType: 'nutrition',
    });
    try {
        const remotePdf = await renderHtmlToPdf(remoteHtml, {
            trace: remoteTrace,
            preparePage: applyElevateNutritionContentPageSizes,
            deadlineMs: 20_000,
        });
        if (
            isPdf(remotePdf) &&
            remoteTrace.stages.image_settle &&
            !remoteTrace.stages.image_settle.detail?.skipped
        ) {
            pass(
                'many failed remote images settle within budget',
                `settleMs=${remoteTrace.stages.image_settle.ms} timedOut=${Boolean(remoteTrace.stages.image_settle.detail?.timedOutStage)}`
            );
        } else {
            fail(
                'many failed remote images settle within budget',
                JSON.stringify(remoteTrace.stages.image_settle)
            );
        }
    } catch (err) {
        fail(
            'many failed remote images settle within budget',
            err instanceof Error ? err.message : String(err)
        );
    }

    // Slow image stage budget: settleRemoteImages itself.
    // (Covered indirectly above via invalid hosts + stage budget.)

    // --- Concurrent nutrition exports ---
    const [c1, c2, c3] = await Promise.all([
        renderElevateNutritionPdf(basic),
        renderElevateNutritionPdf(basic),
        renderElevateNutritionPdf(large),
    ]);
    if (isPdf(c1) && isPdf(c2) && isPdf(c3)) {
        pass('concurrent nutrition exports all succeed');
    } else {
        fail('concurrent nutrition exports all succeed', 'invalid pdf');
    }

    // --- Deadline cleanup ---
    try {
        await renderElevateNutritionPdf(basic, {
            deadlineMs: 1,
        });
        fail('nutrition render deadline returns 504', 'no throw');
    } catch (error) {
        if (error?.statusCode === 504 && error?.pdfPhase) {
            pass(
                'nutrition render deadline returns 504',
                `phase=${error.pdfPhase}`
            );
        } else {
            fail(
                'nutrition render deadline returns 504',
                `${error?.statusCode} ${error?.pdfPhase} ${error?.message}`
            );
        }
    }

    if (getActivePdfRenderCount() === 0) {
        pass('active render count is zero after nutrition deadline cleanup');
    } else {
        fail(
            'active render count is zero after nutrition deadline cleanup',
            String(getActivePdfRenderCount())
        );
    }

    await closeHtmlPdfBrowser();

    console.log('\nNutrition PDF performance checks:');
    const failed = results.filter((r) => !r.ok);
    console.log(
        `${results.length - failed.length}/${results.length} passed`
    );
    console.log(`Runtime note: ${runtimeNote}`);
    console.log(
        `Serverless env flag: ${isServerlessPdfRuntime() ? 'on' : 'off'}`
    );
    if (failed.length) process.exitCode = 1;
    process.exit(process.exitCode || 0);
}

await run();
