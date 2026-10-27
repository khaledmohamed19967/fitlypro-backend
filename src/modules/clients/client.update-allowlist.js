/**
 * Explicit allowlists for trainer-driven client updates (User + nutrition profile).
 * Request bodies are validated with Joi first; only these keys are applied to models.
 */

/** @type {readonly string[]} */
export const CLIENT_PERSONAL_UPDATE_FIELDS = [
    'firstName',
    'lastName',
    'phone',
    'dateOfBirth',
    'gender',
];

/** @type {readonly string[]} */
export const CLIENT_FITNESS_UPDATE_FIELDS = [
    'primaryFitnessGoal',
    'currentWeight',
    'targetWeight',
    'height',
    'experienceLevel',
];

/** @type {readonly string[]} */
export const CLIENT_PROGRAM_UPDATE_FIELDS = [
    'programType',
    'sessionsPerWeek',
    'startDate',
    'packageDuration',
    'endDate',
    'additionalNotes',
];

/** @type {readonly string[]} */
export const CLIENT_HEALTH_USER_UPDATE_FIELDS = [
    'medicalConditions',
    'injuries',
];

/** @type {readonly string[]} */
export const CLIENT_NUTRITION_PROFILE_UPDATE_FIELDS = [
    'allergyOptionIds',
    'dietaryRestrictionOptionIds',
    'allergies',
    'dietaryRestrictions',
];

export const CLIENT_PLAN_UPDATE_FIELDS = [
    ...CLIENT_FITNESS_UPDATE_FIELDS,
    ...CLIENT_PROGRAM_UPDATE_FIELDS,
];

export const CLIENT_FULL_UPDATE_FIELDS = [
    ...CLIENT_PERSONAL_UPDATE_FIELDS,
    ...CLIENT_FITNESS_UPDATE_FIELDS,
    ...CLIENT_PROGRAM_UPDATE_FIELDS,
    ...CLIENT_HEALTH_USER_UPDATE_FIELDS,
];

/**
 * @param {Record<string, unknown>} source
 * @param {readonly string[]} allowedKeys
 */
export const pickAllowedUpdateFields = (source, allowedKeys) => {
    const patch = {};
    for (const key of allowedKeys) {
        if (source[key] !== undefined) {
            patch[key] = source[key];
        }
    }
    return patch;
};
