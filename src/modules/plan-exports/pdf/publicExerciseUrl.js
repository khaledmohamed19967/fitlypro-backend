/**
 * Build public Exercise Library detail URLs for PDF exports.
 * Reusable by any plan-export template (Classic today; Elevate later).
 */

import config from '../../../config/index.js';

/**
 * @param {unknown} value
 * @returns {string|null}
 */
const asNonEmptyString = (value) => {
    if (value == null) return null;
    const text = String(value).trim();
    return text || null;
};

/**
 * Public catalog URL for an exercise referenced in a workout PDF.
 * Only active system exercises are linkable (matches /public/exercises API).
 *
 * @param {{
 *   exerciseId?: unknown,
 *   slug?: unknown,
 *   ownershipType?: unknown,
 *   status?: unknown,
 * }} [exercise]
 * @returns {string|null}
 */
export const buildPublicExerciseUrl = (exercise = {}) => {
    if (exercise.ownershipType !== 'system' || exercise.status !== 'active') {
        return null;
    }

    const slug = asNonEmptyString(exercise.slug);
    const exerciseId = asNonEmptyString(exercise.exerciseId);
    const segment = slug || exerciseId;
    if (!segment) {
        return null;
    }

    const base = asNonEmptyString(config.clientApp?.url);
    if (!base) {
        return null;
    }

    return `${base.replace(/\/+$/, '')}/exercises/${encodeURIComponent(segment)}`;
};
