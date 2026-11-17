import mongoose from 'mongoose';
import {
    CLIENT_SUBSCRIPTION_STATUSES,
    PACKAGE_DURATION_VALUES,
} from './client-subscription.constants.js';

/**
 * Independent coaching subscription period for a trainer-owned client.
 * Workout / nutrition PlanAssignments are unrelated.
 *
 * Status is explicit (active | completed | cancelled) — not derived from dates
 * or User.isActive in Mongoose middleware.
 */
const clientSubscriptionSchema = new mongoose.Schema(
    {
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Trainer ID is required'],
        },
        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Client ID is required'],
        },
        packageDuration: {
            type: String,
            required: [true, 'Package duration is required'],
            enum: {
                values: PACKAGE_DURATION_VALUES,
                message:
                    'Package duration must be 1_month, 3_months, 6_months, 12_months, or ongoing',
            },
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
                values: CLIENT_SUBSCRIPTION_STATUSES,
                message: 'Status must be active, completed, or cancelled',
            },
            default: 'active',
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

clientSubscriptionSchema.pre('validate', function validateSubscriptionDates() {
    const isOngoing = this.packageDuration === 'ongoing';

    if (isOngoing) {
        if (this.endDate != null) {
            this.invalidate(
                'endDate',
                'Ongoing subscriptions must have a null end date'
            );
        }
        return;
    }

    if (this.endDate == null) {
        this.invalidate(
            'endDate',
            'Finite package subscriptions require an end date'
        );
        return;
    }

    if (this.startDate && this.endDate <= this.startDate) {
        this.invalidate('endDate', 'End date must be after start date');
    }
});

/** History: newest subscription first for a trainer/client pair. */
clientSubscriptionSchema.index({
    trainerId: 1,
    clientId: 1,
    startDate: -1,
    createdAt: -1,
});

/**
 * At most one active subscription per trainer/client.
 * Historical (completed/cancelled) rows are not constrained by this index.
 */
clientSubscriptionSchema.index(
    { trainerId: 1, clientId: 1 },
    {
        unique: true,
        name: 'trainerId_1_clientId_1_active_unique',
        partialFilterExpression: { status: 'active' },
    }
);

const ClientSubscription = mongoose.model(
    'ClientSubscription',
    clientSubscriptionSchema
);

export default ClientSubscription;
