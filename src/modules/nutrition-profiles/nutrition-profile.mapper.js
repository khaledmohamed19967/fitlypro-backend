/**
 * Nutrition Profile mappers
 */

const toIdString = (id) => (id != null ? id.toString?.() ?? String(id) : null);

const trimStringList = (list) =>
    (Array.isArray(list) ? list : [])
        .map((s) => String(s).trim())
        .filter(Boolean);

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
        dietaryRestrictions: plain.dietaryRestrictions ?? [],
        foodPreferences: plain.foodPreferences ?? [],
        notes: plain.notes ?? null,
        createdAt: plain.createdAt,
        updatedAt: plain.updatedAt,
    };
};

/**
 * Normalize string-list fields from request body.
 */
export const normalizeProfilePayload = (body = {}) => {
    const payload = {};

    if (body.activityLevel !== undefined) {
        payload.activityLevel = body.activityLevel || null;
    }
    if (body.allergies !== undefined) {
        payload.allergies = trimStringList(body.allergies);
    }
    if (body.dietaryRestrictions !== undefined) {
        payload.dietaryRestrictions = trimStringList(body.dietaryRestrictions);
    }
    if (body.foodPreferences !== undefined) {
        payload.foodPreferences = trimStringList(body.foodPreferences);
    }
    if (body.notes !== undefined) {
        payload.notes = body.notes === '' || body.notes == null ? null : String(body.notes).trim();
    }

    return payload;
};
