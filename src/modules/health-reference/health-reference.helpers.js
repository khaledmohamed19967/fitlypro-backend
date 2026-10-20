import mongoose from 'mongoose';
import HealthReferenceOption from './health-reference.model.js';
import { ApiError } from '../../utils/ApiError.js';
import { HEALTH_REFERENCE_CATEGORIES } from './health-reference.constants.js';

export const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

/**
 * Dedupe ObjectId strings preserving first occurrence order.
 * @param {string[]|undefined} ids
 * @returns {string[]}
 */
export const dedupeObjectIdStrings = (ids) => {
    if (!Array.isArray(ids)) {
        return [];
    }
    const seen = new Set();
    const out = [];
    for (const raw of ids) {
        const id = String(raw);
        if (!isValidObjectId(id) || seen.has(id)) {
            continue;
        }
        seen.add(id);
        out.push(id);
    }
    return out;
};

/**
 * @param {import('mongoose').Document|object|null|undefined} option
 */
export const mapHealthReferenceOptionToPublic = (option) => {
    if (!option) {
        return null;
    }
    const plain =
        typeof option.toObject === 'function'
            ? option.toObject({ virtuals: true })
            : option;

    return {
        id: String(plain._id ?? plain.id),
        code: plain.code,
        label: plain.label,
        category: plain.category,
    };
};

/**
 * Map ordered option ids to public option objects (missing ids omitted).
 * @param {string[]} orderedIds
 * @param {Map<string, object>} byId
 */
export const mapOrderedHealthOptions = (orderedIds, byId) => {
    if (!Array.isArray(orderedIds)) {
        return [];
    }
    const options = [];
    for (const id of orderedIds) {
        const key = String(id);
        const doc = byId.get(key);
        if (doc) {
            options.push(mapHealthReferenceOptionToPublic(doc));
        }
    }
    return options;
};

/**
 * Load options by id into a Map keyed by id string.
 * @param {string[]} ids
 */
export const loadHealthOptionsMap = async (ids) => {
    const unique = dedupeObjectIdStrings(ids);
    if (unique.length === 0) {
        return new Map();
    }

    const docs = await HealthReferenceOption.find({ _id: { $in: unique } });
    const map = new Map();
    for (const doc of docs) {
        map.set(doc._id.toString(), doc);
    }
    return map;
};

/**
 * Validate selections for one category.
 *
 * @param {object} params
 * @param {string} params.category
 * @param {string[]|undefined} params.requestedIds
 * @param {string[]|undefined} params.existingIds — retained inactive allowed
 * @param {string} params.fieldName — API error field path
 * @returns {Promise<string[]>} validated id strings
 */
export const validateHealthOptionIdsForCategory = async ({
    category,
    requestedIds,
    existingIds = [],
    fieldName,
}) => {
    if (requestedIds === undefined) {
        return undefined;
    }

    const errors = [];
    for (const id of requestedIds) {
        if (!isValidObjectId(id)) {
            errors.push({
                field: fieldName,
                message: 'Must be a valid ObjectId',
            });
        }
    }
    if (errors.length) {
        throw new ApiError(400, 'Validation failed', errors);
    }

    const normalized = dedupeObjectIdStrings(requestedIds);
    const existingSet = new Set(
        dedupeObjectIdStrings(existingIds).map(String)
    );

    if (normalized.length === 0) {
        return [];
    }

    const dupCount = Array.isArray(requestedIds) ? requestedIds.length : 0;
    if (dupCount !== normalized.length) {
        throw new ApiError(400, 'Validation failed', [
            {
                field: fieldName,
                message: 'IDs must be unique',
            },
        ]);
    }

    const docs = await HealthReferenceOption.find({
        _id: { $in: normalized },
    });

    const byId = new Map(docs.map((d) => [d._id.toString(), d]));

    for (const id of normalized) {
        const doc = byId.get(id);
        if (!doc) {
            throw new ApiError(400, 'Validation failed', [
                {
                    field: fieldName,
                    message: `Unknown health reference option: ${id}`,
                },
            ]);
        }
        if (doc.category !== category) {
            throw new ApiError(400, 'Validation failed', [
                {
                    field: fieldName,
                    message: `Option ${id} is not a ${category} reference`,
                },
            ]);
        }
        if (doc.status === 'inactive' && !existingSet.has(id)) {
            throw new ApiError(400, 'Validation failed', [
                {
                    field: fieldName,
                    message: `Option ${doc.code} is inactive and cannot be newly selected`,
                },
            ]);
        }
    }

    return normalized;
};

/**
 * Legacy string labels with no catalog match (for display of custom / unmigrated values).
 * @param {string[]} legacyStrings
 * @param {Array<{ code: string, label: string }>} selectedOptions
 */
export const computeUnmappedLegacyStrings = (legacyStrings, selectedOptions) => {
    if (!Array.isArray(legacyStrings) || legacyStrings.length === 0) {
        return [];
    }

    const known = new Set();
    for (const opt of selectedOptions ?? []) {
        known.add(String(opt.code).toLowerCase());
        known.add(String(opt.label).toLowerCase());
    }

    return legacyStrings.filter((raw) => {
        const trimmed = String(raw).trim();
        if (!trimmed) {
            return false;
        }
        const lower = trimmed.toLowerCase();
        const asCode = lower.replace(/\s+/g, '_').replace(/-/g, '_');
        return !known.has(lower) && !known.has(asCode);
    });
};

/**
 * @param {object} publicProfile — from getPublicProfile()
 */
export const enrichClientPublicProfileWithInjuryAreas = async (publicProfile) => {
    if (!publicProfile) {
        return publicProfile;
    }

    const ids = publicProfile.injuryAreaOptionIds ?? [];
    const map = await loadHealthOptionsMap(ids);
    const injuryAreaOptions = mapOrderedHealthOptions(ids, map);

    return {
        ...publicProfile,
        injuryAreaOptions,
    };
};

export { HEALTH_REFERENCE_CATEGORIES };
