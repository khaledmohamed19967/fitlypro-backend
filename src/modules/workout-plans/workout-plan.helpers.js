import mongoose from 'mongoose';
import { DEFAULT_WORKOUT_PLAN_ICON } from './workout-plan.constants.js';

/**
 * Workout Plan — pure domain helpers (Phase 1 + Phase 4A)
 */

/**
 * @param {import('mongoose').Types.ObjectId|string} trainerId
 */
const toTrainerObjectId = (trainerId) => {
    if (trainerId instanceof mongoose.Types.ObjectId) {
        return trainerId;
    }
    return new mongoose.Types.ObjectId(String(trainerId));
};

/**
 * @param {import('mongoose').Document|object} doc
 * @returns {object}
 */
const toPlainObject = (doc) =>
    typeof doc?.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc ?? {};

/**
 * @param {import('mongoose').Types.ObjectId|string|undefined|null} id
 * @returns {string|null}
 */
const toIdString = (id) => (id != null ? id.toString?.() ?? String(id) : null);

/**
 * Normalize ownership for API / auth checks.
 * Supports Phase 2 legacy docs that only have top-level trainerId.
 *
 * @param {object} plan
 * @returns {{ type: 'system'|'trainer', trainerId: string|null }}
 */
export const resolvePlanOwnership = (plan) => {
    if (!plan) {
        return { type: 'trainer', trainerId: null };
    }

    const doc = toPlainObject(plan);
    if (doc.ownership?.type === 'system') {
        return { type: 'system', trainerId: null };
    }

    if (doc.ownership?.type === 'trainer') {
        return {
            type: 'trainer',
            trainerId: toIdString(doc.ownership.trainerId ?? doc.trainerId),
        };
    }

    // Legacy Phase 2: trainerId only
    if (doc.trainerId) {
        return { type: 'trainer', trainerId: toIdString(doc.trainerId) };
    }

    return { type: 'trainer', trainerId: null };
};

/**
 * Mongo filter: system plans ∪ current trainer's plans.
 * Includes legacy Phase 2 docs without ownership.
 *
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @returns {object}
 */
export const buildWorkoutPlanVisibilityFilter = (trainerId) => {
    const ownerId = toTrainerObjectId(trainerId);

    return {
        $or: [
            { 'ownership.type': 'system' },
            { 'ownership.type': 'trainer', 'ownership.trainerId': ownerId },
            {
                ownership: { $exists: false },
                trainerId: ownerId,
            },
        ],
    };
};

/**
 * Build list ownership scope for query param ownership=system|trainer|all.
 * Default trainer-only listing remains backward compatible.
 *
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @param {'system'|'trainer'|'all'} ownership
 * @returns {object}
 */
export const buildWorkoutPlanOwnershipFilter = (trainerId, ownership = 'trainer') => {
    const ownerId = toTrainerObjectId(trainerId);

    if (ownership === 'system') {
        return { 'ownership.type': 'system' };
    }

    if (ownership === 'all') {
        return buildWorkoutPlanVisibilityFilter(trainerId);
    }

    return {
        $or: [
            { 'ownership.type': 'trainer', 'ownership.trainerId': ownerId },
            { ownership: { $exists: false }, trainerId: ownerId },
        ],
    };
};

/**
 * Shared search/advanced filters for workout plan list + summary counts.
 *
 * @param {object} query
 */
export const buildWorkoutPlanSharedListConditions = (query) => {
    const { search, goal, level, isTemplate } = query;
    const conditions = [];

    if (goal) {
        conditions.push({ goal });
    }

    if (level) {
        conditions.push({ level });
    }

    if (isTemplate !== undefined) {
        conditions.push({ isTemplate });
    }

    if (search && String(search).trim()) {
        const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');
        conditions.push({
            $or: [{ name: regex }, { description: regex }],
        });
    }

    return conditions;
};

/**
 * Mongo filter for workout plan list/summary queries.
 *
 * @param {object} query
 * @param {string} trainerId
 */
export const buildWorkoutPlanListFilter = (query, trainerId) => {
    const { status, ownership = 'trainer' } = query;

    const conditions = [
        buildWorkoutPlanOwnershipFilter(trainerId, ownership),
        ...buildWorkoutPlanSharedListConditions(query),
    ];

    if (status) {
        conditions.push({ status });
    }

    return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

export const isSystemWorkoutPlan = (plan) => resolvePlanOwnership(plan).type === 'system';

export const isTrainerWorkoutPlan = (plan) => resolvePlanOwnership(plan).type === 'trainer';

/**
 * @param {object} plan
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 */
export const canReadWorkoutPlan = (plan, trainerId) => {
    const ownership = resolvePlanOwnership(plan);
    if (ownership.type === 'system') return true;
    return ownership.trainerId != null && String(ownership.trainerId) === String(trainerId);
};

/**
 * @param {object} plan
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 */
export const canModifyWorkoutPlan = (plan, trainerId) => {
    const ownership = resolvePlanOwnership(plan);
    if (ownership.type === 'system') return false;
    return ownership.trainerId != null && String(ownership.trainerId) === String(trainerId);
};

/**
 * Active plan clone eligibility: system template (any trainer) or own trainer plan/template.
 *
 * @param {object} plan
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 */
export const canCloneWorkoutPlan = (plan, trainerId) => {
    if (!plan || plan.status !== 'active') {
        return false;
    }

    const ownership = resolvePlanOwnership(plan);
    if (ownership.type === 'system') return true;
    return ownership.trainerId != null && String(ownership.trainerId) === String(trainerId);
};

/**
 * Generate a unique clone name within a trainer's plans.
 *
 * @param {string} sourceName
 * @param {(candidate: string) => Promise<boolean>} nameExists
 * @returns {Promise<string>}
 */
export const generateCloneName = async (sourceName, nameExists) => {
    const base = `${String(sourceName || 'Workout Plan').trim()} Copy`.slice(0, 120);
    if (!(await nameExists(base))) {
        return base;
    }

    let suffix = 2;
    while (suffix < 1000) {
        const candidate = `${base} ${suffix}`.slice(0, 120);
        if (!(await nameExists(candidate))) {
            return candidate;
        }
        suffix += 1;
    }

    return `${base} ${Date.now()}`.slice(0, 120);
};

/**
 * Sort sets by setNumber ascending.
 *
 * @param {object[]} sets
 * @returns {object[]}
 */
export const normalizeSetNumbers = (sets = []) => {
    if (!Array.isArray(sets)) {
        return [];
    }

    return [...sets].sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0));
};

/**
 * Sort exercises by order ascending and normalize nested sets.
 *
 * @param {object[]} exercises
 * @returns {object[]}
 */
export const normalizeExerciseOrder = (exercises = []) => {
    if (!Array.isArray(exercises)) {
        return [];
    }

    return [...exercises]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((exercise) => ({
            ...exercise,
            sets: normalizeSetNumbers(exercise.sets),
        }));
};

/**
 * Sort warm-up / cardio activities by order ascending.
 *
 * @param {object[]} activities
 * @returns {object[]}
 */
export const normalizeActivityOrder = (activities = []) => {
    if (!Array.isArray(activities)) {
        return [];
    }

    return [...activities].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
};

/**
 * Sort days by dayNumber ascending and normalize nested exercises/sets.
 *
 * @param {object[]} workoutDays
 * @returns {object[]}
 */
export const normalizeWorkoutDays = (workoutDays = []) => {
    if (!Array.isArray(workoutDays)) {
        return [];
    }

    return [...workoutDays]
        .sort((a, b) => (a.dayNumber ?? 0) - (b.dayNumber ?? 0))
        .map((day) => {
            const next = {
                ...day,
                exercises: normalizeExerciseOrder(day.exercises),
            };

            // Preserve undefined vs [] so update can omit→keep / []→clear sections.
            if (Array.isArray(day.warmupActivities)) {
                next.warmupActivities = normalizeActivityOrder(day.warmupActivities);
            }
            if (Array.isArray(day.cardioActivities)) {
                next.cardioActivities = normalizeActivityOrder(day.cardioActivities);
            }

            return next;
        });
};

/**
 * Normalize trainer-controlled plan input before persistence.
 * Trims strings and normalizes nested day/exercise/set ordering.
 *
 * @param {object} input
 * @returns {object}
 */
export const normalizeWorkoutPlanInput = (input = {}) => {
    const normalized = { ...input };

    if (typeof normalized.name === 'string') {
        normalized.name = normalized.name.trim();
    }

    if (typeof normalized.description === 'string') {
        const trimmed = normalized.description.trim();
        normalized.description = trimmed || null;
    }

    if (typeof normalized.notes === 'string') {
        const trimmed = normalized.notes.trim();
        normalized.notes = trimmed || null;
    }

    if (typeof normalized.icon === 'string') {
        const trimmed = normalized.icon.trim();
        normalized.icon = trimmed || DEFAULT_WORKOUT_PLAN_ICON;
    }

    if (Array.isArray(normalized.workoutDays)) {
        normalized.workoutDays = normalizeWorkoutDays(
            normalized.workoutDays.map((day) => {
                const nextDay = { ...day };

                if (typeof nextDay.name === 'string') {
                    nextDay.name = nextDay.name.trim();
                }

                if (typeof nextDay.description === 'string') {
                    const trimmed = nextDay.description.trim();
                    nextDay.description = trimmed || null;
                }

                for (const activityField of ['warmupActivities', 'cardioActivities']) {
                    if (!Array.isArray(nextDay[activityField])) {
                        continue;
                    }

                    nextDay[activityField] = nextDay[activityField].map((activity) => {
                        const nextActivity = { ...activity };

                        if (typeof nextActivity.notes === 'string') {
                            const trimmed = nextActivity.notes.trim();
                            nextActivity.notes = trimmed || null;
                        }

                        if (nextActivity.activitySnapshot) {
                            const snapshot = { ...nextActivity.activitySnapshot };
                            if (typeof snapshot.name === 'string') {
                                snapshot.name = snapshot.name.trim();
                            }
                            if (typeof snapshot.thumbnailUrl === 'string') {
                                const trimmed = snapshot.thumbnailUrl.trim();
                                snapshot.thumbnailUrl = trimmed || null;
                            }
                            nextActivity.activitySnapshot = snapshot;
                        }

                        return nextActivity;
                    });
                }

                if (Array.isArray(nextDay.exercises)) {
                    nextDay.exercises = nextDay.exercises.map((exercise) => {
                        const nextExercise = { ...exercise };

                        if (typeof nextExercise.notes === 'string') {
                            const trimmed = nextExercise.notes.trim();
                            nextExercise.notes = trimmed || null;
                        }

                        if (typeof nextExercise.tempo === 'string') {
                            const trimmed = nextExercise.tempo.trim();
                            nextExercise.tempo = trimmed || null;
                        }

                        if (nextExercise.exerciseSnapshot) {
                            const snapshot = { ...nextExercise.exerciseSnapshot };
                            if (typeof snapshot.name === 'string') {
                                snapshot.name = snapshot.name.trim();
                            }
                            if (typeof snapshot.thumbnailUrl === 'string') {
                                const trimmed = snapshot.thumbnailUrl.trim();
                                snapshot.thumbnailUrl = trimmed || null;
                            }
                            nextExercise.exerciseSnapshot = snapshot;
                        }

                        return nextExercise;
                    });
                }

                return nextDay;
            })
        );
    }

    return normalized;
};

/**
 * @param {object[]} workoutDays
 * @returns {{ valid: boolean, message?: string }}
 */
export const validateUniqueDayNumbers = (workoutDays = []) => {
    if (!Array.isArray(workoutDays)) {
        return { valid: true };
    }

    const seen = new Set();

    for (const day of workoutDays) {
        if (day?.dayNumber == null) {
            continue;
        }

        if (seen.has(day.dayNumber)) {
            return {
                valid: false,
                message: 'Day numbers must be unique within a plan',
            };
        }

        seen.add(day.dayNumber);
    }

    return { valid: true };
};

/**
 * @param {object[]} exercises
 * @returns {{ valid: boolean, message?: string }}
 */
export const validateUniqueExerciseOrders = (exercises = []) => {
    if (!Array.isArray(exercises)) {
        return { valid: true };
    }

    const seen = new Set();

    for (const exercise of exercises) {
        if (exercise?.order == null) {
            continue;
        }

        if (seen.has(exercise.order)) {
            return {
                valid: false,
                message: 'Exercise order values must be unique within each day',
            };
        }

        seen.add(exercise.order);
    }

    return { valid: true };
};

/**
 * @param {object[]} activities
 * @param {string} [sectionLabel]
 * @returns {{ valid: boolean, message?: string }}
 */
export const validateUniqueActivityOrders = (activities = [], sectionLabel = 'Activity') => {
    if (!Array.isArray(activities)) {
        return { valid: true };
    }

    const seen = new Set();

    for (const activity of activities) {
        if (activity?.order == null) {
            continue;
        }

        if (seen.has(activity.order)) {
            return {
                valid: false,
                message: `${sectionLabel} activity order values must be unique within each day`,
            };
        }

        seen.add(activity.order);
    }

    return { valid: true };
};

/**
 * Humanize preset activityType for snapshot fallback (e.g. dynamic_mobility → Dynamic Mobility).
 *
 * @param {string} activityType
 * @returns {string}
 */
export const formatActivityTypeLabel = (activityType) => {
    const parts = String(activityType ?? '')
        .split('_')
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length === 0) {
        return 'Activity';
    }

    return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
};

/**
 * @param {object[]} sets
 * @returns {{ valid: boolean, message?: string }}
 */
export const validateUniqueSetNumbers = (sets = []) => {
    if (!Array.isArray(sets)) {
        return { valid: true };
    }

    const seen = new Set();

    for (const set of sets) {
        if (set?.setNumber == null) {
            continue;
        }

        if (seen.has(set.setNumber)) {
            return {
                valid: false,
                message: 'Set numbers must be unique within each exercise',
            };
        }

        seen.add(set.setNumber);
    }

    return { valid: true };
};

/**
 * Count total programmed exercises across all days.
 *
 * @param {object[]} workoutDays
 * @returns {number}
 */
export const countTotalExercises = (workoutDays = []) => {
    if (!Array.isArray(workoutDays)) {
        return 0;
    }

    return workoutDays.reduce(
        (total, day) => total + (Array.isArray(day.exercises) ? day.exercises.length : 0),
        0
    );
};

/**
 * Map embedded exercise set to public API shape.
 *
 * @param {object} set
 * @returns {object}
 */
const mapExerciseSetToPublic = (set) => ({
    id: toIdString(set._id ?? set.id),
    setNumber: set.setNumber,
    reps: set.reps ?? null,
    weight: set.weight ?? null,
    weightUnit: set.weightUnit,
    isWarmup: Boolean(set.isWarmup),
    isDropset: Boolean(set.isDropset),
});

/**
 * Map embedded plan exercise to public API shape.
 *
 * @param {object} exercise
 * @returns {object}
 */
const mapPlanExerciseToPublic = (exercise) => ({
    id: toIdString(exercise._id ?? exercise.id),
    exerciseId: toIdString(exercise.exerciseId),
    order: exercise.order,
    sets: Array.isArray(exercise.sets)
        ? normalizeSetNumbers(exercise.sets).map(mapExerciseSetToPublic)
        : [],
    restBetweenSets: exercise.restBetweenSets,
    notes: exercise.notes ?? null,
    tempo: exercise.tempo ?? null,
    supersetWith: toIdString(exercise.supersetWith),
    exerciseSnapshot: exercise.exerciseSnapshot
        ? {
              name: exercise.exerciseSnapshot.name,
              thumbnailUrl: exercise.exerciseSnapshot.thumbnailUrl ?? null,
          }
        : null,
});

/**
 * Map embedded warm-up / cardio activity to public API shape.
 *
 * @param {object} activity
 * @returns {object}
 */
const mapPlanActivityToPublic = (activity) => ({
    id: toIdString(activity._id ?? activity.id),
    activityType: activity.activityType,
    protocol: activity.protocol ?? undefined,
    order: activity.order,
    durationMinutes: activity.durationMinutes,
    intensity: activity.intensity,
    distanceKm: activity.distanceKm ?? null,
    targetHeartRate: activity.targetHeartRate ?? null,
    workSeconds: activity.workSeconds ?? null,
    recoverySeconds: activity.recoverySeconds ?? null,
    rounds: activity.rounds ?? null,
    notes: activity.notes ?? null,
    exerciseId: toIdString(activity.exerciseId),
    activitySnapshot: activity.activitySnapshot
        ? {
              name: activity.activitySnapshot.name,
              thumbnailUrl: activity.activitySnapshot.thumbnailUrl ?? null,
          }
        : null,
});

/**
 * Map warm-up activity (no cardio-only fields).
 *
 * @param {object} activity
 * @returns {object}
 */
const mapWarmupActivityToPublic = (activity) => {
    const mapped = mapPlanActivityToPublic(activity);
    delete mapped.protocol;
    delete mapped.distanceKm;
    delete mapped.targetHeartRate;
    delete mapped.workSeconds;
    delete mapped.recoverySeconds;
    delete mapped.rounds;
    return mapped;
};

/**
 * Map cardio activity including protocol fields.
 *
 * @param {object} activity
 * @returns {object}
 */
const mapCardioActivityToPublic = (activity) => ({
    ...mapPlanActivityToPublic(activity),
    protocol: activity.protocol || 'continuous',
});

/**
 * Map embedded workout day to public API shape.
 *
 * @param {object} day
 * @returns {object}
 */
const mapWorkoutDayToPublic = (day) => ({
    id: toIdString(day._id ?? day.id),
    dayNumber: day.dayNumber,
    name: day.name,
    description: day.description ?? null,
    warmupActivities: Array.isArray(day.warmupActivities)
        ? normalizeActivityOrder(day.warmupActivities).map(mapWarmupActivityToPublic)
        : [],
    exercises: Array.isArray(day.exercises)
        ? normalizeExerciseOrder(day.exercises).map(mapPlanExerciseToPublic)
        : [],
    cardioActivities: Array.isArray(day.cardioActivities)
        ? normalizeActivityOrder(day.cardioActivities).map(mapCardioActivityToPublic)
        : [],
});

/**
 * Full workout plan detail for API responses.
 *
 * @param {import('mongoose').Document|object} plan
 * @returns {object|null}
 */
export const mapWorkoutPlanToPublic = (plan) => {
    if (!plan) {
        return null;
    }

    const doc = toPlainObject(plan);
    const workoutDays = normalizeWorkoutDays(doc.workoutDays ?? []);
    const ownership = resolvePlanOwnership(doc);

    return {
        id: toIdString(doc._id ?? doc.id),
        trainerId: ownership.trainerId,
        ownership: {
            type: ownership.type,
            trainerId: ownership.trainerId,
        },
        templateKey: ownership.type === 'system' ? doc.templateKey ?? null : null,
        icon: doc.icon?.trim() || DEFAULT_WORKOUT_PLAN_ICON,
        name: doc.name,
        description: doc.description ?? null,
        duration: doc.duration,
        daysPerWeek: doc.daysPerWeek,
        goal: doc.goal,
        level: doc.level,
        workoutDays: workoutDays.map(mapWorkoutDayToPublic),
        isTemplate: Boolean(doc.isTemplate),
        status: doc.status,
        notes: doc.notes ?? null,
        totalExercises: countTotalExercises(workoutDays),
        totalDays: workoutDays.length,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};

/**
 * Compact workout plan row for list API responses.
 *
 * @param {import('mongoose').Document|object} plan
 * @param {{ assignedClientsCount?: number }} [options]
 * @returns {object|null}
 */
export const mapWorkoutPlanListItem = (plan, options = {}) => {
    if (!plan) {
        return null;
    }

    const doc = toPlainObject(plan);
    const workoutDays = doc.workoutDays ?? [];
    const ownership = resolvePlanOwnership(doc);
    const assignedClientsCount =
        ownership.type === 'system' ? 0 : Math.max(0, Number(options.assignedClientsCount) || 0);

    return {
        id: toIdString(doc._id ?? doc.id),
        icon: doc.icon?.trim() || DEFAULT_WORKOUT_PLAN_ICON,
        name: doc.name,
        goal: doc.goal,
        level: doc.level,
        duration: doc.duration,
        daysPerWeek: doc.daysPerWeek,
        isTemplate: Boolean(doc.isTemplate),
        status: doc.status,
        ownership: {
            type: ownership.type,
            trainerId: ownership.trainerId,
        },
        assignedClientsCount,
        totalExercises: countTotalExercises(workoutDays),
        totalDays: Array.isArray(workoutDays) ? workoutDays.length : 0,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};

/**
 * Build hydrated exercise summary for detail responses.
 *
 * @param {string} exerciseId
 * @param {object|null} exerciseSnapshot
 * @param {Map<string, object>} exerciseMap
 * @returns {object}
 */
const buildHydratedExercise = (exerciseId, exerciseSnapshot, exerciseMap) => {
    const catalog = exerciseMap.get(exerciseId);

    if (catalog) {
        return catalog;
    }

    if (exerciseSnapshot) {
        return {
            id: exerciseId,
            name: exerciseSnapshot.name,
            thumbnailUrl: exerciseSnapshot.thumbnailUrl ?? null,
            status: 'archived',
            muscles: null,
        };
    }

    return {
        id: exerciseId,
        name: 'Unknown exercise',
        thumbnailUrl: null,
        status: null,
        muscles: null,
    };
};

/**
 * Full workout plan detail with hydrated Exercise summaries per PlanExercise.
 *
 * @param {import('mongoose').Document|object} plan
 * @param {Map<string, object>} [exerciseMap]
 * @returns {object|null}
 */
/**
 * Hydrate optional activity exerciseId; omit `exercise` when no catalog reference.
 *
 * @param {object} activity
 * @param {Map<string, object>} exerciseMap
 * @returns {object}
 */
const hydratePlanActivity = (activity, exerciseMap) => {
    if (!activity.exerciseId) {
        return activity;
    }

    return {
        ...activity,
        exercise: buildHydratedExercise(
            activity.exerciseId,
            activity.activitySnapshot,
            exerciseMap
        ),
    };
};

export const mapWorkoutPlanToDetail = (plan, exerciseMap = new Map()) => {
    const base = mapWorkoutPlanToPublic(plan);
    if (!base) {
        return null;
    }

    return {
        ...base,
        workoutDays: base.workoutDays.map((day) => ({
            ...day,
            warmupActivities: day.warmupActivities.map((activity) =>
                hydratePlanActivity(activity, exerciseMap)
            ),
            exercises: day.exercises.map((exercise) => ({
                ...exercise,
                exercise: buildHydratedExercise(
                    exercise.exerciseId,
                    exercise.exerciseSnapshot,
                    exerciseMap
                ),
            })),
            cardioActivities: day.cardioActivities.map((activity) =>
                hydratePlanActivity(activity, exerciseMap)
            ),
        })),
    };
};

/**
 * Map plan assignment to public API shape.
 *
 * @param {import('mongoose').Document|object} assignment
 * @param {import('mongoose').Document|object|null} [client]
 * @returns {object}
 */
export const mapAssignmentToPublic = (assignment, client = null) => {
    const doc = toPlainObject(assignment);
    const planField = doc.planId;
    const planId =
        planField && typeof planField === 'object'
            ? toIdString(planField._id ?? planField.id)
            : toIdString(planField);
    const planSummary =
        planField &&
        typeof planField === 'object' &&
        typeof planField.name === 'string'
            ? {
                  id: toIdString(planField._id ?? planField.id),
                  name: planField.name,
              }
            : null;

    return {
        id: toIdString(doc._id ?? doc.id),
        planId,
        planVersionId: toIdString(doc.planVersionId),
        clientId: toIdString(
            doc.clientId && typeof doc.clientId === 'object'
                ? doc.clientId._id ?? doc.clientId.id
                : doc.clientId
        ),
        client:
            client && typeof client.getPublicProfile === 'function'
                ? client.getPublicProfile()
                : null,
        plan: planSummary,
        startDate: doc.startDate,
        endDate: doc.endDate ?? null,
        status: doc.status,
        progress: doc.progress ?? 0,
        completedSessions: doc.completedSessions ?? 0,
        totalSessions: doc.totalSessions ?? 0,
        notes: doc.notes ?? null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};

/**
 * Player-safe set row (executable fields only).
 *
 * @param {object} set
 * @returns {object}
 */
const mapPlayerExerciseSet = (set) => ({
    id: set.id ?? null,
    setNumber: set.setNumber,
    reps: set.reps ?? null,
    weight: set.weight ?? null,
    weightUnit: set.weightUnit,
    isWarmup: Boolean(set.isWarmup),
    isDropset: Boolean(set.isDropset),
});

/**
 * Player-safe plan exercise row, including hydrated catalog summary when present.
 *
 * @param {object} exercise
 * @returns {object}
 */
const mapPlayerPlanExercise = (exercise) => ({
    id: exercise.id ?? null,
    exerciseId: exercise.exerciseId ?? null,
    order: exercise.order,
    sets: Array.isArray(exercise.sets) ? exercise.sets.map(mapPlayerExerciseSet) : [],
    restBetweenSets: exercise.restBetweenSets,
    notes: exercise.notes ?? null,
    tempo: exercise.tempo ?? null,
    supersetWith: exercise.supersetWith ?? null,
    exerciseSnapshot: exercise.exerciseSnapshot
        ? {
              name: exercise.exerciseSnapshot.name,
              thumbnailUrl: exercise.exerciseSnapshot.thumbnailUrl ?? null,
          }
        : null,
    exercise: exercise.exercise
        ? {
              id: exercise.exercise.id ?? null,
              name: exercise.exercise.name,
              thumbnailUrl: exercise.exercise.thumbnailUrl ?? null,
              status: exercise.exercise.status ?? null,
              muscles:
                  exercise.exercise.muscles &&
                  typeof exercise.exercise.muscles === 'object' &&
                  exercise.exercise.muscles.primary
                      ? {
                            primary: exercise.exercise.muscles.primary,
                            secondary: Array.isArray(exercise.exercise.muscles.secondary)
                                ? exercise.exercise.muscles.secondary
                                : [],
                        }
                      : null,
          }
        : null,
});

/**
 * Player-safe workout day.
 *
 * @param {object} day
 * @returns {object}
 */
/**
 * Player-safe warm-up / cardio activity (includes hydrated exercise when present).
 *
 * @param {object} activity
 * @returns {object}
 */
const mapPlayerPlanActivity = (activity) => ({
    id: activity.id ?? null,
    activityType: activity.activityType,
    protocol: activity.protocol,
    order: activity.order,
    durationMinutes: activity.durationMinutes,
    intensity: activity.intensity,
    distanceKm: activity.distanceKm ?? null,
    targetHeartRate: activity.targetHeartRate ?? null,
    workSeconds: activity.workSeconds ?? null,
    recoverySeconds: activity.recoverySeconds ?? null,
    rounds: activity.rounds ?? null,
    notes: activity.notes ?? null,
    exerciseId: activity.exerciseId ?? null,
    activitySnapshot: activity.activitySnapshot
        ? {
              name: activity.activitySnapshot.name,
              thumbnailUrl: activity.activitySnapshot.thumbnailUrl ?? null,
          }
        : null,
    exercise: activity.exercise
        ? {
              id: activity.exercise.id ?? null,
              name: activity.exercise.name,
              thumbnailUrl: activity.exercise.thumbnailUrl ?? null,
              status: activity.exercise.status ?? null,
              muscles:
                  activity.exercise.muscles &&
                  typeof activity.exercise.muscles === 'object' &&
                  activity.exercise.muscles.primary
                      ? {
                            primary: activity.exercise.muscles.primary,
                            secondary: Array.isArray(activity.exercise.muscles.secondary)
                                ? activity.exercise.muscles.secondary
                                : [],
                        }
                      : null,
          }
        : null,
});

const mapPlayerWarmupActivity = (activity) => {
    const mapped = mapPlayerPlanActivity(activity);
    delete mapped.protocol;
    delete mapped.distanceKm;
    delete mapped.targetHeartRate;
    delete mapped.workSeconds;
    delete mapped.recoverySeconds;
    delete mapped.rounds;
    return mapped;
};

const mapPlayerCardioActivity = (activity) => ({
    ...mapPlayerPlanActivity(activity),
    protocol: activity.protocol || 'continuous',
});

const mapPlayerWorkoutDay = (day) => ({
    id: day.id ?? null,
    dayNumber: day.dayNumber,
    name: day.name,
    description: day.description ?? null,
    warmupActivities: Array.isArray(day.warmupActivities)
        ? day.warmupActivities.map(mapPlayerWarmupActivity)
        : [],
    exercises: Array.isArray(day.exercises)
        ? day.exercises.map(mapPlayerPlanExercise)
        : [],
    cardioActivities: Array.isArray(day.cardioActivities)
        ? day.cardioActivities.map(mapPlayerCardioActivity)
        : [],
});

/**
 * Map an active assignment + hydrated plan detail into the player `/me/workout-plan` DTO.
 * Omits trainer/admin fields (ownership, trainerId, templateKey, plan status, etc.).
 *
 * @param {import('mongoose').Document|object} assignment
 * @param {object} planDetail — output of mapWorkoutPlanToDetail
 * @returns {object}
 */
export const mapPlayerWorkoutAssignment = (assignment, planDetail) => {
    const doc = toPlainObject(assignment);

    return {
        id: toIdString(doc._id ?? doc.id),
        status: doc.status,
        startDate: doc.startDate,
        endDate: doc.endDate ?? null,
        progress: doc.progress ?? 0,
        completedSessions: doc.completedSessions ?? 0,
        totalSessions: doc.totalSessions ?? 0,
        notes: doc.notes ?? null,
        plan: {
            id: planDetail.id,
            name: planDetail.name,
            description: planDetail.description ?? null,
            goal: planDetail.goal,
            level: planDetail.level,
            workoutDays: Array.isArray(planDetail.workoutDays)
                ? planDetail.workoutDays.map(mapPlayerWorkoutDay)
                : [],
        },
    };
};

/**
 * Trainer Client Details summary: assignment metadata + lightweight plan fields.
 * Does not include workoutDays / exercises / sets (player endpoint owns executable content).
 *
 * @param {import('mongoose').Document|object} assignment
 * @param {import('mongoose').Document|object|null} plan
 * @returns {object}
 */
export const mapTrainerClientWorkoutAssignment = (assignment, plan = null) => {
    const doc = toPlainObject(assignment);
    const planDoc = plan ? toPlainObject(plan) : null;

    return {
        id: toIdString(doc._id ?? doc.id),
        planId: toIdString(
            doc.planId && typeof doc.planId === 'object'
                ? doc.planId._id ?? doc.planId.id
                : doc.planId
        ),
        planVersionId: toIdString(doc.planVersionId),
        clientId: toIdString(
            doc.clientId && typeof doc.clientId === 'object'
                ? doc.clientId._id ?? doc.clientId.id
                : doc.clientId
        ),
        status: doc.status,
        startDate: doc.startDate,
        endDate: doc.endDate ?? null,
        progress: doc.progress ?? 0,
        completedSessions: doc.completedSessions ?? 0,
        totalSessions: doc.totalSessions ?? 0,
        notes: doc.notes ?? null,
        plan: planDoc
            ? {
                  id: toIdString(planDoc._id ?? planDoc.id),
                  name: planDoc.name,
                  description: planDoc.description ?? null,
                  goal: planDoc.goal,
                  level: planDoc.level,
              }
            : null,
    };
};

/**
 * Allowlisted Workout Plan summary embedded on GET /clients/:id.
 * Same assignment/plan selection as mapTrainerClientWorkoutAssignmentIfVisible;
 * excludes progress and nested plan objects.
 *
 * @param {import('mongoose').Document|object} assignment
 * @param {import('mongoose').Document|object} plan — visible (non-draft) plan
 * @returns {object|null}
 */
export const mapClientDetailsWorkoutPlanSummary = (assignment, plan) => {
    if (!assignment || !plan) {
        return null;
    }

    const doc = toPlainObject(assignment);
    const planDoc = toPlainObject(plan);
    const planName =
        typeof planDoc.name === 'string' ? planDoc.name.trim() : '';

    if (!planName) {
        return null;
    }

    const duration = planDoc.duration;
    const totalWeeks =
        typeof duration === 'number' && Number.isFinite(duration) && duration >= 1
            ? duration
            : null;

    const toIso = (value) => {
        if (value == null || value === '') return null;
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };

    const startDate = toIso(doc.startDate);
    if (!startDate) {
        return null;
    }

    return {
        assignmentId: toIdString(doc._id ?? doc.id),
        planId: toIdString(
            doc.planId && typeof doc.planId === 'object'
                ? doc.planId._id ?? doc.planId.id
                : doc.planId
        ),
        planName,
        status: doc.status,
        startDate,
        endDate: toIso(doc.endDate),
        totalWeeks,
        completedSessions:
            typeof doc.completedSessions === 'number' ? doc.completedSessions : 0,
        totalSessions: typeof doc.totalSessions === 'number' ? doc.totalSessions : 0,
    };
};
