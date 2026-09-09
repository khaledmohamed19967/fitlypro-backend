import mongoose from 'mongoose';
import WorkoutPlan from './workout-plan.model.js';
import PlanAssignment from './plan-assignment.model.js';
import WorkoutPlanVersion from './workout-plan-version.model.js';
import User from '../users/user.model.js';
import Exercise from '../exercises/exercise.model.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildPaginationMeta, countMatchingDocuments, paginateCollection, resolvePagination } from '../../utils/pagination.js';
import { buildExerciseVisibilityFilter } from '../exercises/exercise.helpers.js';
import {
    normalizeWorkoutPlanInput,
    mapWorkoutPlanToDetail,
    mapWorkoutPlanListItem,
    mapAssignmentToPublic,
    mapPlayerWorkoutAssignment,
    mapTrainerClientWorkoutAssignment,
    buildWorkoutPlanListFilter,
    buildWorkoutPlanVisibilityFilter,
    canReadWorkoutPlan,
    canModifyWorkoutPlan,
    canCloneWorkoutPlan,
    generateCloneName,
    isSystemWorkoutPlan,
} from './workout-plan.helpers.js';
import { DEFAULT_WORKOUT_PLAN_ICON, CANCELLABLE_ASSIGNMENT_STATUSES } from './workout-plan.constants.js';

/**
 * Workout Plan Service — CRUD, assignments, templates/clone (Phase 2 + 4A)
 */

const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

const resolveObjectId = (id) =>
    isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId();

const emptyToNull = (value) => (value === '' || value === undefined ? null : value);

/**
 * Load a plan the trainer can read (own trainer plan OR system template).
 * Missing / foreign → 404 (no ownership leak).
 *
 * @param {string} planId
 * @param {string} trainerId
 */
const loadReadablePlan = async (planId, trainerId) => {
    if (!isValidObjectId(planId)) {
        throw new ApiError(400, 'Invalid workout plan ID');
    }

    const plan = await WorkoutPlan.findOne({
        $and: [{ _id: planId }, buildWorkoutPlanVisibilityFilter(trainerId)],
    });

    if (!plan || !canReadWorkoutPlan(plan, trainerId)) {
        throw new ApiError(404, 'Workout plan not found');
    }

    return plan;
};

/**
 * Load a plan the trainer can modify (own trainer plan only).
 * System templates → 403. Missing / foreign → 404.
 *
 * @param {string} planId
 * @param {string} trainerId
 */
const loadModifiablePlan = async (planId, trainerId) => {
    if (!isValidObjectId(planId)) {
        throw new ApiError(400, 'Invalid workout plan ID');
    }

    const plan = await WorkoutPlan.findById(planId);

    if (!plan) {
        throw new ApiError(404, 'Workout plan not found');
    }

    if (isSystemWorkoutPlan(plan)) {
        throw new ApiError(403, 'System workout templates cannot be modified');
    }

    if (!canModifyWorkoutPlan(plan, trainerId)) {
        throw new ApiError(404, 'Workout plan not found');
    }

    return plan;
};

/**
 * Load trainer-owned plan for assignment listing (not system templates).
 * System templates → 403. Missing / foreign → 404.
 *
 * @param {string} planId
 * @param {string} trainerId
 */
const loadOwnedTrainerPlan = async (planId, trainerId) => {
    const plan = await loadModifiablePlan(planId, trainerId);
    return plan;
};

/**
 * Load plan eligible for new assignments.
 * System templates → 400. Draft/archived → 400. Foreign → 404.
 *
 * @param {string} planId
 * @param {string} trainerId
 */
const loadAssignablePlan = async (planId, trainerId) => {
    if (!isValidObjectId(planId)) {
        throw new ApiError(400, 'Invalid workout plan ID');
    }

    const plan = await WorkoutPlan.findById(planId);

    if (!plan) {
        throw new ApiError(404, 'Workout plan not found');
    }

    if (isSystemWorkoutPlan(plan)) {
        throw new ApiError(400, 'System workout templates cannot be assigned');
    }

    if (!canModifyWorkoutPlan(plan, trainerId)) {
        throw new ApiError(404, 'Workout plan not found');
    }

    if (plan.status === 'archived') {
        throw new ApiError(400, 'Cannot assign an archived workout plan');
    }

    if (plan.status === 'draft') {
        throw new ApiError(400, 'Cannot assign a draft workout plan');
    }

    return plan;
};

/**
 * Map Mongo duplicate-key races on active (planId, clientId) to domain 409.
 *
 * @param {unknown} err
 */
const throwIfDuplicateActiveAssignment = (err) => {
    if (err?.code === 11000) {
        throw new ApiError(409, 'Active assignment already exists for one or more clients', [
            {
                field: 'clientIds',
                message: 'Active assignment already exists for one or more clients',
            },
        ]);
    }
};

/**
 * @param {object} query
 * @param {string} trainerId
 */
const getWorkoutPlanSummary = async (query, trainerId) => {
    const filter = buildWorkoutPlanListFilter(query, trainerId);

    const grouped = await WorkoutPlan.aggregate([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const counts = { draft: 0, active: 0, archived: 0 };
    for (const row of grouped) {
        if (row._id && Object.prototype.hasOwnProperty.call(counts, row._id)) {
            counts[row._id] = row.count;
        }
    }

    return {
        all: counts.draft + counts.active + counts.archived,
        ...counts,
    };
};

/**
 * @param {object} query
 * @param {string} trainerId
 */
const getWorkoutPlans = async (query, trainerId) => {
    const { page, limit, sort = 'newest' } = query;
    const filter = buildWorkoutPlanListFilter(query, trainerId);

    if (usesExerciseCountSort(sort)) {
        const { page: safePage, limit: safeLimit, skip } = resolvePagination({ page, limit });

        const [results, total] = await Promise.all([
            WorkoutPlan.aggregate([
                { $match: filter },
                {
                    $addFields: {
                        totalExercises: {
                            $sum: {
                                $map: {
                                    input: { $ifNull: ['$workoutDays', []] },
                                    as: 'day',
                                    in: { $size: { $ifNull: ['$$day.exercises', []] } },
                                },
                            },
                        },
                    },
                },
                { $sort: buildSortSpec(sort) },
                { $skip: skip },
                { $limit: safeLimit },
            ]),
            countMatchingDocuments(WorkoutPlan, filter),
        ]);

        return {
            workoutPlans: results.map((plan) => mapWorkoutPlanListItem(plan)),
            pagination: buildPaginationMeta(safePage, safeLimit, total),
        };
    }

    const { docs, pagination } = await paginateCollection({
        model: WorkoutPlan,
        filter,
        sort: buildSortSpec(sort),
        page,
        limit,
    });

    return {
        workoutPlans: docs.map((plan) => mapWorkoutPlanListItem(plan)),
        pagination,
    };
};

/**
 * @param {string} sort
 */
const buildSortSpec = (sort) => {
    switch (sort) {
        case 'name':
            return { name: 1 };
        case 'name-desc':
            return { name: -1 };
        case 'oldest':
            return { createdAt: 1 };
        case 'exercises-high':
            return { totalExercises: -1, createdAt: -1 };
        case 'exercises-low':
            return { totalExercises: 1, createdAt: -1 };
        case 'newest':
        default:
            return { createdAt: -1 };
    }
};

const usesExerciseCountSort = (sort) =>
    sort === 'exercises-high' || sort === 'exercises-low';

/**
 * @param {string} exerciseId
 * @param {string} trainerId
 * @param {string} fieldPath
 */
const validateAndLoadExercise = async (exerciseId, trainerId, fieldPath) => {
    if (!isValidObjectId(exerciseId)) {
        throw new ApiError(400, 'Invalid exercise ID', [
            { field: fieldPath, message: 'Must be a valid ObjectId' },
        ]);
    }

    const exercise = await Exercise.findOne({
        $and: [{ _id: exerciseId }, buildExerciseVisibilityFilter(trainerId)],
    });

    if (!exercise) {
        throw new ApiError(400, 'Exercise is not accessible', [
            {
                field: fieldPath,
                message: 'Exercise not found or not accessible to you',
            },
        ]);
    }

    return exercise;
};

/**
 * Validate, snapshot, renumber, and resolve subdocument ids for nested plan tree.
 *
 * @param {object[]} workoutDays
 * @param {string} trainerId
 */
const processWorkoutDays = async (workoutDays, trainerId) => {
    const normalized = normalizeWorkoutPlanInput({ workoutDays }).workoutDays ?? [];
    const sortedDays = [...normalized].sort((a, b) => (a.dayNumber ?? 0) - (b.dayNumber ?? 0));

    const processedDays = [];

    for (let dayIndex = 0; dayIndex < sortedDays.length; dayIndex += 1) {
        const day = sortedDays[dayIndex];
        const dayId = resolveObjectId(day._id);
        const sortedExercises = [...(day.exercises ?? [])].sort(
            (a, b) => (a.order ?? 0) - (b.order ?? 0)
        );

        const processedExercises = [];
        const idMap = new Map();

        for (let exerciseIndex = 0; exerciseIndex < sortedExercises.length; exerciseIndex += 1) {
            const exercise = sortedExercises[exerciseIndex];
            const exerciseDocId = resolveObjectId(exercise._id);

            if (exercise._id && isValidObjectId(exercise._id)) {
                idMap.set(String(exercise._id), exerciseDocId);
            }

            const fieldPath = `workoutDays.${dayIndex}.exercises.${exerciseIndex}.exerciseId`;
            const catalogExercise = await validateAndLoadExercise(
                exercise.exerciseId,
                trainerId,
                fieldPath
            );

            const sortedSets = [...(exercise.sets ?? [])].sort(
                (a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0)
            );

            processedExercises.push({
                _id: exerciseDocId,
                exerciseId: catalogExercise._id,
                order: exerciseIndex + 1,
                sets: sortedSets.map((set, setIndex) => ({
                    _id: resolveObjectId(set._id),
                    setNumber: setIndex + 1,
                    reps: set.reps ?? null,
                    weight: set.weight ?? null,
                    weightUnit: set.weightUnit || 'kg',
                    isWarmup: Boolean(set.isWarmup),
                    isDropset: Boolean(set.isDropset),
                })),
                restBetweenSets: exercise.restBetweenSets,
                notes: emptyToNull(exercise.notes),
                tempo: emptyToNull(exercise.tempo),
                supersetWith: null,
                exerciseSnapshot: {
                    name: catalogExercise.name,
                    thumbnailUrl: catalogExercise.media?.thumbnailUrl ?? null,
                },
                _supersetWithRaw: exercise.supersetWith ?? null,
            });
        }

        const exerciseIdSet = new Set(processedExercises.map((ex) => ex._id.toString()));

        for (const exercise of processedExercises) {
            const rawSuperset = exercise._supersetWithRaw;
            delete exercise._supersetWithRaw;

            if (!rawSuperset) {
                continue;
            }

            if (!isValidObjectId(rawSuperset)) {
                throw new ApiError(400, 'Invalid superset reference', [
                    {
                        field: 'supersetWith',
                        message: 'Superset target must be a valid ObjectId',
                    },
                ]);
            }

            let targetId = String(rawSuperset);
            if (idMap.has(targetId)) {
                targetId = idMap.get(targetId).toString();
            }

            if (!exerciseIdSet.has(targetId)) {
                throw new ApiError(400, 'Invalid superset reference', [
                    {
                        field: 'supersetWith',
                        message: 'Superset target must exist in the same workout day',
                    },
                ]);
            }

            if (targetId === exercise._id.toString()) {
                throw new ApiError(400, 'Invalid superset reference', [
                    {
                        field: 'supersetWith',
                        message: 'Exercise cannot superset with itself',
                    },
                ]);
            }

            exercise.supersetWith = new mongoose.Types.ObjectId(targetId);
        }

        processedDays.push({
            _id: dayId,
            dayNumber: dayIndex + 1,
            name: day.name,
            description: emptyToNull(day.description),
            exercises: processedExercises,
        });
    }

    return processedDays;
};

/**
 * Deep-clone workoutDays with fresh nested ObjectIds.
 * Preserves exerciseId + exerciseSnapshot; remaps supersetWith within each day.
 *
 * @param {object[]} workoutDays
 * @returns {object[]}
 */
const deepCloneWorkoutDays = (workoutDays = []) => {
    const clonedDays = [];

    for (const day of workoutDays) {
        const idMap = new Map();
        const clonedExercises = [];

        for (const exercise of day.exercises ?? []) {
            const newExerciseId = new mongoose.Types.ObjectId();
            const oldId = exercise._id?.toString?.() ?? null;
            if (oldId) {
                idMap.set(oldId, newExerciseId);
            }

            clonedExercises.push({
                _id: newExerciseId,
                exerciseId: exercise.exerciseId,
                order: exercise.order,
                sets: (exercise.sets ?? []).map((set) => ({
                    _id: new mongoose.Types.ObjectId(),
                    setNumber: set.setNumber,
                    reps: set.reps ?? null,
                    weight: set.weight ?? null,
                    weightUnit: set.weightUnit || 'kg',
                    isWarmup: Boolean(set.isWarmup),
                    isDropset: Boolean(set.isDropset),
                })),
                restBetweenSets: exercise.restBetweenSets,
                notes: exercise.notes ?? null,
                tempo: exercise.tempo ?? null,
                supersetWith: null,
                exerciseSnapshot: exercise.exerciseSnapshot
                    ? {
                          name: exercise.exerciseSnapshot.name,
                          thumbnailUrl: exercise.exerciseSnapshot.thumbnailUrl ?? null,
                      }
                    : null,
                _supersetWithRaw: exercise.supersetWith?.toString?.() ?? null,
            });
        }

        for (const exercise of clonedExercises) {
            const raw = exercise._supersetWithRaw;
            delete exercise._supersetWithRaw;
            if (!raw) continue;
            const mapped = idMap.get(String(raw));
            if (mapped) {
                exercise.supersetWith = mapped;
            }
        }

        clonedDays.push({
            _id: new mongoose.Types.ObjectId(),
            dayNumber: day.dayNumber,
            name: day.name,
            description: day.description ?? null,
            exercises: clonedExercises,
        });
    }

    return clonedDays;
};

/**
 * @param {import('mongoose').Document} plan
 */
const loadExercisesForPlan = async (plan) => {
    const exerciseIds = new Set();

    for (const day of plan.workoutDays ?? []) {
        for (const exercise of day.exercises ?? []) {
            if (exercise.exerciseId) {
                exerciseIds.add(String(exercise.exerciseId));
            }
        }
    }

    if (exerciseIds.size === 0) {
        return new Map();
    }

    const exercises = await Exercise.find({ _id: { $in: [...exerciseIds] } });
    const exerciseMap = new Map();

    for (const exercise of exercises) {
        exerciseMap.set(exercise._id.toString(), {
            id: exercise._id.toString(),
            name: exercise.name,
            thumbnailUrl: exercise.media?.thumbnailUrl ?? null,
            status: exercise.status,
        });
    }

    return exerciseMap;
};

/**
 * @param {string} planId
 * @param {string} trainerId
 */
const getWorkoutPlanById = async (planId, trainerId) => {
    const plan = await loadReadablePlan(planId, trainerId);
    const exerciseMap = await loadExercisesForPlan(plan);
    return mapWorkoutPlanToDetail(plan, exerciseMap);
};

/**
 * @param {object} body
 * @param {string} trainerId
 */
const createWorkoutPlan = async (body, trainerId) => {
    const normalized = normalizeWorkoutPlanInput(body);
    const workoutDays = normalized.workoutDays
        ? await processWorkoutDays(normalized.workoutDays, trainerId)
        : [];

    const plan = new WorkoutPlan({
        trainerId,
        ownership: {
            type: 'trainer',
            trainerId,
        },
        templateKey: null,
        icon: normalized.icon ?? DEFAULT_WORKOUT_PLAN_ICON,
        name: normalized.name,
        description: emptyToNull(normalized.description),
        duration: normalized.duration,
        daysPerWeek: normalized.daysPerWeek,
        goal: normalized.goal,
        level: normalized.level,
        workoutDays,
        isTemplate: normalized.isTemplate ?? false,
        status: normalized.status ?? 'active',
        notes: emptyToNull(normalized.notes),
    });

    await plan.save();

    const exerciseMap = await loadExercisesForPlan(plan);
    return mapWorkoutPlanToDetail(plan, exerciseMap);
};

/**
 * @param {string} planId
 * @param {object} body
 * @param {string} trainerId
 */
const updateWorkoutPlan = async (planId, body, trainerId) => {
    const plan = await loadModifiablePlan(planId, trainerId);
    const normalized = normalizeWorkoutPlanInput(body);

    if (normalized.name !== undefined) plan.name = normalized.name;
    if (normalized.icon !== undefined) {
        plan.icon = normalized.icon ?? DEFAULT_WORKOUT_PLAN_ICON;
    }
    if (normalized.description !== undefined) {
        plan.description = emptyToNull(normalized.description);
    }
    if (normalized.duration !== undefined) plan.duration = normalized.duration;
    if (normalized.daysPerWeek !== undefined) plan.daysPerWeek = normalized.daysPerWeek;
    if (normalized.goal !== undefined) plan.goal = normalized.goal;
    if (normalized.level !== undefined) plan.level = normalized.level;
    if (normalized.isTemplate !== undefined) plan.isTemplate = normalized.isTemplate;
    if (normalized.status !== undefined) plan.status = normalized.status;
    if (normalized.notes !== undefined) plan.notes = emptyToNull(normalized.notes);

    if (normalized.workoutDays !== undefined) {
        plan.workoutDays = await processWorkoutDays(normalized.workoutDays, trainerId);
        plan.markModified('workoutDays');
    }

    await plan.save();

    const exerciseMap = await loadExercisesForPlan(plan);
    return mapWorkoutPlanToDetail(plan, exerciseMap);
};

/**
 * @param {string} planId
 * @param {string} trainerId
 */
const archiveWorkoutPlan = async (planId, trainerId) => {
    const plan = await loadModifiablePlan(planId, trainerId);
    plan.status = 'archived';
    await plan.save();
    return mapWorkoutPlanToDetail(plan, await loadExercisesForPlan(plan));
};

/**
 * Clone an active plan into a new trainer-owned plan.
 *
 * @param {string} sourcePlanId
 * @param {string} trainerId
 * @param {{ name?: string }} payload
 */
const cloneWorkoutPlan = async (sourcePlanId, trainerId, payload = {}) => {
    if (!isValidObjectId(sourcePlanId)) {
        throw new ApiError(400, 'Invalid workout plan ID');
    }

    const source = await WorkoutPlan.findById(sourcePlanId);

    if (!source || !canReadWorkoutPlan(source, trainerId)) {
        throw new ApiError(404, 'Workout plan not found');
    }

    if (source.status !== 'active') {
        throw new ApiError(400, 'Only active plans can be cloned');
    }

    if (!canCloneWorkoutPlan(source, trainerId)) {
        throw new ApiError(404, 'Workout plan not found');
    }

    let name = payload.name?.trim();
    if (!name) {
        name = await generateCloneName(source.name, async (candidate) => {
            const existing = await WorkoutPlan.exists({
                name: candidate,
                $or: [
                    { 'ownership.type': 'trainer', 'ownership.trainerId': trainerId },
                    { ownership: { $exists: false }, trainerId },
                ],
            });
            return Boolean(existing);
        });
    }

    const plan = new WorkoutPlan({
        trainerId,
        ownership: {
            type: 'trainer',
            trainerId,
        },
        templateKey: null,
        icon: source.icon ?? DEFAULT_WORKOUT_PLAN_ICON,
        name,
        description: source.description ?? null,
        duration: source.duration,
        daysPerWeek: source.daysPerWeek,
        goal: source.goal,
        level: source.level,
        workoutDays: deepCloneWorkoutDays(source.workoutDays ?? []),
        isTemplate: false,
        status: 'active',
        notes: source.notes ?? null,
    });

    await plan.save();

    const exerciseMap = await loadExercisesForPlan(plan);
    return mapWorkoutPlanToDetail(plan, exerciseMap);
};

/**
 * @param {string} clientId
 * @param {string} trainerId
 */
const verifyTrainerClient = async (clientId, trainerId) => {
    if (!isValidObjectId(clientId)) {
        throw new ApiError(400, 'Invalid client ID', [
            { field: 'clientIds', message: 'Must be a valid ObjectId' },
        ]);
    }

    const client = await User.findOne({
        _id: clientId,
        role: 'client',
        trainer: trainerId,
    });

    if (!client) {
        throw new ApiError(400, 'Client is not accessible', [
            {
                field: 'clientIds',
                message: 'Client not found or not assigned to you',
            },
        ]);
    }

    return client;
};

/**
 * @param {string|null|undefined} planVersionId
 * @param {string} planId
 * @param {string} trainerId
 */
const validatePlanVersionReference = async (planVersionId, planId, trainerId) => {
    if (!planVersionId) {
        return null;
    }

    if (!isValidObjectId(planVersionId)) {
        throw new ApiError(400, 'Invalid plan version ID', [
            { field: 'planVersionId', message: 'Must be a valid ObjectId' },
        ]);
    }

    const version = await WorkoutPlanVersion.findOne({
        _id: planVersionId,
        planId,
        trainerId,
    });

    if (!version) {
        throw new ApiError(400, 'Plan version not found', [
            { field: 'planVersionId', message: 'Version does not belong to this plan' },
        ]);
    }

    return version;
};

/**
 * @param {string} planId
 * @param {object} body
 * @param {string} trainerId
 */
const createAssignments = async (planId, body, trainerId) => {
    await loadAssignablePlan(planId, trainerId);

    await validatePlanVersionReference(body.planVersionId, planId, trainerId);

    const clients = [];
    for (const clientId of body.clientIds) {
        clients.push(await verifyTrainerClient(clientId, trainerId));
    }

    const duplicateClientIds = [];

    for (const clientId of body.clientIds) {
        const existing = await PlanAssignment.findOne({
            planId,
            clientId,
            status: 'active',
        });

        if (existing) {
            duplicateClientIds.push(clientId);
        }
    }

    if (duplicateClientIds.length > 0) {
        throw new ApiError(409, 'Active assignment already exists for one or more clients', [
            {
                field: 'clientIds',
                message: `Active assignment already exists for client(s): ${duplicateClientIds.join(', ')}`,
            },
        ]);
    }

    const assignments = [];

    try {
        for (let index = 0; index < body.clientIds.length; index += 1) {
            const clientId = body.clientIds[index];
            const client = clients[index];

            const assignment = await PlanAssignment.create({
                trainerId,
                planId,
                planVersionId: body.planVersionId || null,
                clientId,
                startDate: body.startDate,
                endDate: body.endDate || null,
                status: 'active',
                notes: emptyToNull(body.notes),
            });

            assignments.push(mapAssignmentToPublic(assignment, client));
        }
    } catch (err) {
        throwIfDuplicateActiveAssignment(err);
        throw err;
    }

    return assignments;
};

/**
 * @param {string} planId
 * @param {string} trainerId
 */
const getAssignments = async (planId, trainerId) => {
    await loadOwnedTrainerPlan(planId, trainerId);

    const assignments = await PlanAssignment.find({ planId, trainerId })
        .sort({ startDate: -1 })
        .populate('clientId');

    return assignments.map((assignment) =>
        mapAssignmentToPublic(assignment, assignment.clientId)
    );
};

/**
 * Resolve the WorkoutPlan (or later: pinned version) for an assignment.
 * Currently always loads the live plan by planId — planVersionId is ignored until
 * version create/list APIs exist.
 *
 * @param {import('mongoose').Document} assignment
 * @returns {Promise<import('mongoose').Document|null>}
 */
const resolveAssignedPlan = async (assignment) => {
    // Future: if (assignment.planVersionId) { return WorkoutPlanVersion.findById(...) mapped to plan shape }
    const planId = assignment.planId;
    if (!planId || !isValidObjectId(String(planId))) {
        return null;
    }
    return WorkoutPlan.findById(planId);
};

/**
 * Active assignments for a client, newest first (startDate, then createdAt).
 * Shared by player `/me` and trainer Client Details so both surfaces agree.
 *
 * @param {object} filter
 * @returns {Promise<import('mongoose').Document[]>}
 */
const findNewestActiveAssignments = (filter) =>
    PlanAssignment.find({ ...filter, status: 'active' }).sort({
        startDate: -1,
        createdAt: -1,
    });

/**
 * Trainer Client Details ownership: same 400/404/403 conventions as client CRUD.
 * Kept local so workout does not import nutrition modules.
 *
 * @param {string} clientId
 * @param {string} trainerId
 */
const assertTrainerAccessibleClient = async (clientId, trainerId) => {
    if (!isValidObjectId(clientId)) {
        throw new ApiError(400, 'Invalid client ID');
    }

    const client = await User.findOne({
        _id: clientId,
        role: 'client',
    });

    if (!client) {
        throw new ApiError(404, 'Client not found');
    }

    if (
        trainerId &&
        client.trainer &&
        client.trainer.toString() !== trainerId.toString()
    ) {
        throw new ApiError(403, 'You do not have access to this client');
    }

    return client;
};

/**
 * Player `/me/workout-plan`: active assignment owned by the authenticated client,
 * with live plan executable content.
 *
 * Multiple actives (allowed across different plans today): pick newest by
 * startDate desc, then createdAt desc. Does not change uniqueness indexes.
 *
 * @param {string} clientId — must be req.user.id (never client-supplied)
 * @returns {Promise<object|null>}
 */
const getMyActiveAssignment = async (clientId) => {
    if (!isValidObjectId(clientId)) {
        throw new ApiError(400, 'Invalid client ID');
    }

    const assignments = await findNewestActiveAssignments({ clientId });

    if (assignments.length === 0) {
        return null;
    }

    if (assignments.length > 1) {
        console.warn(
            `[workout-plan] Client ${clientId} has ${assignments.length} active workout assignments; returning newest by startDate/createdAt (${assignments[0]._id}).`
        );
    }

    const assignment = assignments[0];
    const plan = await resolveAssignedPlan(assignment);

    if (!plan) {
        throw new ApiError(404, 'Assigned workout plan not found');
    }

    // Draft plans cannot be newly assigned; archived plans may still have active
    // assignments (assignments survive archive). Player may continue the program.
    if (plan.status === 'draft') {
        throw new ApiError(404, 'Assigned workout plan not found');
    }

    const exerciseMap = await loadExercisesForPlan(plan);
    const planDetail = mapWorkoutPlanToDetail(plan, exerciseMap);

    return mapPlayerWorkoutAssignment(assignment, planDetail);
};

/**
 * Trainer Client Details → Workout tab: active assignment for an owned client.
 * Summary DTO only (no workoutDays). Same multi-active ordering as `/me/workout-plan`.
 *
 * @param {string} clientId
 * @param {string} trainerId — req.user.id
 * @returns {Promise<object|null>}
 */
const getClientActiveAssignment = async (clientId, trainerId) => {
    await assertTrainerAccessibleClient(clientId, trainerId);

    const assignments = await findNewestActiveAssignments({
        clientId,
        trainerId,
    });

    if (assignments.length === 0) {
        return null;
    }

    if (assignments.length > 1) {
        console.warn(
            `[workout-plan] Trainer ${trainerId} client ${clientId} has ${assignments.length} active workout assignments; returning newest by startDate/createdAt (${assignments[0]._id}).`
        );
    }

    const assignment = assignments[0];
    const plan = await resolveAssignedPlan(assignment);

    if (!plan || plan.status === 'draft') {
        console.warn(
            `[workout-plan] Active assignment ${assignment._id} references missing/draft plan; returning null for Client Details.`
        );
        return null;
    }

    // Archived plans remain visible in Client Details while the assignment is active
    // (consistent with player endpoint and "assignments survive archive").
    return mapTrainerClientWorkoutAssignment(assignment, plan);
};

/**
 * "Remove from Client" — cancel an active workout assignment.
 * Only active → cancelled; the document and all other fields are preserved.
 *
 * @param {string} planId
 * @param {string} assignmentId
 * @param {string} trainerId
 * @returns {Promise<object>}
 */
const cancelAssignment = async (planId, assignmentId, trainerId) => {
    await loadOwnedTrainerPlan(planId, trainerId);

    if (!isValidObjectId(assignmentId)) {
        throw new ApiError(400, 'Invalid assignment ID');
    }

    const assignment = await PlanAssignment.findOne({
        _id: assignmentId,
        planId,
        trainerId,
    });

    if (!assignment) {
        throw new ApiError(404, 'Workout plan assignment not found');
    }

    if (!CANCELLABLE_ASSIGNMENT_STATUSES.includes(assignment.status)) {
        throw new ApiError(
            409,
            `Only active assignments can be cancelled (current status: ${assignment.status})`
        );
    }

    assignment.status = 'cancelled';
    await assignment.save();

    await assignment.populate({ path: 'planId', select: 'name' });

    return mapAssignmentToPublic(assignment);
};

export default {
    getWorkoutPlans,
    getWorkoutPlanSummary,
    getWorkoutPlanById,
    createWorkoutPlan,
    updateWorkoutPlan,
    archiveWorkoutPlan,
    cloneWorkoutPlan,
    createAssignments,
    getAssignments,
    getMyActiveAssignment,
    getClientActiveAssignment,
    cancelAssignment,
};
