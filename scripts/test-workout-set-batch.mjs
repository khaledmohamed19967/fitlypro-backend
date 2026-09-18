/**
 * Workout set batch logging.
 * Run: node scripts/test-workout-set-batch.mjs
 *
 * Prerequisites:
 * - Dev server running (with latest code)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import Exercise from '../src/modules/exercises/exercise.model.js';
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js';
import PlanAssignment from '../src/modules/workout-plans/plan-assignment.model.js';
import WorkoutSession from '../src/modules/workout-plans/workout-session.model.js';
import WorkoutSetLog from '../src/modules/workout-plans/workout-set-log.model.js';

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
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

const setItem = (exerciseId, setNumber, overrides = {}) => ({
    exerciseId,
    setNumber,
    status: 'completed',
    reps: 10,
    weight: 40,
    weightUnit: 'kg',
    durationSeconds: null,
    distance: null,
    notes: null,
    ...overrides,
});

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    const trainer = await User.create({
        firstName: 'Batch',
        lastName: 'Trainer',
        email: `wp-batch-trainer-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const clientA = await User.create({
        firstName: 'Batch',
        lastName: 'ClientA',
        email: `wp-batch-a-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const clientB = await User.create({
        firstName: 'Batch',
        lastName: 'ClientB',
        email: `wp-batch-b-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const loginTrainer = await request('POST', '/auth/login', {
        body: { email: trainer.email, password },
    });
    const loginA = await request('POST', '/auth/login', {
        body: { email: clientA.email, password },
    });
    const loginB = await request('POST', '/auth/login', {
        body: { email: clientB.email, password },
    });

    const tokenTrainer = loginTrainer.json?.data?.token;
    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;

    if (!tokenTrainer || !tokenA || !tokenB) {
        throw new Error('Failed to login test users');
    }

    const exercise = await Exercise.create({
        name: `Batch Exercise ${suffix}`,
        slug: `batch-ex-${suffix}`,
        muscles: { primary: 'chest', secondary: ['triceps'] },
        equipment: ['dumbbell'],
        category: 'strength',
        difficulty: 'beginner',
        ownership: { type: 'trainer', trainerId: trainer._id },
        source: { type: 'manual' },
        status: 'active',
    });
    const exerciseB = await Exercise.create({
        name: `Batch Exercise B ${suffix}`,
        slug: `batch-ex-b-${suffix}`,
        muscles: { primary: 'back', secondary: ['biceps'] },
        equipment: ['dumbbell'],
        category: 'strength',
        difficulty: 'beginner',
        ownership: { type: 'trainer', trainerId: trainer._id },
        source: { type: 'manual' },
        status: 'active',
    });
    const exerciseC = await Exercise.create({
        name: `Batch Exercise C ${suffix}`,
        slug: `batch-ex-c-${suffix}`,
        muscles: { primary: 'shoulders', secondary: [] },
        equipment: ['dumbbell'],
        category: 'strength',
        difficulty: 'beginner',
        ownership: { type: 'trainer', trainerId: trainer._id },
        source: { type: 'manual' },
        status: 'active',
    });
    const exerciseId = exercise._id.toString();
    const exerciseIdB = exerciseB._id.toString();
    const exerciseIdC = exerciseC._id.toString();

    const makeSets = (count) =>
        Array.from({ length: count }, (_, i) => ({
            setNumber: i + 1,
            reps: 8,
            weight: 20,
            weightUnit: 'kg',
        }));

    // 20 + 20 + 10 = 50 prescribed sets (plan max 20 sets/exercise)
    const fiftyBatchItems = [
        ...Array.from({ length: 20 }, (_, i) => setItem(exerciseId, i + 1)),
        ...Array.from({ length: 20 }, (_, i) => setItem(exerciseIdB, i + 1)),
        ...Array.from({ length: 10 }, (_, i) => setItem(exerciseIdC, i + 1)),
    ];

    const createPlan = await request('POST', '/workout-plans', {
        token: tokenTrainer,
        body: {
            name: `Batch Plan ${suffix}`,
            description: 'Batch set logging plan',
            duration: 4,
            daysPerWeek: 2,
            goal: 'strength',
            level: 'beginner',
            isTemplate: false,
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Push',
                    description: 'Batch day',
                    exercises: [
                        {
                            exerciseId,
                            order: 1,
                            restBetweenSets: 90,
                            sets: makeSets(20),
                        },
                        {
                            exerciseId: exerciseIdB,
                            order: 2,
                            restBetweenSets: 90,
                            sets: makeSets(20),
                        },
                        {
                            exerciseId: exerciseIdC,
                            order: 3,
                            restBetweenSets: 60,
                            sets: makeSets(10),
                        },
                    ],
                },
                {
                    dayNumber: 2,
                    name: 'Pull',
                    exercises: [
                        {
                            exerciseId,
                            order: 1,
                            restBetweenSets: 60,
                            sets: makeSets(2),
                        },
                    ],
                },
            ],
        },
    });

    const planId = createPlan.json?.data?.workoutPlan?.id;
    const workoutDayId = createPlan.json?.data?.workoutPlan?.workoutDays?.[0]?.id;
    if (!planId || !workoutDayId) {
        throw new Error(`Plan create failed: ${JSON.stringify(createPlan.json)}`);
    }

    const assignA = await request('POST', `/workout-plans/${planId}/assignments`, {
        token: tokenTrainer,
        body: { clientIds: [clientA._id.toString()], startDate: new Date().toISOString() },
    });
    if (assignA.status !== 201) {
        throw new Error(`Assign A failed: ${JSON.stringify(assignA.json)}`);
    }

    const assignB = await request('POST', `/workout-plans/${planId}/assignments`, {
        token: tokenTrainer,
        body: { clientIds: [clientB._id.toString()], startDate: new Date().toISOString() },
    });
    if (assignB.status !== 201) {
        throw new Error(`Assign B failed: ${JSON.stringify(assignB.json)}`);
    }

    const startA = await request('POST', '/me/workout-sessions', {
        token: tokenA,
        body: { workoutDayId },
    });
    const sessionId = startA.json?.data?.session?.id;
    if (startA.status !== 201 || !sessionId) {
        throw new Error(`Start session failed: ${JSON.stringify(startA.json)}`);
    }

    const batchPath = `/me/workout-sessions/${sessionId}/sets/batch`;

    // --- Auth ---
    const unauth = await request('POST', batchPath, {
        body: { sets: [setItem(exerciseId, 1)] },
    });
    if (unauth.status === 401) pass('17. Unauthorized user → 401');
    else fail('17. Unauthorized user → 401', `status=${unauth.status}`);

    const asTrainer = await request('POST', batchPath, {
        token: tokenTrainer,
        body: { sets: [setItem(exerciseId, 1)] },
    });
    if (asTrainer.status === 403) pass('18. Non-client role → 403');
    else fail('18. Non-client role → 403', `status=${asTrainer.status}`);

    // --- Envelope validation ---
    const missingSets = await request('POST', batchPath, {
        token: tokenA,
        body: {},
    });
    if (missingSets.status === 400) pass('7. Missing sets → 400');
    else fail('7. Missing sets → 400', JSON.stringify(missingSets.json));

    const emptySets = await request('POST', batchPath, {
        token: tokenA,
        body: { sets: [] },
    });
    if (emptySets.status === 400) pass('6. Empty sets → 400');
    else fail('6. Empty sets → 400', JSON.stringify(emptySets.json));

    const tooMany = await request('POST', batchPath, {
        token: tokenA,
        body: {
            sets: [
                ...fiftyBatchItems,
                setItem(new mongoose.Types.ObjectId().toString(), 1),
            ],
        },
    });
    if (tooMany.status === 400) pass('5. 51 sets → 400');
    else fail('5. 51 sets → 400', JSON.stringify(tooMany.json));

    const dupInPayload = await request('POST', batchPath, {
        token: tokenA,
        body: {
            sets: [setItem(exerciseId, 1), setItem(exerciseId, 1, { reps: 8 })],
        },
    });
    if (dupInPayload.status === 400) {
        pass('8. Duplicate exerciseId + setNumber inside same request → 400');
    } else {
        fail(
            '8. Duplicate exerciseId + setNumber inside same request → 400',
            JSON.stringify(dupInPayload.json)
        );
    }

    const beforeDupWrites = await WorkoutSetLog.countDocuments({ sessionId });
    if (beforeDupWrites === 0) {
        pass('8b. Duplicate payload did not write any set logs');
    } else {
        fail('8b. Duplicate payload did not write any set logs', `count=${beforeDupWrites}`);
    }

    const badObjectId = await request('POST', batchPath, {
        token: tokenA,
        body: { sets: [setItem('not-an-object-id', 1)] },
    });
    if (badObjectId.status === 400) pass('26. Invalid ObjectId → 400');
    else fail('26. Invalid ObjectId → 400', JSON.stringify(badObjectId.json));

    const badReps = await request('POST', batchPath, {
        token: tokenA,
        body: { sets: [setItem(exerciseId, 1, { reps: -1 })] },
    });
    if (badReps.status === 400) pass('27. Invalid reps/weight/etc. → 400');
    else fail('27. Invalid reps/weight/etc. → 400', JSON.stringify(badReps.json));

    const longNotes = await request('POST', batchPath, {
        token: tokenA,
        body: { sets: [setItem(exerciseId, 1, { notes: 'x'.repeat(501) })] },
    });
    if (longNotes.status === 400) pass('28. Notes > 500 → 400');
    else fail('28. Notes > 500 → 400', JSON.stringify(longNotes.json));

    const badStatus = await request('POST', batchPath, {
        token: tokenA,
        body: { sets: [setItem(exerciseId, 1, { status: 'done' })] },
    });
    if (badStatus.status === 400) pass('29. status validation → 400');
    else fail('29. status validation → 400', JSON.stringify(badStatus.json));

    const badUnit = await request('POST', batchPath, {
        token: tokenA,
        body: { sets: [setItem(exerciseId, 1, { weightUnit: 'stones' })] },
    });
    if (badUnit.status === 400) pass('30. weightUnit validation → 400');
    else fail('30. weightUnit validation → 400', JSON.stringify(badUnit.json));

    const ownedFields = await request('POST', batchPath, {
        token: tokenA,
        body: {
            sets: [
                {
                    ...setItem(exerciseId, 1),
                    clientId: clientB._id.toString(),
                    assignmentId: new mongoose.Types.ObjectId().toString(),
                    planId: planId,
                    sessionId,
                    planExerciseId: new mongoose.Types.ObjectId().toString(),
                    workoutDayId,
                    completedAt: new Date().toISOString(),
                },
            ],
        },
    });
    if (ownedFields.status === 400) {
        pass('25. Server-owned fields rejected');
    } else {
        fail('25. Server-owned fields rejected', JSON.stringify(ownedFields.json));
    }

    // --- Happy paths ---
    const oneSet = await request('POST', batchPath, {
        token: tokenA,
        body: { sets: [setItem(exerciseId, 1)] },
    });
    const oneResults = oneSet.json?.data?.results;
    if (
        oneSet.status === 200 &&
        oneResults?.length === 1 &&
        oneResults[0]?.outcome === 'created' &&
        oneResults[0]?.setLog?.id &&
        oneResults[0]?.error === null
    ) {
        pass('2. One set → created');
    } else {
        fail('2. One set → created', JSON.stringify(oneSet.json));
    }

    const multi = await request('POST', batchPath, {
        token: tokenA,
        body: {
            sets: [setItem(exerciseId, 2), setItem(exerciseId, 3), setItem(exerciseId, 4)],
        },
    });
    if (
        multi.status === 200 &&
        multi.json?.data?.results?.every((r) => r.outcome === 'created') &&
        multi.json?.data?.results?.length === 3
    ) {
        pass('3. Multiple sets → all created');
    } else {
        fail('3. Multiple sets → all created', JSON.stringify(multi.json));
    }

    // Fill remaining sets on client A day-1 (sets 5-20 of ex A, all of B and C)
    const remainingA = fiftyBatchItems.filter(
        (item) =>
            !(item.exerciseId === exerciseId && item.setNumber >= 1 && item.setNumber <= 4)
    );
    const fillA = await request('POST', batchPath, {
        token: tokenA,
        body: { sets: remainingA },
    });
    if (
        fillA.status === 200 &&
        fillA.json?.data?.results?.every((r) => r.outcome === 'created') &&
        fillA.json?.data?.results?.length === remainingA.length
    ) {
        pass('3b. Remaining day-1 sets created');
    } else {
        fail('3b. Remaining day-1 sets created', JSON.stringify({
            status: fillA.status,
            len: fillA.json?.data?.results?.length,
            expected: remainingA.length,
        }));
    }

    // Exact 50 on client B
    const startB = await request('POST', '/me/workout-sessions', {
        token: tokenB,
        body: { workoutDayId },
    });
    const sessionB = startB.json?.data?.session?.id;
    if (!sessionB) {
        throw new Error(`Start B failed: ${JSON.stringify(startB.json)}`);
    }
    const batchPathB = `/me/workout-sessions/${sessionB}/sets/batch`;

    const exactFifty = await request('POST', batchPathB, {
        token: tokenB,
        body: { sets: fiftyBatchItems },
    });
    const fiftyCount = await WorkoutSetLog.countDocuments({ sessionId: sessionB });
    if (
        exactFifty.status === 200 &&
        exactFifty.json?.data?.results?.length === 50 &&
        exactFifty.json?.data?.results?.every((r) => r.outcome === 'created') &&
        fiftyCount === 50
    ) {
        pass('1. Valid batch with all new sets (50) → created');
        pass('4. Maximum 50 sets in one request → 200');
    } else {
        fail(
            '1. Valid batch with all new sets (50) → created',
            JSON.stringify({
                status: exactFifty.status,
                results: exactFifty.json?.data?.results?.length,
                fiftyCount,
                sample: exactFifty.json?.data?.results?.find((r) => r.outcome !== 'created'),
            })
        );
        fail('4. Maximum 50 sets in one request → 200', 'see test 1');
    }

    // --- Per-item validation ---
    const startInvalid = await request('POST', '/me/workout-sessions', {
        token: tokenA,
        body: { workoutDayNumber: 2 },
    });
    const sessionInvalid = startInvalid.json?.data?.session?.id;
    const batchInvalid = `/me/workout-sessions/${sessionInvalid}/sets/batch`;
    const day2ExerciseId = exerciseId;

    const invalidExercise = await request('POST', batchInvalid, {
        token: tokenA,
        body: {
            sets: [setItem(new mongoose.Types.ObjectId().toString(), 1)],
        },
    });
    if (
        invalidExercise.status === 200 &&
        invalidExercise.json?.data?.results?.[0]?.outcome === 'rejected' &&
        invalidExercise.json?.data?.results?.[0]?.error?.statusCode === 400
    ) {
        pass('9. Invalid exercise → rejected item');
    } else {
        fail('9. Invalid exercise → rejected item', JSON.stringify(invalidExercise.json));
    }

    const invalidSetNumber = await request('POST', batchInvalid, {
        token: tokenA,
        body: { sets: [setItem(day2ExerciseId, 99)] },
    });
    if (
        invalidSetNumber.status === 200 &&
        invalidSetNumber.json?.data?.results?.[0]?.outcome === 'rejected'
    ) {
        pass('10. Invalid set number → rejected item');
    } else {
        fail('10. Invalid set number → rejected item', JSON.stringify(invalidSetNumber.json));
    }

    const mixed = await request('POST', batchInvalid, {
        token: tokenA,
        body: {
            sets: [
                setItem(day2ExerciseId, 1),
                setItem(day2ExerciseId, 99),
                setItem(day2ExerciseId, 2),
            ],
        },
    });
    const mixedOutcomes = mixed.json?.data?.results?.map((r) => r.outcome);
    if (
        mixed.status === 200 &&
        mixedOutcomes?.[0] === 'created' &&
        mixedOutcomes?.[1] === 'rejected' &&
        mixedOutcomes?.[2] === 'created'
    ) {
        pass('11. Mixed valid + invalid items');
    } else {
        fail('11. Mixed valid + invalid items', JSON.stringify(mixed.json));
    }

    const mixedCount = await WorkoutSetLog.countDocuments({ sessionId: sessionInvalid });
    if (mixedCount === 2) pass('11b. Mixed batch only persisted valid items');
    else fail('11b. Mixed batch only persisted valid items', `count=${mixedCount}`);

    // --- Idempotency ---
    const allDup = await request('POST', batchInvalid, {
        token: tokenA,
        body: {
            sets: [setItem(day2ExerciseId, 1), setItem(day2ExerciseId, 2)],
        },
    });
    if (
        allDup.status === 200 &&
        allDup.json?.data?.results?.every((r) => r.outcome === 'alreadyExists') &&
        allDup.json?.data?.results?.every((r) => r.setLog?.id)
    ) {
        pass('12. All duplicates → alreadyExists');
    } else {
        fail('12. All duplicates → alreadyExists', JSON.stringify(allDup.json));
    }

    // Mixed new + alreadyExists on client B session (all 50 exist) — need a fresh day/session
    // Use day 2 for client B
    const startB2 = await request('POST', '/me/workout-sessions', {
        token: tokenB,
        body: { workoutDayNumber: 2 },
    });
    const sessionB2 = startB2.json?.data?.session?.id;
    const batchB2 = `/me/workout-sessions/${sessionB2}/sets/batch`;

    await request('POST', batchB2, {
        token: tokenB,
        body: { sets: [setItem(exerciseId, 1, { reps: 5 })] },
    });

    const mixedExist = await request('POST', batchB2, {
        token: tokenB,
        body: {
            sets: [
                setItem(exerciseId, 1, { reps: 99 }),
                setItem(exerciseId, 2, { reps: 7 }),
            ],
        },
    });
    const mixedExistOutcomes = mixedExist.json?.data?.results?.map((r) => r.outcome);
    const existingLog = mixedExist.json?.data?.results?.[0]?.setLog;
    if (
        mixedExist.status === 200 &&
        mixedExistOutcomes?.[0] === 'alreadyExists' &&
        mixedExistOutcomes?.[1] === 'created' &&
        existingLog?.reps === 5
    ) {
        pass('13. Mixed new + alreadyExists');
        pass('16. Existing SetLog returned for alreadyExists (first-write-wins)');
    } else {
        fail('13. Mixed new + alreadyExists', JSON.stringify(mixedExist.json));
        fail(
            '16. Existing SetLog returned for alreadyExists (first-write-wins)',
            JSON.stringify(existingLog)
        );
    }

    const retryPayload = {
        sets: [
            setItem(exerciseId, 1, { reps: 5 }),
            setItem(exerciseId, 2, { reps: 7 }),
        ],
    };
    const countBeforeRetry = await WorkoutSetLog.countDocuments({ sessionId: sessionB2 });
    const retry = await request('POST', batchB2, {
        token: tokenB,
        body: retryPayload,
    });
    const countAfterRetry = await WorkoutSetLog.countDocuments({ sessionId: sessionB2 });
    if (
        retry.status === 200 &&
        retry.json?.data?.results?.every((r) => r.outcome === 'alreadyExists') &&
        countAfterRetry === countBeforeRetry
    ) {
        pass('14. Retry exact same batch → alreadyExists');
        pass('15. Retry produces no duplicate documents');
    } else {
        fail('14. Retry exact same batch → alreadyExists', JSON.stringify(retry.json));
        fail(
            '15. Retry produces no duplicate documents',
            `before=${countBeforeRetry} after=${countAfterRetry}`
        );
    }

    // --- Counter correctness ---
    const sessionBDoc = await WorkoutSession.findById(sessionB);
    if (
        sessionBDoc?.completedSets === 50 &&
        sessionBDoc?.totalSets === 50 &&
        sessionBDoc?.progress === 100
    ) {
        pass('24. Counter correctness after full batch');
    } else {
        fail(
            '24. Counter correctness after full batch',
            JSON.stringify({
                completedSets: sessionBDoc?.completedSets,
                totalSets: sessionBDoc?.totalSets,
                progress: sessionBDoc?.progress,
            })
        );
    }

    // Session DTO present on batch response
    if (
        exactFifty.json?.data?.session?.id === sessionB &&
        Array.isArray(exactFifty.json?.data?.session?.setLogs) &&
        exactFifty.json?.data?.session?.setLogs.length === 50 &&
        !('trainerId' in (exactFifty.json?.data?.session || {})) &&
        !('clientId' in (exactFifty.json?.data?.session || {}))
    ) {
        pass('1b. Batch response includes public session DTO');
    } else {
        fail('1b. Batch response includes public session DTO', 'session shape invalid');
    }

    // Single-set endpoint still works
    const singleStill = await request('POST', `/me/workout-sessions/${sessionInvalid}/sets`, {
        token: tokenA,
        body: setItem(day2ExerciseId, 1),
    });
    // set 1 already exists on sessionInvalid → 409 from single endpoint
    if (singleStill.status === 409) {
        pass('Single-set endpoint unchanged (duplicate still 409)');
    } else {
        fail(
            'Single-set endpoint unchanged (duplicate still 409)',
            `status=${singleStill.status}`
        );
    }

    // --- Session-level failures ---
    const unknownSession = await request(
        'POST',
        `/me/workout-sessions/${new mongoose.Types.ObjectId()}/sets/batch`,
        {
            token: tokenA,
            body: { sets: [setItem(exerciseId, 1)] },
        }
    );
    if (unknownSession.status === 404) pass('19. Session not found → 404');
    else fail('19. Session not found → 404', `status=${unknownSession.status}`);

    // Complete client B day-2 session then batch
    const completed = await request('POST', `/me/workout-sessions/${sessionB2}/complete`, {
        token: tokenB,
    });
    if (completed.status === 200) {
        const afterComplete = await request('POST', batchB2, {
            token: tokenB,
            body: { sets: [setItem(exerciseId, 1)] },
        });
        if (afterComplete.status === 409) pass('20. Session completed → 409');
        else fail('20. Session completed → 409', JSON.stringify(afterComplete.json));
    } else {
        fail('20. Session completed → 409', `complete failed: ${JSON.stringify(completed.json)}`);
    }

    // Abandoned session
    const abandonClient = await User.create({
        firstName: 'Batch',
        lastName: 'Abandon',
        email: `wp-batch-abandon-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });
    await request('POST', `/workout-plans/${planId}/assignments`, {
        token: tokenTrainer,
        body: {
            clientIds: [abandonClient._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    const loginAbandon = await request('POST', '/auth/login', {
        body: { email: abandonClient.email, password },
    });
    const tokenAbandon = loginAbandon.json?.data?.token;
    const startAbandon = await request('POST', '/me/workout-sessions', {
        token: tokenAbandon,
        body: { workoutDayId },
    });
    const abandonSessionId = startAbandon.json?.data?.session?.id;
    await request('POST', `/me/workout-sessions/${abandonSessionId}/abandon`, {
        token: tokenAbandon,
    });
    const afterAbandon = await request(
        'POST',
        `/me/workout-sessions/${abandonSessionId}/sets/batch`,
        {
            token: tokenAbandon,
            body: { sets: [setItem(exerciseId, 1)] },
        }
    );
    if (afterAbandon.status === 409) pass('21. Session abandoned → 409');
    else fail('21. Session abandoned → 409', JSON.stringify(afterAbandon.json));

    // Assignment no longer active
    const inactiveClient = await User.create({
        firstName: 'Batch',
        lastName: 'Inactive',
        email: `wp-batch-inactive-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });
    const assignInactive = await request('POST', `/workout-plans/${planId}/assignments`, {
        token: tokenTrainer,
        body: {
            clientIds: [inactiveClient._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    const inactiveAssignmentId = assignInactive.json?.data?.assignments?.[0]?.id;
    const loginInactive = await request('POST', '/auth/login', {
        body: { email: inactiveClient.email, password },
    });
    const tokenInactive = loginInactive.json?.data?.token;
    const startInactive = await request('POST', '/me/workout-sessions', {
        token: tokenInactive,
        body: { workoutDayId },
    });
    const inactiveSessionId = startInactive.json?.data?.session?.id;

    await request(
        'PATCH',
        `/workout-plans/${planId}/assignments/${inactiveAssignmentId}`,
        {
            token: tokenTrainer,
            body: { status: 'cancelled' },
        }
    );

    const afterCancel = await request(
        'POST',
        `/me/workout-sessions/${inactiveSessionId}/sets/batch`,
        {
            token: tokenInactive,
            body: { sets: [setItem(exerciseId, 1)] },
        }
    );
    if (afterCancel.status === 409) pass('22. Assignment no longer active → 409');
    else fail('22. Assignment no longer active → 409', JSON.stringify(afterCancel.json));

    // Assignment plan mismatch
    const mismatchClient = await User.create({
        firstName: 'Batch',
        lastName: 'Mismatch',
        email: `wp-batch-mismatch-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });
    await request('POST', `/workout-plans/${planId}/assignments`, {
        token: tokenTrainer,
        body: {
            clientIds: [mismatchClient._id.toString()],
            startDate: new Date().toISOString(),
        },
    });
    const loginMismatch = await request('POST', '/auth/login', {
        body: { email: mismatchClient.email, password },
    });
    const tokenMismatch = loginMismatch.json?.data?.token;
    const startMismatch = await request('POST', '/me/workout-sessions', {
        token: tokenMismatch,
        body: { workoutDayId },
    });
    const mismatchSessionId = startMismatch.json?.data?.session?.id;
    await WorkoutSession.updateOne(
        { _id: mismatchSessionId },
        { $set: { planId: new mongoose.Types.ObjectId() } }
    );
    const afterMismatch = await request(
        'POST',
        `/me/workout-sessions/${mismatchSessionId}/sets/batch`,
        {
            token: tokenMismatch,
            body: { sets: [setItem(exerciseId, 1)] },
        }
    );
    if (afterMismatch.status === 409) pass('23. Assignment plan mismatch → 409');
    else fail('23. Assignment plan mismatch → 409', JSON.stringify(afterMismatch.json));

    // Cross-client: B cannot write to A's session
    const cross = await request('POST', batchPath, {
        token: tokenB,
        body: { sets: [setItem(exerciseId, 1)] },
    });
    if (cross.status === 404) pass('Cross-client session access → 404');
    else fail('Cross-client session access → 404', `status=${cross.status}`);

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);
    if (failed.length) {
        failed.forEach((f) => console.log(`FAIL: ${f.name} — ${f.detail}`));
    }

    await WorkoutSetLog.deleteMany({
        clientId: {
            $in: [
                clientA._id,
                clientB._id,
                abandonClient._id,
                inactiveClient._id,
                mismatchClient._id,
            ],
        },
    });
    await WorkoutSession.deleteMany({
        clientId: {
            $in: [
                clientA._id,
                clientB._id,
                abandonClient._id,
                inactiveClient._id,
                mismatchClient._id,
            ],
        },
    });
    await PlanAssignment.deleteMany({ trainerId: trainer._id });
    await WorkoutPlan.deleteMany({ trainerId: trainer._id });
    await Exercise.deleteMany({ _id: { $in: [exercise._id, exerciseB._id, exerciseC._id] } });
    await User.deleteMany({
        _id: {
            $in: [
                trainer._id,
                clientA._id,
                clientB._id,
                abandonClient._id,
                inactiveClient._id,
                mismatchClient._id,
            ],
        },
    });

    await mongoose.disconnect();
    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
