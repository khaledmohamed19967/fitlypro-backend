import Joi from 'joi';
import {
    MUSCLES,
    EQUIPMENT,
    DIFFICULTIES,
    CATEGORIES,
    OWNERSHIP_FILTERS,
    EXERCISE_STATUSES,
} from './exercise.constants.js';

/**
 * Exercise validation schemas (Joi)
 * Body schemas are intended for use with existing `validate()` middleware.
 * Query schema is exported for Phase 2; no query middleware in Phase 1.
 */

const mediaSchema = Joi.object({
    thumbnailUrl: Joi.string().uri().allow(null, '').optional(),
    imageUrls: Joi.array().items(Joi.string().uri()).max(10).optional(),
    videoUrl: Joi.string().uri().allow(null, '').optional(),
}).optional();

const musclesSchema = Joi.object({
    primary: Joi.string()
        .valid(...MUSCLES)
        .required()
        .messages({
            'any.only': 'Primary muscle must be a valid muscle value',
            'any.required': 'Primary muscle is required',
        }),
    secondary: Joi.array()
        .items(Joi.string().valid(...MUSCLES))
        .unique()
        .optional()
        .messages({
            'array.unique': 'Secondary muscles must not contain duplicates',
        }),
}).custom((value, helpers) => {
    if (value.secondary?.includes(value.primary)) {
        return helpers.error('muscles.secondaryIncludesPrimary');
    }
    return value;
}).messages({
    'muscles.secondaryIncludesPrimary': 'Secondary muscles must not include the primary muscle',
});

const stringList = (maxItems, maxLength) =>
    Joi.array().items(Joi.string().trim().max(maxLength)).max(maxItems).optional();

const tagsSchema = Joi.array()
    .items(Joi.string().trim().lowercase().max(40))
    .max(20)
    .unique()
    .optional();

const equipmentSchema = Joi.array()
    .items(Joi.string().valid(...EQUIPMENT))
    .min(1)
    .unique()
    .required()
    .messages({
        'array.min': 'At least one equipment value is required',
        'any.required': 'Equipment is required',
    });

const forbiddenServerFields = {
    slug: Joi.forbidden(),
    ownership: Joi.forbidden(),
    source: Joi.forbidden(),
    status: Joi.forbidden(),
};

/**
 * Create exercise — client content fields only
 */
export const validateCreateExercise = Joi.object({
    name: Joi.string().trim().min(2).max(120).required().messages({
        'string.min': 'Name must be at least 2 characters',
        'string.max': 'Name cannot exceed 120 characters',
        'any.required': 'Name is required',
    }),
    nameAr: Joi.string().trim().max(120).optional().allow('', null),
    description: Joi.string().trim().max(2000).optional().allow('', null),
    descriptionAr: Joi.string().trim().max(2000).optional().allow('', null),
    muscles: musclesSchema.required(),
    equipment: equipmentSchema,
    category: Joi.string()
        .valid(...CATEGORIES)
        .required()
        .messages({
            'any.only': 'Category must be a valid category value',
            'any.required': 'Category is required',
        }),
    difficulty: Joi.string()
        .valid(...DIFFICULTIES)
        .required()
        .messages({
            'any.only': 'Difficulty must be beginner, intermediate, or advanced',
            'any.required': 'Difficulty is required',
        }),
    instructions: stringList(30, 500),
    instructionsAr: stringList(30, 500),
    commonMistakes: stringList(20, 500),
    media: mediaSchema,
    tags: tagsSchema,
    ...forbiddenServerFields,
});

/**
 * Update exercise — all content fields optional; server fields forbidden
 */
export const validateUpdateExercise = Joi.object({
    name: Joi.string().trim().min(2).max(120).optional(),
    nameAr: Joi.string().trim().max(120).optional().allow('', null),
    description: Joi.string().trim().max(2000).optional().allow('', null),
    descriptionAr: Joi.string().trim().max(2000).optional().allow('', null),
    muscles: Joi.object({
        primary: Joi.string()
            .valid(...MUSCLES)
            .required(),
        secondary: Joi.array()
            .items(Joi.string().valid(...MUSCLES))
            .unique()
            .optional(),
    })
        .custom((value, helpers) => {
            if (value.secondary?.includes(value.primary)) {
                return helpers.error('muscles.secondaryIncludesPrimary');
            }
            return value;
        })
        .messages({
            'muscles.secondaryIncludesPrimary':
                'Secondary muscles must not include the primary muscle',
        })
        .optional(),
    equipment: Joi.array()
        .items(Joi.string().valid(...EQUIPMENT))
        .min(1)
        .unique()
        .optional(),
    category: Joi.string()
        .valid(...CATEGORIES)
        .optional(),
    difficulty: Joi.string()
        .valid(...DIFFICULTIES)
        .optional(),
    instructions: stringList(30, 500),
    instructionsAr: stringList(30, 500),
    commonMistakes: stringList(20, 500),
    media: mediaSchema,
    tags: tagsSchema,
    ...forbiddenServerFields,
}).min(1);

/**
 * Duplicate exercise — optional name override only
 */
export const validateDuplicateExercise = Joi.object({
    name: Joi.string().trim().min(2).max(120).optional(),
    ...forbiddenServerFields,
});

/**
 * List/search query schema (Phase 2 will wire this; no middleware in Phase 1)
 */
export const validateExerciseQuery = Joi.object({
    search: Joi.string().trim().max(100).optional().allow(''),
    primaryMuscle: Joi.string()
        .valid(...MUSCLES)
        .optional(),
    equipment: Joi.string()
        .valid(...EQUIPMENT)
        .optional(),
    difficulty: Joi.string()
        .valid(...DIFFICULTIES)
        .optional(),
    category: Joi.string()
        .valid(...CATEGORIES)
        .optional(),
    ownership: Joi.string()
        .valid(...OWNERSHIP_FILTERS)
        .default('all'),
    status: Joi.string()
        .valid(...EXERCISE_STATUSES)
        .optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(24),
});
