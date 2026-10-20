/**
 * Nutrition Profile mappers
 */

import mongoose from 'mongoose';
import {
    computeUnmappedLegacyStrings,
    dedupeObjectIdStrings,
    loadHealthOptionsMap,
    mapOrderedHealthOptions,
} from '../health-reference/health-reference.helpers.js';

const toIdString = (id) => (id != null ? id.toString?.() ?? String(id) : null);

const trimStringList = (list) =>
    (Array.isArray(list) ? list : [])
        .map((s) => String(s).trim())
        .filter(Boolean);

const mapOptionIdList = (list) =>
    (Array.isArray(list) ? list : []).map((id) => toIdString(id)).filter(Boolean);

/**
 * @param {import('mongoose').Document|object} doc
 */
export const mapNutritionProfileToPublic = (doc) => {
    if (!doc) return null;
    const plain = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc;

    return {
        id: toIdString(plain._id ?? plain.id),
        clientId: toIdString(plain.clientId),
        trainerId: toIdString(plain.trainerId),
        activityLevel: plain.activityLevel ?? null,
        allergies: plain.allergies ?? [],
        allergyOptionIds: mapOptionIdList(plain.allergyOptionIds),
        dietaryRestrictions: plain.dietaryRestrictions ?? [],
        dietaryRestrictionOptionIds: mapOptionIdList(plain.dietaryRestrictionOptionIds),
        foodPreferences: plain.foodPreferences ?? [],
        notes: plain.notes ?? null,
        createdAt: plain.createdAt,
        updatedAt: plain.updatedAt,
    };
};

/**
 * Hydrate catalog selections and legacy unmapped strings for edit/display.
 * @param {object|null} publicProfile — from mapNutritionProfileToPublic
 */
export const enrichNutritionProfilePublic = async (publicProfile) => {
    if (!publicProfile) {
        return publicProfile;
    }

    const allergyIds = publicProfile.allergyOptionIds ?? [];
    const dietaryIds = publicProfile.dietaryRestrictionOptionIds ?? [];
    const optionMap = await loadHealthOptionsMap([...allergyIds, ...dietaryIds]);

    const allergyOptions = mapOrderedHealthOptions(allergyIds, optionMap);
    const dietaryRestrictionOptions = mapOrderedHealthOptions(dietaryIds, optionMap);

    return {
        ...publicProfile,
        allergyOptions,
        dietaryRestrictionOptions,
        unmappedAllergies: computeUnmappedLegacyStrings(
            publicProfile.allergies,
            allergyOptions
        ),
        unmappedDietaryRestrictions: computeUnmappedLegacyStrings(
            publicProfile.dietaryRestrictions,
            dietaryRestrictionOptions
        ),
    };
};

/**
 * Normalize string-list fields from request body.
 * Option ID arrays are deduped; existence/category validation runs in the service.
 */
export const normalizeProfilePayload = (body = {}) => {
    const payload = {};

    if (body.activityLevel !== undefined) {
        payload.activityLevel = body.activityLevel || null;
    }
    if (body.allergies !== undefined) {
        payload.allergies = trimStringList(body.allergies);
    }
    if (body.allergyOptionIds !== undefined) {
        payload.allergyOptionIds = dedupeObjectIdStrings(body.allergyOptionIds).map(
            (id) => new mongoose.Types.ObjectId(id)
        );
    }
    if (body.dietaryRestrictions !== undefined) {
        payload.dietaryRestrictions = trimStringList(body.dietaryRestrictions);
    }
    if (body.dietaryRestrictionOptionIds !== undefined) {
        payload.dietaryRestrictionOptionIds = dedupeObjectIdStrings(
            body.dietaryRestrictionOptionIds
        ).map((id) => new mongoose.Types.ObjectId(id));
    }
    if (body.foodPreferences !== undefined) {
        payload.foodPreferences = trimStringList(body.foodPreferences);
    }
    if (body.notes !== undefined) {
        payload.notes = body.notes === '' || body.notes == null ? null : String(body.notes).trim();
    }

    return payload;
};
