import mongoose from 'mongoose';
import {
    WORKOUT_GOALS,
    WORKOUT_LEVELS,
} from './workout-plan.constants.js';
import { workoutDaySchema } from './workout-plan.model.js';

const workoutPlanVersionSchema = new mongoose.Schema(
    {
        planId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkoutPlan',
            required: [true, 'Plan ID is required'],
            index: true,
        },
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Trainer ID is required'],
            index: true,
        },
        versionNumber: {
            type: Number,
            required: [true, 'Version number is required'],
            min: [1, 'Version number must be at least 1'],
        },
        name: {
            type: String,
            required: [true, 'Version name is required'],
            trim: true,
            minlength: [2, 'Version name must be at least 2 characters'],
            maxlength: [120, 'Version name cannot exceed 120 characters'],
        },
        description: {
            type: String,
            trim: true,
            maxlength: [2000, 'Description cannot exceed 2000 characters'],
            default: null,
        },
        changes: {
            type: String,
            trim: true,
            maxlength: [500, 'Changes description cannot exceed 500 characters'],
            default: null,
        },
        workoutDays: {
            type: [workoutDaySchema],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= 7;
                },
                message: 'Workout days cannot exceed 7 items',
            },
        },
        goal: {
            type: String,
            required: [true, 'Goal is required'],
            enum: {
                values: WORKOUT_GOALS,
                message: 'Invalid workout goal',
            },
        },
        level: {
            type: String,
            required: [true, 'Level is required'],
            enum: {
                values: WORKOUT_LEVELS,
                message: 'Invalid workout level',
            },
        },
        duration: {
            type: Number,
            required: [true, 'Duration is required'],
            min: [1, 'Duration must be at least 1 week'],
        },
        daysPerWeek: {
            type: Number,
            required: [true, 'Days per week is required'],
            min: [1, 'Days per week must be between 1 and 7'],
            max: [7, 'Days per week must be between 1 and 7'],
        },
        isActive: {
            type: Boolean,
            default: false,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Created by is required'],
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

workoutPlanVersionSchema.index({ planId: 1, versionNumber: -1 });
workoutPlanVersionSchema.index({ planId: 1, isActive: 1 });
workoutPlanVersionSchema.index({ trainerId: 1, planId: 1 });

const WorkoutPlanVersion = mongoose.model('WorkoutPlanVersion', workoutPlanVersionSchema);

export default WorkoutPlanVersion;
