import mongoose from 'mongoose';
import Exercise from './exercise.model.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginateCollection } from '../../utils/pagination.js';
import {
    buildExerciseVisibilityFilter,
    escapeRegex,
    slugifyExerciseName,
    normalizeTags,
    sanitizeSecondaryMuscles,
    toPublicExercise,
} from './exercise.helpers.js';

/**
 * Exercise Service — read + trainer create (Phase 3C)
 */

const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

/**
 * Build ownership/visibility scope for the authenticated trainer.
 * Never accepts another trainer's id from the client.
 *
 * @param {string} trainerId
 * @param {'system'|'trainer'|'all'} ownership
 */
const buildOwnershipScope = (trainerId, ownership = 'all') => {
    if (ownership === 'system') {
        return { 'ownership.type': 'system' };
    }

    if (ownership === 'trainer') {
        return {
            'ownership.type': 'trainer',
            'ownership.trainerId': trainerId,
        };
    }

    return buildExerciseVisibilityFilter(trainerId);
};

/**
 * Build Mongo filter from validated query + trainer identity.
 *
 * @param {object} query
 * @param {string} trainerId
 */
const buildListFilter = (query, trainerId) => {
    const {
        search,
        primaryMuscle,
        equipment,
        difficulty,
        category,
        ownership = 'all',
        status = 'active',
    } = query;

    const conditions = [buildOwnershipScope(trainerId, ownership)];

    if (status) {
        conditions.push({ status });
    }

    if (primaryMuscle) {
        conditions.push({ 'muscles.primary': primaryMuscle });
    }

    if (equipment) {
        conditions.push({ equipment });
    }

    if (difficulty) {
        conditions.push({ difficulty });
    }

    if (category) {
        conditions.push({ category });
    }

    if (search && String(search).trim()) {
        const regex = new RegExp(escapeRegex(String(search).trim()), 'i');
        conditions.push({
            $or: [{ name: regex }, { nameAr: regex }, { tags: regex }],
        });
    }

    return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

/**
 * List exercises visible to the trainer (system + own), with filters/pagination.
 *
 * @param {object} query - validated query (validateExerciseQuery)
 * @param {string} trainerId
 */
const getExercises = async (query, trainerId) => {
    const filter = buildListFilter(query, trainerId);

    const { docs, pagination } = await paginateCollection({
        model: Exercise,
        filter,
        sort: { createdAt: -1 },
        page: query.page,
        limit: query.limit,
    });

    return {
        exercises: docs.map((exercise) => toPublicExercise(exercise)),
        pagination,
    };
};

/**
 * Get one exercise by id if visible to the trainer.
 * Missing and non-visible exercises both return 404 (no ownership leak).
 *
 * @param {string} exerciseId
 * @param {string} trainerId
 */
const getExerciseById = async (exerciseId, trainerId) => {
    if (!isValidObjectId(exerciseId)) {
        throw new ApiError(400, 'Invalid exercise ID');
    }

    const exercise = await Exercise.findOne({
        $and: [{ _id: exerciseId }, buildExerciseVisibilityFilter(trainerId)],
    });

    if (!exercise) {
        throw new ApiError(404, 'Exercise not found');
    }

    return toPublicExercise(exercise);
};

const emptyToNull = (value) => (value === '' || value === undefined ? null : value);

const defaultMedia = () => ({
    thumbnailUrl: null,
    imageUrls: [],
    videoUrl: null,
});

/**
 * Resolve a unique slug within the trainer's ownership scope.
 *
 * @param {string} baseSlug
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @param {string|import('mongoose').Types.ObjectId|null} [excludeExerciseId]
 */
const resolveTrainerSlug = async (baseSlug, trainerId, excludeExerciseId = null) => {
    let slug = baseSlug;
    let suffix = 2;

    const slugQuery = (candidate) => {
        const query = {
            'ownership.type': 'trainer',
            'ownership.trainerId': trainerId,
            slug: candidate,
        };
        if (excludeExerciseId) {
            query._id = { $ne: excludeExerciseId };
        }
        return query;
    };

    while (await Exercise.exists(slugQuery(slug))) {
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
    }

    return slug;
};

/**
 * Create a trainer-owned custom exercise.
 * Server sets ownership, source, status, and slug — never from client body.
 *
 * @param {object} body - validated create payload (validateCreateExercise)
 * @param {string} trainerId
 */
const createExercise = async (body, trainerId) => {
    const baseSlug = slugifyExerciseName(body.name);
    if (!baseSlug) {
        throw new ApiError(400, 'Could not generate a valid slug from exercise name');
    }

    const slug = await resolveTrainerSlug(baseSlug, trainerId);
    const primary = body.muscles.primary;
    const secondary = sanitizeSecondaryMuscles(primary, body.muscles.secondary || []);

    const exercise = new Exercise({
        name: body.name,
        nameAr: emptyToNull(body.nameAr),
        slug,
        description: emptyToNull(body.description),
        descriptionAr: emptyToNull(body.descriptionAr),
        muscles: { primary, secondary },
        equipment: body.equipment,
        category: body.category,
        difficulty: body.difficulty,
        instructions: body.instructions || [],
        instructionsAr: body.instructionsAr || [],
        commonMistakes: body.commonMistakes || [],
        media: body.media
            ? {
                  thumbnailUrl: emptyToNull(body.media.thumbnailUrl),
                  imageUrls: body.media.imageUrls || [],
                  videoUrl: emptyToNull(body.media.videoUrl),
              }
            : defaultMedia(),
        tags: normalizeTags(body.tags || []),
        ownership: {
            type: 'trainer',
            trainerId,
        },
        source: {
            type: 'manual',
            externalProvider: null,
            externalId: null,
            duplicatedFromId: null,
        },
        status: 'active',
    });

    try {
        await exercise.save();
    } catch (err) {
        if (err.code === 11000) {
            throw new ApiError(
                409,
                'An exercise with this slug already exists in your library'
            );
        }
        throw err;
    }

    return toPublicExercise(exercise);
};

/**
 * Load exercise for mutation and enforce trainer ownership.
 * System and foreign-trainer exercises return 403; missing returns 404.
 *
 * @param {string} exerciseId
 * @param {string} trainerId
 */
const loadOwnedTrainerExercise = async (exerciseId, trainerId) => {
    if (!isValidObjectId(exerciseId)) {
        throw new ApiError(400, 'Invalid exercise ID');
    }

    const exercise = await Exercise.findById(exerciseId);
    if (!exercise) {
        throw new ApiError(404, 'Exercise not found');
    }

    if (exercise.ownership?.type === 'system') {
        throw new ApiError(403, 'System exercises cannot be modified');
    }

    if (exercise.ownership?.type !== 'trainer') {
        throw new ApiError(403, 'Not authorized to modify this exercise');
    }

    if (String(exercise.ownership.trainerId) !== String(trainerId)) {
        throw new ApiError(403, 'Not authorized to modify this exercise');
    }

    return exercise;
};

const applyMediaUpdate = (exercise, media) => {
    if (!media) return;

    if (media.thumbnailUrl !== undefined) {
        exercise.media.thumbnailUrl = emptyToNull(media.thumbnailUrl);
    }
    if (media.imageUrls !== undefined) {
        exercise.media.imageUrls = media.imageUrls;
    }
    if (media.videoUrl !== undefined) {
        exercise.media.videoUrl = emptyToNull(media.videoUrl);
    }
};

/**
 * Update a trainer-owned exercise (partial PATCH).
 * Server-owned fields (ownership, source, status, slug*) never come from the client.
 * *slug is regenerated when name changes.
 *
 * @param {string} exerciseId
 * @param {object} body - validated update payload (validateUpdateExercise)
 * @param {string} trainerId
 */
const updateExercise = async (exerciseId, body, trainerId) => {
    const exercise = await loadOwnedTrainerExercise(exerciseId, trainerId);

    if (body.name !== undefined) {
        if (body.name !== exercise.name) {
            const baseSlug = slugifyExerciseName(body.name);
            if (!baseSlug) {
                throw new ApiError(400, 'Could not generate a valid slug from exercise name');
            }
            exercise.slug = await resolveTrainerSlug(baseSlug, trainerId, exercise._id);
        }
        exercise.name = body.name;
    }

    if (body.nameAr !== undefined) {
        exercise.nameAr = emptyToNull(body.nameAr);
    }
    if (body.description !== undefined) {
        exercise.description = emptyToNull(body.description);
    }
    if (body.descriptionAr !== undefined) {
        exercise.descriptionAr = emptyToNull(body.descriptionAr);
    }
    if (body.category !== undefined) {
        exercise.category = body.category;
    }
    if (body.difficulty !== undefined) {
        exercise.difficulty = body.difficulty;
    }
    if (body.equipment !== undefined) {
        exercise.equipment = body.equipment;
    }
    if (body.instructions !== undefined) {
        exercise.instructions = body.instructions;
    }
    if (body.instructionsAr !== undefined) {
        exercise.instructionsAr = body.instructionsAr;
    }
    if (body.commonMistakes !== undefined) {
        exercise.commonMistakes = body.commonMistakes;
    }
    if (body.tags !== undefined) {
        exercise.tags = normalizeTags(body.tags);
    }
    if (body.media !== undefined) {
        applyMediaUpdate(exercise, body.media);
    }
    if (body.muscles !== undefined) {
        const primary = body.muscles.primary;
        const secondary = sanitizeSecondaryMuscles(
            primary,
            body.muscles.secondary || []
        );
        exercise.muscles = { primary, secondary };
    }

    try {
        await exercise.save();
    } catch (err) {
        if (err.code === 11000) {
            throw new ApiError(
                409,
                'An exercise with this slug already exists in your library'
            );
        }
        throw err;
    }

    return toPublicExercise(exercise);
};

export default {
    getExercises,
    getExerciseById,
    createExercise,
    updateExercise,
};
