import mongoose from 'mongoose';
import { ACTIVITY_LEVELS } from './nutrition-profile.constants.js';

/**
 * One Nutrition Profile per Client.
 * Does NOT store height, weight, DOB, sex/gender, or medicalConditions
 * (those live on User / Client).
 */
const nutritionProfileSchema = new mongoose.Schema(
    {
        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Client ID is required'],
            unique: true,
            index: true,
        },
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Trainer ID is required'],
            index: true,
        },
        activityLevel: {
            type: String,
            enum: {
                values: ACTIVITY_LEVELS,
                message: 'Invalid activity level',
            },
            default: null,
        },
        allergies: {
            type: [String],
            default: [],
            validate: {
                validator: (arr) =>
                    Array.isArray(arr) &&
                    arr.every((s) => typeof s === 'string' && s.trim().length <= 120),
                message: 'Each allergy must be a string up to 120 characters',
            },
        },
        dietaryRestrictions: {
            type: [String],
            default: [],
            validate: {
                validator: (arr) =>
                    Array.isArray(arr) &&
                    arr.every((s) => typeof s === 'string' && s.trim().length <= 120),
                message: 'Each dietary restriction must be a string up to 120 characters',
            },
        },
        foodPreferences: {
            type: [String],
            default: [],
            validate: {
                validator: (arr) =>
                    Array.isArray(arr) &&
                    arr.every((s) => typeof s === 'string' && s.trim().length <= 120),
                message: 'Each food preference must be a string up to 120 characters',
            },
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [1000, 'Notes cannot exceed 1000 characters'],
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

nutritionProfileSchema.index({ trainerId: 1, clientId: 1 });

const NutritionProfile = mongoose.model('NutritionProfile', nutritionProfileSchema);

export default NutritionProfile;
