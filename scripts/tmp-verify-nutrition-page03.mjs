import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { chromium } from 'playwright';
import {
    buildElevateNutritionHtml,
    deriveElevateNutritionViewModel,
} from '../src/modules/plan-exports/templates/elevate/nutrition.js';
import { buildElevateWorkoutHtml } from '../src/modules/plan-exports/templates/elevate/page.js';
import { loadStudioFixtureExportModel } from '../src/modules/plan-exports/studio/studio.fixtures.js';
import { renderHtmlToPdf } from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';
import { ELEVATE_PDF_OPTIONS } from '../src/modules/plan-exports/templates/elevate/index.js';

mkdirSync('./tmp', { recursive: true });

const loaded = loadStudioFixtureExportModel('nutrition-basic', 'nutrition');
if (!loaded.ok) throw new Error(loaded.message);

const view = deriveElevateNutritionViewModel(loaded.exportModel);
if (view.instructionEntries.length !== 4) {
    throw new Error(`expected 4 instructions, got ${view.instructionEntries.length}`);
}
if (view.instructionEntries[0].instruction.indexOf('Whey') < 0) {
    throw new Error('supplements should come before vitamins');
}
if (view.instructionEntries[2].instruction.indexOf('Vitamin D3') < 0) {
    throw new Error('vitamins should follow supplements');
}
if (view.macros.calories !== 1470 || view.macros.protein !== 128) {
    throw new Error('macro targets wrong');
}

const html = buildElevateNutritionHtml(loaded.exportModel);
writeFileSync('./tmp/elevate-nutrition-3pages.html', html);

if ((html.match(/class="page /g) || []).length < 3) {
    throw new Error('expected 3 pages');
}
if (!html.includes('03 / 03') || !html.includes('02 / 03')) {
    throw new Error('page numbers missing');
}
if (!html.includes('notes-photo') || !html.includes('How to use this plan')) {
    throw new Error('page 03 content missing');
}
if (html.includes('Electrolytes') || html.includes('Casein')) {
    throw new Error('old fixture instructions leaked');
}

// Empty instructions
const empty = buildElevateNutritionHtml({
    type: 'nutrition',
    plan: {
        id: 'e',
        name: 'Empty Notes',
        duration: 4,
        goal: 'maintenance',
        status: 'active',
        macroTargets: { calories: 1800, protein: 140, carbs: 160, fat: 50 },
        supplements: [{ id: 'x', instruction: '   ', order: 1 }],
        vitamins: [],
    },
    trainer: { id: 't', fullName: 'T' },
    content: { nutritionDays: [{ dayNumber: 1, meals: [] }] },
});
if (!empty.includes('No supplements or vitamins in this plan yet.')) {
    throw new Error('empty instructions state missing');
}
if ((empty.match(/<li class="notes-item"/g) || []).length > 0) {
    throw new Error('blank instruction should not render as item');
}

// Vitamins only
const vitaminsOnly = deriveElevateNutritionViewModel({
    type: 'nutrition',
    plan: {
        id: 'v',
        name: 'V',
        duration: 2,
        goal: 'maintenance',
        status: 'active',
        macroTargets: null,
        computedMacros: {
            avgDailyCalories: 1600,
            avgDailyProtein: 120,
            avgDailyCarbs: 140,
            avgDailyFat: 45,
        },
        supplements: [],
        vitamins: [
            { instruction: 'Omega 3 - 2 caps', order: 2 },
            { instruction: 'Vitamin D - morning', order: 1 },
        ],
    },
    content: { nutritionDays: [] },
});
if (vitaminsOnly.instructionEntries.map((e) => e.instruction).join('|') !== 'Vitamin D - morning|Omega 3 - 2 caps') {
    throw new Error('vitamin order wrong');
}
if (vitaminsOnly.macros.calories !== 1600 || vitaminsOnly.macros.protein !== 120) {
    throw new Error('computedMacros fallback failed');
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
await page.setContent(html, { waitUntil: 'load' });
const pageCount = await page.locator('.page').count();
if (pageCount !== 3) throw new Error(`expected 3 pages, got ${pageCount}`);

const notes = page.locator('.page-nutrition-notes');
const notesBox = await notes.boundingBox();
const footer = await notes.locator('.details-footer').boundingBox();
const photo = await notes.locator('.notes-photo').boundingBox();
const howto = await notes.locator('.notes-howto').boundingBox();
const items = await notes.locator('.notes-item').count();
if (items !== 4) throw new Error(`expected 4 note items, got ${items}`);

const stackBottom = await notes
    .locator('[data-elevate="nutrition-notes-stack"]')
    .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom;
    });
const footerTop = footer.y;
const photoStyle = await notes.locator('.notes-photo').evaluate((el) => {
    const s = getComputedStyle(el);
    return {
        objectFit: s.objectFit,
        borderRadius: s.borderRadius,
        naturalWidth: el.naturalWidth,
        naturalHeight: el.naturalHeight,
    };
});

console.log({
    notesH: Math.round(notesBox.height),
    items,
    photo,
    howto,
    photoStyle,
    footerClearance: Math.round(footerTop - stackBottom),
});

if (photoStyle.objectFit !== 'cover') throw new Error('photo object-fit');
if (!photoStyle.naturalWidth) throw new Error('photo not loaded');
if (Math.abs(photo.height - howto.height) > 40) {
    console.warn('WARN: photo/howto height delta', Math.abs(photo.height - howto.height));
}

await page.locator('.page-nutrition-cover').screenshot({ path: 'tmp/elevate-nutrition-p01-check.png' });
await page.locator('.page-nutrition-meals').screenshot({ path: 'tmp/elevate-nutrition-p02-check.png' });
await notes.screenshot({ path: 'tmp/elevate-nutrition-p03.png' });

const workout = JSON.parse(
    readFileSync(
        './src/modules/plan-exports/studio/fixtures/workout-basic.json',
        'utf8'
    )
);
const wHtml = buildElevateWorkoutHtml(workout);
await page.setContent(wHtml, { waitUntil: 'load' });
const wPages = await page.locator('.page').count();
console.log('Workout pages still render:', wPages);

await browser.close();

const pdf = await renderHtmlToPdf(html, ELEVATE_PDF_OPTIONS);
writeFileSync('./tmp/elevate-nutrition-3pages.pdf', pdf);
console.log('PDF bytes', pdf.length);
console.log('PASS: Nutrition Page 03 verified');
