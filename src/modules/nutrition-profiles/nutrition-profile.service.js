import NutritionProfile from './nutrition-profile.model.js';
import { ApiError } from '../../utils/ApiError.js';
import { loadAccessibleClientDocument } from './nutrition-profile.helpers.js';
import {
    mapNutritionProfileToPublic,
    normalizeProfilePayload,
} from './nutrition-profile.mapper.js';

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

    return mapNutritionProfileToPublic(profile);
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
    const payload = normalizeProfilePayload(body);

    if (Object.keys(payload).length === 0) {
        throw new ApiError(400, 'No valid nutrition profile fields provided');
    }

    let profile = await NutritionProfile.findOne({ clientId: client._id });

    if (!profile) {
        profile = new NutritionProfile({
            clientId: client._id,
            trainerId,
            allergies: [],
            dietaryRestrictions: [],
            foodPreferences: [],
            ...payload,
        });
    } else {
        Object.assign(profile, payload);
        profile.trainerId = trainerId;
    }

    await profile.save();
    return mapNutritionProfileToPublic(profile);
};

export default {
    getNutritionProfile,
    upsertNutritionProfile,
};
