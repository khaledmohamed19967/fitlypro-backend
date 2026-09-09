import mongoose from 'mongoose';
import {
    MUSCLES,
    EQUIPMENT,
    DIFFICULTIES,
    CATEGORIES,
    OWNERSHIP_TYPES,
    SOURCE_TYPES,
    EXERCISE_STATUSES,
} from './exercise.constants.js';

/**
 * Nested ownership subdocument.
 * Explicit Schema avoids Mongoose treating a nested `type` field as a SchemaType shortcut.
 */
const ownershipSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            required: [true, 'Ownership type is required'],
            enum: {
                values: OWNERSHIP_TYPES,
                message: 'Ownership type must be system or trainer',
            },
        },
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { _id: false }
);

const sourceSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: {
                values: SOURCE_TYPES,
                message: 'Invalid source type',
            },
            default: 'manual',
        },
        externalProvider: {
            type: String,
            trim: true,
            maxlength: [64, 'External provider cannot exceed 64 characters'],
            default: null,
        },
        externalId: {
            type: String,
            trim: true,
            maxlength: [128, 'External ID cannot exceed 128 characters'],
            default: null,
        },
        duplicatedFromId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Exercise',
            default: null,
        },
    },
    { _id: false }
);

const mediaSchema = new mongoose.Schema(
    {
        thumbnailUrl: {
            type: String,
            trim: true,
            default: null,
        },
        imageUrls: {
            type: [
                {
                    type: String,
                    trim: true,
                },
            ],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= 10;
                },
                message: 'Image URLs cannot exceed 10 items',
            },
        },
        videoUrl: {
            type: String,
            trim: true,
            default: null,
        },
    },
    { _id: false }
);

/**
 * Exercise Schema
 * Catalog definition only — no workout programming fields (sets/reps/rest).
 */
const exerciseSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Exercise name is required'],
            trim: true,
            minlength: [2, 'Exercise name must be at least 2 characters'],
            maxlength: [120, 'Exercise name cannot exceed 120 characters'],
        },
        nameAr: {
            type: String,
            trim: true,
            maxlength: [120, 'Arabic name cannot exceed 120 characters'],
            default: null,
        },
        slug: {
            type: String,
            required: [true, 'Slug is required'],
            lowercase: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
            maxlength: [2000, 'Description cannot exceed 2000 characters'],
            default: null,
        },
        descriptionAr: {
            type: String,
            trim: true,
            maxlength: [2000, 'Arabic description cannot exceed 2000 characters'],
            default: null,
        },
        muscles: {
            primary: {
                type: String,
                required: [true, 'Primary muscle is required'],
                enum: {
                    values: MUSCLES,
                    message: 'Invalid primary muscle',
                },
            },
            secondary: {
                type: [
                    {
                        type: String,
                        enum: {
                            values: MUSCLES,
                            message: 'Invalid secondary muscle',
                        },
                    },
                ],
                default: [],
            },
        },
        equipment: {
            type: [
                {
                    type: String,
                    enum: {
                        values: EQUIPMENT,
                        message: 'Invalid equipment value',
                    },
                },
            ],
            required: [true, 'Equipment is required'],
            validate: {
                validator(value) {
                    return Array.isArray(value) && value.length >= 1;
                },
                message: 'At least one equipment value is required',
            },
        },
        category: {
            type: String,
            required: [true, 'Category is required'],
            enum: {
                values: CATEGORIES,
                message: 'Invalid category',
            },
        },
        difficulty: {
            type: String,
            required: [true, 'Difficulty is required'],
            enum: {
                values: DIFFICULTIES,
                message: 'Invalid difficulty',
            },
        },
        instructions: {
            type: [
                {
                    type: String,
                    trim: true,
                    maxlength: [500, 'Instruction cannot exceed 500 characters'],
                },
            ],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= 30;
                },
                message: 'Instructions cannot exceed 30 items',
            },
        },
        instructionsAr: {
            type: [
                {
                    type: String,
                    trim: true,
                    maxlength: [500, 'Arabic instruction cannot exceed 500 characters'],
                },
            ],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= 30;
                },
                message: 'Arabic instructions cannot exceed 30 items',
            },
        },
        commonMistakes: {
            type: [
                {
                    type: String,
                    trim: true,
                    maxlength: [500, 'Common mistake cannot exceed 500 characters'],
                },
            ],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= 20;
                },
                message: 'Common mistakes cannot exceed 20 items',
            },
        },
        media: {
            type: mediaSchema,
            default: () => ({}),
        },
        tags: {
            type: [
                {
                    type: String,
                    trim: true,
                    lowercase: true,
                    maxlength: [40, 'Tag cannot exceed 40 characters'],
                },
            ],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= 20;
                },
                message: 'Tags cannot exceed 20 items',
            },
        },
        ownership: {
            type: ownershipSchema,
            required: [true, 'Ownership is required'],
        },
        source: {
            type: sourceSchema,
            default: () => ({ type: 'manual' }),
        },
        status: {
            type: String,
            enum: {
                values: EXERCISE_STATUSES,
                message: 'Status must be active or archived',
            },
            default: 'active',
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Ownership consistency: system => trainerId null; trainer => trainerId required
exerciseSchema.pre('validate', function ownershipConsistency() {
    const ownership = this.ownership;
    if (!ownership || !ownership.type) {
        this.invalidate('ownership.type', 'Ownership type is required');
        return;
    }
    if (ownership.type === 'system' && ownership.trainerId != null) {
        this.invalidate('ownership.trainerId', 'System exercises must have null trainerId');
        return;
    }
    if (ownership.type === 'trainer' && ownership.trainerId == null) {
        this.invalidate('ownership.trainerId', 'Trainer exercises require trainerId');
    }
});

// Secondary muscles must not include primary
exerciseSchema.path('muscles.secondary').validate(function validateSecondary(secondary) {
    const primary = this.muscles?.primary;
    if (!primary || !Array.isArray(secondary)) {
        return true;
    }
    return !secondary.includes(primary);
}, 'Secondary muscles must not include the primary muscle');

/**
 * Indexes
 *
 * Slug uniqueness: compound unique on (ownership.type, ownership.trainerId, slug).
 * System exercises all use trainerId=null; uniqueness still holds because slug differs
 * per document. Trainer scopes isolate by trainerId ObjectId.
 * (MongoDB treats null as a value in unique compounds — multiple system rows are fine
 * as long as slugs are unique within the system scope.)
 */
exerciseSchema.index(
    { 'ownership.type': 1, 'ownership.trainerId': 1, slug: 1 },
    { unique: true }
);

// Trainer / system listing (status + recent first)
exerciseSchema.index({
    'ownership.type': 1,
    'ownership.trainerId': 1,
    status: 1,
    createdAt: -1,
});

exerciseSchema.index({ 'muscles.primary': 1, status: 1 });

exerciseSchema.index({ category: 1, difficulty: 1, status: 1 });

// Multikey on equipment array
exerciseSchema.index({ equipment: 1, status: 1 });

/**
 * Import dedupe: unique only when both externalProvider and externalId are strings.
 * Documents without import metadata are excluded via partialFilterExpression.
 */
exerciseSchema.index(
    { 'source.externalProvider': 1, 'source.externalId': 1 },
    {
        unique: true,
        partialFilterExpression: {
            'source.externalProvider': { $type: 'string' },
            'source.externalId': { $type: 'string' },
        },
    }
);

const Exercise = mongoose.model('Exercise', exerciseSchema);

export default Exercise;
