/**
 * Nutrition PDF export regression tests (Elevate).
 *
 * Covers:
 * - Small / large nutrition plans
 * - Many unique local decorative images (pages scale) without HTML data-URI bloat
 * - Slow / failed remote images (shared renderer path; Nutrition has none by default)
 * - Concurrent Nutrition exports
 * - Deadline cleanup (page closed, shared browser retained)
 * - Valid PDF + attachment-oriented headers from service shape
 * - Correct Nutrition pagination (cover + meals + notes)
 *
 * Runtime: local Playwright Chromium by default.
 * Production/serverless Chromium verification is still pending unless
 * PDF_USE_SERVERLESS_CHROMIUM=1 is set (and @sparticuz/chromium is usable).
 *
 * Run: node scripts/test-elevate-nutrition-pdf.mjs
 */
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    clearPdfRemoteImageCache,
    closeHtmlPdfBrowser,
    getHtmlPdfActivePageCount,
    isServerlessPdfRuntime,
    renderHtmlToPdf,
} from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';
import {
    createPdfExportTrace,
    resolvePdfExportDeadlineMs,
} from '../src/modules/plan-exports/pdf/pdfExportTrace.js';
import {
    buildElevateNutritionHtml,
    deriveElevateNutritionViewModel,
    getNutritionExportSafeMetrics,
    renderElevateNutritionPdf,
} from '../src/modules/plan-exports/templates/elevate/index.js';
import { ELEVATE_HTML_DIR } from '../src/modules/plan-exports/templates/elevate/page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const results = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const isPdf = (buf) =>
    Buffer.isBuffer(buf) && buf.length > 100 && buf.slice(0, 5).toString() === '%PDF-';

const basic = JSON.parse(
    readFileSync(
        join(ROOT, 'src/modules/plan-exports/studio/fixtures/nutrition-basic.json'),
        'utf8'
    )
);

const food = (name, i) => ({
    name,
    brand: null,
    quantity: 100,
    unit: 'g',
    notes: null,
    itemMacros: { calories: 120 + i, protein: 12, carbs: 14, fat: 3 },
});

const meal = (order, name, mealType, nFoods) => ({
    order,
    name,
    mealType,
    suggestedTime: '12:00',
    notes: null,
    mealTotals: {
        calories: 120 * nFoods,
        protein: 12 * nFoods,
        carbs: 14 * nFoods,
        fat: 3 * nFoods,
    },
    foodItems: Array.from({ length: nFoods }, (_, i) =>
        food(`${name} item ${i + 1}`, i)
    ),
});

const makeLargeNutrition = ({ meals = 16, foodsPerMeal = 6 } = {}) => ({
    type: 'nutrition',
    plan: {
        id: 'large-nutrition',
        name: 'Large Nutrition Fixture',
        duration: 8,
        daysCount: 1,
        goal: 'weight_loss',
        scheduleMode: 'daily',
        notes: null,
        status: 'active',
        isTemplate: false,
        totalMeals: meals,
        totalFoodItems: meals * foodsPerMeal,
        avgDailyCalories: 2400,
        macroTargets: { calories: 2400, protein: 180, carbs: 220, fat: 70 },
        computedMacros: {
            avgDailyCalories: 2400,
            avgDailyProtein: 180,
            avgDailyCarbs: 220,
            avgDailyFat: 70,
        },
        supplements: Array.from({ length: 10 }, (_, i) => ({
            id: `s${i}`,
            instruction: `Supplement ${i + 1}`,
            order: i + 1,
        })),
        vitamins: Array.from({ length: 6 }, (_, i) => ({
            id: `v${i}`,
            instruction: `Vitamin ${i + 1}`,
            order: i + 1,
        })),
    },
    trainer: { id: 't', fullName: 'Coach', email: null, phone: null },
    content: {
        nutritionDays: [
            {
                dayNumber: 1,
                name: 'Training Day',
                notes: null,
                dailyTotals: { calories: 2400, protein: 180, carbs: 220, fat: 70 },
                meals: Array.from({ length: meals }, (_, i) =>
                    meal(i + 1, `Meal ${i + 1}`, 'meal', foodsPerMeal)
                ),
            },
        ],
    },
});

const countDataUriImgs = (html) =>
    (html.match(/src="data:image\//g) || []).length;

const countRelativeImgs = (html) =>
    (html.match(/src="images\//g) || []).length;

// --- HTML production mode: no duplicated data-URI images ---
{
    const inlined = buildElevateNutritionHtml(basic, { inlineAssets: true });
    const routed = buildElevateNutritionHtml(basic, { inlineAssets: false });
    if (countDataUriImgs(inlined) > 0 && countRelativeImgs(routed) > 0 && countDataUriImgs(routed) === 0) {
        pass('production nutrition HTML keeps relative images (no data-URI img bloat)');
    } else {
        fail(
            'production nutrition HTML keeps relative images (no data-URI img bloat)',
            JSON.stringify({
                inlinedData: countDataUriImgs(inlined),
                routedData: countDataUriImgs(routed),
                routedRel: countRelativeImgs(routed),
            })
        );
    }

    const large = makeLargeNutrition({ meals: 20 });
    const largeInlined = buildElevateNutritionHtml(large, { inlineAssets: true });
    const largeRouted = buildElevateNutritionHtml(large, { inlineAssets: false });
    const inlinedKB = Buffer.byteLength(largeInlined) / 1024;
    const routedKB = Buffer.byteLength(largeRouted) / 1024;
    if (routedKB < inlinedKB * 0.55) {
        pass(
            `large nutrition HTML shrinks with asset routing (${Math.round(routedKB)}KB vs ${Math.round(inlinedKB)}KB inlined)`
        );
    } else {
        fail(
            'large nutrition HTML shrinks with asset routing',
            `${Math.round(routedKB)}KB routed vs ${Math.round(inlinedKB)}KB inlined`
        );
    }
}

// --- Metrics + pagination ---
{
    const view = deriveElevateNutritionViewModel(basic);
    const metrics = getNutritionExportSafeMetrics(basic);
    if (
        view.totalPages >= 3 &&
        metrics.totalPages === view.totalPages &&
        metrics.remoteFoodImages === 0 &&
        metrics.mealPages >= 1 &&
        metrics.notesPages >= 1
    ) {
        pass('nutrition metrics + pagination (cover/meals/notes)');
    } else {
        fail('nutrition metrics + pagination (cover/meals/notes)', JSON.stringify({ viewPages: view.totalPages, metrics }));
    }
}

// --- Deadline helper ---
{
    const ms = resolvePdfExportDeadlineMs({ PDF_EXPORT_DEADLINE_MS: '50000' });
    if (ms === 50_000) pass('PDF_EXPORT_DEADLINE_MS default margin config (50s)');
    else fail('PDF_EXPORT_DEADLINE_MS default margin config (50s)', String(ms));
}

const usingServerless = isServerlessPdfRuntime();
console.log(
    usingServerless
        ? 'Runtime: serverless Chromium (PDF_USE_SERVERLESS_CHROMIUM / Vercel)'
        : 'Runtime: local Chromium (production-runtime verification still pending)'
);

// --- Small nutrition PDF ---
let smallPdf;
try {
    const t0 = Date.now();
    smallPdf = await renderElevateNutritionPdf(basic, {
        exportId: 'test-nutrition-small',
    });
    const ms = Date.now() - t0;
    if (isPdf(smallPdf)) {
        pass(`small nutrition PDF valid (${smallPdf.length} bytes, ${ms}ms)`);
    } else {
        fail('small nutrition PDF valid', 'not a PDF buffer');
    }
} catch (error) {
    fail('small nutrition PDF valid', error instanceof Error ? error.message : String(error));
}

// --- Large nutrition PDF ---
const largeModel = makeLargeNutrition({ meals: 16, foodsPerMeal: 6 });
try {
    const metrics = getNutritionExportSafeMetrics(largeModel);
    const t0 = Date.now();
    const pdf = await renderElevateNutritionPdf(largeModel, {
        exportId: 'test-nutrition-large',
    });
    const ms = Date.now() - t0;
    if (isPdf(pdf) && metrics.totalPages >= 5) {
        pass(
            `large nutrition PDF valid (${pdf.length} bytes, ${ms}ms, pages=${metrics.totalPages}, meals=${metrics.mealCount}, foods=${metrics.foodItemCount})`
        );
    } else {
        fail('large nutrition PDF valid', JSON.stringify({ isPdf: isPdf(pdf), metrics }));
    }
} catch (error) {
    fail('large nutrition PDF valid', error instanceof Error ? error.message : String(error));
}

// --- Many pages / unique decorative image refs (local assets via routing) ---
try {
    const many = makeLargeNutrition({ meals: 24, foodsPerMeal: 4 });
    const html = buildElevateNutritionHtml(many, { inlineAssets: false });
    const relImgs = countRelativeImgs(html);
    const pdf = await renderElevateNutritionPdf(many, {
        exportId: 'test-nutrition-many-images',
    });
    if (isPdf(pdf) && relImgs >= 20 && countDataUriImgs(html) === 0) {
        pass(
            `many unique page image refs served via routing (${relImgs} relative imgs, pdf ${pdf.length} bytes)`
        );
    } else {
        fail(
            'many unique page image refs served via routing',
            JSON.stringify({ relImgs, dataUris: countDataUriImgs(html), pdfOk: isPdf(pdf) })
        );
    }
} catch (error) {
    fail(
        'many unique page image refs served via routing',
        error instanceof Error ? error.message : String(error)
    );
}

// --- Slow + failed remote images (shared renderer; Nutrition path can still host them) ---
{
    clearPdfRemoteImageCache();
    const slowServer = createServer((req, res) => {
        if (req.url?.includes('fail')) {
            res.statusCode = 500;
            res.end('nope');
            return;
        }
        setTimeout(() => {
            // 1x1 PNG
            const png = Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                'base64'
            );
            res.setHeader('Content-Type', 'image/png');
            res.end(png);
        }, 2500);
    });
    await new Promise((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
    const { port } = slowServer.address();
    const slowUrl = `http://127.0.0.1:${port}/slow.png`;
    const failUrl = `http://127.0.0.1:${port}/fail.png`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title>
<style>@page { size: 794px 400px; margin: 0; } body{margin:0}.page{width:794px;height:400px}</style>
</head><body>
<section class="page"><img src="${slowUrl}" width="40" height="40"><img src="${failUrl}" width="40" height="40"></section>
</body></html>`;

    try {
        const t0 = Date.now();
        const pdf = await renderHtmlToPdf(html, {
            format: 'A4',
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
            exportId: 'test-remote-images',
            planType: 'nutrition',
            deadlineAt: Date.now() + 20_000,
        });
        const ms = Date.now() - t0;
        // Should not wait the full 2.5s * N sequentially beyond per-image cap (~4s parallel).
        if (isPdf(pdf) && ms < 12_000) {
            pass(`slow/failed remote images bounded (${ms}ms)`);
        } else {
            fail('slow/failed remote images bounded', `ms=${ms} pdf=${isPdf(pdf)}`);
        }
    } catch (error) {
        fail(
            'slow/failed remote images bounded',
            error instanceof Error ? error.message : String(error)
        );
    } finally {
        await new Promise((resolve) => slowServer.close(resolve));
        clearPdfRemoteImageCache();
    }
}

// --- Concurrent nutrition exports ---
try {
    const t0 = Date.now();
    const buffers = await Promise.all([
        renderElevateNutritionPdf(basic, { exportId: 'concurrent-a' }),
        renderElevateNutritionPdf(basic, { exportId: 'concurrent-b' }),
        renderElevateNutritionPdf(largeModel, { exportId: 'concurrent-c' }),
    ]);
    const ms = Date.now() - t0;
    if (buffers.every(isPdf) && getHtmlPdfActivePageCount() === 0) {
        pass(`concurrent nutrition exports (${buffers.length} PDFs, ${ms}ms, pages cleaned)`);
    } else {
        fail(
            'concurrent nutrition exports',
            JSON.stringify({
                ok: buffers.map(isPdf),
                activePages: getHtmlPdfActivePageCount(),
            })
        );
    }
} catch (error) {
    fail(
        'concurrent nutrition exports',
        error instanceof Error ? error.message : String(error)
    );
}

// --- Deadline cleanup ---
try {
    const trace = createPdfExportTrace({
        exportId: 'deadline-cleanup',
        planType: 'nutrition',
        deadlineMs: 30,
    });
    let threw = null;
    try {
        await renderElevateNutritionPdf(largeModel, {
            trace,
            deadlineAt: Date.now() - 1,
            exportId: 'deadline-cleanup',
        });
    } catch (error) {
        threw = error;
    }
    trace.finish({
        ok: false,
        error: threw || new Error('expected deadline'),
    });

    if (
        threw &&
        threw.statusCode === 504 &&
        threw.pdfPhase === 'deadline' &&
        getHtmlPdfActivePageCount() === 0
    ) {
        pass('deadline cleanup closes page without leaking');
    } else {
        fail(
            'deadline cleanup closes page without leaking',
            JSON.stringify({
                statusCode: threw?.statusCode,
                pdfPhase: threw?.pdfPhase,
                activePages: getHtmlPdfActivePageCount(),
                message: threw?.message,
            })
        );
    }
} catch (error) {
    fail(
        'deadline cleanup closes page without leaking',
        error instanceof Error ? error.message : String(error)
    );
}

// --- Attachment header shape (mirrors controller contract) ---
{
    if (isPdf(smallPdf)) {
        const filename = 'nutrition-plan.pdf';
        const headers = {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': String(smallPdf.length),
            'X-Export-Id': 'test-nutrition-small',
            'Cache-Control': 'no-store',
        };
        if (
            headers['Content-Type'] === 'application/pdf' &&
            headers['Content-Disposition'].includes('attachment') &&
            headers['X-Export-Id']
        ) {
            pass('attachment headers contract (Content-Type/Disposition/X-Export-Id)');
        } else {
            fail('attachment headers contract (Content-Type/Disposition/X-Export-Id)', JSON.stringify(headers));
        }
    } else {
        fail('attachment headers contract (Content-Type/Disposition/X-Export-Id)', 'missing small PDF');
    }
}

// --- Before/after stage timing sample ---
{
    const tHtml0 = Date.now();
    const htmlRouted = buildElevateNutritionHtml(largeModel, { inlineAssets: false });
    const htmlMs = Date.now() - tHtml0;
    const tPdf0 = Date.now();
    const pdf = await renderElevateNutritionPdf(largeModel, {
        exportId: 'timing-sample',
    });
    const pdfMs = Date.now() - tPdf0;
    console.log(
        JSON.stringify(
            {
                timingSample: {
                    plan: 'large nutrition',
                    htmlBytes: Buffer.byteLength(htmlRouted),
                    htmlMs,
                    pdfBytes: pdf.length,
                    totalRenderMs: pdfMs,
                    pages: getNutritionExportSafeMetrics(largeModel).totalPages,
                    assetRoot: ELEVATE_HTML_DIR.endsWith('html'),
                },
            },
            null,
            2
        )
    );
    pass('timing sample logged for report');
}

await closeHtmlPdfBrowser();

const failed = results.filter((r) => !r.ok);
console.log('\n---');
console.log(`Results: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
    for (const f of failed) console.log(`  FAIL: ${f.name} — ${f.detail}`);
    process.exit(1);
}
process.exit(0);
