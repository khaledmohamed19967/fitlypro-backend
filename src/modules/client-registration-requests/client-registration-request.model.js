import mongoose from 'mongoose';
import { CLIENT_REGISTRATION_REQUEST_STATUSES } from './client-registration-request.constants.js';

/**
 * Prospect-submitted registration payload awaiting coach approval.
 * Mirrors Add Client fields except password (never collected at this stage).
 * Approving the request creates the client User. Rejection does not.
 */
const objectIdArray = {
    type: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'HealthReferenceOption',
        },
    ],
    default: [],
};

const clientRegistrationRequestSchema = new mongoose.Schema(
    {
        invitationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ClientProspectInvitation',
            required: [true, 'Invitation ID is required'],
        },
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Trainer ID is required'],
            index: true,
        },

        // --- Personal (Add Client) ---
        firstName: {
            type: String,
            required: [true, 'First name is required'],
            trim: true,
            minlength: [2, 'First name must be at least 2 characters'],
            maxlength: [50, 'First name cannot exceed 50 characters'],
        },
        lastName: {
            type: String,
            required: [true, 'Last name is required'],
            trim: true,
            minlength: [2, 'Last name must be at least 2 characters'],
            maxlength: [50, 'Last name cannot exceed 50 characters'],
        },
        email: {
            type: String,
            required: [true, 'Email is required'],
            lowercase: true,
            trim: true,
        },
        phone: {
            type: String,
            trim: true,
            match: [/^[0-9]{10,15}$/, 'Please provide a valid phone number'],
        },
        dateOfBirth: {
            type: Date,
        },
        gender: {
            type: String,
            enum: ['male', 'female', 'other'],
        },

        // --- Fitness ---
        primaryFitnessGoal: {
            type: String,
            required: [true, 'Primary fitness goal is required'],
            enum: [
                'weight_loss',
                'muscle_gain',
                'general_fitness',
                'endurance',
                'strength',
                'flexibility',
                'sports_performance',
                'rehabilitation',
            ],
        },
        currentWeight: {
            type: Number,
            min: [20, 'Current weight must be at least 20 kg'],
            max: [300, 'Current weight cannot exceed 300 kg'],
        },
        targetWeight: {
            type: Number,
            min: [20, 'Target weight must be at least 20 kg'],
            max: [300, 'Target weight cannot exceed 300 kg'],
        },
        height: {
            type: Number,
            min: [50, 'Height must be at least 50 cm'],
            max: [250, 'Height cannot exceed 250 cm'],
        },
        experienceLevel: {
            type: String,
            enum: ['beginner', 'intermediate', 'advanced', 'expert'],
        },

        // --- Program ---
        programType: {
            type: String,
            enum: [
                'personal_training',
                'group_training',
                'online_coaching',
                'nutrition_only',
                'hybrid',
            ],
        },
        sessionsPerWeek: {
            type: Number,
            min: [1, 'Sessions per week must be at least 1'],
            max: [7, 'Sessions per week cannot exceed 7'],
        },
        startDate: {
            type: Date,
        },
        packageDuration: {
            type: String,
            enum: ['1_month', '3_months', '6_months', '12_months', 'ongoing'],
        },
        endDate: {
            type: Date,
        },

        // --- Additional / health ---
        additionalNotes: {
            type: String,
            maxlength: [1000, 'Additional notes cannot exceed 1000 characters'],
        },
        medicalConditions: {
            type: String,
            maxlength: [500, 'Medical conditions cannot exceed 500 characters'],
        },
        injuries: {
            type: String,
            maxlength: [500, 'Injuries cannot exceed 500 characters'],
        },
        injuryAreaOptionIds: objectIdArray,
        injuryDetails: {
            type: String,
            trim: true,
            maxlength: [500, 'Injury details cannot exceed 500 characters'],
            default: null,
        },
        allergyOptionIds: objectIdArray,
        dietaryRestrictionOptionIds: objectIdArray,

        // --- Approval workflow ---
        approvalStatus: {
            type: String,
            required: true,
            enum: {
                values: CLIENT_REGISTRATION_REQUEST_STATUSES,
                message: 'Status must be pending, approved, or rejected',
            },
            default: 'pending',
            index: true,
        },
        /** Set when coach approves and User is created (Phase 3+). */
        createdUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        /**
         * Password invitation created for this approval.
         * Coordinates concurrent approvals so only one createInvitation runs.
         */
        passwordInvitationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ClientInvitation',
            default: null,
        },
        /**
         * Short-lived claim while invitation creation is in progress.
         * Cleared on success/failure; stale claims are reclaimable.
         */
        passwordInvitationClaimedAt: {
            type: Date,
            default: null,
        },
        reviewedAt: {
            type: Date,
            default: null,
        },
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        rejectionReason: {
            type: String,
            trim: true,
            maxlength: [500, 'Rejection reason cannot exceed 500 characters'],
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

clientRegistrationRequestSchema.index({
    trainerId: 1,
    approvalStatus: 1,
    createdAt: -1,
});
clientRegistrationRequestSchema.index(
    { invitationId: 1 },
    { unique: true }
);

const ClientRegistrationRequest = mongoose.model(
    'ClientRegistrationRequest',
    clientRegistrationRequestSchema
);

export default ClientRegistrationRequest;
