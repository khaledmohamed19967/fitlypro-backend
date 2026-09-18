import mongoose from 'mongoose';
import WorkoutSession from './workout-session.model.js';
import WorkoutSetLog from './workout-set-log.model.js';
import PlanAssignment from './plan-assignment.model.js';
import WorkoutPlan from './workout-plan.model.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginateCollection } from '../../utils/pagination.js';
import {
    calculateAssignmentProgress,
    calculateSessionProgress,
    countPrescribedSetsForDay,
    mapPreviousSetLogToPublic,
    mapWorkoutSessionListItem,
    mapWorkoutSessionToPublic,
    mapWorkoutSetLogToPublic,
} from './workout-session.helpers.js';

/**
 * Workout Session Service — player execution (start / log / complete / history)
 */

const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

const emptyToNull = (value) => (value === '' || value === undefined ? null : value);

/**
 * Same newest-active rule as GET /me/workout-plan.
 *
 * @param {string} clientId
 */
const loadNewestActiveAssignment = async (clientId) => {
    const assignments = await PlanAssignment.find({
        clientId,
        status: 'active',
    }).sort({ startDate: -1, createdAt: -1 });

    if (assignments.length === 0) {
        return null;
    }

    if (assignments.length > 1) {
        console.warn(
            `[workout-session] Client ${clientId} has ${assignments.length} active assignments; using newest (${assignments[0]._id}).`
        );
    }

    return assignments[0];
};

/**
 * Live plan via assignment.planId (versioning not used).
 *
 * @param {import('mongoose').Document} assignment
 */
const loadAssignedPlan = async (assignment) => {
    const planId = assignment.planId;
    if (!planId || !isValidObjectId(String(planId))) {
        return null;
    }
    return WorkoutPlan.findById(planId);
};

/**
 * @param {import('mongoose').Document} plan
 * @param {{ workoutDayId?: string, workoutDayNumber?: number }} selector
 */
const findWorkoutDay = (plan, selector) => {
    const days = plan.workoutDays ?? [];

    if (selector.workoutDayId) {
        if (!isValidObjectId(selector.workoutDayId)) {
            throw new ApiError(400, 'Invalid workout day ID');
        }
        const day = days.find(
            (d) => d._id && String(d._id) === String(selector.workoutDayId)
        );
        if (!day) {
            throw new ApiError(404, 'Workout day not found on assigned plan');
        }
        return day;
    }

    if (selector.workoutDayNumber != null) {
        const day = days.find((d) => d.dayNumber === Number(selector.workoutDayNumber));
        if (!day) {
            throw new ApiError(404, 'Workout day not found on assigned plan');
        }
        return day;
    }

    throw new ApiError(400, 'workoutDayId or workoutDayNumber is required');
};

/**
 * @param {string} sessionId
 * @param {string} clientId
 */
const loadOwnedSession = async (sessionId, clientId) => {
    if (!isValidObjectId(sessionId)) {
        throw new ApiError(400, 'Invalid session ID');
    }

    const session = await WorkoutSession.findOne({
        _id: sessionId,
        clientId,
    });

    if (!session) {
        throw new ApiError(404, 'Workout session not found');
    }

    return session;
};

/**
 * Re-verify assignment still belongs to the player and is active.
 *
 * @param {import('mongoose').Document} session
 * @param {string} clientId
 */
const loadActiveAssignmentForSession = async (session, clientId) => {
    const assignment = await PlanAssignment.findOne({
        _id: session.assignmentId,
        clientId,
        status: 'active',
    });

    if (!assignment) {
        throw new ApiError(409, 'Active workout assignment is no longer available');
    }

    if (String(assignment.planId) !== String(session.planId)) {
        throw new ApiError(409, 'Session plan no longer matches the active assignment');
    }

    return assignment;
};

/**
 * @param {import('mongoose').Document} session
 */
const loadPlanDayForSession = async (session) => {
    const plan = await WorkoutPlan.findById(session.planId);
    if (!plan) {
        throw new ApiError(404, 'Assigned workout plan not found');
    }

    const day = (plan.workoutDays ?? []).find(
        (d) => d._id && String(d._id) === String(session.workoutDayId)
    );

    if (!day) {
        throw new ApiError(404, 'Workout day not found on assigned plan');
    }

    return { plan, day };
};

/**
 * @param {object} day
 * @param {string} exerciseId
 * @param {number} setNumber
 */
const findPrescribedExerciseSet = (day, exerciseId, setNumber) => {
    const exercise = (day.exercises ?? []).find(
        (ex) => ex.exerciseId && String(ex.exerciseId) === String(exerciseId)
    );

    if (!exercise) {
        throw new ApiError(400, 'Exercise is not part of this workout day');
    }

    const prescribedSet = (exercise.sets ?? []).find(
        (set) => set.setNumber === Number(setNumber)
    );

    if (!prescribedSet) {
        throw new ApiError(400, 'Set number is not prescribed for this exercise');
    }

    return { exercise, prescribedSet };
};

/**
 * Recalculate session counters from set logs and persist.
 *
 * @param {import('mongoose').Document} session
 */
const refreshSessionCounters = async (session) => {
    const totalSets = session.totalSets ?? 0;
    const completedSets = await WorkoutSetLog.countDocuments({
        sessionId: session._id,
        status: 'completed',
    });

    session.completedSets = completedSets;
    session.progress = calculateSessionProgress(completedSets, totalSets);
    await session.save();
    return session;
};

/**
 * Recount completed sessions for an assignment and update progress fields.
 *
 * Interpretation (v1): totalSessions = workoutDays.length on the assigned plan;
 * completedSessions = count of completed WorkoutSession docs for this assignment.
 *
 * @param {import('mongoose').Document} assignment
 * @param {import('mongoose').Document} plan
 */
const refreshAssignmentProgress = async (assignment, plan) => {
    const completedSessions = await WorkoutSession.countDocuments({
        assignmentId: assignment._id,
        status: 'completed',
    });
    const totalSessions = Array.isArray(plan.workoutDays) ? plan.workoutDays.length : 0;

    assignment.completedSessions = completedSessions;
    assignment.totalSessions = totalSessions;
    assignment.progress = calculateAssignmentProgress(completedSessions, totalSessions);
    await assignment.save();
    return assignment;
};

const loadSessionSetLogs = (sessionId) =>
    WorkoutSetLog.find({ sessionId }).sort({ exerciseId: 1, setNumber: 1 });

/**
 * Latest completed session for the same client + assignment + workout day,
 * excluding the current session. Matches startSession uniqueness scope and
 * overview "completed for day" semantics (completed only, not abandoned).
 *
 * @param {import('mongoose').Document} session
 * @returns {Promise<object[]>}
 */
const loadPreviousSetLogsForSession = async (session) => {
    if (!session || session.status !== 'in_progress') {
        return [];
    }

    const previous = await WorkoutSession.findOne({
        clientId: session.clientId,
        assignmentId: session.assignmentId,
        workoutDayId: session.workoutDayId,
        status: 'completed',
        _id: { $ne: session._id },
        startedAt: { $lt: session.startedAt },
    }).sort({ startedAt: -1, createdAt: -1 });

    if (!previous) {
        return [];
    }

    const logs = await loadSessionSetLogs(previous._id);
    return logs
        .map(mapPreviousSetLogToPublic)
        .filter((row) => row != null);
};

/**
 * Public session DTO with optional previous-performance context for in-progress.
 *
 * @param {import('mongoose').Document} session
 * @param {import('mongoose').Document[]} setLogs
 */
const toPublicSessionWithPrevious = async (session, setLogs) => {
    const mapped = mapWorkoutSessionToPublic(session, setLogs);
    mapped.previousSetLogs = await loadPreviousSetLogsForSession(session);
    return mapped;
};

/**
 * @param {string} clientId
 * @param {object} body
 */
const startSession = async (clientId, body) => {
    if (!isValidObjectId(clientId)) {
        throw new ApiError(400, 'Invalid client ID');
    }

    const assignment = await loadNewestActiveAssignment(clientId);
    if (!assignment) {
        throw new ApiError(404, 'No active workout plan assignment for this client');
    }

    const plan = await loadAssignedPlan(assignment);
    if (!plan || plan.status === 'draft') {
        throw new ApiError(404, 'Assigned workout plan not found');
    }

    const day = findWorkoutDay(plan, body);
    const totalSets = countPrescribedSetsForDay(day);

    const existing = await WorkoutSession.findOne({
        assignmentId: assignment._id,
        workoutDayId: day._id,
        status: 'in_progress',
        clientId,
    });

    if (existing) {
        const setLogs = await loadSessionSetLogs(existing._id);
        return toPublicSessionWithPrevious(existing, setLogs);
    }

    try {
        const session = await WorkoutSession.create({
            assignmentId: assignment._id,
            clientId,
            trainerId: assignment.trainerId,
            planId: assignment.planId,
            workoutDayId: day._id,
            workoutDayNumber: day.dayNumber,
            workoutDayName: day.name,
            workoutDayDescription: day.description ?? null,
            status: 'in_progress',
            startedAt: new Date(),
            completedAt: null,
            durationSeconds: 0,
            completedSets: 0,
            totalSets,
            progress: 0,
        });

        return toPublicSessionWithPrevious(session, []);
    } catch (err) {
        if (err?.code === 11000) {
            const raced = await WorkoutSession.findOne({
                assignmentId: assignment._id,
                workoutDayId: day._id,
                status: 'in_progress',
                clientId,
            });
            if (raced) {
                const setLogs = await loadSessionSetLogs(raced._id);
                return toPublicSessionWithPrevious(raced, setLogs);
            }
        }
        throw err;
    }
};

/**
 * @param {string} sessionId
 * @param {string} clientId
 * @param {object} body
 */
const logSet = async (sessionId, clientId, body) => {
    const session = await loadOwnedSession(sessionId, clientId);

    if (session.status !== 'in_progress') {
        throw new ApiError(
            409,
            `Cannot log sets on a session that is ${session.status}`
        );
    }

    await loadActiveAssignmentForSession(session, clientId);
    const { day } = await loadPlanDayForSession(session);
    const { exercise } = findPrescribedExerciseSet(day, body.exerciseId, body.setNumber);

    const status = body.status ?? 'completed';

    try {
        const setLog = await WorkoutSetLog.create({
            sessionId: session._id,
            assignmentId: session.assignmentId,
            clientId,
            planId: session.planId,
            workoutDayId: session.workoutDayId,
            exerciseId: body.exerciseId,
            planExerciseId: exercise._id,
            setNumber: body.setNumber,
            status,
            reps: body.reps ?? null,
            weight: body.weight ?? null,
            weightUnit: body.weightUnit ?? 'kg',
            durationSeconds: body.durationSeconds ?? null,
            distance: body.distance ?? null,
            notes: emptyToNull(body.notes),
            completedAt: status === 'completed' ? new Date() : null,
        });

        await refreshSessionCounters(session);

        return mapWorkoutSetLogToPublic(setLog);
    } catch (err) {
        if (err?.code === 11000) {
            throw new ApiError(409, 'Set log already exists for this exercise and set number');
        }
        throw err;
    }
};

/**
 * @param {string} exerciseId
 * @param {number} setNumber
 */
const setIdentityKey = (exerciseId, setNumber) =>
    `${String(exerciseId)}:${Number(setNumber)}`;

/**
 * Collect write-error indexes that are duplicate-key (11000) from a bulkWrite failure.
 * Non-duplicate errors are rethrown.
 *
 * @param {unknown} err
 * @returns {Set<number>}
 */
const collectDuplicateBulkIndexes = (err) => {
    const writeErrors = err?.writeErrors ?? [];
    if (!Array.isArray(writeErrors) || writeErrors.length === 0) {
        if (err?.code === 11000) {
            return new Set([0]);
        }
        throw err;
    }

    const duplicateIndexes = new Set();
    for (const writeError of writeErrors) {
        const code = writeError.code ?? writeError.err?.code;
        if (code === 11000) {
            duplicateIndexes.add(writeError.index);
        } else {
            throw err;
        }
    }

    return duplicateIndexes;
};

/**
 * Partial-success batch set logging.
 * Session-level failures abort the whole request; per-item failures are rejected results.
 * Duplicate keys (existing unique index) → alreadyExists (no 409).
 *
 * @param {string} sessionId
 * @param {string} clientId
 * @param {{ sets: object[] }} body
 */
const logSetBatch = async (sessionId, clientId, body) => {
    const session = await loadOwnedSession(sessionId, clientId);

    if (session.status !== 'in_progress') {
        throw new ApiError(
            409,
            `Cannot log sets on a session that is ${session.status}`
        );
    }

    await loadActiveAssignmentForSession(session, clientId);
    const { day } = await loadPlanDayForSession(session);

    const sets = Array.isArray(body.sets) ? body.sets : [];
    /** @type {Array<object|undefined>} */
    const results = new Array(sets.length);
    /** @type {{ index: number, item: object, planExerciseId: import('mongoose').Types.ObjectId }[]} */
    const eligible = [];

    for (let index = 0; index < sets.length; index += 1) {
        const item = sets[index];
        try {
            const { exercise } = findPrescribedExerciseSet(
                day,
                item.exerciseId,
                item.setNumber
            );
            eligible.push({
                index,
                item,
                planExerciseId: exercise._id,
            });
        } catch (err) {
            if (err instanceof ApiError) {
                results[index] = {
                    exerciseId: String(item.exerciseId),
                    setNumber: item.setNumber,
                    outcome: 'rejected',
                    setLog: null,
                    error: {
                        statusCode: err.statusCode,
                        message: err.message,
                    },
                };
                continue;
            }
            throw err;
        }
    }

    if (eligible.length === 0) {
        const setLogs = await loadSessionSetLogs(session._id);
        return {
            session: mapWorkoutSessionToPublic(session, setLogs),
            results,
        };
    }

    const existingLogs = await WorkoutSetLog.find({
        sessionId: session._id,
        $or: eligible.map(({ item }) => ({
            exerciseId: item.exerciseId,
            setNumber: item.setNumber,
        })),
    });

    const existingMap = new Map(
        existingLogs.map((log) => [setIdentityKey(log.exerciseId, log.setNumber), log])
    );

    /** @type {typeof eligible} */
    const toInsert = [];

    for (const entry of eligible) {
        const key = setIdentityKey(entry.item.exerciseId, entry.item.setNumber);
        const existing = existingMap.get(key);
        if (existing) {
            results[entry.index] = {
                exerciseId: String(entry.item.exerciseId),
                setNumber: entry.item.setNumber,
                outcome: 'alreadyExists',
                setLog: mapWorkoutSetLogToPublic(existing),
                error: null,
            };
        } else {
            toInsert.push(entry);
        }
    }

    let createdCount = 0;

    if (toInsert.length > 0) {
        const completedAt = new Date();
        const ops = toInsert.map(({ item, planExerciseId }) => {
            const status = item.status ?? 'completed';
            return {
                insertOne: {
                    document: {
                        sessionId: session._id,
                        assignmentId: session.assignmentId,
                        clientId,
                        planId: session.planId,
                        workoutDayId: session.workoutDayId,
                        exerciseId: item.exerciseId,
                        planExerciseId,
                        setNumber: item.setNumber,
                        status,
                        reps: item.reps ?? null,
                        weight: item.weight ?? null,
                        weightUnit: item.weightUnit ?? 'kg',
                        durationSeconds: item.durationSeconds ?? null,
                        distance: item.distance ?? null,
                        notes: emptyToNull(item.notes),
                        completedAt: status === 'completed' ? completedAt : null,
                    },
                },
            };
        });

        const duplicateOpIndexes = new Set();
        try {
            await WorkoutSetLog.bulkWrite(ops, { ordered: false });
            createdCount = toInsert.length;
        } catch (err) {
            const duplicates = collectDuplicateBulkIndexes(err);
            for (const opIndex of duplicates) {
                duplicateOpIndexes.add(opIndex);
            }
            createdCount = toInsert.length - duplicateOpIndexes.size;
        }

        const persistedLogs = await WorkoutSetLog.find({
            sessionId: session._id,
            $or: toInsert.map(({ item }) => ({
                exerciseId: item.exerciseId,
                setNumber: item.setNumber,
            })),
        });

        const persistedMap = new Map(
            persistedLogs.map((log) => [
                setIdentityKey(log.exerciseId, log.setNumber),
                log,
            ])
        );

        for (let opIndex = 0; opIndex < toInsert.length; opIndex += 1) {
            const entry = toInsert[opIndex];
            const key = setIdentityKey(entry.item.exerciseId, entry.item.setNumber);
            const log = persistedMap.get(key);

            if (!log) {
                results[entry.index] = {
                    exerciseId: String(entry.item.exerciseId),
                    setNumber: entry.item.setNumber,
                    outcome: 'rejected',
                    setLog: null,
                    error: {
                        statusCode: 500,
                        message: 'Failed to persist set log',
                    },
                };
                continue;
            }

            results[entry.index] = {
                exerciseId: String(entry.item.exerciseId),
                setNumber: entry.item.setNumber,
                outcome: duplicateOpIndexes.has(opIndex) ? 'alreadyExists' : 'created',
                setLog: mapWorkoutSetLogToPublic(log),
                error: null,
            };
        }
    }

    if (createdCount > 0) {
        await refreshSessionCounters(session);
    }

    const setLogs = await loadSessionSetLogs(session._id);
    return {
        session: mapWorkoutSessionToPublic(session, setLogs),
        results,
    };
};

/**
 * @param {string} sessionId
 * @param {string} setLogId
 * @param {string} clientId
 * @param {object} body
 */
const updateSetLog = async (sessionId, setLogId, clientId, body) => {
    const session = await loadOwnedSession(sessionId, clientId);

    if (session.status !== 'in_progress') {
        throw new ApiError(
            409,
            `Cannot update sets on a session that is ${session.status}`
        );
    }

    await loadActiveAssignmentForSession(session, clientId);

    if (!isValidObjectId(setLogId)) {
        throw new ApiError(400, 'Invalid set log ID');
    }

    const setLog = await WorkoutSetLog.findOne({
        _id: setLogId,
        sessionId: session._id,
        clientId,
    });

    if (!setLog) {
        throw new ApiError(404, 'Set log not found');
    }

    if (body.status !== undefined) setLog.status = body.status;
    if (body.reps !== undefined) setLog.reps = body.reps;
    if (body.weight !== undefined) setLog.weight = body.weight;
    if (body.weightUnit !== undefined) setLog.weightUnit = body.weightUnit;
    if (body.durationSeconds !== undefined) setLog.durationSeconds = body.durationSeconds;
    if (body.distance !== undefined) setLog.distance = body.distance;
    if (body.notes !== undefined) setLog.notes = emptyToNull(body.notes);

    if (setLog.status === 'completed' && !setLog.completedAt) {
        setLog.completedAt = new Date();
    }
    if (setLog.status === 'skipped') {
        setLog.completedAt = null;
    }

    await setLog.save();
    await refreshSessionCounters(session);

    return mapWorkoutSetLogToPublic(setLog);
};

/**
 * @param {string} sessionId
 * @param {string} clientId
 */
const completeSession = async (sessionId, clientId) => {
    const session = await loadOwnedSession(sessionId, clientId);

    if (session.status === 'completed') {
        throw new ApiError(409, 'Workout session is already completed');
    }
    if (session.status === 'abandoned') {
        throw new ApiError(409, 'Abandoned workout sessions cannot be completed');
    }
    if (session.status !== 'in_progress') {
        throw new ApiError(409, `Cannot complete a session that is ${session.status}`);
    }

    const assignment = await loadActiveAssignmentForSession(session, clientId);
    const { plan } = await loadPlanDayForSession(session);

    await refreshSessionCounters(session);

    const completedAt = new Date();
    const startedAt = session.startedAt ? new Date(session.startedAt) : completedAt;
    session.status = 'completed';
    session.completedAt = completedAt;
    session.durationSeconds = Math.max(
        0,
        Math.floor((completedAt.getTime() - startedAt.getTime()) / 1000)
    );
    await session.save();

    await refreshAssignmentProgress(assignment, plan);

    const setLogs = await loadSessionSetLogs(session._id);
    return mapWorkoutSessionToPublic(session, setLogs);
};

/**
 * @param {string} sessionId
 * @param {string} clientId
 */
const abandonSession = async (sessionId, clientId) => {
    const session = await loadOwnedSession(sessionId, clientId);

    if (session.status !== 'in_progress') {
        throw new ApiError(
            409,
            `Only in-progress sessions can be abandoned (current status: ${session.status})`
        );
    }

    await loadActiveAssignmentForSession(session, clientId);
    await refreshSessionCounters(session);

    session.status = 'abandoned';
    session.completedAt = null;
    await session.save();

    const setLogs = await loadSessionSetLogs(session._id);
    return mapWorkoutSessionToPublic(session, setLogs);
};

/**
 * @param {string} clientId
 * @param {object} query
 */
const listSessions = async (clientId, query = {}) => {
    if (!isValidObjectId(clientId)) {
        throw new ApiError(400, 'Invalid client ID');
    }

    const filter = { clientId };

    if (query.status) {
        filter.status = query.status;
    }

    if (query.assignmentId) {
        if (!isValidObjectId(query.assignmentId)) {
            throw new ApiError(400, 'Invalid assignment ID');
        }
        filter.assignmentId = query.assignmentId;
    }

    if (query.from || query.to) {
        filter.startedAt = {};
        if (query.from) filter.startedAt.$gte = new Date(query.from);
        if (query.to) filter.startedAt.$lte = new Date(query.to);
    }

    const { docs, pagination } = await paginateCollection({
        model: WorkoutSession,
        filter,
        sort: { startedAt: -1, createdAt: -1 },
        page: query.page,
        limit: query.limit,
        lean: true,
    });

    return {
        sessions: docs.map(mapWorkoutSessionListItem),
        pagination,
    };
};

/**
 * @param {string} sessionId
 * @param {string} clientId
 */
const getSession = async (sessionId, clientId) => {
    const session = await loadOwnedSession(sessionId, clientId);
    const setLogs = await loadSessionSetLogs(session._id);
    return toPublicSessionWithPrevious(session, setLogs);
};

export default {
    startSession,
    logSet,
    logSetBatch,
    updateSetLog,
    completeSession,
    abandonSession,
    listSessions,
    getSession,
};
