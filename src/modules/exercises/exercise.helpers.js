/**
 * Exercise Library — pure domain helpers (Phase 1)
 */

/**
 * Convert an English exercise name to a kebab-case slug.
 * Latin letters/digits are kept; other scripts (e.g. Arabic) are preserved as characters.
 * Punctuation and separators collapse to single hyphens.
 *
 * @param {string} name
 * @returns {string}
 */
export const slugifyExerciseName = (name) => {
    if (!name || typeof name !== 'string') {
        return '';
    }

    return name
        .normalize('NFKD')
        .trim()
        .toLowerCase()
        .replace(/[\u0300-\u036f]/g, '') // strip combining marks from Latin accents
        .replace(/[^a-z0-9\u0600-\u06ff]+/gi, '-') // keep Latin + Arabic letters/digits
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
};

/**
 * Normalize tags: trim, lowercase, drop empties, dedupe (order preserved).
 *
 * @param {string[]} tags
 * @returns {string[]}
 */
export const normalizeTags = (tags = []) => {
    if (!Array.isArray(tags)) {
        return [];
    }

    const seen = new Set();
    const result = [];

    for (const tag of tags) {
        if (typeof tag !== 'string') continue;
        const normalized = tag.trim().toLowerCase();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
};

/**
 * Ensure secondary muscles do not include the primary muscle; dedupe.
 *
 * @param {string} primary
 * @param {string[]} secondary
 * @returns {string[]}
 */
export const sanitizeSecondaryMuscles = (primary, secondary = []) => {
    if (!Array.isArray(secondary)) {
        return [];
    }

    const seen = new Set();
    const result = [];

    for (const muscle of secondary) {
        if (!muscle || muscle === primary || seen.has(muscle)) continue;
        seen.add(muscle);
        result.push(muscle);
    }

    return result;
};

/**
 * Public API representation of an Exercise (mirrors User.getPublicProfile id style).
 *
 * @param {import('mongoose').Document|object} exercise
 * @returns {object|null}
 */
export const toPublicExercise = (exercise) => {
    if (!exercise) {
        return null;
    }

    const doc = typeof exercise.toObject === 'function' ? exercise.toObject({ virtuals: true }) : exercise;

    return {
        id: doc._id?.toString?.() ?? doc.id,
        name: doc.name,
        nameAr: doc.nameAr ?? null,
        slug: doc.slug,
        description: doc.description ?? null,
        descriptionAr: doc.descriptionAr ?? null,
        muscles: {
            primary: doc.muscles?.primary,
            secondary: doc.muscles?.secondary ?? [],
        },
        equipment: doc.equipment ?? [],
        category: doc.category,
        difficulty: doc.difficulty,
        instructions: doc.instructions ?? [],
        instructionsAr: doc.instructionsAr ?? [],
        commonMistakes: doc.commonMistakes ?? [],
        media: {
            thumbnailUrl: doc.media?.thumbnailUrl ?? null,
            imageUrls: doc.media?.imageUrls ?? [],
            videoUrl: doc.media?.videoUrl ?? null,
        },
        tags: doc.tags ?? [],
        ownership: {
            type: doc.ownership?.type,
            trainerId: doc.ownership?.trainerId
                ? doc.ownership.trainerId.toString?.() ?? doc.ownership.trainerId
                : null,
        },
        source: {
            type: doc.source?.type ?? 'manual',
            externalProvider: doc.source?.externalProvider ?? null,
            externalId: doc.source?.externalId ?? null,
            duplicatedFromId: doc.source?.duplicatedFromId
                ? doc.source.duplicatedFromId.toString?.() ?? doc.source.duplicatedFromId
                : null,
        },
        status: doc.status,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};

/**
 * Escape user input for safe use inside a RegExp.
 *
 * @param {string} value
 * @returns {string}
 */
export const escapeRegex = (value) =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Mongo filter: system exercises ∪ trainer's own exercises.
 * Authorization still belongs in the service layer.
 *
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @returns {object}
 */
export const buildExerciseVisibilityFilter = (trainerId) => ({
    $or: [
        { 'ownership.type': 'system' },
        {
            'ownership.type': 'trainer',
            'ownership.trainerId': trainerId,
        },
    ],
});
