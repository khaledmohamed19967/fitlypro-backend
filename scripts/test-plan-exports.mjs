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
import {
    buildExportFilename,
    sanitizeFilenamePart,
} from '../src/modules/plan-exports/plan-export.helpers.js';
import {
    getTemplateMeta,
    getTemplatePlanAssets,
    listExportTemplates,
    resolveTemplateRenderer,
} from '../src/modules/plan-exports/templates/index.js';
import {
    buildClassicNutritionHtml,
    buildClassicWorkoutHtml,
} from '../src/modules/plan-exports/templates/classic/index.js';
import { escapeHtml } from '../src/modules/plan-exports/pdf/htmlEscape.js';
import { renderHtmlToPdf, closeHtmlPdfBrowser } from '../src/modules/plan-exports/pdf/htmlPdfRenderer.js';

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

    const classicMeta = getTemplateMeta('classic');
    const classicNutritionPreview =
        classicMeta?.assets?.nutrition?.previewImageUrl ?? null;
    const classicWorkoutPreview =
        classicMeta?.assets?.workout?.previewImageUrl ?? null;
    if (
        typeof classicNutritionPreview === 'string' &&
        classicNutritionPreview.startsWith(
            'https://ucarecdn.com/f0c1a1f5-f68f-4050-872e-d605f1df39ee/'
        ) &&
        typeof classicWorkoutPreview === 'string' &&
        classicWorkoutPreview.startsWith(
            'https://ucarecdn.com/c4fdab05-2c4e-46cb-b196-b375c3af8f69/'
        )
    ) {
        pass('classic template has plan-type preview image metadata');
    } else {
        fail(
            'classic template has plan-type preview image metadata',
            JSON.stringify(classicMeta?.assets)
        );
    }

    const nutritionClassic = listExportTemplates('nutrition').find(
        (t) => t.id === 'classic'
    );
    if (
        nutritionClassic?.previewUrl === classicNutritionPreview &&
        nutritionClassic?.assets?.previewImageUrl === classicNutritionPreview
    ) {
        pass('nutrition templates expose classic preview URL');
    } else {
        fail(
            'nutrition templates expose classic preview URL',
            JSON.stringify(nutritionClassic)
        );
    }

    const workoutClassic = listExportTemplates('workout').find(
        (t) => t.id === 'classic'
    );
    if (
        workoutClassic &&
        workoutClassic.previewUrl === classicWorkoutPreview &&
        workoutClassic.assets?.previewImageUrl === classicWorkoutPreview
    ) {
        pass('workout templates expose classic preview URL');
    } else {
        fail(
            'workout templates expose classic preview URL',
            JSON.stringify(workoutClassic)
        );
    }

    const unscopedClassic = listExportTemplates().find((t) => t.id === 'classic');
    if (
        unscopedClassic?.previewUrl == null &&
        unscopedClassic?.assets?.nutrition?.previewImageUrl ===
            classicNutritionPreview &&
        unscopedClassic?.assets?.workout?.previewImageUrl ===
            classicWorkoutPreview
    ) {
        pass('unscoped templates keep plan-type previews namespaced');
    } else {
        fail(
            'unscoped templates keep plan-type previews namespaced',
            JSON.stringify(unscopedClassic)
        );
    }

    if (
        getTemplatePlanAssets('classic', 'nutrition')?.previewImageUrl ===
            classicNutritionPreview &&
        getTemplatePlanAssets('classic', 'workout')?.previewImageUrl ===
            classicWorkoutPreview
    ) {
        pass('template plan assets resolve without controller hardcoding');
    } else {
        fail(
            'template plan assets resolve without controller hardcoding',
            JSON.stringify({
                nutrition: getTemplatePlanAssets('classic', 'nutrition'),
                workout: getTemplatePlanAssets('classic', 'workout'),
            })
        );
    }

    if (getTemplateMeta('classic') && !getTemplateMeta('missing')) {
        pass('template registry lookup');
    } else {
        fail('template registry lookup', 'classic/missing');
    }

    if (
        typeof resolveTemplateRenderer('classic', 'workout') === 'function' &&
        typeof resolveTemplateRenderer('classic', 'nutrition') === 'function' &&
        resolveTemplateRenderer('nope', 'workout') == null
    ) {
        pass('template renderer resolution');
    } else {
        fail('template renderer resolution', 'classic renderers missing');
    }

    if (
        escapeHtml('<script>alert(1)</script>') ===
        '&lt;script&gt;alert(1)&lt;/script&gt;'
    ) {
        pass('html escape');
    } else {
        fail('html escape', escapeHtml('<script>'));
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

    const nutritionHtml = buildClassicNutritionHtml(sampleNutrition);
    if (
        nutritionHtml.includes('Muscle Gain &lt;b&gt;Hack&lt;/b&gt;') &&
        nutritionHtml.includes('class="plan-info-table"') &&
        nutritionHtml.includes('>Contact</th>') &&
        nutritionHtml.includes('>Daily Meal Plan</h2>') &&
        nutritionHtml.includes('Meals / day') &&
        nutritionHtml.includes('Breakfast') &&
        nutritionHtml.includes('Eggs (Whole)') &&
        nutritionHtml.includes('Daily Totals') &&
        nutritionHtml.includes('info-status') &&
        !nutritionHtml.includes('Day 1') &&
        nutritionHtml.includes('dir="ltr"') &&
        !nutritionHtml.includes('ucarecdn.com')
    ) {
        pass('nutrition HTML content + fitlypro-template structure');
    } else {
        fail(
            'nutrition HTML content + fitlypro-template structure',
            nutritionHtml.slice(0, 500)
        );
    }

    const workoutHtml = buildClassicWorkoutHtml({
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
                            name: 'Squat',
                            order: 1,
                            restBetweenSets: 60,
                            sets: [
                                { setNumber: 1, reps: 10 },
                                { setNumber: 2, reps: 10 },
                            ],
                        },
                    ],
                },
            ],
        },
    });
    if (
        workoutHtml.includes('Full Body &lt;b&gt;Test&lt;/b&gt;') &&
        workoutHtml.includes('FITLY<span class="pro">PRO</span>') &&
        workoutHtml.includes('class="plan-info-table"') &&
        workoutHtml.includes('>Contact</th>') &&
        workoutHtml.includes('>Weekly Workout Plan</h2>') &&
        workoutHtml.includes('cell-meal" rowspan="1">Push</td>') &&
        workoutHtml.includes('Squat') &&
        workoutHtml.includes('coach@example.com') &&
        workoutHtml.includes('info-status') &&
        workoutHtml.includes('Weekly Totals') &&
        workoutHtml.includes('dir="ltr"') &&
        !workoutHtml.includes('ucarecdn.com')
    ) {
        pass('workout HTML content + fitlypro-template structure');
    } else {
        fail(
            'workout HTML content + fitlypro-template structure',
            workoutHtml.slice(0, 500)
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
        const workoutTemplate = templatesRes.json?.data?.templates?.find(
            (t) => t.id === 'classic'
        );
        const expectedWorkoutPreview =
            getTemplateMeta('classic')?.assets?.workout?.previewImageUrl ?? null;
        if (
            templatesRes.status === 200 &&
            Array.isArray(templatesRes.json?.data?.templates) &&
            workoutTemplate &&
            workoutTemplate.previewUrl === expectedWorkoutPreview &&
            workoutTemplate.assets?.previewImageUrl === expectedWorkoutPreview
        ) {
            pass('GET workout templates returns preview image URL');
        } else {
            fail('GET workout templates returns preview image URL', JSON.stringify(templatesRes.json));
        }

        const nutritionTemplatesRes = await request(
            'GET',
            '/plan-exports/templates?planType=nutrition',
            { token: tokenA }
        );
        const nutritionTemplate = nutritionTemplatesRes.json?.data?.templates?.find(
            (t) => t.id === 'classic'
        );
        const expectedNutritionPreview =
            getTemplateMeta('classic')?.assets?.nutrition?.previewImageUrl ?? null;
        if (
            nutritionTemplatesRes.status === 200 &&
            nutritionTemplate?.previewUrl === expectedNutritionPreview &&
            nutritionTemplate?.assets?.previewImageUrl === expectedNutritionPreview
        ) {
            pass('GET nutrition templates returns preview image URL');
        } else {
            fail(
                'GET nutrition templates returns preview image URL',
                JSON.stringify(nutritionTemplatesRes.json)
            );
        }

        const workoutExport = await request('POST', '/plan-exports', {
            token: tokenA,
            body: {
                planType: 'workout',
                planId: workout._id.toString(),
                templateId: 'classic',
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
            pass('workout export PDF');
        } else {
            fail(
                'workout export PDF',
                `status=${workoutExport.status} ct=${workoutCt} cd=${workoutCd} head=${workoutExport.buffer.slice(0, 40).toString()}`
            );
        }

        const nutritionExport = await request('POST', '/plan-exports', {
            token: tokenA,
            body: {
                planType: 'nutrition',
                planId: nutrition._id.toString(),
                templateId: 'classic',
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
            pass('nutrition export PDF');
        } else {
            fail(
                'nutrition export PDF',
                `status=${nutritionExport.status} head=${nutritionExport.buffer.slice(0, 80).toString()}`
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
                templateId: 'classic',
            },
        });
        if (invalidType.status === 400) pass('invalid plan type rejected');
        else fail('invalid plan type rejected', JSON.stringify(invalidType.json));

        const missingPlan = await request('POST', '/plan-exports', {
            token: tokenA,
            body: {
                planType: 'workout',
                planId: new mongoose.Types.ObjectId().toString(),
                templateId: 'classic',
            },
        });
        if (missingPlan.status === 404) pass('missing plan rejected');
        else fail('missing plan rejected', JSON.stringify(missingPlan.json));

        const unauthorized = await request('POST', '/plan-exports', {
            token: tokenB,
            body: {
                planType: 'workout',
                planId: workout._id.toString(),
                templateId: 'classic',
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
