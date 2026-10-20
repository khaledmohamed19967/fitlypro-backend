import mongoose from 'mongoose';
import {
    HEALTH_REFERENCE_CATEGORIES,
    HEALTH_REFERENCE_STATUSES,
} from './health-reference.constants.js';

const healthReferenceOptionSchema = new mongoose.Schema(
    {
        category: {
            type: String,
            required: [true, 'Category is required'],
            enum: {
                values: HEALTH_REFERENCE_CATEGORIES,
                message: 'Invalid health reference category',
            },
            index: true,
        },
        code: {
            type: String,
            required: [true, 'Code is required'],
            trim: true,
            maxlength: [64, 'Code cannot exceed 64 characters'],
        },
        label: {
            type: String,
            required: [true, 'Label is required'],
            trim: true,
            maxlength: [120, 'Label cannot exceed 120 characters'],
        },
        status: {
            type: String,
            enum: {
                values: HEALTH_REFERENCE_STATUSES,
                message: 'Invalid status',
            },
            default: 'active',
            index: true,
        },
        sortOrder: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

healthReferenceOptionSchema.index({ category: 1, code: 1 }, { unique: true });
healthReferenceOptionSchema.index({ category: 1, status: 1, sortOrder: 1, label: 1 });

const HealthReferenceOption = mongoose.model(
    'HealthReferenceOption',
    healthReferenceOptionSchema
);

export default HealthReferenceOption;
