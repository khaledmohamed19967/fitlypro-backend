import NutritionProfile from './nutrition-profile.model.js';
import { ApiError } from '../../utils/ApiError.js';
import { loadAccessibleClientDocument } from './nutrition-profile.helpers.js';
import {
    enrichNutritionProfilePublic,
    mapNutritionProfileToPublic,
    normalizeProfilePayload,
} from './nutrition-profile.mapper.js';
import { validateHealthOptionIdsForCategory } from '../health-reference/health-reference.helpers.js';
import mongoose from 'mongoose';

/**
 * Validate ID-based selections against the health reference catalog.
 * @param {object} body
 * @param {import('mongoose').Document|null} existingProfile
 */
const validateNutritionProfileOptionIds = async (body, existingProfile) => {
    const existingAllergyIds = (existingProfile?.allergyOptionIds ?? []).map((id) =>
        id.toString()
    );
    const existingDietaryIds = (existingProfile?.dietaryRestrictionOptionIds ?? []).map(
        (id) => id.toString()
    );

    if (body.allergyOptionIds !== undefined) {
        await validateHealthOptionIdsForCategory({
            category: 'allergy',
            requestedIds: body.allergyOptionIds,
            existingIds: existingAllergyIds,
            fieldName: 'allergyOptionIds',
        });
    }

    if (body.dietaryRestrictionOptionIds !== undefined) {
        await validateHealthOptionIdsForCategory({
            category: 'dietary_restriction',
            requestedIds: body.dietaryRestrictionOptionIds,
            existingIds: existingDietaryIds,
            fieldName: 'dietaryRestrictionOptionIds',
        });
    }
};

/**
 * @param {string} clientId
 * @param {string} trainerId
 */
const getNutritionProfile = async (clientId, trainerId) => {
    await loadAccessibleClientDocument(clientId, trainerId);

    const profile = await NutritionProfile.findOne({ clientId });
    if (!profile) {
        return null;
    }

    const mapped = mapNutritionProfileToPublic(profile);
    return enrichNutritionProfilePublic(mapped);
};

/**
 * Create or update the single Nutrition Profile for a client.
 *
 * @param {string} clientId
 * @param {object} body
 * @param {string} trainerId
 */
const upsertNutritionProfile = async (clientId, body, trainerId) => {
    const client = await loadAccessibleClientDocument(clientId, trainerId);

    let profile = await NutritionProfile.findOne({ clientId: client._id });

    await validateNutritionProfileOptionIds(body, profile);

    const payload = normalizeProfilePayload(body);

    if (Object.keys(payload).length === 0) {
        throw new ApiError(400, 'No valid nutrition profile fields provided');
    }

    if (!profile) {
        profile = new NutritionProfile({
            clientId: client._id,
            trainerId,
            allergies: [],
            allergyOptionIds: [],
            dietaryRestrictions: [],
            dietaryRestrictionOptionIds: [],
            foodPreferences: [],
            ...payload,
        });
    } else {
        Object.assign(profile, payload);
        profile.trainerId = trainerId;
    }

    await profile.save();
    const mapped = mapNutritionProfileToPublic(profile);
    return enrichNutritionProfilePublic(mapped);
};

/**
 * Initial nutrition profile write during client creation (same rules as upsert).
 *
 * @param {string} clientId
 * @param {string} trainerId
 * @param {object} body
 */
const createNutritionProfileForNewClient = async (clientId, trainerId, body) => {
    await validateNutritionProfileOptionIds(body, null);
    const payload = normalizeProfilePayload(body);

    if (Object.keys(payload).length === 0) {
        return null;
    }

    const profile = await NutritionProfile.create({
        clientId: new mongoose.Types.ObjectId(clientId),
        trainerId,
        allergies: [],
        allergyOptionIds: [],
        dietaryRestrictions: [],
        dietaryRestrictionOptionIds: [],
        foodPreferences: [],
        ...payload,
    });

    const mapped = mapNutritionProfileToPublic(profile);
    return enrichNutritionProfilePublic(mapped);
};

export default {
    getNutritionProfile,
    upsertNutritionProfile,
    createNutritionProfileForNewClient,
};
