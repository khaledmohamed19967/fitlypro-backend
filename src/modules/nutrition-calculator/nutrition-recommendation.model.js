import mongoose from 'mongoose';
import {
    ACTIVITY_LEVELS,
    CALCULATOR_GOALS,
    CALCULATOR_SEXES,
    RECOMMENDATION_STATUSES,
} from '../nutrition-calculator/nutrition-calculator.constants.js';

const macrosSchema = new mongoose.Schema(
    {
        proteinG: { type: Number, min: 0, required: true },
        carbsG: { type: Number, min: 0, required: true },
        fatG: { type: Number, min: 0, required: true },
    },
    { _id: false }
);

/**
 * Approved / calculated nutrition recommendation snapshot.
 * Preserves inputs + outputs for historical traceability.
 * Not a "NutritionCalculator" entity — calculator remains pure logic.
 */
const nutritionRecommendationSchema = new mongoose.Schema(
    {
        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Client ID is required'],
            index: true,
        },
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Trainer ID is required'],
            index: true,
        },
        calculatedAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
        status: {
            type: String,
            enum: {
                values: RECOMMENDATION_STATUSES,
                message: 'Status must be calculated or approved',
            },
            default: 'calculated',
        },
        // Snapshot of inputs used at calculation time
        sex: {
            type: String,
            enum: CALCULATOR_SEXES,
            required: true,
        },
        age: {
            type: Number,
            required: true,
            min: 13,
            max: 100,
        },
        dateOfBirth: {
            type: Date,
            default: null,
        },
        heightCm: {
            type: Number,
            required: true,
            min: 50,
            max: 250,
        },
        weightKg: {
            type: Number,
            required: true,
            min: 20,
            max: 300,
        },
        activityLevel: {
            type: String,
            enum: ACTIVITY_LEVELS,
            required: true,
        },
        goal: {
            type: String,
            enum: CALCULATOR_GOALS,
            required: true,
        },
        // Snapshot of derived results
        bmr: { type: Number, required: true },
        activityFactor: { type: Number, required: true },
        maintenanceCalories: { type: Number, required: true },
        calorieAdjustment: {
            goal: { type: String, required: true },
            multiplier: { type: Number, required: true },
        },
        recommendedCalories: { type: Number, required: true },
        recommendedMacros: {
            type: macrosSchema,
            required: true,
        },
        // Coach overrides (optional)
        finalCalories: {
            type: Number,
            min: 500,
            max: 10000,
            default: null,
        },
        finalMacros: {
            type: macrosSchema,
            default: null,
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [1000, 'Notes cannot exceed 1000 characters'],
            default: null,
        },
        macroMethodology: {
            version: { type: String, default: null },
            notes: { type: String, default: null },
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

nutritionRecommendationSchema.index({ clientId: 1, calculatedAt: -1 });
nutritionRecommendationSchema.index({ trainerId: 1, clientId: 1, calculatedAt: -1 });

const NutritionRecommendation = mongoose.model(
    'NutritionRecommendation',
    nutritionRecommendationSchema
);

export default NutritionRecommendation;
