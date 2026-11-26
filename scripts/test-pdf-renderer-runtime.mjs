/**
 * PDF renderer runtime selection + local Chromium smoke tests.
 * Run: node scripts/test-pdf-renderer-runtime.mjs
 *
 * Does not require a live API server. Local Chromium must be installed:
 *   npx playwright install chromium
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    closeHtmlPdfBrowser,
    isServerlessPdfRuntime,
    renderHtmlToPdf,
    resolvePdfBrowserLaunchPlan,
} from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';
import { renderClassicWorkoutPdf } from '../src/modules/plan-exports/templates/classic/index.js';
import { renderElevateWorkoutPdf } from '../src/modules/plan-exports/templates/elevate/index.js';

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

const fixturePath = join(
    ROOT,
    'src/modules/plan-exports/studio/fixtures/workout-basic.json'
);
const basicFixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

// --- Runtime detection (no browser launch) ---
if (!isServerlessPdfRuntime({})) {
    pass('local env is not serverless');
} else {
    fail('local env is not serverless', 'empty env marked serverless');
}

if (isServerlessPdfRuntime({ VERCEL: '1' })) {
    pass('VERCEL=1 selects serverless');
} else {
    fail('VERCEL=1 selects serverless', '');
}

if (isServerlessPdfRuntime({ AWS_LAMBDA_FUNCTION_NAME: 'server' })) {
    pass('AWS_LAMBDA_FUNCTION_NAME selects serverless');
} else {
    fail('AWS_LAMBDA_FUNCTION_NAME selects serverless', '');
}

if (isServerlessPdfRuntime({ PDF_USE_SERVERLESS_CHROMIUM: '1' })) {
    pass('PDF_USE_SERVERLESS_CHROMIUM=1 selects serverless');
} else {
    fail('PDF_USE_SERVERLESS_CHROMIUM=1 selects serverless', '');
}

if (!isServerlessPdfRuntime({ NODE_ENV: 'production', VERCEL: undefined })) {
    pass('NODE_ENV=production alone does not select serverless');
} else {
    fail('NODE_ENV=production alone does not select serverless', '');
}

const localPlan = await resolvePdfBrowserLaunchPlan({});
if (
    localPlan.mode === 'local' &&
    localPlan.launchOptions.headless === true &&
    !localPlan.launchOptions.executablePath
) {
    pass('local launch plan uses default Playwright Chromium');
} else {
    fail('local launch plan uses default Playwright Chromium', JSON.stringify(localPlan));
}

const serverlessPlan = await resolvePdfBrowserLaunchPlan({
    PDF_USE_SERVERLESS_CHROMIUM: '1',
});
if (
    serverlessPlan.mode === 'serverless' &&
    typeof serverlessPlan.launchOptions.executablePath === 'string' &&
    serverlessPlan.launchOptions.executablePath.length > 0 &&
    Array.isArray(serverlessPlan.launchOptions.args) &&
    serverlessPlan.launchOptions.args.length > 0
) {
    pass('serverless launch plan uses @sparticuz/chromium executablePath + args');
} else {
    fail(
        'serverless launch plan uses @sparticuz/chromium executablePath + args',
        JSON.stringify({
            mode: serverlessPlan.mode,
            hasPath: Boolean(serverlessPlan.launchOptions.executablePath),
            argsLen: serverlessPlan.launchOptions.args?.length,
        })
    );
}

// --- Local PDF generation (real Playwright Chromium) ---
try {
    const htmlPdf = await renderHtmlToPdf(
        '<!DOCTYPE html><html><head><title>t</title></head><body><h1>Fitly PDF</h1></body></html>'
    );
    if (isPdf(htmlPdf)) {
        pass('local HTML→PDF returns valid %PDF- buffer');
    } else {
        fail(
            'local HTML→PDF returns valid %PDF- buffer',
            htmlPdf?.slice?.(0, 20)?.toString?.()
        );
    }

    const classicPdf = await renderClassicWorkoutPdf(basicFixture);
    if (isPdf(classicPdf)) {
        pass('local Classic workout PDF is valid');
    } else {
        fail('local Classic workout PDF is valid', classicPdf?.slice?.(0, 20)?.toString?.());
    }

    const elevatePdf = await renderElevateWorkoutPdf(basicFixture);
    if (isPdf(elevatePdf)) {
        pass('local Elevate workout PDF is valid');
    } else {
        fail('local Elevate workout PDF is valid', elevatePdf?.slice?.(0, 20)?.toString?.());
    }

    try {
        await renderHtmlToPdf('');
        fail('empty HTML returns controlled ApiError', 'no throw');
    } catch (error) {
        if (error?.statusCode === 500 && /PDF generation failed/i.test(error.message)) {
            pass('empty HTML returns controlled ApiError');
        } else {
            fail('empty HTML returns controlled ApiError', String(error?.message));
        }
    }
} catch (error) {
    fail('local PDF smoke suite', error instanceof Error ? error.message : String(error));
} finally {
    await closeHtmlPdfBrowser().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
    process.exit(1);
}
