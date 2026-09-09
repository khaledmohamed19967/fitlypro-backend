import mongoose from 'mongoose';
import { ASSIGNMENT_STATUSES } from './workout-plan.constants.js';

const planAssignmentSchema = new mongoose.Schema(
    {
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
        planVersionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WorkoutPlanVersion',
            default: null,
        },
        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Client ID is required'],
            index: true,
        },
        startDate: {
            type: Date,
            required: [true, 'Start date is required'],
        },
        endDate: {
            type: Date,
            default: null,
        },
        status: {
            type: String,
            required: [true, 'Status is required'],
            enum: {
                values: ASSIGNMENT_STATUSES,
                message: 'Status must be active, completed, paused, or cancelled',
            },
            default: 'active',
        },
        progress: {
            type: Number,
            min: [0, 'Progress cannot be less than 0'],
            max: [100, 'Progress cannot exceed 100'],
            default: 0,
        },
        completedSessions: {
            type: Number,
            min: [0, 'Completed sessions cannot be negative'],
            default: 0,
        },
        totalSessions: {
            type: Number,
            min: [0, 'Total sessions cannot be negative'],
            default: 0,
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [1000, 'Assignment notes cannot exceed 1000 characters'],
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

planAssignmentSchema.pre('validate', function validateAssignmentDates() {
    if (this.endDate && this.startDate && this.endDate <= this.startDate) {
        this.invalidate('endDate', 'End date must be after start date');
    }
});

planAssignmentSchema.index({ trainerId: 1, status: 1, startDate: -1 });
planAssignmentSchema.index({ planId: 1, clientId: 1, status: 1 });
planAssignmentSchema.index({ clientId: 1, status: 1 });
planAssignmentSchema.index({ trainerId: 1, clientId: 1 });

planAssignmentSchema.index(
    { planId: 1, clientId: 1 },
    {
        unique: true,
        name: 'planId_1_clientId_1_active_unique',
        partialFilterExpression: { status: 'active' },
    }
);

const PlanAssignment = mongoose.model('PlanAssignment', planAssignmentSchema);

export default PlanAssignment;
