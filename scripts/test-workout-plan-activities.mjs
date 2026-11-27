/**
 * Warm-up & Cardio workout-plan backend verification.
 * Run: node scripts/test-workout-plan-activities.mjs
 *
 * Requires API server on API_URL (default http://localhost:8000).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import Exercise from '../src/modules/exercises/exercise.model.js';
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js';
import { validateCreateWorkoutPlan, validateUpdateWorkoutPlan } from '../src/modules/workout-plans/workout-plan.validator.js';
import { countPrescribedSetsForDay } from '../src/modules/workout-plans/workout-session.helpers.js';
import { buildWorkoutExportModel } from '../src/modules/plan-exports/plan-export.helpers.js';
import { countTotalExercises } from '../src/modules/workout-plans/workout-plan.helpers.js';

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

async function request(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

const joiOk = (schema, value) => {
    const { error } = schema.validate(value, { abortEarly: false });
    return !error;
};

const joiError = (schema, value) => {
    const { error } = schema.validate(value, { abortEarly: false });
    return error;
};

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';
    const trainerEmail = `trainer-act-${suffix}@test.com`;
    const otherEmail = `trainer-act-b-${suffix}@test.com`;

    const trainer = await User.create({
        firstName: 'Act',
        lastName: 'Trainer',
        email: trainerEmail,
        password,
        role: 'trainer',
    });

    const otherTrainer = await User.create({
        firstName: 'Other',
        lastName: 'Trainer',
        email: otherEmail,
        password,
        role: 'trainer',
    });

    const login = await request('POST', '/auth/login', {
        body: { email: trainerEmail, password },
    });
    const token = login.json?.data?.token;
    if (!token) {
        throw new Error('Failed to login test trainer');
    }

    const strengthEx =
        (await Exercise.findOne({
            'ownership.type': 'system',
            category: 'strength',
            status: 'active',
        })) ||
        (await Exercise.create({
            name: `Strength Act ${suffix}`,
            slug: `strength-act-${suffix}`,
            muscles: { primary: 'chest', secondary: [] },
            equipment: ['dumbbell'],
            category: 'strength',
            difficulty: 'beginner',
            ownership: { type: 'system' },
            source: { type: 'seed' },
            status: 'active',
        }));

    const warmupEx = await Exercise.create({
        name: `Warmup Catalog ${suffix}`,
        slug: `warmup-catalog-${suffix}`,
        muscles: { primary: 'full_body', secondary: [] },
        equipment: ['bodyweight'],
        category: 'warmup',
        difficulty: 'beginner',
        ownership: { type: 'trainer', trainerId: trainer._id },
        source: { type: 'manual' },
        status: 'active',
        media: { thumbnailUrl: 'https://example.com/warmup.jpg' },
    });

    const cardioEx = await Exercise.create({
        name: `Cardio Catalog ${suffix}`,
        slug: `cardio-catalog-${suffix}`,
        muscles: { primary: 'full_body', secondary: [] },
        equipment: ['machine'],
        category: 'cardio',
        difficulty: 'beginner',
        ownership: { type: 'trainer', trainerId: trainer._id },
        source: { type: 'manual' },
        status: 'active',
        media: { thumbnailUrl: 'https://example.com/cardio.jpg' },
    });

    const privateWarmup = await Exercise.create({
        name: `Private Warmup ${suffix}`,
        slug: `private-warmup-${suffix}`,
        muscles: { primary: 'full_body', secondary: [] },
        equipment: ['bodyweight'],
        category: 'warmup',
        difficulty: 'beginner',
        ownership: { type: 'trainer', trainerId: otherTrainer._id },
        source: { type: 'manual' },
        status: 'active',
    });

    // ——— Joi validation unit checks ———
    const validCreateBase = {
        name: 'Activities Plan',
        duration: 4,
        daysPerWeek: 2,
        goal: 'general_fitness',
        level: 'beginner',
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Day 1',
                warmupActivities: [
                    {
                        activityType: 'dynamic_mobility',
                        order: 1,
                        durationMinutes: 5,
                        intensity: 'low',
                        notes: 'Easy',
                    },
                ],
                exercises: [
                    {
                        exerciseId: strengthEx._id.toString(),
                        order: 1,
                        restBetweenSets: 60,
                        sets: [{ setNumber: 1, reps: 10, weightUnit: 'kg' }],
                    },
                ],
                cardioActivities: [
                    {
                        activityType: 'treadmill',
                        protocol: 'continuous',
                        order: 1,
                        durationMinutes: 20,
                        intensity: 'moderate',
                        distanceKm: 3,
                    },
                ],
            },
        ],
    };

    if (joiOk(validateCreateWorkoutPlan, validCreateBase)) {
        pass('Joi: valid warm-up + continuous cardio');
    } else {
        fail('Joi: valid warm-up + continuous cardio', joiError(validateCreateWorkoutPlan, validCreateBase)?.message);
    }

    const intervalOk = {
        ...validCreateBase,
        workoutDays: [
            {
                ...validCreateBase.workoutDays[0],
                cardioActivities: [
                    {
                        activityType: 'hiit',
                        protocol: 'interval',
                        order: 1,
                        durationMinutes: 15,
                        intensity: 'high',
                        workSeconds: 40,
                        recoverySeconds: 20,
                        rounds: 8,
                    },
                ],
            },
        ],
    };
    if (joiOk(validateCreateWorkoutPlan, intervalOk)) {
        pass('Joi: valid interval cardio');
    } else {
        fail('Joi: valid interval cardio', joiError(validateCreateWorkoutPlan, intervalOk)?.message);
    }

    const badIntensity = {
        ...validCreateBase,
        workoutDays: [
            {
                ...validCreateBase.workoutDays[0],
                warmupActivities: [
                    {
                        activityType: 'walking',
                        order: 1,
                        durationMinutes: 5,
                        intensity: 'extreme',
                    },
                ],
            },
        ],
    };
    if (!joiOk(validateCreateWorkoutPlan, badIntensity)) {
        pass('Joi: rejects invalid intensity');
    } else {
        fail('Joi: rejects invalid intensity', 'accepted extreme');
    }

    const badDuration = {
        ...validCreateBase,
        workoutDays: [
            {
                ...validCreateBase.workoutDays[0],
                warmupActivities: [
                    {
                        activityType: 'walking',
                        order: 1,
                        durationMinutes: 301,
                        intensity: 'low',
                    },
                ],
            },
        ],
    };
    if (!joiOk(validateCreateWorkoutPlan, badDuration)) {
        pass('Joi: rejects duration > 300');
    } else {
        fail('Joi: rejects duration > 300', 'accepted 301');
    }

    const continuousWithInterval = {
        ...validCreateBase,
        workoutDays: [
            {
                ...validCreateBase.workoutDays[0],
                cardioActivities: [
                    {
                        activityType: 'treadmill',
                        protocol: 'continuous',
                        order: 1,
                        durationMinutes: 20,
                        intensity: 'moderate',
                        workSeconds: 40,
                        recoverySeconds: 20,
                        rounds: 8,
                    },
                ],
            },
        ],
    };
    if (!joiOk(validateCreateWorkoutPlan, continuousWithInterval)) {
        pass('Joi: rejects continuous + interval fields');
    } else {
        fail('Joi: rejects continuous + interval fields', 'accepted');
    }

    const intervalMissing = {
        ...validCreateBase,
        workoutDays: [
            {
                ...validCreateBase.workoutDays[0],
                cardioActivities: [
                    {
                        activityType: 'hiit',
                        protocol: 'interval',
                        order: 1,
                        durationMinutes: 15,
                        intensity: 'high',
                    },
                ],
            },
        ],
    };
    if (!joiOk(validateCreateWorkoutPlan, intervalMissing)) {
        pass('Joi: rejects interval missing work/recovery/rounds');
    } else {
        fail('Joi: rejects interval missing work/recovery/rounds', 'accepted');
    }

    // ——— Session isolation unit ———
    const dayWithActivities = {
        exercises: [
            { sets: [{}, {}, {}] },
            { sets: [{}, {}] },
        ],
        warmupActivities: [{ durationMinutes: 5 }],
        cardioActivities: [{ durationMinutes: 20, protocol: 'interval', rounds: 8 }],
    };
    if (countPrescribedSetsForDay(dayWithActivities) === 5) {
        pass('Session: prescribed sets ignore warm-up/cardio');
    } else {
        fail(
            'Session: prescribed sets ignore warm-up/cardio',
            String(countPrescribedSetsForDay(dayWithActivities))
        );
    }

    if (
        countTotalExercises([dayWithActivities]) === 2 &&
        countTotalExercises([{ exercises: undefined, warmupActivities: [{}] }]) === 0
    ) {
        pass('totalExercises counts strength only');
    } else {
        fail('totalExercises counts strength only', String(countTotalExercises([dayWithActivities])));
    }

    const legacyExport = buildWorkoutExportModel(
        {
            id: 'legacy',
            name: 'Legacy',
            duration: 4,
            daysPerWeek: 1,
            goal: 'strength',
            level: 'beginner',
            status: 'active',
            totalExercises: 1,
            totalDays: 1,
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'A',
                    exercises: [
                        {
                            exerciseId: strengthEx._id.toString(),
                            order: 1,
                            restBetweenSets: 60,
                            exerciseSnapshot: { name: 'Press' },
                            sets: [{ setNumber: 1, reps: 5 }],
                        },
                    ],
                },
            ],
        },
        { fullName: 'Coach' }
    );
    const legacyDay = legacyExport.content.workoutDays[0];
    if (
        Array.isArray(legacyDay.warmupActivities) &&
        legacyDay.warmupActivities.length === 0 &&
        Array.isArray(legacyDay.cardioActivities) &&
        legacyDay.cardioActivities.length === 0 &&
        legacyDay.exercises.length === 1 &&
        legacyDay.exercises[0].name === 'Press'
    ) {
        pass('Export DTO: legacy days get empty activity arrays; exercises unchanged');
    } else {
        fail('Export DTO: legacy days get empty activity arrays; exercises unchanged', JSON.stringify(legacyDay));
    }

    // ——— API create with both sections ———
    const createBoth = await request('POST', '/workout-plans', {
        token,
        body: {
            name: `Activities Both ${suffix}`,
            duration: 4,
            daysPerWeek: 2,
            goal: 'general_fitness',
            level: 'beginner',
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Training',
                    warmupActivities: [
                        {
                            activityType: 'dynamic_mobility',
                            order: 1,
                            durationMinutes: 5,
                            intensity: 'low',
                            notes: 'Open hips',
                            exerciseId: warmupEx._id.toString(),
                        },
                        {
                            activityType: 'walking',
                            order: 2,
                            durationMinutes: 3,
                            intensity: 'low',
                        },
                    ],
                    exercises: [
                        {
                            exerciseId: strengthEx._id.toString(),
                            order: 1,
                            restBetweenSets: 90,
                            sets: [
                                { setNumber: 1, reps: 8, weight: 40, weightUnit: 'kg' },
                                { setNumber: 2, reps: 8, weight: 40, weightUnit: 'kg' },
                            ],
                        },
                    ],
                    cardioActivities: [
                        {
                            activityType: 'treadmill',
                            protocol: 'continuous',
                            order: 1,
                            durationMinutes: 20,
                            intensity: 'moderate',
                            distanceKm: 2.5,
                            exerciseId: cardioEx._id.toString(),
                        },
                        {
                            activityType: 'hiit',
                            protocol: 'interval',
                            order: 2,
                            durationMinutes: 12,
                            intensity: 'high',
                            workSeconds: 30,
                            recoverySeconds: 30,
                            rounds: 10,
                        },
                    ],
                },
            ],
        },
    });

    const created = createBoth.json?.data?.workoutPlan;
    const day = created?.workoutDays?.[0];

    if (
        createBoth.status === 201 &&
        day?.warmupActivities?.length === 2 &&
        day?.cardioActivities?.length === 2 &&
        day?.exercises?.length === 1 &&
        day.warmupActivities[0].exerciseId === warmupEx._id.toString() &&
        day.warmupActivities[0].exercise?.name === warmupEx.name &&
        day.warmupActivities[0].activitySnapshot?.name === warmupEx.name &&
        day.warmupActivities[1].exerciseId === null &&
        day.warmupActivities[1].activitySnapshot?.name &&
        day.cardioActivities[0].protocol === 'continuous' &&
        day.cardioActivities[1].protocol === 'interval' &&
        day.cardioActivities[1].rounds === 10
    ) {
        pass('API: create plan with warm-up + cardio + strength');
    } else {
        fail('API: create plan with warm-up + cardio + strength', JSON.stringify(createBoth.json));
    }

    const planId = created?.id;

    const createEmpty = await request('POST', '/workout-plans', {
        token,
        body: {
            name: `Activities Empty ${suffix}`,
            duration: 4,
            daysPerWeek: 1,
            goal: 'general_fitness',
            level: 'beginner',
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Only Strength',
                    exercises: [
                        {
                            exerciseId: strengthEx._id.toString(),
                            order: 1,
                            restBetweenSets: 60,
                            sets: [{ setNumber: 1, reps: 10, weightUnit: 'kg' }],
                        },
                    ],
                },
            ],
        },
    });
    const emptyDay = createEmpty.json?.data?.workoutPlan?.workoutDays?.[0];
    if (
        createEmpty.status === 201 &&
        Array.isArray(emptyDay?.warmupActivities) &&
        emptyDay.warmupActivities.length === 0 &&
        Array.isArray(emptyDay?.cardioActivities) &&
        emptyDay.cardioActivities.length === 0
    ) {
        pass('API: create without activity sections returns empty arrays');
    } else {
        fail('API: create without activity sections returns empty arrays', JSON.stringify(createEmpty.json));
    }

    // Mixed category allowed in warm-up / cardio
    const mixedCat = await request('POST', '/workout-plans', {
        token,
        body: {
            name: `Mixed Cat ${suffix}`,
            duration: 4,
            daysPerWeek: 1,
            goal: 'general_fitness',
            level: 'beginner',
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Mixed',
                    warmupActivities: [
                        {
                            activityType: 'other',
                            order: 1,
                            durationMinutes: 5,
                            intensity: 'low',
                            exerciseId: strengthEx._id.toString(),
                        },
                    ],
                    exercises: [],
                    cardioActivities: [
                        {
                            activityType: 'other',
                            protocol: 'continuous',
                            order: 1,
                            durationMinutes: 10,
                            intensity: 'moderate',
                            exerciseId: strengthEx._id.toString(),
                        },
                    ],
                },
            ],
        },
    });
    const mixedDay = mixedCat.json?.data?.workoutPlan?.workoutDays?.[0];
    if (
        mixedCat.status === 201 &&
        mixedDay?.warmupActivities?.[0]?.exerciseId === strengthEx._id.toString() &&
        mixedDay?.cardioActivities?.[0]?.exerciseId === strengthEx._id.toString()
    ) {
        pass('API: allows any exercise category in warm-up and cardio');
    } else {
        fail(
            'API: allows any exercise category in warm-up and cardio',
            JSON.stringify(mixedCat.json)
        );
    }
    const mixedPlanId = mixedCat.json?.data?.workoutPlan?.id;

    // Private exercise
    const privateRef = await request('POST', '/workout-plans', {
        token,
        body: {
            name: `Private Ref ${suffix}`,
            duration: 4,
            daysPerWeek: 1,
            goal: 'general_fitness',
            level: 'beginner',
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Bad',
                    warmupActivities: [
                        {
                            activityType: 'other',
                            order: 1,
                            durationMinutes: 5,
                            intensity: 'low',
                            exerciseId: privateWarmup._id.toString(),
                        },
                    ],
                    exercises: [],
                },
            ],
        },
    });
    if (privateRef.status === 400) {
        pass('API: rejects inaccessible exerciseId for activity');
    } else {
        fail('API: rejects inaccessible exerciseId for activity', JSON.stringify(privateRef.json));
    }

    // Update: preserve omitted warm-up, clear cardio with []
    const dayId = day?.id;
    const warmupId0 = day?.warmupActivities?.[0]?.id;
    const warmupId1 = day?.warmupActivities?.[1]?.id;

    const updatePreserve = await request('PATCH', `/workout-plans/${planId}`, {
        token,
        body: {
            workoutDays: [
                {
                    _id: dayId,
                    dayNumber: 1,
                    name: 'Training Updated',
                    exercises: [
                        {
                            exerciseId: strengthEx._id.toString(),
                            order: 1,
                            restBetweenSets: 90,
                            sets: [{ setNumber: 1, reps: 8, weightUnit: 'kg' }],
                        },
                    ],
                    cardioActivities: [],
                },
            ],
        },
    });
    const updatedDay = updatePreserve.json?.data?.workoutPlan?.workoutDays?.[0];
    if (
        updatePreserve.status === 200 &&
        updatedDay?.warmupActivities?.length === 2 &&
        updatedDay.warmupActivities[0].id === warmupId0 &&
        updatedDay.warmupActivities[1].id === warmupId1 &&
        updatedDay.cardioActivities?.length === 0 &&
        updatedDay.name === 'Training Updated'
    ) {
        pass('API: omit warm-up preserves; empty cardio clears');
    } else {
        fail('API: omit warm-up preserves; empty cardio clears', JSON.stringify(updatePreserve.json));
    }

    // Update activity notes + add/remove
    const updateMutate = await request('PATCH', `/workout-plans/${planId}`, {
        token,
        body: {
            workoutDays: [
                {
                    _id: dayId,
                    dayNumber: 1,
                    name: 'Training Updated',
                    warmupActivities: [
                        {
                            _id: warmupId0,
                            activityType: 'dynamic_mobility',
                            order: 1,
                            durationMinutes: 6,
                            intensity: 'moderate',
                            notes: 'Updated notes',
                            exerciseId: warmupEx._id.toString(),
                        },
                    ],
                    exercises: [
                        {
                            exerciseId: strengthEx._id.toString(),
                            order: 1,
                            restBetweenSets: 90,
                            sets: [{ setNumber: 1, reps: 8, weightUnit: 'kg' }],
                        },
                    ],
                    cardioActivities: [
                        {
                            activityType: 'cycling',
                            protocol: 'continuous',
                            order: 1,
                            durationMinutes: 25,
                            intensity: 'moderate',
                        },
                    ],
                },
            ],
        },
    });
    const mutated = updateMutate.json?.data?.workoutPlan?.workoutDays?.[0];
    if (
        updateMutate.status === 200 &&
        mutated?.warmupActivities?.length === 1 &&
        mutated.warmupActivities[0].id === warmupId0 &&
        mutated.warmupActivities[0].durationMinutes === 6 &&
        mutated.warmupActivities[0].notes === 'Updated notes' &&
        mutated.cardioActivities?.length === 1 &&
        mutated.cardioActivities[0].activityType === 'cycling'
    ) {
        pass('API: update existing activity; add/remove rows');
    } else {
        fail('API: update existing activity; add/remove rows', JSON.stringify(updateMutate.json));
    }

    // Cross-plan activity id
    const foreignActivityId = new mongoose.Types.ObjectId().toString();
    const crossId = await request('PATCH', `/workout-plans/${planId}`, {
        token,
        body: {
            workoutDays: [
                {
                    _id: dayId,
                    dayNumber: 1,
                    name: 'Training Updated',
                    warmupActivities: [
                        {
                            _id: foreignActivityId,
                            activityType: 'walking',
                            order: 1,
                            durationMinutes: 5,
                            intensity: 'low',
                        },
                    ],
                    exercises: [
                        {
                            exerciseId: strengthEx._id.toString(),
                            order: 1,
                            restBetweenSets: 60,
                            sets: [{ setNumber: 1, reps: 5, weightUnit: 'kg' }],
                        },
                    ],
                },
            ],
        },
    });
    if (crossId.status === 400) {
        pass('API: rejects cross-plan activity IDs');
    } else {
        fail('API: rejects cross-plan activity IDs', JSON.stringify(crossId.json));
    }

    // Snapshot fallback: archive catalog exercise then GET
    await Exercise.findByIdAndUpdate(warmupEx._id, { status: 'archived' });
    // Also make it inaccessible by transferring ownership away after snapshot was stored —
    // visibility filter excludes other trainer's exercises; delete from trainer visibility by changing owner
    await Exercise.findByIdAndUpdate(warmupEx._id, {
        ownership: { type: 'trainer', trainerId: otherTrainer._id },
        status: 'active',
    });

    const getAfter = await request('GET', `/workout-plans/${planId}`, { token });
    const gotWarmup = getAfter.json?.data?.workoutPlan?.workoutDays?.[0]?.warmupActivities?.[0];
    if (
        getAfter.status === 200 &&
        gotWarmup?.exerciseId === warmupEx._id.toString() &&
        gotWarmup?.activitySnapshot?.name === `Warmup Catalog ${suffix}` &&
        gotWarmup?.exercise?.name === `Warmup Catalog ${suffix}` &&
        gotWarmup?.exercise?.status === 'archived'
    ) {
        pass('API: snapshot fallback when catalog not visible');
    } else {
        fail('API: snapshot fallback when catalog not visible', JSON.stringify(gotWarmup));
    }

    // Legacy plan document without activity arrays
    const legacyDoc = await WorkoutPlan.create({
        trainerId: trainer._id,
        ownership: { type: 'trainer', trainerId: trainer._id },
        name: `Legacy Plan ${suffix}`,
        duration: 4,
        daysPerWeek: 1,
        goal: 'general_fitness',
        level: 'beginner',
        status: 'active',
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Legacy Day',
                exercises: [
                    {
                        exerciseId: strengthEx._id,
                        order: 1,
                        restBetweenSets: 60,
                        sets: [{ setNumber: 1, reps: 5, weightUnit: 'kg' }],
                        exerciseSnapshot: { name: strengthEx.name, thumbnailUrl: null },
                    },
                ],
            },
        ],
    });
    // Force-unset activity arrays to simulate historical docs
    await WorkoutPlan.collection.updateOne(
        { _id: legacyDoc._id },
        { $unset: { 'workoutDays.0.warmupActivities': '', 'workoutDays.0.cardioActivities': '' } }
    );

    const getLegacy = await request('GET', `/workout-plans/${legacyDoc._id}`, { token });
    const legacyApiDay = getLegacy.json?.data?.workoutPlan?.workoutDays?.[0];
    if (
        getLegacy.status === 200 &&
        Array.isArray(legacyApiDay?.warmupActivities) &&
        legacyApiDay.warmupActivities.length === 0 &&
        Array.isArray(legacyApiDay?.cardioActivities) &&
        legacyApiDay.cardioActivities.length === 0
    ) {
        pass('API: legacy plans serialize empty activity arrays');
    } else {
        fail('API: legacy plans serialize empty activity arrays', JSON.stringify(getLegacy.json));
    }

    // Clone
    const beforeClone = await WorkoutPlan.findById(planId).lean();
    const cloneRes = await request('POST', `/workout-plans/${planId}/clone`, {
        token,
        body: { name: `Cloned Activities ${suffix}` },
    });
    const cloned = cloneRes.json?.data?.workoutPlan;
    const clonedDay = cloned?.workoutDays?.[0];
    const afterClone = await WorkoutPlan.findById(planId).lean();

    if (
        cloneRes.status === 201 &&
        clonedDay?.warmupActivities?.length === beforeClone.workoutDays[0].warmupActivities.length &&
        clonedDay?.cardioActivities?.length === beforeClone.workoutDays[0].cardioActivities.length &&
        clonedDay.warmupActivities[0].id !== String(beforeClone.workoutDays[0].warmupActivities[0]._id) &&
        String(afterClone.workoutDays[0].warmupActivities[0]._id) ===
            String(beforeClone.workoutDays[0].warmupActivities[0]._id)
    ) {
        pass('API: clone copies activities with new nested IDs; source unchanged');
    } else {
        fail(
            'API: clone copies activities with new nested IDs; source unchanged',
            JSON.stringify({ clone: cloneRes.json, sourceWarmup: beforeClone.workoutDays[0].warmupActivities[0]._id })
        );
    }

    // Export model with activities
    const detail = getAfter.json?.data?.workoutPlan;
    const exportWithActs = buildWorkoutExportModel(detail, { fullName: 'Coach' });
    const exportDay = exportWithActs.content.workoutDays[0];
    if (
        exportDay.warmupActivities?.length >= 1 &&
        exportDay.cardioActivities?.length >= 1 &&
        exportDay.exercises?.length === 1 &&
        exportDay.warmupActivities[0].durationMinutes != null &&
        exportDay.warmupActivities[0].intensity &&
        exportWithActs.plan.totalExercises === detail.totalExercises
    ) {
        pass('Export DTO: includes warm-up/cardio; totalExercises strength-only');
    } else {
        fail('Export DTO: includes warm-up/cardio; totalExercises strength-only', JSON.stringify(exportDay));
    }

    // Cleanup
    await WorkoutPlan.deleteMany({
        _id: {
            $in: [
                planId,
                createEmpty.json?.data?.workoutPlan?.id,
                mixedPlanId,
                legacyDoc._id,
                cloned?.id,
            ].filter(Boolean),
        },
    });
    await Exercise.deleteMany({
        _id: { $in: [warmupEx._id, cardioEx._id, privateWarmup._id] },
    });
    await User.deleteMany({ _id: { $in: [trainer._id, otherTrainer._id] } });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
    return mongoose.disconnect().catch(() => {});
});
