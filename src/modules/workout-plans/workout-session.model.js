import mongoose from 'mongoose';
import { WORKOUT_SESSION_STATUSES } from './workout-plan.constants.js';

/**
 * Player workout execution session.
 * Prescribed content remains on WorkoutPlan; this document tracks a performance attempt.
 */
const workoutSessionSchema = new mongoose.Schema(
    {
        assignmentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PlanAssignment',
            required: [true, 'Assignment ID is required'],
            index: true,
        },
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
        planId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkoutPlan',
            required: [true, 'Plan ID is required'],
            index: true,
        },
        workoutDayId: {
            type: mongoose.Schema.Types.ObjectId,
            required: [true, 'Workout day ID is required'],
        },
        workoutDayNumber: {
            type: Number,
            required: [true, 'Workout day number is required'],
            min: [1, 'Workout day number must be at least 1'],
            max: [7, 'Workout day number cannot exceed 7'],
        },
        workoutDayName: {
            type: String,
            required: [true, 'Workout day name is required'],
            trim: true,
            maxlength: [120, 'Workout day name cannot exceed 120 characters'],
        },
        workoutDayDescription: {
            type: String,
            trim: true,
            maxlength: [2000, 'Workout day description cannot exceed 2000 characters'],
            default: null,
        },
        status: {
            type: String,
            required: [true, 'Status is required'],
            enum: {
                values: WORKOUT_SESSION_STATUSES,
                message: 'Status must be in_progress, completed, or abandoned',
            },
            default: 'in_progress',
        },
        startedAt: {
            type: Date,
            required: [true, 'Started at is required'],
            default: Date.now,
        },
        completedAt: {
            type: Date,
            default: null,
        },
        durationSeconds: {
            type: Number,
            min: [0, 'Duration cannot be negative'],
            default: 0,
        },
        completedSets: {
            type: Number,
            min: [0, 'Completed sets cannot be negative'],
            default: 0,
        },
        totalSets: {
            type: Number,
            min: [0, 'Total sets cannot be negative'],
            default: 0,
        },
        progress: {
            type: Number,
            min: [0, 'Progress cannot be less than 0'],
            max: [100, 'Progress cannot exceed 100'],
            default: 0,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

workoutSessionSchema.index({ clientId: 1, createdAt: -1 });
workoutSessionSchema.index({ assignmentId: 1, createdAt: -1 });
workoutSessionSchema.index({ clientId: 1, status: 1 });
workoutSessionSchema.index({ trainerId: 1, clientId: 1, createdAt: -1 });

workoutSessionSchema.index(
    { assignmentId: 1, workoutDayId: 1 },
    {
        unique: true,
        name: 'assignmentId_1_workoutDayId_1_in_progress_unique',
        partialFilterExpression: { status: 'in_progress' },
    }
);

const WorkoutSession = mongoose.model('WorkoutSession', workoutSessionSchema);

export default WorkoutSession;
