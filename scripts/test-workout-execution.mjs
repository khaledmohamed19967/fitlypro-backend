/**
 * Workout Execution / Sessions / Set Logging verification.
 * Run: node scripts/test-workout-execution.mjs
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

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    const trainer = await User.create({
        firstName: 'Exec',
        lastName: 'Trainer',
        email: `wp-exec-trainer-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const clientA = await User.create({
        firstName: 'Exec',
        lastName: 'ClientA',
        email: `wp-exec-a-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const clientB = await User.create({
        firstName: 'Exec',
        lastName: 'ClientB',
        email: `wp-exec-b-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const clientEmpty = await User.create({
        firstName: 'Exec',
        lastName: 'Empty',
        email: `wp-exec-empty-${suffix}@test.com`,
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
    const loginEmpty = await request('POST', '/auth/login', {
        body: { email: clientEmpty.email, password },
    });

    const tokenTrainer = loginTrainer.json?.data?.token;
    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;
    const tokenEmpty = loginEmpty.json?.data?.token;

    if (!tokenTrainer || !tokenA || !tokenB) {
        throw new Error('Failed to login test users');
    }

    let systemExercise = await Exercise.findOne({ 'ownership.type': 'system', status: 'active' });
    if (!systemExercise) {
        systemExercise = await Exercise.create({
            name: `Exec Exercise ${suffix}`,
            slug: `exec-ex-${suffix}`,
            muscles: { primary: 'chest', secondary: [] },
            equipment: ['dumbbell'],
            category: 'strength',
            difficulty: 'beginner',
            ownership: { type: 'system', trainerId: null },
            source: { type: 'manual' },
            status: 'active',
        });
    }

    const exerciseId = systemExercise._id.toString();

    const createPlan = await request('POST', '/workout-plans', {
        token: tokenTrainer,
        body: {
            name: `Exec Plan ${suffix}`,
            description: 'Execution test plan',
            duration: 4,
            daysPerWeek: 2,
            goal: 'strength',
            level: 'beginner',
            isTemplate: false,
            workoutDays: [
                {
                    dayNumber: 1,
                    name: 'Push',
                    description: 'Push day',
                    exercises: [
                        {
                            exerciseId,
                            order: 1,
                            restBetweenSets: 90,
                            sets: [
                                { setNumber: 1, reps: 10, weight: 40, weightUnit: 'kg' },
                                { setNumber: 2, reps: 8, weight: 45, weightUnit: 'kg' },
                            ],
                        },
                    ],
                },
                {
                    dayNumber: 2,
                    name: 'Pull',
                    description: 'Pull day',
                    exercises: [
                        {
                            exerciseId,
                            order: 1,
                            restBetweenSets: 60,
                            sets: [{ setNumber: 1, reps: 12, weightUnit: 'kg' }],
                        },
                    ],
                },
            ],
        },
    });

    const planId = createPlan.json?.data?.workoutPlan?.id;
    const workoutDayId = createPlan.json?.data?.workoutPlan?.workoutDays?.[0]?.id;
    const planDocBefore = await WorkoutPlan.findById(planId).lean();

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

    // Auth gates
    const unauth = await request('POST', '/me/workout-sessions', {
        body: { workoutDayId },
    });
    if (unauth.status === 401) pass('1. Unauthenticated → 401');
    else fail('1. Unauthenticated → 401', `status=${unauth.status}`);

    const asTrainer = await request('POST', '/me/workout-sessions', {
        token: tokenTrainer,
        body: { workoutDayId },
    });
    if (asTrainer.status === 403) pass('2. Trainer → 403');
    else fail('2. Trainer → 403', `status=${asTrainer.status}`);

    // No active assignment
    const startEmpty = await request('POST', '/me/workout-sessions', {
        token: tokenEmpty,
        body: { workoutDayId },
    });
    if (startEmpty.status === 404) pass('3. Client without active assignment → 404');
    else fail('3. Client without active assignment → 404', JSON.stringify(startEmpty.json));

    // Forbidden ownership injection
    const inject = await request('POST', '/me/workout-sessions', {
        token: tokenA,
        body: {
            workoutDayId,
            clientId: clientB._id.toString(),
            trainerId: trainer._id.toString(),
            planId,
            assignmentId: '000000000000000000000000',
        },
    });
    if (inject.status === 400) pass('4. Injected ownership fields rejected');
    else fail('4. Injected ownership fields rejected', `status=${inject.status}`);

    // Start session
    const start = await request('POST', '/me/workout-sessions', {
        token: tokenA,
        body: { workoutDayId },
    });
    const session = start.json?.data?.session;
    const sessionId = session?.id;

    if (start.status === 201 && session?.status === 'in_progress' && sessionId) {
        pass('5. Client can start own assigned workout');
    } else {
        fail('5. Client can start own assigned workout', JSON.stringify(start.json));
    }

    if (
        session?.workoutDay?.id === workoutDayId &&
        session?.workoutDay?.dayNumber === 1 &&
        session?.workoutDay?.name === 'Push' &&
        session?.totalSets === 2 &&
        session?.completedSets === 0 &&
        session?.progress === 0 &&
        Array.isArray(session?.setLogs) &&
        !('clientId' in session) &&
        !('trainerId' in session)
    ) {
        pass('6. Session DTO shape is player-safe with counters');
    } else {
        fail('6. Session DTO shape is player-safe with counters', JSON.stringify(session));
    }

    // Resume same in-progress session
    const resume = await request('POST', '/me/workout-sessions', {
        token: tokenA,
        body: { workoutDayNumber: 1 },
    });
    if (resume.status === 201 && resume.json?.data?.session?.id === sessionId) {
        pass('7. Starting same day resumes existing in-progress session');
    } else {
        fail('7. Starting same day resumes existing in-progress session', JSON.stringify(resume.json));
    }

    // Invalid day
    const badDay = await request('POST', '/me/workout-sessions', {
        token: tokenA,
        body: { workoutDayNumber: 7 },
    });
    if (badDay.status === 404) pass('8. Invalid workout day → 404');
    else fail('8. Invalid workout day → 404', `status=${badDay.status}`);

    // Log set
    const log1 = await request('POST', `/me/workout-sessions/${sessionId}/sets`, {
        token: tokenA,
        body: {
            exerciseId,
            setNumber: 1,
            reps: 12,
            weight: 50,
            weightUnit: 'kg',
            status: 'completed',
            notes: 'felt strong',
        },
    });
    const setLogId = log1.json?.data?.setLog?.id;

    if (log1.status === 201 && log1.json?.data?.setLog?.reps === 12) {
        pass('9. Client can log a prescribed set');
    } else {
        fail('9. Client can log a prescribed set', JSON.stringify(log1.json));
    }

    const afterLog1 = await request('GET', `/me/workout-sessions/${sessionId}`, {
        token: tokenA,
    });
    if (
        afterLog1.json?.data?.session?.completedSets === 1 &&
        afterLog1.json?.data?.session?.progress === 50
    ) {
        pass('10. Progress recalculated server-side after set log');
    } else {
        fail('10. Progress recalculated server-side after set log', JSON.stringify(afterLog1.json));
    }

    // Duplicate set
    const dup = await request('POST', `/me/workout-sessions/${sessionId}/sets`, {
        token: tokenA,
        body: { exerciseId, setNumber: 1, reps: 9, weightUnit: 'kg' },
    });
    if (dup.status === 409) pass('11. Duplicate set → 409');
    else fail('11. Duplicate set → 409', `status=${dup.status}`);

    // Invalid exercise / set
    const badEx = await request('POST', `/me/workout-sessions/${sessionId}/sets`, {
        token: tokenA,
        body: {
            exerciseId: '000000000000000000000000',
            setNumber: 1,
            reps: 5,
            weightUnit: 'kg',
        },
    });
    if (badEx.status === 400) pass('12. Invalid exercise rejected');
    else fail('12. Invalid exercise rejected', `status=${badEx.status}`);

    const badSetNum = await request('POST', `/me/workout-sessions/${sessionId}/sets`, {
        token: tokenA,
        body: { exerciseId, setNumber: 99, reps: 5, weightUnit: 'kg' },
    });
    if (badSetNum.status === 400) pass('13. Invalid setNumber rejected');
    else fail('13. Invalid setNumber rejected', `status=${badSetNum.status}`);

    // Update set
    const upd = await request(
        'PATCH',
        `/me/workout-sessions/${sessionId}/sets/${setLogId}`,
        { token: tokenA, body: { reps: 11, weight: 52.5 } }
    );
    if (upd.status === 200 && upd.json?.data?.setLog?.reps === 11) {
        pass('14. Client can update own set log');
    } else {
        fail('14. Client can update own set log', JSON.stringify(upd.json));
    }

    // IDOR: client B cannot touch A's session
    const startB = await request('POST', '/me/workout-sessions', {
        token: tokenB,
        body: { workoutDayId },
    });
    const sessionBId = startB.json?.data?.session?.id;

    const bOnA = await request('POST', `/me/workout-sessions/${sessionId}/sets`, {
        token: tokenB,
        body: { exerciseId, setNumber: 2, reps: 8, weightUnit: 'kg' },
    });
    if (bOnA.status === 404) pass('15. Client B cannot log into Client A session');
    else fail('15. Client B cannot log into Client A session', `status=${bOnA.status}`);

    const bGetA = await request('GET', `/me/workout-sessions/${sessionId}`, {
        token: tokenB,
    });
    if (bGetA.status === 404) pass('16. Client B cannot read Client A session');
    else fail('16. Client B cannot read Client A session', `status=${bGetA.status}`);

    const bCompleteA = await request('POST', `/me/workout-sessions/${sessionId}/complete`, {
        token: tokenB,
    });
    if (bCompleteA.status === 404) pass('17. Client B cannot complete Client A session');
    else fail('17. Client B cannot complete Client A session', `status=${bCompleteA.status}`);

    const bPatchA = await request(
        'PATCH',
        `/me/workout-sessions/${sessionId}/sets/${setLogId}`,
        { token: tokenB, body: { reps: 1 } }
    );
    if (bPatchA.status === 404) pass('18. Client B cannot update Client A set log');
    else fail('18. Client B cannot update Client A set log', `status=${bPatchA.status}`);

    // Log remaining set and complete
    await request('POST', `/me/workout-sessions/${sessionId}/sets`, {
        token: tokenA,
        body: { exerciseId, setNumber: 2, reps: 8, weight: 45, weightUnit: 'kg' },
    });

    const complete = await request('POST', `/me/workout-sessions/${sessionId}/complete`, {
        token: tokenA,
    });
    const completed = complete.json?.data?.session;

    if (
        complete.status === 200 &&
        completed?.status === 'completed' &&
        completed?.completedAt &&
        completed?.progress === 100 &&
        completed?.completedSets === 2 &&
        typeof completed?.durationSeconds === 'number'
    ) {
        pass('19. Complete session succeeds with server timestamps');
    } else {
        fail('19. Complete session succeeds with server timestamps', JSON.stringify(complete.json));
    }

    const completeAgain = await request('POST', `/me/workout-sessions/${sessionId}/complete`, {
        token: tokenA,
    });
    if (completeAgain.status === 409) pass('20. Completed session cannot be completed again');
    else fail('20. Completed session cannot be completed again', `status=${completeAgain.status}`);

    const logAfterComplete = await request('POST', `/me/workout-sessions/${sessionId}/sets`, {
        token: tokenA,
        body: { exerciseId, setNumber: 1, reps: 1, weightUnit: 'kg' },
    });
    if (logAfterComplete.status === 409) pass('21. Completed session cannot receive new sets');
    else fail('21. Completed session cannot receive new sets', `status=${logAfterComplete.status}`);

    // Assignment progress updated
    const assignmentAfter = await PlanAssignment.findOne({
        clientId: clientA._id,
        planId,
        status: 'active',
    }).lean();
    if (
        assignmentAfter &&
        assignmentAfter.completedSessions === 1 &&
        assignmentAfter.totalSessions === 2 &&
        assignmentAfter.progress === 50
    ) {
        pass('22. Assignment progress updated after session completion');
    } else {
        fail('22. Assignment progress updated after session completion', JSON.stringify(assignmentAfter));
    }

    // Abandon flow on day 2
    const startDay2 = await request('POST', '/me/workout-sessions', {
        token: tokenA,
        body: { workoutDayNumber: 2 },
    });
    const day2Id = startDay2.json?.data?.session?.id;
    await request('POST', `/me/workout-sessions/${day2Id}/sets`, {
        token: tokenA,
        body: { exerciseId, setNumber: 1, reps: 10, weightUnit: 'kg', status: 'skipped' },
    });
    const abandon = await request('POST', `/me/workout-sessions/${day2Id}/abandon`, {
        token: tokenA,
    });
    if (abandon.status === 200 && abandon.json?.data?.session?.status === 'abandoned') {
        pass('23. Abandon in-progress session');
    } else {
        fail('23. Abandon in-progress session', JSON.stringify(abandon.json));
    }

    const logAbandoned = await request('POST', `/me/workout-sessions/${day2Id}/sets`, {
        token: tokenA,
        body: { exerciseId, setNumber: 1, reps: 1, weightUnit: 'kg' },
    });
    if (logAbandoned.status === 409) pass('24. Abandoned session cannot receive new sets');
    else fail('24. Abandoned session cannot receive new sets', `status=${logAbandoned.status}`);

    const completeAbandoned = await request('POST', `/me/workout-sessions/${day2Id}/complete`, {
        token: tokenA,
    });
    if (completeAbandoned.status === 409) pass('25. Abandoned session cannot be completed');
    else fail('25. Abandoned session cannot be completed', `status=${completeAbandoned.status}`);

    // Abandon must not bump completedSessions
    const assignmentAfterAbandon = await PlanAssignment.findOne({
        clientId: clientA._id,
        planId,
        status: 'active',
    }).lean();
    if (assignmentAfterAbandon?.completedSessions === 1) {
        pass('26. Abandon does not increment completedSessions');
    } else {
        fail('26. Abandon does not increment completedSessions', JSON.stringify(assignmentAfterAbandon));
    }

    // History
    const history = await request('GET', '/me/workout-sessions?limit=10', { token: tokenA });
    if (
        history.status === 200 &&
        Array.isArray(history.json?.data?.sessions) &&
        history.json.data.sessions.length >= 2 &&
        history.json.data.pagination?.total >= 2 &&
        !history.json.data.sessions.some((s) => s.id === sessionBId)
    ) {
        pass('27. History returns only own sessions with pagination');
    } else {
        fail('27. History returns only own sessions with pagination', JSON.stringify(history.json));
    }

    // Plan unchanged
    const planDocAfter = await WorkoutPlan.findById(planId).lean();
    const beforeSets = JSON.stringify(planDocBefore.workoutDays);
    const afterSets = JSON.stringify(planDocAfter.workoutDays);
    if (beforeSets === afterSets) {
        pass('28. WorkoutPlan prescribed data unchanged after execution');
    } else {
        fail('28. WorkoutPlan prescribed data unchanged after execution', 'workoutDays mutated');
    }

    // Negative weight rejected
    const startNeg = await request('POST', '/me/workout-sessions', {
        token: tokenB,
        body: { workoutDayNumber: 2 },
    });
    const negSessionId = startNeg.json?.data?.session?.id;
    const negWeight = await request('POST', `/me/workout-sessions/${negSessionId}/sets`, {
        token: tokenB,
        body: { exerciseId, setNumber: 1, reps: 5, weight: -1, weightUnit: 'kg' },
    });
    if (negWeight.status === 400) pass('29. Negative weight rejected');
    else fail('29. Negative weight rejected', `status=${negWeight.status}`);

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);

    await WorkoutSetLog.deleteMany({ clientId: { $in: [clientA._id, clientB._id, clientEmpty._id] } });
    await WorkoutSession.deleteMany({ clientId: { $in: [clientA._id, clientB._id, clientEmpty._id] } });
    await PlanAssignment.deleteMany({ trainerId: trainer._id });
    await WorkoutPlan.deleteMany({ trainerId: trainer._id });
    await User.deleteMany({
        _id: { $in: [trainer._id, clientA._id, clientB._id, clientEmpty._id] },
    });
    await mongoose.disconnect();

    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
