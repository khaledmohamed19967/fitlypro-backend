/**
 * Render Elevate workout PDF and rasterize each page for visual inspection.
 * Run: node scripts/probe-example-week-pdf-pages.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

import { renderElevateWorkoutPdf } from '../src/modules/plan-exports/templates/elevate/index.js';
import { closeHtmlPdfBrowser } from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp/pdf-samples');
const FIXTURE = join(
    ROOT,
    'src/modules/plan-exports/studio/fixtures/workout-basic.json'
);

const run = async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const pdf = await renderElevateWorkoutPdf(fixture);
    const pdfPath = join(OUT_DIR, 'probe-example-week.pdf');
    writeFileSync(pdfPath, pdf);
    console.log('pdf bytes', pdf.length);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
        viewport: { width: 1000, height: 1400 },
    });

    const b64 = pdf.toString('base64');
    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;background:#111">
<canvas id="c"></canvas>
<script type="module">
import * as pdfjs from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
const data = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) =>
  c.charCodeAt(0)
);
const doc = await pdfjs.getDocument({ data }).promise;
window.__pdfPages = doc.numPages;
window.__renderPage = async (n) => {
  const p = await doc.getPage(n);
  const viewport = p.getViewport({ scale: 1.5 });
  const canvas = document.getElementById('c');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await p.render({
    canvasContext: canvas.getContext('2d'),
    viewport,
  }).promise;
  return { w: canvas.width, h: canvas.height, pages: doc.numPages };
};
window.__ready = true;
</script>
</body>
</html>`;

    await page.setContent(html, {
        waitUntil: 'networkidle',
        timeout: 120_000,
    });
    await page.waitForFunction(() => window.__ready === true, {
        timeout: 120_000,
    });
    const pages = await page.evaluate(() => window.__pdfPages);
    console.log('pdf pages', pages);

    for (let i = 1; i <= pages; i += 1) {
        const info = await page.evaluate(async (n) => window.__renderPage(n), i);
        await page.locator('#c').screenshot({
            path: join(OUT_DIR, `probe-pdf-page-${i}.png`),
        });
        console.log('rendered page', i, info);
    }

    await browser.close();
    await closeHtmlPdfBrowser().catch(() => {});
};

await run();
