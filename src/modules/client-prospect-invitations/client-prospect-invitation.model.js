import mongoose from 'mongoose';
import { CLIENT_PROSPECT_INVITATION_STATUSES } from './client-prospect-invitation.constants.js';

/**
 * Coach-initiated invitation for a prospective client (no User yet).
 * Raw token is never stored — only tokenHash.
 */
const clientProspectInvitationSchema = new mongoose.Schema(
    {
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Trainer ID is required'],
            index: true,
        },
        clientName: {
            type: String,
            required: [true, 'Client name is required'],
            trim: true,
            minlength: [2, 'Client name must be at least 2 characters'],
            maxlength: [100, 'Client name cannot exceed 100 characters'],
        },
        /** Digits-only WhatsApp phone (10–15), project convention. */
        phone: {
            type: String,
            required: [true, 'Phone number is required'],
            trim: true,
            match: [/^[0-9]{10,15}$/, 'Please provide a valid phone number'],
            index: true,
        },
        tokenHash: {
            type: String,
            required: [true, 'Token hash is required'],
            unique: true,
            select: false,
        },
        status: {
            type: String,
            required: true,
            enum: {
                values: CLIENT_PROSPECT_INVITATION_STATUSES,
                message: 'Status must be pending, used, or revoked',
            },
            default: 'pending',
            index: true,
        },
        expiresAt: {
            type: Date,
            required: [true, 'Expiration date is required'],
            index: true,
        },
        usedAt: {
            type: Date,
            default: null,
        },
        revokedAt: {
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

clientProspectInvitationSchema.index({ trainerId: 1, phone: 1, status: 1 });
clientProspectInvitationSchema.index({ trainerId: 1, status: 1, createdAt: -1 });

const ClientProspectInvitation = mongoose.model(
    'ClientProspectInvitation',
    clientProspectInvitationSchema
);

export default ClientProspectInvitation;
