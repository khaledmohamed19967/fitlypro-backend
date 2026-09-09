/**
 * Workout session / set-log — pure helpers & player-safe DTOs
 */

const toPlainObject = (doc) =>
    typeof doc?.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc ?? {};

const toIdString = (id) => (id != null ? id.toString?.() ?? String(id) : null);

/**
 * Count prescribed sets for a workout day document.
 *
 * @param {object} day
 * @returns {number}
 */
export const countPrescribedSetsForDay = (day) => {
    if (!day || !Array.isArray(day.exercises)) {
        return 0;
    }

    return day.exercises.reduce(
        (total, exercise) => total + (Array.isArray(exercise.sets) ? exercise.sets.length : 0),
        0
    );
};

/**
 * Server-side session progress percent (0–100), rounded to nearest integer.
 *
 * @param {number} completedSets
 * @param {number} totalSets
 * @returns {number}
 */
export const calculateSessionProgress = (completedSets, totalSets) => {
    const total = Number(totalSets) || 0;
    if (total <= 0) {
        return 0;
    }
    const completed = Math.max(0, Number(completedSets) || 0);
    return Math.min(100, Math.round((completed / total) * 100));
};

/**
 * Assignment-level progress from completed sessions vs plan workout-day count.
 *
 * @param {number} completedSessions
 * @param {number} totalSessions
 * @returns {number}
 */
export const calculateAssignmentProgress = (completedSessions, totalSessions) =>
    calculateSessionProgress(completedSessions, totalSessions);

/**
 * @param {import('mongoose').Document|object} setLog
 * @returns {object}
 */
export const mapWorkoutSetLogToPublic = (setLog) => {
    const doc = toPlainObject(setLog);

    return {
        id: toIdString(doc._id ?? doc.id),
        sessionId: toIdString(doc.sessionId),
        exerciseId: toIdString(doc.exerciseId),
        planExerciseId: toIdString(doc.planExerciseId),
        setNumber: doc.setNumber,
        status: doc.status,
        reps: doc.reps ?? null,
        weight: doc.weight ?? null,
        weightUnit: doc.weightUnit ?? 'kg',
        durationSeconds: doc.durationSeconds ?? null,
        distance: doc.distance ?? null,
        notes: doc.notes ?? null,
        completedAt: doc.completedAt ?? null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};

/**
 * @param {import('mongoose').Document|object} session
 * @param {import('mongoose').Document|object[]} [setLogs]
 * @returns {object}
 */
export const mapWorkoutSessionToPublic = (session, setLogs = []) => {
    const doc = toPlainObject(session);

    return {
        id: toIdString(doc._id ?? doc.id),
        assignmentId: toIdString(doc.assignmentId),
        planId: toIdString(doc.planId),
        workoutDay: {
            id: toIdString(doc.workoutDayId),
            dayNumber: doc.workoutDayNumber,
            name: doc.workoutDayName,
            description: doc.workoutDayDescription ?? null,
        },
        status: doc.status,
        startedAt: doc.startedAt,
        completedAt: doc.completedAt ?? null,
        durationSeconds: doc.durationSeconds ?? 0,
        completedSets: doc.completedSets ?? 0,
        totalSets: doc.totalSets ?? 0,
        progress: doc.progress ?? 0,
        setLogs: (setLogs ?? []).map(mapWorkoutSetLogToPublic),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};

/**
 * Compact history row (no setLogs).
 *
 * @param {import('mongoose').Document|object} session
 * @returns {object}
 */
export const mapWorkoutSessionListItem = (session) => {
    const mapped = mapWorkoutSessionToPublic(session, []);
    delete mapped.setLogs;
    return mapped;
};
