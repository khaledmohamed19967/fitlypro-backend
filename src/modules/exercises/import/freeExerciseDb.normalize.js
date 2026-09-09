/**
 * Free Exercise DB normalization (Phase 3B).
 * Pure transforms — no MongoDB I/O.
 */

import {
    slugifyExerciseName,
    normalizeTags,
    sanitizeSecondaryMuscles,
} from '../exercise.helpers.js';
import {
    EXTERNAL_PROVIDER,
    MEDIA_BASE_URL,
    MUSCLE_MAP,
    UNSUPPORTED_MUSCLES,
    EQUIPMENT_MAP,
    UNSUPPORTED_EQUIPMENT,
    CATEGORY_MAP,
    DIFFICULTY_MAP,
    FORCE_TAGS,
    MECHANIC_TAGS,
    REJECTION,
    WARNING,
} from './freeExerciseDb.mappings.js';

const MAX_INSTRUCTION_LEN = 500;
const MAX_INSTRUCTIONS = 30;
const MAX_TAGS = 20;

/**
 * @param {string} sourceMuscle
 * @returns {{ value: string|null, unsupported: boolean, traps: boolean }}
 */
export const normalizeMuscle = (sourceMuscle) => {
    if (!sourceMuscle || typeof sourceMuscle !== 'string') {
        return { value: null, unsupported: true, traps: false };
    }
    const key = sourceMuscle.trim().toLowerCase();
    if (UNSUPPORTED_MUSCLES.has(key)) {
        return { value: null, unsupported: true, traps: false };
    }
    if (key === 'traps') {
        return { value: 'back', unsupported: false, traps: true };
    }
    const mapped = MUSCLE_MAP[key];
    if (!mapped) {
        return { value: null, unsupported: true, traps: false };
    }
    return { value: mapped, unsupported: false, traps: false };
};

/**
 * @param {string|null|undefined} sourceEquipment
 * @param {{ category?: string, name?: string }} ctx
 */
export const normalizeEquipment = (sourceEquipment, ctx = {}) => {
    const warnings = [];
    const tags = [];

    if (sourceEquipment == null || sourceEquipment === '') {
        const category = ctx.category;
        const name = ctx.name || '';
        const clearlyBodyweight =
            /\bbody[\s-]?weight\b/i.test(name) ||
            /\bpush[\s-]?ups?\b/i.test(name) ||
            /\bpull[\s-]?ups?\b/i.test(name) ||
            /\bchin[\s-]?ups?\b/i.test(name) ||
            /\binverted[\s-]?rows?\b/i.test(name);
        const autoCategories = category === 'stretching' || category === 'plyometrics';

        if (autoCategories || clearlyBodyweight) {
            warnings.push({
                code: WARNING.WARNING_NULL_EQUIPMENT_NORMALIZED,
                message: 'equipment → bodyweight',
            });
            return { equipment: ['bodyweight'], warnings, tags, reject: null };
        }

        warnings.push({
            code: WARNING.WARNING_NULL_EQUIPMENT,
            message: 'equipment is null and cannot be auto-normalized',
        });
        return {
            equipment: null,
            warnings,
            tags,
            reject: REJECTION.NULL_EQUIPMENT,
        };
    }

    const key = String(sourceEquipment).trim().toLowerCase();

    if (UNSUPPORTED_EQUIPMENT.has(key)) {
        return {
            equipment: null,
            warnings,
            tags,
            reject: REJECTION.UNSUPPORTED_EQUIPMENT,
        };
    }

    if (key === 'e-z curl bar') {
        warnings.push({
            code: WARNING.WARNING_AMBIGUOUS_EQUIPMENT,
            message: 'e-z curl bar → barbell',
        });
        tags.push('ez-bar');
        return { equipment: ['barbell'], warnings, tags, reject: null };
    }

    const mapped = EQUIPMENT_MAP[key];
    if (!mapped) {
        return {
            equipment: null,
            warnings,
            tags,
            reject: REJECTION.UNSUPPORTED_EQUIPMENT,
        };
    }

    return { equipment: [mapped], warnings, tags, reject: null };
};

export const normalizeCategory = (sourceCategory) => {
    if (!sourceCategory || typeof sourceCategory !== 'string') {
        return { category: null, specialtyTag: null, reject: REJECTION.INVALID_CATEGORY, warnings: [] };
    }
    const key = sourceCategory.trim().toLowerCase();
    const mapped = CATEGORY_MAP[key];
    if (!mapped) {
        return { category: null, specialtyTag: null, reject: REJECTION.INVALID_CATEGORY, warnings: [] };
    }
    const warnings = [];
    if (mapped.specialtyTag) {
        warnings.push({
            code: WARNING.WARNING_SPECIALTY_CATEGORY,
            message: `${key} → strength (+ tag ${mapped.specialtyTag})`,
        });
    }
    return {
        category: mapped.category,
        specialtyTag: mapped.specialtyTag,
        reject: null,
        warnings,
    };
};

export const normalizeDifficulty = (sourceLevel) => {
    if (!sourceLevel || typeof sourceLevel !== 'string') {
        return { difficulty: null, reject: REJECTION.INVALID_DIFFICULTY };
    }
    const key = sourceLevel.trim().toLowerCase();
    const mapped = DIFFICULTY_MAP[key];
    if (!mapped) {
        return { difficulty: null, reject: REJECTION.INVALID_DIFFICULTY };
    }
    return { difficulty: mapped, reject: null };
};

/**
 * Split a long instruction on sentence boundaries; truncate only if unavoidable.
 */
export const normalizeInstructions = (instructions) => {
    const warnings = [];
    const out = [];

    if (!Array.isArray(instructions) || instructions.length === 0) {
        return { instructions: [], warnings };
    }

    for (const step of instructions) {
        if (typeof step !== 'string') continue;
        const trimmed = step.trim();
        if (!trimmed) continue;

        if (trimmed.length <= MAX_INSTRUCTION_LEN) {
            out.push(trimmed);
            continue;
        }

        const parts = splitLongStep(trimmed);
        if (parts.length > 1) {
            warnings.push({
                code: WARNING.WARNING_INSTRUCTION_SPLIT,
                message: `split instruction (${trimmed.length} chars → ${parts.length} steps)`,
            });
        }

        for (const part of parts) {
            if (part.length <= MAX_INSTRUCTION_LEN) {
                out.push(part);
            } else {
                out.push(part.slice(0, MAX_INSTRUCTION_LEN));
                warnings.push({
                    code: WARNING.WARNING_INSTRUCTION_TRUNCATED,
                    message: `truncated instruction step to ${MAX_INSTRUCTION_LEN} chars`,
                });
            }
        }
    }

    return {
        instructions: out.slice(0, MAX_INSTRUCTIONS),
        warnings,
    };
};

const splitLongStep = (text) => {
    if (text.length <= MAX_INSTRUCTION_LEN) return [text];

    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
    if (!sentences || sentences.length <= 1) {
        return chunkByLength(text, MAX_INSTRUCTION_LEN);
    }

    const parts = [];
    let current = '';
    for (const sentence of sentences) {
        const s = sentence.trim();
        if (!s) continue;
        if (s.length > MAX_INSTRUCTION_LEN) {
            if (current) {
                parts.push(current.trim());
                current = '';
            }
            parts.push(...chunkByLength(s, MAX_INSTRUCTION_LEN));
            continue;
        }
        const candidate = current ? `${current} ${s}` : s;
        if (candidate.length <= MAX_INSTRUCTION_LEN) {
            current = candidate;
        } else {
            if (current) parts.push(current.trim());
            current = s;
        }
    }
    if (current) parts.push(current.trim());
    return parts.filter(Boolean);
};

const chunkByLength = (text, max) => {
    const chunks = [];
    for (let i = 0; i < text.length; i += max) {
        chunks.push(text.slice(i, i + max));
    }
    return chunks;
};

export const normalizeMedia = (images) => {
    const imageUrls = [];
    if (Array.isArray(images)) {
        for (const rel of images) {
            if (typeof rel !== 'string' || !rel.trim()) continue;
            const path = rel.trim().replace(/^\/+/, '');
            imageUrls.push(`${MEDIA_BASE_URL}/${path}`);
        }
    }

    return {
        thumbnailUrl: imageUrls[0] || null,
        imageUrls: imageUrls.slice(0, 10),
        videoUrl: null,
    };
};

/**
 * Normalize one Free Exercise DB record into a FitlyPro document payload (no slug resolution yet).
 *
 * @returns {{ ok: true, doc: object, warnings: object[], stats: object } | { ok: false, reject: string, detail: string, warnings: object[] }}
 */
export const normalizeExercise = (source) => {
    const warnings = [];
    const extraTags = [];
    const stats = {
        muscleMapped: false,
        equipmentMapped: false,
        categoryMapped: false,
        difficultyMapped: false,
        tagsAdded: 0,
    };

    const name = typeof source?.name === 'string' ? source.name.trim() : '';
    if (name.length < 2 || name.length > 120) {
        return {
            ok: false,
            reject: REJECTION.INVALID_NAME,
            detail: `name="${source?.name}"`,
            warnings,
        };
    }

    const externalId = typeof source?.id === 'string' ? source.id.trim() : '';
    if (!externalId) {
        return {
            ok: false,
            reject: REJECTION.VALIDATION_FAILED,
            detail: 'missing source id',
            warnings,
        };
    }

    // Category first (needed for null-equipment policy)
    const categoryResult = normalizeCategory(source.category);
    warnings.push(...categoryResult.warnings);
    if (categoryResult.reject) {
        return {
            ok: false,
            reject: categoryResult.reject,
            detail: `category=${source.category}`,
            warnings,
        };
    }
    if (categoryResult.specialtyTag) {
        extraTags.push(categoryResult.specialtyTag);
        stats.categoryMapped = true;
    } else if (source.category !== categoryResult.category) {
        stats.categoryMapped = true;
    }

    const difficultyResult = normalizeDifficulty(source.level);
    if (difficultyResult.reject) {
        return {
            ok: false,
            reject: difficultyResult.reject,
            detail: `level=${source.level}`,
            warnings,
        };
    }
    if (source.level === 'expert') stats.difficultyMapped = true;

    const primaries = Array.isArray(source.primaryMuscles) ? source.primaryMuscles : [];
    if (primaries.length === 0) {
        return {
            ok: false,
            reject: REJECTION.MISSING_PRIMARY_MUSCLE,
            detail: 'primaryMuscles empty',
            warnings,
        };
    }

    const primarySource = primaries[0];
    const primaryNorm = normalizeMuscle(primarySource);
    if (primaryNorm.unsupported || !primaryNorm.value) {
        return {
            ok: false,
            reject: REJECTION.UNSUPPORTED_PRIMARY_MUSCLE,
            detail: `primaryMuscle = ${primarySource}`,
            warnings,
        };
    }
    if (primarySource !== primaryNorm.value) stats.muscleMapped = true;
    if (primaryNorm.traps) {
        extraTags.push('traps');
        warnings.push({
            code: WARNING.WARNING_TRAPS_NORMALIZED,
            message: 'traps → back',
        });
        stats.muscleMapped = true;
    }

    const secondary = [];
    const secondaries = Array.isArray(source.secondaryMuscles) ? source.secondaryMuscles : [];
    for (const sec of secondaries) {
        const norm = normalizeMuscle(sec);
        if (norm.unsupported || !norm.value) {
            warnings.push({
                code: WARNING.WARNING_UNSUPPORTED_SECONDARY_DROPPED,
                message: `dropped secondary muscle ${sec}`,
            });
            continue;
        }
        if (sec !== norm.value) stats.muscleMapped = true;
        if (norm.traps) {
            extraTags.push('traps');
            warnings.push({
                code: WARNING.WARNING_TRAPS_NORMALIZED,
                message: 'traps → back (secondary)',
            });
        }
        secondary.push(norm.value);
    }

    const equipmentResult = normalizeEquipment(source.equipment, {
        category: source.category,
        name,
    });
    warnings.push(...equipmentResult.warnings);
    extraTags.push(...equipmentResult.tags);
    if (equipmentResult.reject) {
        return {
            ok: false,
            reject: equipmentResult.reject,
            detail: `equipment = ${source.equipment}`,
            warnings,
        };
    }
    if (
        source.equipment == null ||
        String(source.equipment).toLowerCase() !== equipmentResult.equipment[0]
    ) {
        stats.equipmentMapped = true;
    }

    const instr = normalizeInstructions(source.instructions);
    warnings.push(...instr.warnings);

    if (source.force && FORCE_TAGS.has(String(source.force).toLowerCase())) {
        extraTags.push(String(source.force).toLowerCase());
    }
    if (source.mechanic && MECHANIC_TAGS.has(String(source.mechanic).toLowerCase())) {
        extraTags.push(String(source.mechanic).toLowerCase());
    }

    const tags = normalizeTags(extraTags).slice(0, MAX_TAGS);
    stats.tagsAdded = tags.length;

    const baseSlug = slugifyExerciseName(name);
    if (!baseSlug) {
        return {
            ok: false,
            reject: REJECTION.INVALID_SLUG,
            detail: `could not slugify "${name}"`,
            warnings,
        };
    }

    const doc = {
        name,
        slug: baseSlug,
        description: null,
        muscles: {
            primary: primaryNorm.value,
            secondary: sanitizeSecondaryMuscles(primaryNorm.value, secondary),
        },
        equipment: equipmentResult.equipment,
        category: categoryResult.category,
        difficulty: difficultyResult.difficulty,
        instructions: instr.instructions,
        commonMistakes: [],
        media: normalizeMedia(source.images),
        tags,
        ownership: {
            type: 'system',
            trainerId: null,
        },
        source: {
            type: 'import',
            externalProvider: EXTERNAL_PROVIDER,
            externalId,
            duplicatedFromId: null,
        },
        status: 'active',
    };

    return { ok: true, doc, warnings, stats, baseSlug };
};

export const buildExerciseDocument = normalizeExercise;
