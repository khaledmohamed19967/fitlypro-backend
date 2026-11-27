/**
 * Plan PDF export tests (HTML + Chromium renderer).
 * Run: node scripts/test-plan-exports.mjs
 * Requires: API server running + APP_DB_URL + Playwright Chromium installed
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import config from '../src/config/index.js';
import {
    buildExportFilename,
    buildWorkoutExportModel,
    sanitizeFilenamePart,
} from '../src/modules/plan-exports/plan-export.helpers.js';
import {
    getTemplateMeta,
    getTemplatePlanAssets,
    listExportTemplates,
    resolveTemplateRenderer,
} from '../src/modules/plan-exports/templates/index.js';
import {
    buildElevateNutritionHtml,
    buildElevateWorkoutHtml,
    renderElevateWorkoutPdf,
} from '../src/modules/plan-exports/templates/elevate/index.js';
import {
    buildHighlightedTitleHtml,
    fitElevateTitleLayout,
} from '../src/modules/plan-exports/templates/elevate/page.js';
import { escapeHtml } from '../src/modules/plan-exports/pdf/htmlEscape.js';
import { buildPublicExerciseUrl } from '../src/modules/plan-exports/pdf/publicExerciseUrl.js';
import { renderHtmlToPdf, closeHtmlPdfBrowser } from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';
import { validatePlanExportBody } from '../src/modules/plan-exports/plan-export.validator.js';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const BASE = process.env.API_URL || 'http://localhost:8000';
const API = `${BASE}/api/v1`;
const results = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};

const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

async function request(method, path, { token, body, raw } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (raw) {
        const buffer = Buffer.from(await res.arrayBuffer());
        return { status: res.status, headers: res.headers, buffer };
    }

    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

async function runUnitTests() {
    if (sanitizeFilenamePart('My Cool Plan!!!') === 'my-cool-plan') {
        pass('filename sanitization');
    } else {
        fail('filename sanitization', sanitizeFilenamePart('My Cool Plan!!!'));
    }

    const filename = buildExportFilename('nutrition', 'High Protein');
    if (filename === 'nutrition-plan-high-protein.pdf') pass('export filename');
    else fail('export filename', filename);

    const templates = listExportTemplates('nutrition');
    if (
        templates.length >= 1 &&
        templates.every((t) => t.supportedPlanTypes.includes('nutrition'))
    ) {
        pass('template list filters by plan type');
    } else {
        fail('template list filters by plan type', JSON.stringify(templates));
    }

    const elevateMeta = getTemplateMeta('elevate');
    const elevateNutritionPreview =
        elevateMeta?.assets?.nutrition?.previewImageUrl ?? null;
    const elevateWorkoutPreview =
        elevateMeta?.assets?.workout?.previewImageUrl ?? null;
    const allTemplates = listExportTemplates();
    if (
        allTemplates.length === 1 &&
        allTemplates[0].id === 'elevate' &&
        getTemplateMeta('classic') == null &&
        !allTemplates.some((t) => t.id === 'classic')
    ) {
        pass('templates registry is Elevate-only');
    } else {
        fail('templates registry is Elevate-only', JSON.stringify(allTemplates));
    }

    const nutritionElevate = listExportTemplates('nutrition').find(
        (t) => t.id === 'elevate'
    );
    if (
        nutritionElevate?.previewUrl === elevateNutritionPreview &&
        nutritionElevate?.assets?.previewImageUrl === elevateNutritionPreview &&
        typeof elevateNutritionPreview === 'string'
    ) {
        pass('nutrition templates expose elevate preview URL');
    } else {
        fail(
            'nutrition templates expose elevate preview URL',
            JSON.stringify(nutritionElevate)
        );
    }

    const workoutElevate = listExportTemplates('workout').find(
        (t) => t.id === 'elevate'
    );
    if (
        workoutElevate &&
        workoutElevate.previewUrl === elevateWorkoutPreview &&
        workoutElevate.assets?.previewImageUrl === elevateWorkoutPreview
    ) {
        pass('workout templates expose elevate preview URL');
    } else {
        fail(
            'workout templates expose elevate preview URL',
            JSON.stringify(workoutElevate)
        );
    }

    const unscopedElevate = listExportTemplates().find((t) => t.id === 'elevate');
    if (
        unscopedElevate?.previewUrl == null &&
        unscopedElevate?.assets?.nutrition?.previewImageUrl ===
            elevateNutritionPreview &&
        unscopedElevate?.assets?.workout?.previewImageUrl === elevateWorkoutPreview
    ) {
        pass('unscoped templates keep plan-type previews namespaced');
    } else {
        fail(
            'unscoped templates keep plan-type previews namespaced',
            JSON.stringify(unscopedElevate)
        );
    }

    if (
        getTemplatePlanAssets('elevate', 'nutrition')?.previewImageUrl ===
            elevateNutritionPreview &&
        getTemplatePlanAssets('elevate', 'workout')?.previewImageUrl ===
            elevateWorkoutPreview &&
        getTemplatePlanAssets('classic', 'workout') == null
    ) {
        pass('template plan assets resolve without controller hardcoding');
    } else {
        fail(
            'template plan assets resolve without controller hardcoding',
            JSON.stringify({
                nutrition: getTemplatePlanAssets('elevate', 'nutrition'),
                workout: getTemplatePlanAssets('elevate', 'workout'),
            })
        );
    }

    if (getTemplateMeta('elevate') && !getTemplateMeta('missing')) {
        pass('template registry lookup');
    } else {
        fail('template registry lookup', 'elevate/missing');
    }

    if (
        resolveTemplateRenderer('classic', 'workout') == null &&
        resolveTemplateRenderer('classic', 'nutrition') == null &&
        typeof resolveTemplateRenderer('elevate', 'workout') === 'function' &&
        typeof resolveTemplateRenderer('elevate', 'nutrition') === 'function' &&
        resolveTemplateRenderer('nope', 'workout') == null
    ) {
        pass('template renderer resolution (Elevate only)');
    } else {
        fail('template renderer resolution (Elevate only)', 'unexpected renderers');
    }

    const classicValidation = validatePlanExportBody.validate({
        planType: 'workout',
        planId: '507f1f77bcf86cd799439011',
        templateId: 'classic',
    });
    if (classicValidation.error) {
        pass('validator rejects classic templateId');
    } else {
        fail('validator rejects classic templateId', 'classic accepted');
    }

    const coverMeta = getTemplateMeta('elevate');
    const coverPreview = coverMeta?.assets?.workout?.previewImageUrl ?? null;
    const workoutCoverListed = listExportTemplates('workout').find(
        (t) => t.id === 'elevate'
    );
    const nutritionCoverListed = listExportTemplates('nutrition').find(
        (t) => t.id === 'elevate'
    );
    if (
        coverMeta &&
        coverMeta.supportedPlanTypes.includes('workout') &&
        coverMeta.supportedPlanTypes.includes('nutrition') &&
        typeof coverPreview === 'string' &&
        coverMeta.name === 'Elevate' &&
        coverPreview ===
            'https://ik.imagekit.io/6nagrfhcm/template-cover.png' &&
        workoutCoverListed?.previewUrl === coverPreview &&
        workoutCoverListed?.name === 'Elevate' &&
        nutritionCoverListed?.id === 'elevate'
    ) {
        pass('elevate template registry + workout/nutrition discovery');
    } else {
        fail(
            'elevate template registry + workout/nutrition discovery',
            JSON.stringify({ coverMeta, workoutCoverListed, nutritionCoverListed })
        );
    }

    const highlighted = buildHighlightedTitleHtml('Full Body <b>Foundations</b>');
    if (
        highlighted.includes('Full') &&
        highlighted.includes('Body') &&
        highlighted.includes('<span>&lt;b&gt;Foundations&lt;/b&gt;</span>') &&
        !highlighted.includes('<b>Foundations</b>')
    ) {
        pass('elevate title highlight escapes user text');
    } else {
        fail('elevate title highlight escapes user text', highlighted);
    }

    const shortTitle = fitElevateTitleLayout('Full Body Foundations');
    const mediumTitle = fitElevateTitleLayout('Full Body — Beginner Copy 5');
    const longTitle = fitElevateTitleLayout(
        'Very Long Progressive Overload Hypertrophy Foundations Program'
    );
    const longTokenTitle = fitElevateTitleLayout(
        'SupercalifragilisticexpialidociousStrength'
    );
    if (
        shortTitle.mode === 'split-last' &&
        shortTitle.fontSize === 55 &&
        shortTitle.titleHtml.includes('<br>') &&
        shortTitle.titleHtml.includes('<span>Foundations</span>') &&
        mediumTitle.fontSize < 55 &&
        mediumTitle.mode === 'flow' &&
        !mediumTitle.titleHtml.includes('<br>') &&
        mediumTitle.titleHtml.includes('<span>5</span>') &&
        mediumTitle.lineCount <= 2 &&
        longTitle.fontSize <= mediumTitle.fontSize &&
        longTitle.lineCount <= 3 &&
        longTokenTitle.fontSize <= 30 &&
        longTokenTitle.mode === 'flow' &&
        longTokenTitle.titleHtml.includes('SupercalifragilisticexpialidociousStrength')
    ) {
        pass('elevate title layout scales with name length');
    } else {
        fail(
            'elevate title layout scales with name length',
            JSON.stringify({ shortTitle, mediumTitle, longTitle, longTokenTitle })
        );
    }

    if (
        escapeHtml('<script>alert(1)</script>') ===
        '&lt;script&gt;alert(1)&lt;/script&gt;'
    ) {
        pass('html escape');
    } else {
        fail('html escape', escapeHtml('<script>'));
    }

    const clientBase = String(config.clientApp.url || '').replace(/\/+$/, '');
    const slugUrl = buildPublicExerciseUrl({
        exerciseId: 'abc123',
        slug: 'barbell-bench-press',
        ownershipType: 'system',
        status: 'active',
    });
    if (slugUrl === `${clientBase}/exercises/barbell-bench-press`) {
        pass('public exercise URL prefers slug');
    } else {
        fail('public exercise URL prefers slug', slugUrl);
    }

    const idUrl = buildPublicExerciseUrl({
        exerciseId: '507f1f77bcf86cd799439011',
        slug: null,
        ownershipType: 'system',
        status: 'active',
    });
    if (idUrl === `${clientBase}/exercises/507f1f77bcf86cd799439011`) {
        pass('public exercise URL falls back to id');
    } else {
        fail('public exercise URL falls back to id', idUrl);
    }

    if (
        buildPublicExerciseUrl({
            exerciseId: 'abc123',
            slug: 'custom-move',
            ownershipType: 'trainer',
            status: 'active',
        }) == null
    ) {
        pass('trainer-owned exercise has no public URL');
    } else {
        fail('trainer-owned exercise has no public URL', 'unexpected url');
    }

    if (
        buildPublicExerciseUrl({
            exerciseId: 'abc123',
            slug: 'old-move',
            ownershipType: 'system',
            status: 'archived',
        }) == null
    ) {
        pass('archived system exercise has no public URL');
    } else {
        fail('archived system exercise has no public URL', 'unexpected url');
    }

    if (
        buildPublicExerciseUrl({
            exerciseId: null,
            slug: null,
            ownershipType: 'system',
            status: 'active',
        }) == null &&
        buildPublicExerciseUrl({}) == null
    ) {
        pass('missing/unresolved exercise has no public URL');
    } else {
        fail('missing/unresolved exercise has no public URL', 'unexpected url');
    }

    if (clientBase && !clientBase.includes('/api/')) {
        pass('public exercise URL uses configured client app base');
    } else {
        fail('public exercise URL uses configured client app base', clientBase);
    }

    const sampleNutrition = {
        type: 'nutrition',
        plan: {
            id: '1',
            name: 'Muscle Gain <b>Hack</b>',
            description: 'Desc',
            duration: 12,
            daysCount: 1,
            goal: 'muscle_gain',
            scheduleMode: 'daily',
            status: 'active',
            macroTargets: { calories: 3000, protein: 200, carbs: 320, fat: 80 },
            computedMacros: { calories: 1440, protein: 161, carbs: 100, fat: 41 },
        },
        trainer: {
            fullName: 'Khaled Mohamed',
            email: 'khaled@fitlypro.com',
            phone: '0110050580',
        },
        content: {
            nutritionDays: [
                {
                    dayNumber: 1,
                    meals: [
                        {
                            order: 1,
                            name: 'Breakfast',
                            suggestedTime: '07:30',
                            mealTotals: {
                                calories: 339,
                                protein: 25,
                                carbs: 19,
                                fat: 18,
                            },
                            foodItems: [
                                {
                                    name: 'Eggs (Whole)',
                                    quantity: 3,
                                    unit: 'piece',
                                    itemMacros: {
                                        calories: 233,
                                        protein: 19,
                                        carbs: 2,
                                        fat: 16,
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    };

    const nutritionHtml = buildElevateNutritionHtml(sampleNutrition);
    if (
        nutritionHtml.includes('page-nutrition-cover') &&
        nutritionHtml.includes('Breakfast') &&
        nutritionHtml.includes('Eggs (Whole)') &&
        nutritionHtml.includes('lang="en"') &&
        !nutritionHtml.includes('ucarecdn.com')
    ) {
        pass('elevate nutrition HTML content structure');
    } else {
        fail(
            'elevate nutrition HTML content structure',
            nutritionHtml.slice(0, 500)
        );
    }

    const linkedExerciseUrl = buildPublicExerciseUrl({
        exerciseId: '507f1f77bcf86cd799439011',
        slug: 'barbell-squat',
        ownershipType: 'system',
        status: 'active',
    });
    const workoutModel = {
        type: 'workout',
        plan: {
            id: '2',
            name: 'Full Body <b>Test</b>',
            description: 'Progressive overload program for general fitness.',
            duration: 8,
            daysPerWeek: 3,
            goal: 'general_fitness',
            level: 'beginner',
            status: 'active',
        },
        trainer: {
            fullName: 'Coach',
            email: 'coach@example.com',
            phone: '+1 555 0100',
        },
        content: {
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Push',
                    exercises: [
                        {
                            exerciseId: '507f1f77bcf86cd799439011',
                            slug: 'barbell-squat',
                            ownershipType: 'system',
                            status: 'active',
                            name: 'Squat',
                            order: 1,
                            restBetweenSets: 60,
                            notes: 'Keep chest up',
                            sets: [
                                { setNumber: 1, reps: 10 },
                                { setNumber: 2, reps: 10 },
                            ],
                        },
                        {
                            exerciseId: 'trainer-ex-1',
                            slug: 'my-custom-press',
                            ownershipType: 'trainer',
                            status: 'active',
                            name: 'Custom Press',
                            order: 2,
                            restBetweenSets: 45,
                            sets: [{ setNumber: 1, reps: 8 }],
                        },
                    ],
                },
            ],
        },
    };
    const workoutHtml = buildElevateWorkoutHtml(workoutModel);
    if (
        workoutHtml.includes('Squat') &&
        workoutHtml.includes('Custom Press') &&
        workoutHtml.includes('page-cover') &&
        workoutHtml.includes('page-workouts') &&
        workoutHtml.includes('lang="en"') &&
        !workoutHtml.includes('ucarecdn.com')
    ) {
        pass('elevate workout HTML content structure');
    } else {
        fail(
            'elevate workout HTML content structure',
            workoutHtml.slice(0, 500)
        );
    }

    if (
        linkedExerciseUrl &&
        workoutHtml.includes(linkedExerciseUrl) &&
        workoutHtml.includes('Keep chest up')
    ) {
        pass('eligible exercise name is linked; notes stay present');
    } else {
        fail(
            'eligible exercise name is linked; notes stay present',
            `url=${linkedExerciseUrl} linked=${workoutHtml.includes(linkedExerciseUrl)}`
        );
    }

    if (
        workoutHtml.includes('Custom Press') &&
        !workoutHtml.includes('my-custom-press')
    ) {
        pass('ineligible exercise name stays plain text');
    } else {
        fail(
            'ineligible exercise name stays plain text',
            workoutHtml.match(/Custom Press[\s\S]{0,80}/)?.[0] || 'missing'
        );
    }

    const exportModel = buildWorkoutExportModel(
        {
            id: 'plan-1',
            name: 'Export Map Plan',
            duration: 4,
            daysPerWeek: 2,
            goal: 'strength',
            level: 'beginner',
            status: 'active',
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'A',
                    exercises: [
                        {
                            exerciseId: '507f1f77bcf86cd799439011',
                            exercise: {
                                id: '507f1f77bcf86cd799439011',
                                name: 'Bench Press',
                                slug: 'barbell-bench-press',
                                ownershipType: 'system',
                                status: 'active',
                            },
                            order: 1,
                            restBetweenSets: 90,
                            sets: [{ setNumber: 1, reps: 5 }],
                        },
                    ],
                },
            ],
        },
        { fullName: 'Coach' }
    );
    const mapped = exportModel.content.workoutDays[0].exercises[0];
    if (
        mapped.exerciseId === '507f1f77bcf86cd799439011' &&
        mapped.slug === 'barbell-bench-press' &&
        mapped.ownershipType === 'system' &&
        mapped.status === 'active' &&
        mapped.name === 'Bench Press'
    ) {
        pass('workout export model includes public-link fields');
    } else {
        fail('workout export model includes public-link fields', JSON.stringify(mapped));
    }

    const exportDay = exportModel.content.workoutDays[0];
    if (
        Array.isArray(exportDay.warmupActivities) &&
        exportDay.warmupActivities.length === 0 &&
        Array.isArray(exportDay.cardioActivities) &&
        exportDay.cardioActivities.length === 0
    ) {
        pass('workout export model includes empty warm-up/cardio arrays');
    } else {
        fail(
            'workout export model includes empty warm-up/cardio arrays',
            JSON.stringify({
                warmup: exportDay.warmupActivities,
                cardio: exportDay.cardioActivities,
            })
        );
    }

    const exportWithActivities = buildWorkoutExportModel(
        {
            id: 'plan-acts',
            name: 'Activities Export',
            duration: 4,
            daysPerWeek: 1,
            goal: 'general_fitness',
            level: 'beginner',
            status: 'active',
            totalExercises: 1,
            totalDays: 1,
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'A',
                    warmupActivities: [
                        {
                            activityType: 'walking',
                            order: 1,
                            durationMinutes: 5,
                            intensity: 'low',
                            notes: 'Easy',
                            exerciseId: '507f1f77bcf86cd799439021',
                            exercise: {
                                id: '507f1f77bcf86cd799439021',
                                name: 'Walking',
                                slug: 'walking',
                                ownershipType: 'system',
                                status: 'active',
                                thumbnailUrl: 'https://cdn.example.com/walking.png',
                            },
                            activitySnapshot: {
                                name: 'Walking',
                                thumbnailUrl: 'https://cdn.example.com/walking.png',
                            },
                        },
                    ],
                    exercises: [
                        {
                            exerciseId: '507f1f77bcf86cd799439011',
                            exerciseSnapshot: { name: 'Bench Press' },
                            order: 1,
                            restBetweenSets: 90,
                            sets: [{ setNumber: 1, reps: 5 }],
                        },
                    ],
                    cardioActivities: [
                        {
                            activityType: 'treadmill',
                            protocol: 'continuous',
                            order: 1,
                            durationMinutes: 20,
                            intensity: 'moderate',
                            activitySnapshot: { name: 'Treadmill', thumbnailUrl: null },
                        },
                    ],
                },
            ],
        },
        { fullName: 'Coach' }
    );
    const actDay = exportWithActivities.content.workoutDays[0];
    if (
        actDay.warmupActivities?.[0]?.name === 'Walking' &&
        actDay.warmupActivities[0].durationMinutes === 5 &&
        actDay.warmupActivities[0].exerciseId === '507f1f77bcf86cd799439021' &&
        actDay.warmupActivities[0].slug === 'walking' &&
        actDay.warmupActivities[0].ownershipType === 'system' &&
        actDay.warmupActivities[0].status === 'active' &&
        actDay.warmupActivities[0].thumbnailUrl ===
            'https://cdn.example.com/walking.png' &&
        actDay.cardioActivities?.[0]?.name === 'Treadmill' &&
        actDay.cardioActivities[0].exerciseId == null &&
        actDay.cardioActivities[0].thumbnailUrl == null &&
        actDay.exercises?.[0]?.name === 'Bench Press' &&
        exportWithActivities.plan.totalExercises === 1
    ) {
        pass('workout export model maps warm-up/cardio separately from exercises');
    } else {
        fail(
            'workout export model maps warm-up/cardio separately from exercises',
            JSON.stringify(actDay)
        );
    }

    const pdfBuf = await renderHtmlToPdf(nutritionHtml);
    if (Buffer.isBuffer(pdfBuf) && pdfBuf.slice(0, 5).toString() === '%PDF-') {
        pass('Chromium HTML→PDF produces valid PDF');
    } else {
        fail(
            'Chromium HTML→PDF produces valid PDF',
            pdfBuf?.slice?.(0, 20)?.toString?.()
        );
    }

    const workoutPdfBuf = await renderHtmlToPdf(workoutHtml);
    const workoutPdfText = workoutPdfBuf?.toString?.('latin1') || '';
    if (
        Buffer.isBuffer(workoutPdfBuf) &&
        workoutPdfBuf.slice(0, 5).toString() === '%PDF-' &&
        linkedExerciseUrl &&
        workoutPdfText.includes(linkedExerciseUrl)
    ) {
        pass('workout PDF embeds clickable public exercise URL');
    } else {
        fail(
            'workout PDF embeds clickable public exercise URL',
            linkedExerciseUrl || 'missing url'
        );
    }

    const coverModel = {
        type: 'workout',
        plan: {
            id: 'cover-1',
            name: 'Full Body Foundations',
            description: null,
            duration: 8,
            daysPerWeek: 3,
            goal: 'general_fitness',
            level: 'beginner',
            notes: 'Keep rest times honest.',
            status: 'active',
            totalExercises: 6,
            totalDays: 3,
        },
        trainer: { fullName: 'Coach', email: 'coach@example.com', phone: null },
        content: {
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Full Body A',
                    exercises: [
                        {
                            name: 'Squat',
                            order: 1,
                            muscles: { primary: 'quadriceps', secondary: [] },
                            sets: [{}, {}, {}],
                        },
                        {
                            name: 'Bench',
                            order: 2,
                            muscles: { primary: 'chest', secondary: [] },
                            sets: [{}, {}],
                        },
                    ],
                },
                {
                    dayNumber: 2,
                    name: 'Full Body B',
                    exercises: [
                        {
                            name: 'Deadlift',
                            order: 1,
                            muscles: { primary: 'back', secondary: [] },
                            sets: [{}, {}, {}],
                        },
                        {
                            name: 'OHP',
                            order: 2,
                            muscles: { primary: 'shoulders', secondary: [] },
                            sets: [{}, {}],
                        },
                    ],
                },
                {
                    dayNumber: 3,
                    name: 'Full Body C',
                    exercises: [
                        {
                            name: 'Row',
                            order: 1,
                            muscles: { primary: 'back', secondary: [] },
                            sets: [{}, {}],
                        },
                        {
                            name: 'Curl',
                            order: 2,
                            muscles: { primary: 'biceps', secondary: [] },
                            sets: [{}, {}],
                        },
                    ],
                },
            ],
        },
    };

    const coverHtml = buildElevateWorkoutHtml(coverModel);
    if (
        coverHtml.includes('class="page page-cover"') &&
        coverHtml.includes('class="left-stack"') &&
        coverHtml.includes('class="title-stack"') &&
        coverHtml.includes('--title-size:') &&
        coverHtml.includes('elevate-html-source:templates/elevate/html/index.html') &&
        coverHtml.includes('data-elevate-html-css="styles.css"') &&
        coverHtml.includes('Full Body') &&
        coverHtml.includes('Foundations') &&
        coverHtml.includes('Program overview') &&
        coverHtml.includes('class="steps"') &&
        coverHtml.includes('How to log') &&
        coverHtml.includes('Pick a workout') &&
        coverHtml.includes('Log every set') &&
        coverHtml.includes('Tap Finish') &&
        coverHtml.includes('page-workouts') &&
        coverHtml.includes('WORKOUTS') &&
        coverHtml.includes('Full Body A') &&
        coverHtml.includes('2 exercises · 5 sets') &&
        coverHtml.includes('Quadriceps') &&
        coverHtml.includes('Example only') &&
        coverHtml.includes('Coach note: Keep rest times honest.') &&
        /0\d\s*\/\s*0\d/.test(coverHtml) &&
        coverHtml.includes('page-workout-details') &&
        coverHtml.includes('Tick each set') &&
        coverHtml.includes('Workout A') &&
        coverHtml.includes('details-tick') &&
        coverHtml.includes('8 weeks') &&
        coverHtml.includes('Any order') &&
        coverHtml.includes('data:image/png;base64,') &&
        coverHtml.includes('data:font/woff2;base64,') &&
        !coverHtml.includes('data-fitly-cover>') &&
        !coverHtml.includes('calories') &&
        !coverHtml.includes('ucarecdn.com') &&
        !coverHtml.includes('rsms.me')
    ) {
        pass('elevate HTML content + offline assets');
    } else {
        fail('elevate HTML content + offline assets', coverHtml.slice(0, 400));
    }

    const mediumNameHtml = buildElevateWorkoutHtml({
        ...coverModel,
        plan: {
            ...coverModel.plan,
            name: 'Full Body — Beginner Copy 5',
        },
    });
    const longNameHtml = buildElevateWorkoutHtml({
        ...coverModel,
        plan: {
            ...coverModel.plan,
            name: 'Very Long Progressive Overload Hypertrophy Foundations Program <script>',
            description: 'Safe <b>desc</b>',
        },
    });
    // Design has no description slot; names must still be escaped in title/overview.
    if (
        mediumNameHtml.includes('title-stack') &&
        mediumNameHtml.includes('--title-size:') &&
        !mediumNameHtml.includes('--title-size:55px') &&
        mediumNameHtml.includes('<span>5</span>') &&
        longNameHtml.includes('&lt;script&gt;') &&
        !longNameHtml.includes('<script>') &&
        longNameHtml.includes('Program overview') &&
        longNameHtml.includes('--title-size:')
    ) {
        pass('elevate escapes long names and descriptions');
    } else {
        fail(
            'elevate escapes long names and descriptions',
            longNameHtml.slice(0, 300)
        );
    }

    const elevateLinkUrl = buildPublicExerciseUrl({
        exerciseId: '507f1f77bcf86cd799439011',
        slug: 'barbell-squat',
        ownershipType: 'system',
        status: 'active',
    });
    const elevateThumbUrl = 'https://cdn.example.com/exercises/barbell-squat.png';
    const elevateLinkHtml = buildElevateWorkoutHtml({
        type: 'workout',
        plan: {
            id: 'elevate-links',
            name: 'Elevate Link Plan',
            duration: 4,
            notes: null,
            totalExercises: 4,
            totalDays: 1,
        },
        trainer: { fullName: 'Coach', email: 'coach@example.com', phone: null },
        content: {
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Full Body A',
                    exercises: [
                        {
                            exerciseId: '507f1f77bcf86cd799439011',
                            slug: 'barbell-squat',
                            ownershipType: 'system',
                            status: 'active',
                            name: 'Barbell Squat',
                            order: 1,
                            thumbnailUrl: elevateThumbUrl,
                            notes: 'Keep chest up',
                            muscles: { primary: 'quadriceps', secondary: [] },
                            sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }],
                        },
                        {
                            exerciseId: 'trainer-ex-9',
                            slug: 'my-custom-press',
                            ownershipType: 'trainer',
                            status: 'active',
                            name: 'Custom Press',
                            order: 2,
                            thumbnailUrl: 'https://cdn.example.com/custom.png',
                            muscles: { primary: 'chest', secondary: [] },
                            sets: [{ reps: 8 }],
                        },
                        {
                            exerciseId: 'archived-ex-1',
                            slug: 'old-system-move',
                            ownershipType: 'system',
                            status: 'archived',
                            name: 'Archived Move',
                            order: 3,
                            thumbnailUrl: 'https://cdn.example.com/old.png',
                            muscles: { primary: 'back', secondary: [] },
                            sets: [{ reps: 8 }],
                        },
                        {
                            exerciseId: null,
                            slug: null,
                            ownershipType: null,
                            status: null,
                            name: 'Missing Move',
                            order: 4,
                            thumbnailUrl: null,
                            sets: [{ reps: 5 }],
                        },
                    ],
                },
            ],
        },
    });

    const elevateNameLink = `<a class="details-ex-name details-ex-link" href="${escapeHtml(
        elevateLinkUrl
    )}">Barbell Squat</a>`;
    const elevateImageLinkPrefix = `<a class="details-ex-thumb-link details-ex-link" href="${escapeHtml(
        elevateLinkUrl
    )}"`;

    if (
        elevateLinkUrl &&
        elevateLinkHtml.includes(elevateNameLink) &&
        elevateLinkHtml.includes(elevateImageLinkPrefix) &&
        elevateLinkHtml.includes(`src="${escapeHtml(elevateThumbUrl)}"`) &&
        !elevateLinkHtml.includes(
            `href="${escapeHtml(elevateLinkUrl)}">Keep chest up`
        )
    ) {
        pass('elevate active system exercise name + image are linked');
    } else {
        fail(
            'elevate active system exercise name + image are linked',
            elevateLinkHtml.match(/Barbell Squat[\s\S]{0,220}/)?.[0] || 'missing'
        );
    }

    const elevateNameHrefCount = (
        elevateLinkHtml.match(
            new RegExp(
                `href="${escapeHtml(elevateLinkUrl).replace(
                    /[.*+?^${}()|[\]\\]/g,
                    '\\$&'
                )}"`,
                'g'
            )
        ) || []
    ).length;
    if (elevateNameHrefCount === 2) {
        pass('elevate name and image use the same public URL');
    } else {
        fail(
            'elevate name and image use the same public URL',
            `hrefCount=${elevateNameHrefCount}`
        );
    }

    if (
        elevateLinkHtml.includes('<p class="details-ex-name">Custom Press</p>') &&
        !elevateLinkHtml.includes('my-custom-press') &&
        !/details-ex-link"[^>]*>Custom Press/.test(elevateLinkHtml)
    ) {
        pass('elevate trainer-owned exercise remains unlinked');
    } else {
        fail(
            'elevate trainer-owned exercise remains unlinked',
            elevateLinkHtml.match(/Custom Press[\s\S]{0,160}/)?.[0] || 'missing'
        );
    }

    if (
        elevateLinkHtml.includes('<p class="details-ex-name">Archived Move</p>') &&
        !elevateLinkHtml.includes('old-system-move') &&
        !/details-ex-link"[^>]*>Archived Move/.test(elevateLinkHtml)
    ) {
        pass('elevate archived exercise remains unlinked');
    } else {
        fail(
            'elevate archived exercise remains unlinked',
            elevateLinkHtml.match(/Archived Move[\s\S]{0,160}/)?.[0] || 'missing'
        );
    }

    if (
        elevateLinkHtml.includes('<p class="details-ex-name">Missing Move</p>') &&
        !/details-ex-link"[^>]*>Missing Move/.test(elevateLinkHtml)
    ) {
        pass('elevate missing exercise remains unlinked');
    } else {
        fail(
            'elevate missing exercise remains unlinked',
            elevateLinkHtml.match(/Missing Move[\s\S]{0,160}/)?.[0] || 'missing'
        );
    }

    const elevateLinkPdf = await renderElevateWorkoutPdf({
        type: 'workout',
        plan: {
            id: 'elevate-links-pdf',
            name: 'Elevate Link Plan',
            duration: 4,
            notes: null,
            totalExercises: 1,
            totalDays: 1,
        },
        trainer: { fullName: 'Coach', email: 'coach@example.com', phone: null },
        content: {
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Full Body A',
                    exercises: [
                        {
                            exerciseId: '507f1f77bcf86cd799439011',
                            slug: 'barbell-squat',
                            ownershipType: 'system',
                            status: 'active',
                            name: 'Barbell Squat',
                            order: 1,
                            thumbnailUrl: elevateThumbUrl,
                            muscles: { primary: 'quadriceps', secondary: [] },
                            sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }],
                        },
                    ],
                },
            ],
        },
    });
    const elevateLinkPdfText = elevateLinkPdf?.toString?.('latin1') || '';
    if (
        Buffer.isBuffer(elevateLinkPdf) &&
        elevateLinkPdf.slice(0, 5).toString() === '%PDF-' &&
        elevateLinkUrl &&
        elevateLinkPdfText.includes(elevateLinkUrl)
    ) {
        pass('elevate PDF embeds clickable public exercise URL');
    } else {
        fail(
            'elevate PDF embeds clickable public exercise URL',
            elevateLinkUrl || 'missing url'
        );
    }

    const coverOutDir = join(dirname(fileURLToPath(import.meta.url)), '.preview');
    mkdirSync(coverOutDir, { recursive: true });
    const titleCases = [
        {
            name: 'Full Body Foundations',
            file: 'elevate-title-short.pdf',
        },
        {
            name: 'Full Body — Beginner Copy 5',
            file: 'elevate-title-medium.pdf',
        },
        {
            name: 'Very Long Progressive Overload Hypertrophy Foundations Program',
            file: 'elevate-title-long.pdf',
        },
    ];

    let titlePdfsOk = true;
    for (const titleCase of titleCases) {
        const pdf = await renderElevateWorkoutPdf({
            ...coverModel,
            plan: { ...coverModel.plan, name: titleCase.name },
        });
        if (!(Buffer.isBuffer(pdf) && pdf.slice(0, 5).toString() === '%PDF-')) {
            titlePdfsOk = false;
            fail(
                'elevate PDF buffer valid',
                `${titleCase.name}: ${pdf?.slice?.(0, 20)?.toString?.()}`
            );
            break;
        }
        writeFileSync(join(coverOutDir, titleCase.file), pdf);
        const pageMatches = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || [];
        // Cover + overview + detail pages (count varies with content packing).
        if (pageMatches.length < 3) {
            titlePdfsOk = false;
            fail(
                'elevate PDF has multiple pages',
                `${titleCase.name}: pages≈${pageMatches.length}`
            );
            break;
        }
    }
    if (titlePdfsOk) {
        writeFileSync(
            join(coverOutDir, 'elevate-multi-page.pdf'),
            await renderElevateWorkoutPdf(coverModel)
        );
        pass('elevate PDF has multiple pages');
        pass('elevate PDF buffer valid');
    }
}

async function main() {
    try {
        await runUnitTests();
        await mongoose.connect(process.env.APP_DB_URL);

        const suffix = Date.now();
        const password = 'testpass123';

        const trainerA = await User.create({
            firstName: 'Export',
            lastName: 'Alpha',
            email: `export-a-${suffix}@test.com`,
            password,
            role: 'trainer',
            phone: '1234567890',
        });

        const trainerB = await User.create({
            firstName: 'Export',
            lastName: 'Beta',
            email: `export-b-${suffix}@test.com`,
            password,
            role: 'trainer',
        });

        const loginA = await request('POST', '/auth/login', {
            body: { email: trainerA.email, password },
        });
        const loginB = await request('POST', '/auth/login', {
            body: { email: trainerB.email, password },
        });
        const tokenA = loginA.json?.data?.token;
        const tokenB = loginB.json?.data?.token;

        if (!tokenA || !tokenB) {
            fail('Trainer login', JSON.stringify(loginA.json));
            process.exit(1);
        }

        const workout = await WorkoutPlan.create({
            trainerId: trainerA._id,
            ownership: { type: 'trainer', trainerId: trainerA._id },
            name: `Export Workout ${suffix}`,
            description: 'PDF export test workout',
            duration: 4,
            daysPerWeek: 3,
            goal: 'muscle_gain',
            level: 'intermediate',
            isTemplate: false,
            status: 'active',
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Push',
                    exercises: [
                        {
                            exerciseId: new mongoose.Types.ObjectId(),
                            order: 1,
                            restBetweenSets: 90,
                            notes: 'Control the eccentric',
                            exerciseSnapshot: {
                                name: 'Bench Press',
                                thumbnailUrl: null,
                            },
                            sets: [
                                {
                                    setNumber: 1,
                                    reps: 10,
                                    weight: 60,
                                    weightUnit: 'kg',
                                },
                                {
                                    setNumber: 2,
                                    reps: 8,
                                    weight: 65,
                                    weightUnit: 'kg',
                                },
                            ],
                        },
                    ],
                },
            ],
        });

        const nutrition = await NutritionPlan.create({
            trainerId: trainerA._id,
            ownership: { type: 'trainer', trainerId: trainerA._id },
            name: `Export Nutrition ${suffix}`,
            description: 'PDF export test nutrition',
            goal: 'high_protein',
            duration: 4,
            daysCount: 1,
            scheduleMode: 'daily',
            macroTargets: { calories: 2200, protein: 180, carbs: 200, fat: 70 },
            isTemplate: false,
            status: 'active',
            nutritionDays: [
                {
                    dayNumber: 1,
                    name: 'Day 1',
                    meals: [
                        {
                            order: 1,
                            name: 'Breakfast',
                            mealType: 'breakfast',
                            foodItems: [
                                {
                                    foodId: new mongoose.Types.ObjectId(),
                                    order: 1,
                                    quantity: 100,
                                    unit: 'g',
                                    foodSnapshot: {
                                        name: 'Chicken Breast',
                                        brand: null,
                                        category: 'protein',
                                        nutritionPer100g: {
                                            calories: 165,
                                            protein: 31,
                                            carbs: 0,
                                            fat: 3.6,
                                        },
                                        defaultServing: {
                                            quantity: 100,
                                            unit: 'g',
                                            gramWeight: 100,
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        });

        const templatesRes = await request(
            'GET',
            '/plan-exports/templates?planType=workout',
            { token: tokenA }
        );
        const listedTemplates = templatesRes.json?.data?.templates;
        const elevateTemplate = listedTemplates?.find((t) => t.id === 'elevate');
        const classicListed = listedTemplates?.some((t) => t.id === 'classic');
        const expectedWorkoutPreview =
            getTemplateMeta('elevate')?.assets?.workout?.previewImageUrl ?? null;
        if (
            templatesRes.status === 200 &&
            Array.isArray(listedTemplates) &&
            listedTemplates.length === 1 &&
            elevateTemplate &&
            !classicListed &&
            elevateTemplate.previewUrl === expectedWorkoutPreview &&
            elevateTemplate.assets?.previewImageUrl === expectedWorkoutPreview
        ) {
            pass('GET workout templates returns Elevate only');
        } else {
            fail(
                'GET workout templates returns Elevate only',
                JSON.stringify(templatesRes.json)
            );
        }

        const nutritionTemplatesRes = await request(
            'GET',
            '/plan-exports/templates?planType=nutrition',
            { token: tokenA }
        );
        const nutritionTemplate = nutritionTemplatesRes.json?.data?.templates?.find(
            (t) => t.id === 'elevate'
        );
        const expectedNutritionPreview =
            getTemplateMeta('elevate')?.assets?.nutrition?.previewImageUrl ?? null;
        if (
            nutritionTemplatesRes.status === 200 &&
            nutritionTemplatesRes.json?.data?.templates?.length === 1 &&
            nutritionTemplate?.previewUrl === expectedNutritionPreview &&
            nutritionTemplate?.assets?.previewImageUrl === expectedNutritionPreview &&
            !nutritionTemplatesRes.json?.data?.templates?.some((t) => t.id === 'classic')
        ) {
            pass('GET nutrition templates returns Elevate only');
        } else {
            fail(
                'GET nutrition templates returns Elevate only',
                JSON.stringify(nutritionTemplatesRes.json)
            );
        }

        const classicRejected = await request('POST', '/plan-exports', {
            token: tokenA,
            body: {
                planType: 'workout',
                planId: workout._id.toString(),
                templateId: 'classic',
            },
        });
        if (classicRejected.status === 400) {
            pass('classic templateId rejected with HTTP 400');
        } else {
            fail(
                'classic templateId rejected with HTTP 400',
                JSON.stringify(classicRejected.json)
            );
        }

        const workoutExport = await request('POST', '/plan-exports', {
            token: tokenA,
            body: {
                planType: 'workout',
                planId: workout._id.toString(),
                templateId: 'elevate',
            },
            raw: true,
        });
        const workoutCt = workoutExport.headers.get('content-type') || '';
        const workoutCd = workoutExport.headers.get('content-disposition') || '';
        if (
            workoutExport.status === 200 &&
            workoutCt.includes('application/pdf') &&
            workoutExport.buffer.slice(0, 5).toString() === '%PDF-' &&
            workoutCd.includes('attachment') &&
            workoutCd.includes('.pdf')
        ) {
            pass('elevate workout export PDF');
        } else {
            fail(
                'elevate workout export PDF',
                `status=${workoutExport.status} ct=${workoutCt} cd=${workoutCd} head=${workoutExport.buffer.slice(0, 40).toString()}`
            );
        }

        const nutritionExport = await request('POST', '/plan-exports', {
            token: tokenA,
            body: {
                planType: 'nutrition',
                planId: nutrition._id.toString(),
                templateId: 'elevate',
            },
            raw: true,
        });
        if (
            nutritionExport.status === 200 &&
            (nutritionExport.headers.get('content-type') || '').includes(
                'application/pdf'
            ) &&
            nutritionExport.buffer.slice(0, 5).toString() === '%PDF-'
        ) {
            pass('elevate nutrition export PDF');
        } else {
            fail(
                'elevate nutrition export PDF',
                `status=${nutritionExport.status} head=${nutritionExport.buffer.slice(0, 80).toString()}`
            );
        }

        const coverUnauthorized = await request('POST', '/plan-exports', {
            token: tokenB,
            body: {
                planType: 'workout',
                planId: workout._id.toString(),
                templateId: 'elevate',
            },
        });
        if (coverUnauthorized.status === 404) {
            pass('elevate unauthorized plan rejected');
        } else {
            fail(
                'elevate unauthorized plan rejected',
                JSON.stringify(coverUnauthorized.json)
            );
        }

        const invalidTemplate = await request('POST', '/plan-exports', {
            token: tokenA,
            body: {
                planType: 'workout',
                planId: workout._id.toString(),
                templateId: 'does-not-exist',
            },
        });
        if (invalidTemplate.status === 400) pass('invalid template rejected');
        else fail('invalid template rejected', JSON.stringify(invalidTemplate.json));

        const invalidType = await request('POST', '/plan-exports', {
            token: tokenA,
            body: {
                planType: 'yoga',
                planId: workout._id.toString(),
                templateId: 'elevate',
            },
        });
        if (invalidType.status === 400) pass('invalid plan type rejected');
        else fail('invalid plan type rejected', JSON.stringify(invalidType.json));

        const missingPlan = await request('POST', '/plan-exports', {
            token: tokenA,
            body: {
                planType: 'workout',
                planId: new mongoose.Types.ObjectId().toString(),
                templateId: 'elevate',
            },
        });
        if (missingPlan.status === 404) pass('missing plan rejected');
        else fail('missing plan rejected', JSON.stringify(missingPlan.json));

        const unauthorized = await request('POST', '/plan-exports', {
            token: tokenB,
            body: {
                planType: 'workout',
                planId: workout._id.toString(),
                templateId: 'elevate',
            },
        });
        if (unauthorized.status === 404) pass('unauthorized plan rejected');
        else fail('unauthorized plan rejected', JSON.stringify(unauthorized.json));

        await WorkoutPlan.deleteOne({ _id: workout._id });
        await NutritionPlan.deleteOne({ _id: nutrition._id });
        await User.deleteMany({ _id: { $in: [trainerA._id, trainerB._id] } });
        await mongoose.disconnect();
    } finally {
        await closeHtmlPdfBrowser();
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await closeHtmlPdfBrowser().catch(() => {});
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
