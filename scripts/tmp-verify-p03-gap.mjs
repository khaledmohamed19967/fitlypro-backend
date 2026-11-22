import { writeFileSync } from 'fs';
import { chromium } from 'playwright';
import { buildElevateNutritionHtml } from '../src/modules/plan-exports/templates/elevate/nutrition.js';
import { loadStudioFixtureExportModel } from '../src/modules/plan-exports/studio/studio.fixtures.js';
import { renderHtmlToPdf } from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';
import { ELEVATE_PDF_OPTIONS } from '../src/modules/plan-exports/templates/elevate/index.js';

const loaded = loadStudioFixtureExportModel('nutrition-basic', 'nutrition');
const html = buildElevateNutritionHtml(loaded.exportModel);
writeFileSync('./tmp/elevate-nutrition-p03-gap-fix.html', html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
await page.setContent(html, { waitUntil: 'load' });

const notes = page.locator('.page-nutrition-notes');
const stack = await notes
    .locator('[data-elevate="nutrition-notes-stack"]')
    .boundingBox();
const card = await notes.locator('.details-card').first().boundingBox();
const macros = await notes.locator('.notes-macros').boundingBox();
const gap = Math.round(macros.y - (card.y + card.height));
const stackFlex = await notes
    .locator('[data-elevate="nutrition-notes-stack"]')
    .evaluate((el) => getComputedStyle(el).flex);

console.log({
    gapPx: gap,
    stackFlex,
    stackH: Math.round(stack.height),
    cardH: Math.round(card.height),
});

if (gap > 20) throw new Error(`gap still too large: ${gap}`);
if (!String(stackFlex).startsWith('0 0')) {
    throw new Error(`expected flex:none, got ${stackFlex}`);
}

await notes.screenshot({ path: 'tmp/elevate-nutrition-p03-gap-fix.png' });
await browser.close();

const pdf = await renderHtmlToPdf(html, ELEVATE_PDF_OPTIONS);
writeFileSync('./tmp/elevate-nutrition-p03-gap-fix.pdf', pdf);
console.log('PASS pdf', pdf.length);
