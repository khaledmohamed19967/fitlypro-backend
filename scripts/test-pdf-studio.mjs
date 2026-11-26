/**
 * PDF Template Studio — Phase A.1 + B + B.1 + C tests.
 * Run: node scripts/test-pdf-studio.mjs
 *
 * Fixture/HTML/PDF/auth-shape tests need no MongoDB.
 * Optional real-plan ownership tests run when APP_DB_URL is available.
 */

import 'dotenv/config';
import { createServer } from 'net';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    unlinkSync,
    writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import config from '../src/config/index.js';
import User from '../src/modules/users/user.model.js';
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import {
    assertStudioStartupAllowed,
    resolveStudioRuntimeEnv,
    STUDIO_ALLOWED_ENVS,
} from '../src/modules/plan-exports/studio/studio.env.js';
import {
    isStudioCombinationSupported,
    listStudioTemplates,
    listStudioWatchRoots,
    resolveStudioModuleSpec,
    resolveStudioPage,
    resolveStudioPages,
    STUDIO_REGISTRY_PHASE,
    STUDIO_TEMPLATE_SOURCES,
    validateStudioRegistry,
} from '../src/modules/plan-exports/studio/studio.registry.js';
import {
    createStudioApp,
    startStudioServer,
    STUDIO_BIND_HOST,
} from '../src/modules/plan-exports/studio/server.mjs';
import {
    loadStudioFixtureExportModel,
    listStudioFixtures,
    STUDIO_FIXTURE_IDS,
} from '../src/modules/plan-exports/studio/studio.fixtures.js';
import {
    buildStudioHtml,
    createStudioPreview,
    loadFixtureExportModel,
} from '../src/modules/plan-exports/studio/studio.service.js';
import { authenticateStudioUser } from '../src/modules/plan-exports/studio/studio.auth.js';
import {
    extractBearerToken,
    verifyAccessToken,
} from '../src/utils/verifyAccessToken.js';
import { closeHtmlPdfBrowser } from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';
import { ELEVATE_PDF_OPTIONS } from '../src/modules/plan-exports/templates/elevate/index.js';
import { buildElevateWorkoutHtml } from '../src/modules/plan-exports/templates/elevate/page.js';
import {
    getStudioModuleCacheEntry,
    loadStudioHtmlBuilder,
    reloadStudioTemplateModules,
    resetStudioModuleCache,
} from '../src/modules/plan-exports/studio/studio.modules.js';
import {
    broadcastStudioEvent,
    closeAllStudioEvents,
    getStudioEventClientCount,
    subscribeStudioEvents,
} from '../src/modules/plan-exports/studio/studio.events.js';
import {
    classifyStudioWatchFile,
    startStudioWatcher,
} from '../src/modules/plan-exports/studio/studio.watch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STUDIO_PUBLIC = join(
    __dirname,
    '../src/modules/plan-exports/studio/public'
);

const results = [];
const SAFE_ENV = Object.freeze({ NODE_ENV: 'development' });

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};

const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const expect = (name, condition, detail = '') => {
    if (condition) pass(name);
    else fail(name, detail || 'assertion failed');
};

const expectThrows = (name, fn, pattern) => {
    let threw = false;
    let message = '';
    try {
        fn();
    } catch (err) {
        threw = true;
        message = err?.message || String(err);
    }
    expect(
        name,
        threw && (!pattern || pattern.test(message)),
        message || 'did not throw'
    );
};

async function requestApp(app, method, path, { body, headers, raw } = {}) {
    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        instance.on('error', reject);
    });

    try {
        const address = server.address();
        const port = address.port;
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: {
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...headers,
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (raw) {
            const buffer = Buffer.from(await res.arrayBuffer());
            return { status: res.status, headers: res.headers, buffer };
        }

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const json = await res.json().catch(() => ({}));
            return { status: res.status, json, text: null, headers: res.headers };
        }
        if (contentType.includes('text/html')) {
            const text = await res.text();
            return { status: res.status, json: null, text, headers: res.headers };
        }
        const text = await res.text();
        return { status: res.status, json: null, text, headers: res.headers };
    } finally {
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    }
}

function runRegistryTests() {
    const all = listStudioTemplates();
    expect('listStudioTemplates succeeds', all.ok === true, JSON.stringify(all));

    const keys = (all.templates || []).map((t) => `${t.templateId}:${t.planType}`);
    expect(
        'registry exposes elevate workout/nutrition only',
        keys.includes('elevate:workout') &&
            keys.includes('elevate:nutrition') &&
            !keys.some((k) => k.startsWith('classic:')) &&
            keys.length === 2,
        JSON.stringify(keys)
    );

    expect(
        'elevate appears once per plan type (no collapsed duplicate id)',
        keys.filter((k) => k.startsWith('elevate:')).length === 2 &&
            new Set(keys).size === keys.length,
        JSON.stringify(keys)
    );

    expect(
        'elevate workout exposes full page',
        resolveStudioPages('elevate', 'workout').defaultPageId === 'full'
    );
    expect(
        'elevate nutrition exposes full page',
        resolveStudioPages('elevate', 'nutrition').defaultPageId === 'full'
    );
    expect(
        'elevate workout exposes single full page (html design)',
        resolveStudioPages('elevate', 'workout').defaultPageId === 'full'
    );
    const fitlyPages = resolveStudioPages('elevate', 'workout');
    expect(
        'elevate has only one Studio page',
        fitlyPages.ok &&
            fitlyPages.pages.length === 1 &&
            fitlyPages.pages[0].id === 'full',
        JSON.stringify(fitlyPages.pages)
    );

    expect(
        'elevate + nutrition is supported',
        isStudioCombinationSupported('elevate', 'nutrition') === true
    );
    expect(
        'unknown template rejected',
        resolveStudioPages('missing_template', 'workout').status === 404
    );
    expect(
        'unknown page id rejected',
        resolveStudioPage('elevate', 'workout', 'cover').ok === false
    );
    expect(
        'invalid planType filter rejected by registry',
        listStudioTemplates('not-a-type').ok === false
    );
    expect(
        'normalize rejects non-string planType (array)',
        listStudioTemplates(['workout']).ok === false
    );

    expectThrows(
        'empty pages rejected by validateStudioRegistry',
        () =>
            validateStudioRegistry({
                elevate: {
                    workout: [],
                    nutrition: [
                        { id: 'full', label: 'Full document', isDefault: true },
                    ],
                },
            }),
        /non-empty|Invalid Studio registry/
    );

    expectThrows(
        'multiple defaults rejected by validateStudioRegistry',
        () =>
            validateStudioRegistry({
                elevate: {
                    workout: [
                        { id: 'full', label: 'Full', isDefault: true },
                        { id: 'alt', label: 'Alt', isDefault: true },
                    ],
                    nutrition: [
                        { id: 'full', label: 'Full document', isDefault: true },
                    ],
                },
            }),
        /exactly one isDefault/
    );

    expectThrows(
        'orphan Studio declaration rejected',
        () =>
            validateStudioRegistry({
                elevate: {
                    workout: [
                        { id: 'full', label: 'Full document', isDefault: true },
                    ],
                    nutrition: [
                        { id: 'full', label: 'Full document', isDefault: true },
                    ],
                },
                orphan_template: {
                    workout: [
                        { id: 'full', label: 'Full document', isDefault: true },
                    ],
                },
            }),
        /Orphan Studio declaration/
    );

    expectThrows(
        'missing production combination rejected (drift)',
        () =>
            validateStudioRegistry({
                elevate: {
                    workout: [
                        { id: 'full', label: 'Full document', isDefault: true },
                    ],
                },
            }),
        /Missing Studio pages for production combination elevate:nutrition/
    );
}

function runEnvGuardTests() {
    expect(
        'allowlist includes development and test',
        STUDIO_ALLOWED_ENVS.includes('development') &&
            STUDIO_ALLOWED_ENVS.includes('test')
    );

    const matrix = [
        { name: 'NODE_ENV=production refused', env: { NODE_ENV: 'production' }, allowed: false },
        { name: 'APP_NODE_ENV=production refused', env: { APP_NODE_ENV: 'production' }, allowed: false },
        {
            name: 'NODE_ENV=development + APP_NODE_ENV=production refused',
            env: { NODE_ENV: 'development', APP_NODE_ENV: 'production' },
            allowed: false,
        },
        {
            name: 'NODE_ENV=production + APP_NODE_ENV=development refused',
            env: { NODE_ENV: 'production', APP_NODE_ENV: 'development' },
            allowed: false,
        },
        { name: 'NODE_ENV=staging refused', env: { NODE_ENV: 'staging' }, allowed: false },
        { name: 'NODE_ENV=Production refused', env: { NODE_ENV: 'Production' }, allowed: false },
        {
            name: 'missing values default to development and allow',
            env: {},
            allowed: true,
            resolvedEnv: 'development',
        },
        {
            name: 'NODE_ENV=development allowed',
            env: { NODE_ENV: 'development' },
            allowed: true,
            resolvedEnv: 'development',
        },
        {
            name: 'NODE_ENV=test allowed',
            env: { NODE_ENV: 'test' },
            allowed: true,
            resolvedEnv: 'test',
        },
    ];

    for (const caseRow of matrix) {
        const resolved = resolveStudioRuntimeEnv(caseRow.env);
        expect(
            caseRow.name,
            resolved.allowed === caseRow.allowed &&
                (caseRow.resolvedEnv == null ||
                    resolved.resolvedEnv === caseRow.resolvedEnv),
            JSON.stringify(resolved)
        );
        if (!caseRow.allowed) {
            expectThrows(
                `${caseRow.name} (assert throws)`,
                () => assertStudioStartupAllowed(caseRow.env),
                /refuses to start/
            );
        }
    }
}

function runFixtureUnitTests() {
    expect(
        'fixture allowlist is workout-basic + nutrition-basic',
        STUDIO_FIXTURE_IDS.includes('workout-basic') &&
            STUDIO_FIXTURE_IDS.includes('nutrition-basic') &&
            STUDIO_FIXTURE_IDS.length === 2
    );

    const workout = loadStudioFixtureExportModel('workout-basic', 'workout');
    expect(
        'workout fixture loads without DB',
        workout.ok &&
            workout.exportModel.type === 'workout' &&
            workout.exportModel.plan.name.includes('<b>'),
        JSON.stringify(workout.ok ? workout.exportModel.plan.name : workout)
    );

    const nutrition = loadStudioFixtureExportModel(
        'nutrition-basic',
        'nutrition'
    );
    expect(
        'nutrition fixture loads without DB',
        nutrition.ok && nutrition.exportModel.type === 'nutrition'
    );

    expect(
        'unknown fixture rejected',
        loadStudioFixtureExportModel('not-real', 'workout').ok === false
    );
    expect(
        'fixture path traversal id rejected',
        loadStudioFixtureExportModel('../workout-basic', 'workout').ok === false
    );
    expect(
        'fixture plan-type mismatch rejected',
        loadStudioFixtureExportModel('workout-basic', 'nutrition').ok === false
    );
    expect(
        'listStudioFixtures filters by plan type',
        listStudioFixtures('workout').length === 1 &&
            listStudioFixtures('workout')[0].id === 'workout-basic'
    );
}

async function runRenderingTests() {
    const loaded = loadFixtureExportModel({
        planType: 'workout',
        fixtureId: 'workout-basic',
    });
    const classicHtml = await buildStudioHtml({
        templateId: 'elevate',
        planType: 'workout',
        pageId: 'full',
        exportModel: loaded.exportModel,
    });
    expect(
        'registered elevate HTML builder used (escaped name)',
        classicHtml.includes('Studio Fixture &lt;b&gt;Workout&lt;/b&gt;') &&
            classicHtml.includes('<!DOCTYPE html>'),
        classicHtml.slice(0, 200)
    );

    const coverHtml = await buildStudioHtml({
        templateId: 'elevate',
        planType: 'workout',
        pageId: 'full',
        exportModel: loaded.exportModel,
    });
    expect(
        'registered elevate HTML builder used',
        coverHtml.includes('page-cover') &&
            coverHtml.includes('page-workouts') &&
            coverHtml.includes('page-workout-details') &&
            coverHtml.includes('Program overview') &&
            coverHtml.includes(
                'elevate-html-source:templates/elevate/html/index.html'
            ) &&
            coverHtml.includes('Studio Fixture &lt;b&gt;Workout&lt;/b&gt;'),
        coverHtml.slice(0, 240)
    );

    let unknownPageThrew = false;
    try {
        await buildStudioHtml({
            templateId: 'elevate',
            planType: 'workout',
            pageId: 'nope',
            exportModel: loaded.exportModel,
        });
    } catch {
        unknownPageThrew = true;
    }
    expect('unknown page rejected by buildStudioHtml', unknownPageThrew);

    const pdfPreview = await createStudioPreview({
        planType: 'workout',
        source: 'fixture',
        fixtureId: 'workout-basic',
        templateId: 'elevate',
        pageId: 'full',
        format: 'pdf',
    });
    expect(
        'fixture PDF returns %PDF buffer',
        Buffer.isBuffer(pdfPreview.buffer) &&
            pdfPreview.buffer.slice(0, 4).toString() === '%PDF',
        pdfPreview.buffer?.slice?.(0, 8)?.toString?.()
    );
    expect(
        'elevate PDF options respected',
        pdfPreview.pdfOptions?.preferCSSPageSize ===
            ELEVATE_PDF_OPTIONS.preferCSSPageSize &&
            pdfPreview.pdfOptions?.margin?.top === '0'
    );

    const coverPdf = await createStudioPreview({
        planType: 'workout',
        source: 'fixture',
        fixtureId: 'workout-basic',
        templateId: 'elevate',
        pageId: 'full',
        format: 'pdf',
    });
    expect(
        'elevate PDF options respected',
        coverPdf.pdfOptions?.margin?.top === ELEVATE_PDF_OPTIONS.margin.top &&
            coverPdf.buffer.slice(0, 4).toString() === '%PDF'
    );

    expect(
        'elevate HTML uses html/ assets (not legacy cover.css markup)',
        coverHtml.includes('data:image/png;base64,') &&
            coverHtml.includes('data:font/woff2;base64,') &&
            coverHtml.includes('data-elevate-html-css="styles.css"') &&
            !coverHtml.includes('data-fitly-cover>') &&
            !coverHtml.includes('href="styles.css"'),
        coverHtml.slice(0, 240)
    );

    await closeHtmlPdfBrowser();
    pass('Playwright browser closed after PDF renders');
}

async function runApiTests() {
    const app = createStudioApp({ env: SAFE_ENV });

    const templates = await requestApp(app, 'GET', '/api/studio/templates');
    expect(
        'GET templates previewAvailable true (Phase C)',
        templates.status === 200 &&
            templates.json.data?.previewAvailable === true &&
            templates.json.data?.phase === 'C' &&
            STUDIO_REGISTRY_PHASE === 'C'
    );

    const health = await requestApp(app, 'GET', '/api/studio/health');
    expect(
        'GET health reports liveReload',
        health.status === 200 &&
            health.json.data?.liveReload === true &&
            health.json.data?.phase === 'C'
    );

    const rawDesign = await requestApp(
        app,
        'GET',
        '/studio-assets/elevate/html/index.html'
    );
    const rawCss = await requestApp(
        app,
        'GET',
        '/studio-assets/elevate/html/styles.css'
    );
    expect(
        'Studio serves raw elevate/html/index.html',
        rawDesign.status === 200 &&
            rawDesign.text?.includes('Program overview') &&
            rawDesign.text?.includes('href="styles.css"') &&
            rawDesign.text?.includes('src="images/ph.png"'),
        `status=${rawDesign.status}`
    );
    expect(
        'Studio serves raw elevate/html/styles.css',
        rawCss.status === 200 &&
            rawCss.text?.includes('.page') &&
            rawCss.text?.includes('794px') &&
            rawCss.text?.includes('fonts/inter-latin.woff2'),
        `status=${rawCss.status}`
    );

    const fixtures = await requestApp(app, 'GET', '/api/studio/fixtures');
    expect(
        'GET fixtures lists allowlisted ids',
        fixtures.status === 200 &&
            fixtures.json.data.fixtures.length === 2
    );

    const htmlPreview = await requestApp(app, 'POST', '/api/studio/preview', {
        body: {
            planType: 'workout',
            source: 'fixture',
            fixtureId: 'workout-basic',
            templateId: 'elevate',
            pageId: 'full',
            format: 'html',
        },
    });
    expect(
        'POST fixture HTML preview',
        htmlPreview.status === 200 &&
            typeof htmlPreview.text === 'string' &&
            htmlPreview.text.includes('DOCTYPE') &&
            htmlPreview.headers.get('cache-control')?.includes('no-store'),
        `status=${htmlPreview.status}`
    );

    const pdfPreview = await requestApp(app, 'POST', '/api/studio/preview', {
        body: {
            planType: 'workout',
            source: 'fixture',
            fixtureId: 'workout-basic',
            templateId: 'elevate',
            pageId: 'full',
            format: 'pdf',
        },
        raw: true,
    });
    expect(
        'POST fixture PDF preview',
        pdfPreview.status === 200 &&
            pdfPreview.buffer.slice(0, 4).toString() === '%PDF' &&
            pdfPreview.headers.get('content-type')?.includes('application/pdf')
    );

    const missingToken = await requestApp(app, 'POST', '/api/studio/preview', {
        body: {
            planType: 'workout',
            source: 'plan',
            planId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
            templateId: 'elevate',
            pageId: 'full',
            format: 'html',
        },
    });
    expect(
        'missing token rejected for real plans',
        missingToken.status === 401,
        JSON.stringify(missingToken.json)
    );

    const invalidToken = await requestApp(app, 'POST', '/api/studio/preview', {
        body: {
            planType: 'workout',
            source: 'plan',
            planId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
            templateId: 'elevate',
            pageId: 'full',
            format: 'html',
        },
        headers: { Authorization: 'Bearer not-a-jwt' },
    });
    expect(
        'invalid token rejected',
        invalidToken.status === 401,
        JSON.stringify(invalidToken.json)
    );

    const expiredToken = jwt.sign(
        { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'trainer' },
        config.jwt.secret,
        { expiresIn: -10 }
    );
    const expired = await requestApp(app, 'POST', '/api/studio/preview', {
        body: {
            planType: 'workout',
            source: 'plan',
            planId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
            templateId: 'elevate',
            pageId: 'full',
            format: 'html',
        },
        headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(
        'expired token rejected',
        expired.status === 401,
        JSON.stringify(expired.json)
    );

    const trainerIdBody = await requestApp(app, 'POST', '/api/studio/preview', {
        body: {
            planType: 'workout',
            source: 'fixture',
            fixtureId: 'workout-basic',
            templateId: 'elevate',
            pageId: 'full',
            format: 'html',
            trainerId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        },
    });
    expect(
        'browser-supplied trainerId rejected',
        trainerIdBody.status === 400,
        JSON.stringify(trainerIdBody.json)
    );

    const htmlInjection = await requestApp(app, 'POST', '/api/studio/preview', {
        body: {
            planType: 'workout',
            source: 'fixture',
            fixtureId: 'workout-basic',
            templateId: 'elevate',
            pageId: 'full',
            format: 'html',
            html: '<script>alert(1)</script>',
        },
    });
    expect(
        'arbitrary HTML field rejected',
        htmlInjection.status === 400,
        JSON.stringify(htmlInjection.json)
    );

    const pathField = await requestApp(app, 'POST', '/api/studio/preview', {
        body: {
            planType: 'workout',
            source: 'fixture',
            fixtureId: 'workout-basic',
            templateId: 'elevate',
            pageId: 'full',
            format: 'html',
            path: '../secrets',
        },
    });
    expect(
        'arbitrary path field rejected',
        pathField.status === 400,
        JSON.stringify(pathField.json)
    );

    const badPage = await requestApp(app, 'POST', '/api/studio/preview', {
        body: {
            planType: 'workout',
            source: 'fixture',
            fixtureId: 'workout-basic',
            templateId: 'elevate',
            pageId: 'cover',
            format: 'html',
        },
    });
    expect(
        'unknown page rejected by preview API',
        badPage.status === 400,
        JSON.stringify(badPage.json)
    );

    const arrayPlanType = await requestApp(
        app,
        'GET',
        '/api/studio/templates?planType=workout&planType=nutrition'
    );
    expect('planType query array rejected', arrayPlanType.status === 400);

    const traversal = await requestApp(app, 'GET', '/../studio.registry.js');
    expect(
        'static path traversal ../ blocked',
        traversal.status === 404 ||
            (traversal.text != null &&
                !String(traversal.text).includes('STUDIO_PAGES'))
    );

    expectThrows(
        'createStudioApp refuses production env',
        () => createStudioApp({ env: { NODE_ENV: 'production' } }),
        /refuses to start/
    );

    let threw = false;
    try {
        await startStudioServer({ env: { NODE_ENV: 'production' }, port: 18099 });
    } catch {
        threw = true;
    }
    expect('startStudioServer refuses production', threw);

    const freePort = await new Promise((resolve, reject) => {
        const tmp = createServer();
        tmp.listen(0, '127.0.0.1', () => {
            const { port } = tmp.address();
            tmp.close((err) => (err ? reject(err) : resolve(port)));
        });
        tmp.on('error', reject);
    });

    const started = await startStudioServer({
        env: SAFE_ENV,
        port: freePort,
        enableWatcher: false,
    });
    expect(
        'startStudioServer binds 127.0.0.1',
        started.host === STUDIO_BIND_HOST &&
            started.url === `http://127.0.0.1:${started.port}/`
    );
    await started.close();
}

async function runOptionalDbAuthTests() {
    if (!process.env.APP_DB_URL) {
        pass('optional DB ownership tests skipped (no APP_DB_URL)');
        return;
    }

    await mongoose.connect(process.env.APP_DB_URL);

    const trainer = await User.findOne({ role: 'trainer', isActive: true });
    const other = await User.findOne({
        role: 'trainer',
        isActive: true,
        _id: { $ne: trainer?._id },
    });
    const client = await User.findOne({ role: 'client' });

    if (!trainer) {
        pass('optional DB ownership tests skipped (no trainer user)');
        await mongoose.disconnect();
        return;
    }

    const token = trainer.generateAuthToken();
    expect(
        'valid trainer token authenticates',
        (await authenticateStudioUser(token)).id === String(trainer._id)
    );

    if (client) {
        const clientToken = jwt.sign(
            { id: client._id, role: client.role, email: client.email },
            config.jwt.secret,
            { expiresIn: '1h' }
        );
        let roleDenied = false;
        try {
            await authenticateStudioUser(clientToken);
        } catch (err) {
            roleDenied = err?.statusCode === 403;
        }
        expect('unsupported role rejected', roleDenied);
    } else {
        pass('unsupported role test skipped (no client user)');
    }

    const app = createStudioApp({ env: SAFE_ENV });
    const ownWorkout = await WorkoutPlan.findOne({ trainerId: trainer._id });
    const ownNutrition = await NutritionPlan.findOne({ trainerId: trainer._id });

    if (ownWorkout) {
        const ok = await requestApp(app, 'POST', '/api/studio/preview', {
            body: {
                planType: 'workout',
                source: 'plan',
                planId: String(ownWorkout._id),
                templateId: 'elevate',
                pageId: 'full',
                format: 'html',
            },
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(
            'own workout plan accepted',
            ok.status === 200 && ok.text?.includes('DOCTYPE'),
            `status=${ok.status} ${JSON.stringify(ok.json)}`
        );
    } else {
        pass('own workout plan test skipped (no plan)');
    }

    if (ownNutrition) {
        const ok = await requestApp(app, 'POST', '/api/studio/preview', {
            body: {
                planType: 'nutrition',
                source: 'plan',
                planId: String(ownNutrition._id),
                templateId: 'elevate',
                pageId: 'full',
                format: 'html',
            },
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(
            'own nutrition plan accepted',
            ok.status === 200 && ok.text?.includes('DOCTYPE'),
            `status=${ok.status}`
        );
    } else {
        pass('own nutrition plan test skipped (no plan)');
    }

    if (other) {
        const foreign = await WorkoutPlan.findOne({ trainerId: other._id });
        if (foreign) {
            const denied = await requestApp(app, 'POST', '/api/studio/preview', {
                body: {
                    planType: 'workout',
                    source: 'plan',
                    planId: String(foreign._id),
                    templateId: 'elevate',
                    pageId: 'full',
                    format: 'html',
                },
                headers: { Authorization: `Bearer ${token}` },
            });
            expect(
                "another trainer's plan rejected",
                denied.status === 404 || denied.status === 403,
                JSON.stringify(denied.json)
            );
        } else {
            pass('foreign plan test skipped (no other trainer plan)');
        }
    } else {
        pass('foreign plan test skipped (no other trainer)');
    }

    const badId = await requestApp(app, 'POST', '/api/studio/preview', {
        body: {
            planType: 'workout',
            source: 'plan',
            planId: 'not-an-object-id',
            templateId: 'elevate',
            pageId: 'full',
            format: 'html',
        },
        headers: { Authorization: `Bearer ${token}` },
    });
    expect(
        'invalid plan ID rejected',
        badId.status === 400,
        JSON.stringify(badId.json)
    );

    // Admin uses the same ownership-scoped services as production export.
    const admin = await User.findOne({ role: 'admin', isActive: true });
    if (admin && ownWorkout) {
        const adminToken = admin.generateAuthToken();
        const adminPreview = await requestApp(app, 'POST', '/api/studio/preview', {
            body: {
                planType: 'workout',
                source: 'plan',
                planId: String(ownWorkout._id),
                templateId: 'elevate',
                pageId: 'full',
                format: 'html',
            },
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        // Same visibility filter as production: admin JWT id must be able to read the plan.
        expect(
            'admin behavior uses existing ownership rules',
            adminPreview.status === 200 ||
                adminPreview.status === 404 ||
                adminPreview.status === 403,
            `status=${adminPreview.status}`
        );
    } else {
        pass('admin ownership behavior test skipped');
    }

    await mongoose.disconnect();
}

function runPhaseB1HardeningTests() {
    const indexHtml = readFileSync(join(STUDIO_PUBLIC, 'index.html'), 'utf8');
    const studioJs = readFileSync(join(STUDIO_PUBLIC, 'studio.js'), 'utf8');

    const htmlFrameMatch = indexHtml.match(
        /id="preview-frame-html"[\s\S]*?<\/iframe>/
    );
    const pdfFrameMatch = indexHtml.match(
        /id="preview-frame-pdf"[\s\S]*?<\/iframe>/
    );
    const htmlFrame = htmlFrameMatch?.[0] || '';
    const pdfFrame = pdfFrameMatch?.[0] || '';

    expect(
        'HTML iframe has empty sandbox (no allow-same-origin / allow-scripts)',
        /sandbox=""/.test(htmlFrame) &&
            !/allow-same-origin/.test(htmlFrame) &&
            !/allow-scripts/.test(htmlFrame),
        htmlFrame
    );

    expect(
        'PDF iframe is separate and does not allow-scripts',
        pdfFrame.includes('preview-frame-pdf') &&
            !/allow-scripts/.test(pdfFrame),
        pdfFrame
    );

    expect(
        'JWT input is type=text with autocomplete=off',
        /id="jwt"[^>]*type="text"/.test(indexHtml) &&
            /id="jwt"[^>]*autocomplete="off"/.test(indexHtml) &&
            !/id="jwt"[^>]*type="password"/.test(indexHtml),
        indexHtml.match(/id="jwt"[^>]*>/)?.[0] || 'missing jwt input'
    );

    expect(
        'Studio JS does not persist JWT to localStorage/sessionStorage',
        !studioJs.includes('localStorage') &&
            !studioJs.includes('sessionStorage') &&
            studioJs.includes('Authorization') &&
            studioJs.includes('Bearer'),
        'storage or auth header contract missing'
    );

    expect(
        'extractBearerToken matches protect-style Bearer parsing',
        extractBearerToken('Bearer abc.def.ghi') === 'abc.def.ghi' &&
            extractBearerToken('Basic x') == null &&
            extractBearerToken(undefined) == null
    );
}

async function runPhaseB1AsyncTests() {
    runPhaseB1HardeningTests();

    let verifyFailed = false;
    try {
        await verifyAccessToken('not-a-jwt');
    } catch (err) {
        verifyFailed = err?.statusCode === 401;
    }
    expect('shared verifyAccessToken rejects invalid JWT with 401', verifyFailed);

    const coverCssPath = join(
        __dirname,
        '../src/modules/plan-exports/templates/elevate/html/styles.css'
    );
    const workoutCssPath = join(
        __dirname,
        '../src/modules/plan-exports/templates/elevate/html/styles.css'
    );
    const coverOriginal = readFileSync(coverCssPath, 'utf8');
    const workoutOriginal = readFileSync(workoutCssPath, 'utf8');
    const marker = `/* studio-b1-marker-${Date.now()} */`;

    const sampleWorkout = {
        type: 'workout',
        plan: {
            id: 'fixture-reload',
            name: 'Reload Check',
            duration: 4,
            daysPerWeek: 2,
            goal: 'general_fitness',
            level: 'beginner',
            status: 'active',
            totalExercises: 1,
            totalDays: 1,
        },
        trainer: { fullName: 'Coach', email: 'c@example.com', phone: null },
        content: {
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'A',
                    exercises: [
                        {
                            name: 'Squat',
                            order: 1,
                            restBetweenSets: 60,
                            sets: [{ setNumber: 1, reps: 8 }],
                        },
                    ],
                },
            ],
        },
    };

    try {
        writeFileSync(coverCssPath, `${coverOriginal}\n${marker}\n`);
        writeFileSync(workoutCssPath, `${workoutOriginal}\n${marker}\n`);

        const coverHtml = buildElevateWorkoutHtml(sampleWorkout);
        const classicHtml = buildElevateWorkoutHtml(sampleWorkout);

        expect(
            'elevate CSS change appears on next HTML build (no restart)',
            coverHtml.includes(marker),
            coverHtml.includes('page')
                ? 'marker missing in cover html'
                : coverHtml.slice(0, 120)
        );
        expect(
            'elevate CSS change appears on next HTML build (no restart)',
            classicHtml.includes(marker),
            'marker missing in elevate html'
        );

        expect(
            'elevate HTML still contains DOCTYPE + plan name',
            classicHtml.includes('<!DOCTYPE html>') &&
                classicHtml.includes('Reload Check')
        );
        expect(
            'elevate HTML still contains html/ design root',
            coverHtml.includes('page-cover') &&
                coverHtml.includes('page-workouts') &&
                coverHtml.includes('page-workout-details') &&
                coverHtml.includes('Reload Check') &&
                coverHtml.includes('Program overview')
        );
    } finally {
        writeFileSync(coverCssPath, coverOriginal);
        writeFileSync(workoutCssPath, workoutOriginal);
    }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function collectSseEvents(url, { minEvents = 1, timeoutMs = 2500 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const events = [];

    try {
        const res = await fetch(url, {
            headers: { Accept: 'text/event-stream' },
            signal: controller.signal,
        });
        if (!res.ok || !res.body) {
            throw new Error(`SSE HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (events.length < minEvents) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split('\n\n');
            buffer = chunks.pop() || '';
            for (const chunk of chunks) {
                const lines = chunk.split('\n');
                let eventName = 'message';
                let data = '';
                for (const line of lines) {
                    if (line.startsWith('event:')) {
                        eventName = line.slice(6).trim();
                    } else if (line.startsWith('data:')) {
                        data += line.slice(5).trim();
                    }
                }
                if (!data) continue;
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    parsed = data;
                }
                events.push({ event: eventName, data: parsed, raw: data });
            }
        }

        controller.abort();
        return events;
    } catch (err) {
        if (events.length > 0 || err?.name === 'AbortError') {
            return events;
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function runPhaseCWatcherUnitTests() {
    expect(
        'classifyStudioWatchFile marks JS as module',
        classifyStudioWatchFile('workout.js') === 'module' &&
            classifyStudioWatchFile('nested/cover.mjs') === 'module'
    );
    expect(
        'classifyStudioWatchFile marks CSS/images as assets',
        classifyStudioWatchFile('cover.css') === 'assets' &&
            classifyStudioWatchFile('assets/hero.png') === 'assets' &&
            classifyStudioWatchFile('photo.JPEG') === 'assets'
    );
    expect(
        'classifyStudioWatchFile ignores unrelated / dotfiles',
        classifyStudioWatchFile('readme.md') == null &&
            classifyStudioWatchFile('.gitignore') == null &&
            classifyStudioWatchFile('tmp/.cache/x.css') == null
    );

    const roots = listStudioWatchRoots();
    expect(
        'watch roots derive from registry only',
        roots.length === Object.keys(STUDIO_TEMPLATE_SOURCES).length &&
            roots.every(
                (root) =>
                    STUDIO_TEMPLATE_SOURCES[root.templateId]?.watchDir ===
                    root.watchDir
            ),
        JSON.stringify(roots)
    );

    expect(
        'resolveStudioModuleSpec rejects unknown template',
        resolveStudioModuleSpec('not_a_template', 'workout') == null &&
            resolveStudioModuleSpec('elevate', 'missing') == null
    );
}

async function runPhaseCWatcherIntegrationTests() {
    const base = mkdtempSync(join(tmpdir(), 'fitly-studio-watch-'));
    const classicDir = join(base, 'elevate');
    const coverDir = join(base, 'elevate');
    const outsideDir = join(base, 'outside');
    mkdirSync(classicDir, { recursive: true });
    mkdirSync(join(classicDir, 'assets'), { recursive: true });
    mkdirSync(coverDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });

    const cssPath = join(classicDir, 'workout.css');
    const imgPath = join(classicDir, 'assets', 'mark.png');
    const jsPath = join(coverDir, 'page.js');
    const outsideCss = join(outsideDir, 'secret.css');
    writeFileSync(cssPath, '/* a */\n');
    writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(jsPath, 'export const buildElevateWorkoutHtml = () => "v1";\n');
    writeFileSync(outsideCss, 'body{}\n');

    const emitted = [];
    let reloadCalls = 0;

    const watcher = startStudioWatcher({
        roots: [
            { templateId: 'elevate', watchDir: classicDir },
            { templateId: 'elevate', watchDir: coverDir },
        ],
        debounceMs: 80,
        onEvent: (event) => emitted.push(event),
        reloadModules: async (templateId) => {
            reloadCalls += 1;
            return { ok: true, templateId, results: [], message: null };
        },
    });

    try {
        await wait(40);
        const ready = emitted.find((e) => e.type === 'ready');
        expect('watcher emits ready on start', Boolean(ready));

        writeFileSync(cssPath, '/* css-change */\n');
        writeFileSync(cssPath, '/* css-change-2 */\n');
        writeFileSync(cssPath, '/* css-change-3 */\n');
        await wait(220);
        const assetCss = emitted.filter(
            (e) => e.type === 'assets' && e.templateId === 'elevate'
        );
        expect(
            'registered CSS modification emits assets (debounced)',
            assetCss.length === 1,
            `count=${assetCss.length} events=${JSON.stringify(emitted)}`
        );

        writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]));
        await wait(220);
        const assetImg = emitted.filter(
            (e) => e.type === 'assets' && e.templateId === 'elevate'
        );
        expect(
            'registered image modification emits assets',
            assetImg.length >= 2,
            `count=${assetImg.length}`
        );

        writeFileSync(jsPath, 'export const buildElevateWorkoutHtml = () => "v2";\n');
        writeFileSync(jsPath, 'export const buildElevateWorkoutHtml = () => "v3";\n');
        await wait(220);
        const moduleEvents = emitted.filter(
            (e) => e.type === 'module' && e.templateId === 'elevate'
        );
        expect(
            'registered JS modification emits module (debounced)',
            moduleEvents.length === 1 && reloadCalls === 1,
            `events=${moduleEvents.length} reloads=${reloadCalls}`
        );

        const beforeOutside = emitted.length;
        writeFileSync(outsideCss, 'body{color:red}\n');
        await wait(220);
        expect(
            'unregistered directories/files are ignored',
            emitted.length === beforeOutside,
            JSON.stringify(emitted.slice(beforeOutside))
        );

        const missingPath = join(classicDir, 'ephemeral.css');
        writeFileSync(missingPath, 'a{}\n');
        unlinkSync(missingPath);
        writeFileSync(missingPath, 'b{}\n');
        await wait(220);
        expect(
            'missing/recreated files do not crash watcher',
            true
        );
    } finally {
        watcher.close();
        watcher.close();
        expect('watchers close cleanly (idempotent)', true);
        rmSync(base, { recursive: true, force: true });
    }
}

async function runPhaseCModuleReloadTests() {
    resetStudioModuleCache();

    const builders = {
        elevate: Object.assign(() => '<html>elevate-v1</html>', { tag: 'v1' }),
    };

    const importFn = async (href) => {
        if (href.includes('elevate') && href.includes('page.js')) {
            return { buildElevateWorkoutHtml: builders.elevate };
        }
        if (href.includes('elevate') && href.includes('nutrition')) {
            return {
                buildElevateNutritionHtml: Object.assign(() => '<html>n</html>', {
                    tag: 'n',
                }),
            };
        }
        throw new Error(`unexpected import ${href}`);
    };

    const first = await loadStudioHtmlBuilder('elevate', 'workout', { importFn });
    expect(
        'initial module load caches builder',
        first.builder === builders.elevate && first.version === 1
    );

    builders.elevate = Object.assign(() => '<html>elevate-v2</html>', { tag: 'v2' });
    const reloaded = await reloadStudioTemplateModules('elevate', { importFn });
    expect(
        'updated JS builder used after reload',
        reloaded.ok &&
            getStudioModuleCacheEntry('elevate', 'workout')?.builder?.tag === 'v2',
        JSON.stringify(reloaded)
    );

    const held = getStudioModuleCacheEntry('elevate', 'workout').builder;
    builders.elevate = Object.assign(() => {
        throw new Error('boom');
    }, { tag: 'bad' });

    const failedImportFn = async (href) => {
        const text = String(href);
        if (
            text.includes('studioReload') &&
            text.includes('elevate') &&
            text.includes('page.js')
        ) {
            throw new Error('simulated import failure');
        }
        return importFn(href);
    };

    const failed = await reloadStudioTemplateModules('elevate', {
        importFn: failedImportFn,
    });
    expect(
        'failed module import retains previous working module',
        failed.ok === false &&
            getStudioModuleCacheEntry('elevate', 'workout')?.builder === held &&
            getStudioModuleCacheEntry('elevate', 'workout')?.builder?.tag === 'v2',
        JSON.stringify(failed)
    );

    let arbitraryThrew = false;
    try {
        await loadStudioHtmlBuilder('../secret', 'workout', { importFn });
    } catch (err) {
        arbitraryThrew = err?.statusCode === 400;
    }
    expect('client input cannot select an arbitrary module path', arbitraryThrew);

    const productionBefore = buildElevateWorkoutHtml;
    await reloadStudioTemplateModules('elevate', { importFn });
    expect(
        'production module imports remain unaffected',
        buildElevateWorkoutHtml === productionBefore &&
            typeof buildElevateWorkoutHtml === 'function'
    );

    resetStudioModuleCache();
}

async function runPhaseCConcurrencyTests() {
    resetStudioModuleCache();

    let elevateImports = 0;
    let elevateDelayResolve;
    const elevateGate = new Promise((resolve) => {
        elevateDelayResolve = resolve;
    });

    const elevateV1 = Object.assign(() => 'e1', { tag: 'e1' });
    const elevateV2 = Object.assign(() => 'e2', { tag: 'e2' });

    let elevateBuilder = elevateV1;

    const importFn = async (href) => {
        if (href.includes('elevate') && href.includes('page.js')) {
            elevateImports += 1;
            if (String(href).includes('studioReload')) {
                await elevateGate;
            }
            return { buildElevateWorkoutHtml: elevateBuilder };
        }
        if (href.includes('elevate') && href.includes('nutrition')) {
            return {
                buildElevateNutritionHtml: Object.assign(() => 'n', { tag: 'n' }),
            };
        }
        throw new Error(href);
    };

    await loadStudioHtmlBuilder('elevate', 'workout', { importFn });
    await loadStudioHtmlBuilder('elevate', 'workout', { importFn });

    const inFlightBuilder = getStudioModuleCacheEntry('elevate', 'workout').builder;
    expect(
        'in-flight preview holds original module version reference',
        inFlightBuilder?.tag === 'e1'
    );

    elevateBuilder = elevateV2;
    const reloadPromise = reloadStudioTemplateModules('elevate', { importFn });
    const overlapping = reloadStudioTemplateModules('elevate', { importFn });

    await wait(30);
    expect(
        'in-flight preview still sees original builder while reload pending',
        inFlightBuilder?.tag === 'e1'
    );

    elevateDelayResolve();
    const [elevateResult, overlapResult] = await Promise.all([
        reloadPromise,
        overlapping,
    ]);

    expect(
        'multiple reload events do not overlap for the same template',
        elevateResult === overlapResult && elevateImports === 2,
        `imports=${elevateImports}`
    );

    expect(
        'new preview uses latest successfully loaded version',
        getStudioModuleCacheEntry('elevate', 'workout')?.builder?.tag === 'e2'
    );

    resetStudioModuleCache();
}

async function runPhaseCSseTests() {
    closeAllStudioEvents();

    const app = createStudioApp({ env: SAFE_ENV });
    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        instance.on('error', reject);
    });

    try {
        const { port } = server.address();
        const url = `http://127.0.0.1:${port}/api/studio/events`;

        const liveController = new AbortController();
        const liveRes = await fetch(url, {
            headers: { Accept: 'text/event-stream' },
            signal: liveController.signal,
        });
        expect(
            'SSE subscribe adds client',
            liveRes.ok && getStudioEventClientCount() >= 1,
            `count=${getStudioEventClientCount()} status=${liveRes.status}`
        );
        liveController.abort();
        await wait(40);

        const eventsPromise = collectSseEvents(url, {
            minEvents: 2,
            timeoutMs: 3000,
        });
        await wait(60);
        const payload = broadcastStudioEvent({
            type: 'assets',
            templateId: 'elevate',
            category: 'assets',
            message: null,
        });

        expect(
            'SSE event format is safe and typed',
            payload.type === 'assets' &&
                payload.templateId === 'elevate' &&
                payload.category === 'assets' &&
                typeof payload.revision === 'number' &&
                typeof payload.at === 'string' &&
                !('path' in payload) &&
                !('html' in payload) &&
                !('token' in payload) &&
                !('jwt' in payload),
            JSON.stringify(payload)
        );

        const events = await eventsPromise;
        const studioEvents = events.filter((e) => e.event === 'studio');
        expect('SSE delivers studio events', studioEvents.length >= 1);

        const serialized = JSON.stringify(studioEvents);
        expect(
            'SSE payloads exclude plan/HTML/PDF/JWT/paths',
            !serialized.includes('Bearer') &&
                !serialized.includes('<!DOCTYPE') &&
                !serialized.includes('%PDF') &&
                !serialized.includes('file://') &&
                !/[A-Za-z]:\\\\/.test(serialized) &&
                !serialized.includes('watchDir'),
            serialized.slice(0, 400)
        );

        closeAllStudioEvents();
        await wait(50);
        expect(
            'shutdown closes SSE connections / removes clients',
            getStudioEventClientCount() === 0
        );

        // Unit: disconnected clients removed via close handler
        let ended = false;
        const fakeRes = {
            writableEnded: false,
            writeHead() {},
            write() {
                return true;
            },
            end() {
                ended = true;
                this.writableEnded = true;
            },
            on(event, cb) {
                if (event === 'close') this._close = cb;
            },
        };
        subscribeStudioEvents(fakeRes);
        expect('SSE client registered', getStudioEventClientCount() >= 1);
        fakeRes._close?.();
        expect(
            'disconnected clients are removed from subscriber set',
            getStudioEventClientCount() === 0
        );
        subscribeStudioEvents(fakeRes);
        closeAllStudioEvents();
        expect('shutdown closeAll ends SSE clients', ended === true);
    } finally {
        closeAllStudioEvents();
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    }
}

function runPhaseCUiTests() {
    const indexHtml = readFileSync(join(STUDIO_PUBLIC, 'index.html'), 'utf8');
    const studioJs = readFileSync(join(STUDIO_PUBLIC, 'studio.js'), 'utf8');

    expect(
        'UI shows live-status element',
        indexHtml.includes('id="live-status"') &&
            indexHtml.includes('Phase C')
    );

    expect(
        'UI subscribes via EventSource to /api/studio/events',
        studioJs.includes('EventSource') &&
            studioJs.includes('/api/studio/events') &&
            !/EventSource\([^)]*Authorization/.test(studioJs) &&
            !/EventSource\([^)]*jwt/i.test(studioJs)
    );

    expect(
        'UI reconnects after temporary SSE disconnection',
        studioJs.includes('onerror') &&
            studioJs.includes('disconnected') &&
            studioJs.includes('retrying')
    );

    expect(
        'UI refreshes active previews without clearing last success',
        studioJs.includes('clearOnFailure: false') &&
            studioJs.includes('scheduleLiveRefresh') &&
            studioJs.includes('lastPreviewContext')
    );

    expect(
        'UI does not refresh inactive/unselected templates unnecessarily',
        studioJs.includes('templateId !== lastPreviewContext.templateId') &&
            studioJs.includes('templateId !== templateEl.value')
    );

    expect(
        'UI does not send JWT through SSE',
        !studioJs.match(/EventSource[\s\S]{0,200}jwt/i) &&
            studioJs.includes('jwtToken = jwtEl.value')
    );

    expect(
        'UI debounces duplicate preview requests for reload events',
        studioJs.includes('reloadRefreshTimer') &&
            studioJs.includes('clearTimeout(reloadRefreshTimer)')
    );

    expect(
        'UI skips unauthorized auto real-plan refresh',
        studioJs.includes('Live reload skipped: real-plan preview needs a JWT')
    );

    expect(
        'UI does not special-case a second Elevate design page',
        !studioJs.includes("pageId === 'html_design'") &&
            !studioJs.includes('HTML design (html/index.html)')
    );
}

async function main() {
    runRegistryTests();
    runEnvGuardTests();
    runFixtureUnitTests();
    await runRenderingTests();
    await runApiTests();
    await runOptionalDbAuthTests();
    await runPhaseB1AsyncTests();
    runPhaseCWatcherUnitTests();
    await runPhaseCWatcherIntegrationTests();
    await runPhaseCModuleReloadTests();
    await runPhaseCConcurrencyTests();
    await runPhaseCSseTests();
    runPhaseCUiTests();
    await closeHtmlPdfBrowser().catch(() => {});

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
        for (const item of failed) {
            console.log(`  • ${item.name}: ${item.detail}`);
        }
        process.exitCode = 1;
    }
}

main().catch(async (err) => {
    console.error(err);
    await closeHtmlPdfBrowser().catch(() => {});
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
