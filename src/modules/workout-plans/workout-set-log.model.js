import mongoose from 'mongoose';
import { WEIGHT_UNITS, WORKOUT_SET_LOG_STATUSES } from './workout-plan.constants.js';

/**
 * Performed set for a workout session.
 * Does not mutate WorkoutPlan prescribed sets.
 */
const workoutSetLogSchema = new mongoose.Schema(
    {
        sessionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkoutSession',
            required: [true, 'Session ID is required'],
            index: true,
        },
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
        exerciseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Exercise',
            required: [true, 'Exercise ID is required'],
        },
        planExerciseId: {
            type: mongoose.Schema.Types.ObjectId,
            required: [true, 'Plan exercise ID is required'],
        },
        setNumber: {
            type: Number,
            required: [true, 'Set number is required'],
            min: [1, 'Set number must be at least 1'],
        },
        status: {
            type: String,
            required: [true, 'Status is required'],
            enum: {
                values: WORKOUT_SET_LOG_STATUSES,
                message: 'Status must be completed or skipped',
            },
            default: 'completed',
        },
        reps: {
            type: Number,
            min: [0, 'Reps cannot be negative'],
            default: null,
        },
        weight: {
            type: Number,
            min: [0, 'Weight cannot be negative'],
            default: null,
        },
        weightUnit: {
            type: String,
            enum: {
                values: WEIGHT_UNITS,
                message: 'Weight unit must be kg or lbs',
            },
            default: 'kg',
        },
        durationSeconds: {
            type: Number,
            min: [0, 'Duration cannot be negative'],
            default: null,
        },
        distance: {
            type: Number,
            min: [0, 'Distance cannot be negative'],
            default: null,
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [500, 'Notes cannot exceed 500 characters'],
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

workoutSetLogSchema.index(
    { sessionId: 1, exerciseId: 1, setNumber: 1 },
    {
        unique: true,
        name: 'sessionId_1_exerciseId_1_setNumber_1_unique',
    }
);

workoutSetLogSchema.index({ clientId: 1, createdAt: -1 });
workoutSetLogSchema.index({ assignmentId: 1, createdAt: -1 });

const WorkoutSetLog = mongoose.model('WorkoutSetLog', workoutSetLogSchema);

export default WorkoutSetLog;
