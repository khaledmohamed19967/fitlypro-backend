import mongoose from 'mongoose';
import { CLIENT_INVITATION_STATUSES } from './client-invitation.constants.js';

/**
 * Single-use invitation for a trainer-owned client to set their password.
 * Raw token is never stored — only tokenHash.
 */
const clientInvitationSchema = new mongoose.Schema(
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
                values: CLIENT_INVITATION_STATUSES,
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

clientInvitationSchema.index({ clientId: 1, status: 1, createdAt: -1 });
clientInvitationSchema.index({ trainerId: 1, createdAt: -1 });

const ClientInvitation = mongoose.model('ClientInvitation', clientInvitationSchema);

export default ClientInvitation;
