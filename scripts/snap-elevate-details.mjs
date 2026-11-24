import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, mkdirSync } from 'fs';
import { chromium } from 'playwright';
import { buildElevateWorkoutHtml } from '../src/modules/plan-exports/templates/elevate/page.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'tmp/pdf-samples');
mkdirSync(outDir, { recursive: true });
const fixture = JSON.parse(readFileSync(join(root, 'src/modules/plan-exports/studio/fixtures/workout-sections.json'), 'utf8'));
const html = buildElevateWorkoutHtml(fixture);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.locator('section.page-workout-details').first().screenshot({ path: join(outDir, 'elevate-detail-page-1.png') });
console.log('ok');
await browser.close();
