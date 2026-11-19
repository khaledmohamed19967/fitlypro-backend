import mongoose from 'mongoose';
import Exercise from './exercise.model.js';
import { escapeRegex, toPublicExercise } from './exercise.helpers.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginateCollection } from '../../utils/pagination.js';

const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

/**
 * Catalog DTO for anonymous visitors — never includes trainerId or import internals.
 *
 * @param {import('mongoose').Document|object} exercise
 */
export const toCatalogExercise = (exercise) => {
    const pub = toPublicExercise(exercise);
    if (!pub) return null;

    return {
        id: pub.id,
        name: pub.name,
        nameAr: pub.nameAr,
        slug: pub.slug,
        description: pub.description,
        descriptionAr: pub.descriptionAr,
        muscles: pub.muscles,
        equipment: pub.equipment,
        category: pub.category,
        difficulty: pub.difficulty,
        instructions: pub.instructions,
        instructionsAr: pub.instructionsAr,
        commonMistakes: pub.commonMistakes,
        media: pub.media,
        tags: pub.tags,
        ownership: { type: 'system' },
        status: pub.status,
        createdAt: pub.createdAt,
        updatedAt: pub.updatedAt,
    };
};

const SYSTEM_ACTIVE = Object.freeze({
    'ownership.type': 'system',
    status: 'active',
});

/**
 * @param {object} query - validated public query
 */
const buildPublicListFilter = (query) => {
    const { search, primaryMuscle, equipment, difficulty, category } = query;
    const conditions = [{ ...SYSTEM_ACTIVE }];

    if (primaryMuscle) conditions.push({ 'muscles.primary': primaryMuscle });
    if (equipment) conditions.push({ equipment });
    if (difficulty) conditions.push({ difficulty });
    if (category) conditions.push({ category });

    if (search && String(search).trim()) {
        const tokens = String(search).trim().split(/\s+/).filter(Boolean);
        for (const t of tokens) {
            const tokenRegex = new RegExp(escapeRegex(t), 'i');
            conditions.push({
                $or: [{ name: tokenRegex }, { nameAr: tokenRegex }, { tags: tokenRegex }],
            });
        }
    }

    return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

/**
 * Public catalog list — active system exercises only.
 *
 * @param {object} query
 */
export const listPublicExercises = async (query) => {
    const filter = buildPublicListFilter(query);
    const { docs, pagination } = await paginateCollection({
        model: Exercise,
        filter,
        sort: { createdAt: -1 },
        page: query.page,
        limit: query.limit,
    });

    return {
        exercises: docs.map((exercise) => toCatalogExercise(exercise)),
        pagination,
    };
};

/**
 * Public catalog detail by Mongo id or system slug.
 *
 * @param {string} idOrSlug
 */
export const getPublicExercise = async (idOrSlug) => {
    const key = String(idOrSlug ?? '').trim();
    if (!key) {
        throw new ApiError(400, 'Invalid exercise identifier');
    }

    const filter = { ...SYSTEM_ACTIVE };
    if (isValidObjectId(key)) {
        filter._id = key;
    } else {
        filter.slug = key;
    }

    const exercise = await Exercise.findOne(filter);
    if (!exercise) {
        throw new ApiError(404, 'Exercise not found');
    }

    return toCatalogExercise(exercise);
};

export default {
    listPublicExercises,
    getPublicExercise,
    toCatalogExercise,
};
