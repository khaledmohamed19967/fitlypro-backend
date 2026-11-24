import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { chromium } from 'playwright';
import { buildElevateWorkoutHtml } from '../src/modules/plan-exports/templates/elevate/page.js';
import { renderElevateWorkoutPdf } from '../src/modules/plan-exports/templates/elevate/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tmp/pdf-samples');
mkdirSync(outDir, { recursive: true });
const fixture = JSON.parse(readFileSync(join(root, 'src/modules/plan-exports/studio/fixtures/workout-sections.json'), 'utf8'));
const html = buildElevateWorkoutHtml(fixture);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
const metrics = await page.evaluate(() => {
  const details = document.querySelector('section.page-workout-details');
  const card = details.querySelector('.details-card');
  const cs = getComputedStyle(details);
  const pageBox = details.getBoundingClientRect();
  const cardBox = card.getBoundingClientRect();
  return {
    paddingLeft: cs.paddingLeft,
    paddingRight: cs.paddingRight,
    cardLeft: +(cardBox.left - pageBox.left).toFixed(1),
    cardRight: +(pageBox.right - cardBox.right).toFixed(1),
    cardWidth: +cardBox.width.toFixed(1),
    deltaFromOriginal: +(cardBox.width - 734).toFixed(1),
  };
});
console.log(JSON.stringify(metrics, null, 2));
await page.locator('section.page-workout-details').first().screenshot({ path: join(outDir, 'elevate-detail-page-1.png') });
await browser.close();
writeFileSync(join(outDir, 'elevate-workout-sections.pdf'), await renderElevateWorkoutPdf(fixture));
console.log('done');
