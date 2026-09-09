import mongoose from 'mongoose';
import {
    FOOD_CATEGORIES,
    FOOD_STATUSES,
    OWNERSHIP_TYPES,
    SERVING_UNITS,
    SOURCE_TYPES,
    GRAM_WEIGHT_REQUIRED_UNITS,
} from './food.constants.js';

/**
 * Nested ownership subdocument.
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

const nutritionPer100gSchema = new mongoose.Schema(
    {
        calories: {
            type: Number,
            required: [true, 'Calories per 100g is required'],
            min: [0, 'Calories cannot be negative'],
        },
        protein: {
            type: Number,
            required: [true, 'Protein per 100g is required'],
            min: [0, 'Protein cannot be negative'],
        },
        carbs: {
            type: Number,
            required: [true, 'Carbs per 100g is required'],
            min: [0, 'Carbs cannot be negative'],
        },
        fat: {
            type: Number,
            required: [true, 'Fat per 100g is required'],
            min: [0, 'Fat cannot be negative'],
        },
        fiber: {
            type: Number,
            min: [0, 'Fiber cannot be negative'],
            default: null,
        },
        sugar: {
            type: Number,
            min: [0, 'Sugar cannot be negative'],
            default: null,
        },
        sodium: {
            type: Number,
            min: [0, 'Sodium cannot be negative'],
            default: null,
        },
    },
    { _id: false }
);

const defaultServingSchema = new mongoose.Schema(
    {
        quantity: {
            type: Number,
            required: [true, 'Default serving quantity is required'],
            min: [0, 'Default serving quantity must be greater than 0'],
        },
        unit: {
            type: String,
            required: [true, 'Default serving unit is required'],
            enum: {
                values: SERVING_UNITS,
                message: 'Invalid default serving unit',
            },
        },
        gramWeight: {
            type: Number,
            required: [true, 'Default serving gram weight is required'],
            min: [0, 'Gram weight must be greater than 0'],
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
        barcode: {
            type: String,
            trim: true,
            maxlength: [32, 'Barcode cannot exceed 32 characters'],
            default: null,
        },
        originalName: {
            type: String,
            trim: true,
            maxlength: [512, 'Original name cannot exceed 512 characters'],
            default: null,
        },
    },
    { _id: false }
);

const imageSchema = new mongoose.Schema(
    {
        url: {
            type: String,
            trim: true,
            maxlength: [2048, 'Image URL cannot exceed 2048 characters'],
            default: null,
        },
        thumbnailUrl: {
            type: String,
            trim: true,
            maxlength: [2048, 'Thumbnail URL cannot exceed 2048 characters'],
            default: null,
        },
    },
    { _id: false }
);

const foodSchema = new mongoose.Schema(
    {
        /**
         * Compatibility mirror — canonical ownership is `ownership`.
         * System foods: null. Trainer foods: same as ownership.trainerId.
         */
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        ownership: {
            type: ownershipSchema,
            required: [true, 'Ownership is required'],
        },
        name: {
            type: String,
            required: [true, 'Food name is required'],
            trim: true,
            minlength: [2, 'Food name must be at least 2 characters'],
            maxlength: [120, 'Food name cannot exceed 120 characters'],
        },
        normalizedName: {
            type: String,
            trim: true,
            lowercase: true,
            maxlength: [120, 'Normalized name cannot exceed 120 characters'],
            default: null,
            index: true,
        },
        brand: {
            type: String,
            trim: true,
            maxlength: [120, 'Brand cannot exceed 120 characters'],
            default: null,
        },
        category: {
            type: String,
            required: [true, 'Category is required'],
            enum: {
                values: FOOD_CATEGORIES,
                message: 'Invalid food category',
            },
        },
        status: {
            type: String,
            required: [true, 'Status is required'],
            enum: {
                values: FOOD_STATUSES,
                message: 'Status must be active or archived',
            },
            default: 'active',
        },
        nutritionPer100g: {
            type: nutritionPer100gSchema,
            required: [true, 'Nutrition per 100g is required'],
        },
        defaultServing: {
            type: defaultServingSchema,
            required: [true, 'Default serving is required'],
        },
        image: {
            type: imageSchema,
            default: null,
        },
        source: {
            type: sourceSchema,
            default: () => ({ type: 'manual' }),
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

foodSchema.pre('validate', function syncNormalizedName() {
    if (typeof this.name === 'string' && this.name.trim()) {
        this.normalizedName = this.name.trim().toLowerCase();
    }
});

foodSchema.pre('validate', function syncOwnershipFields() {
    const ownership = this.ownership;
    if (!ownership || !ownership.type) {
        this.invalidate('ownership.type', 'Ownership type is required');
        return;
    }

    if (ownership.type === 'system') {
        if (ownership.trainerId != null) {
            this.invalidate('ownership.trainerId', 'System foods must have null ownership.trainerId');
            return;
        }
        this.trainerId = null;
        return;
    }

    if (ownership.type === 'trainer') {
        if (ownership.trainerId == null && this.trainerId != null) {
            ownership.trainerId = this.trainerId;
        }
        if (ownership.trainerId == null) {
            this.invalidate('ownership.trainerId', 'Trainer foods require ownership.trainerId');
            return;
        }
        this.trainerId = ownership.trainerId;
    }
});

foodSchema.pre('validate', function validateDefaultServingGramWeight() {
    const serving = this.defaultServing;
    if (!serving?.unit) {
        return;
    }

    if (
        GRAM_WEIGHT_REQUIRED_UNITS.includes(serving.unit) &&
        (serving.gramWeight == null || serving.gramWeight <= 0)
    ) {
        this.invalidate(
            'defaultServing.gramWeight',
            'Gram weight is required and must be greater than 0 for piece/serving units'
        );
    }
});

foodSchema.index({
    'ownership.type': 1,
    'ownership.trainerId': 1,
    status: 1,
});

foodSchema.index({ name: 'text' });

foodSchema.index({
    name: 1,
    'ownership.type': 1,
    'ownership.trainerId': 1,
});

foodSchema.index({ category: 1, status: 1, 'ownership.type': 1 });

/**
 * System food dedupe — unique identity by external provider + external id.
 */
foodSchema.index(
    { 'source.externalProvider': 1, 'source.externalId': 1 },
    {
        unique: true,
        partialFilterExpression: {
            'ownership.type': 'system',
            'source.externalProvider': { $type: 'string' },
            'source.externalId': { $type: 'string' },
        },
    }
);

const Food = mongoose.model('Food', foodSchema);

export default Food;
