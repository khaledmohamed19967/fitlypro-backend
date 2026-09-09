import mongoose from 'mongoose';
import { ASSIGNMENT_STATUSES } from './nutrition-plan-assignment.constants.js';

const nutritionPlanAssignmentSchema = new mongoose.Schema(
    {
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Trainer ID is required'],
            index: true,
        },
        planId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'NutritionPlan',
            required: [true, 'Plan ID is required'],
            index: true,
        },
        planVersionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'NutritionPlanVersion',
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

nutritionPlanAssignmentSchema.pre('validate', function validateAssignmentDates() {
    if (this.endDate && this.startDate && this.endDate <= this.startDate) {
        this.invalidate('endDate', 'End date must be after start date');
    }
});

nutritionPlanAssignmentSchema.index({ trainerId: 1, status: 1, startDate: -1 });
nutritionPlanAssignmentSchema.index({ planId: 1, clientId: 1, status: 1 });
nutritionPlanAssignmentSchema.index({ clientId: 1, status: 1 });
nutritionPlanAssignmentSchema.index({ trainerId: 1, clientId: 1 });

nutritionPlanAssignmentSchema.index(
    { planId: 1, clientId: 1 },
    {
        unique: true,
        partialFilterExpression: { status: 'active' },
    }
);

const NutritionPlanAssignment = mongoose.model(
    'NutritionPlanAssignment',
    nutritionPlanAssignmentSchema
);

export default NutritionPlanAssignment;
