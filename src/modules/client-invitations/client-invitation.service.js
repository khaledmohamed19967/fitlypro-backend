import mongoose from 'mongoose';
import ClientInvitation from './client-invitation.model.js';
import { CLIENT_INVITATION_STATUS } from './client-invitation.constants.js';
import {
    buildInvitationUrl,
    computeInvitationExpiresAt,
    generateInvitationToken,
    hashInvitationToken,
    isInvitationExpired,
} from './client-invitation.helpers.js';
import User from '../users/user.model.js';
import { ApiError } from '../../utils/ApiError.js';

const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

/**
 * Load a trainer-owned client document (strict ownership).
 *
 * @param {string} clientId
 * @param {string} trainerId
 */
const loadOwnedClientForInvite = async (clientId, trainerId) => {
    if (!isValidObjectId(clientId)) {
        throw new ApiError(400, 'Invalid client ID');
    }

    const client = await User.findById(clientId);

    if (!client || client.role !== 'client') {
        throw new ApiError(404, 'Client not found');
    }

    if (!client.trainer || client.trainer.toString() !== String(trainerId)) {
        throw new ApiError(403, 'You do not have access to this client');
    }

    return client;
};

/**
 * Resolve invitation by raw token (includes tokenHash).
 *
 * @param {string} rawToken
 */
const findInvitationByRawToken = async (rawToken) => {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length < 16) {
        throw new ApiError(400, 'Invalid invitation token');
    }

    const tokenHash = hashInvitationToken(rawToken.trim());
    const invitation = await ClientInvitation.findOne({ tokenHash }).select('+tokenHash');

    if (!invitation) {
        throw new ApiError(404, 'Invitation not found');
    }

    return invitation;
};

/**
 * Shared validity checks for preview (mutates nothing).
 *
 * @param {import('mongoose').Document} invitation
 * @returns {Promise<import('mongoose').Document>} client
 */
const assertInvitationUsable = async (invitation) => {
    if (invitation.status === CLIENT_INVITATION_STATUS.USED || invitation.usedAt) {
        throw new ApiError(409, 'Invitation has already been used');
    }

    if (invitation.status === CLIENT_INVITATION_STATUS.REVOKED) {
        throw new ApiError(409, 'Invitation is no longer valid');
    }

    if (
        invitation.status !== CLIENT_INVITATION_STATUS.PENDING ||
        isInvitationExpired(invitation.expiresAt)
    ) {
        throw new ApiError(410, 'Invitation has expired');
    }

    const client = await User.findById(invitation.clientId);

    if (!client || client.role !== 'client') {
        throw new ApiError(404, 'Client not found');
    }

    if (!client.isActive) {
        throw new ApiError(403, 'Client account is inactive');
    }

    return client;
};

/**
 * Map a failed claim to a precise status error (used / revoked / expired / missing).
 *
 * @param {string} rawToken
 */
const throwUnusableInvitationError = async (rawToken) => {
    const invitation = await findInvitationByRawToken(rawToken);
    await assertInvitationUsable(invitation);
    throw new ApiError(409, 'Invitation has already been used');
};

/**
 * Roll a claimed invitation back to pending if password update fails.
 *
 * @param {import('mongoose').Types.ObjectId} invitationId
 */
const rollbackClaimedInvitation = async (invitationId) => {
    await ClientInvitation.findOneAndUpdate(
        {
            _id: invitationId,
            status: CLIENT_INVITATION_STATUS.USED,
        },
        {
            $set: {
                status: CLIENT_INVITATION_STATUS.PENDING,
                usedAt: null,
            },
        }
    );
};

/**
 * Create a new invitation; revoke prior pending invitations for the client.
 *
 * @param {string} clientId
 * @param {string} trainerId
 */
const createInvitation = async (clientId, trainerId) => {
    if (!isValidObjectId(trainerId)) {
        throw new ApiError(400, 'Invalid trainer ID');
    }

    const client = await loadOwnedClientForInvite(clientId, trainerId);

    await ClientInvitation.updateMany(
        {
            clientId: client._id,
            status: CLIENT_INVITATION_STATUS.PENDING,
        },
        {
            $set: {
                status: CLIENT_INVITATION_STATUS.REVOKED,
                revokedAt: new Date(),
            },
        }
    );

    const rawToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const expiresAt = computeInvitationExpiresAt();

    await ClientInvitation.create({
        clientId: client._id,
        trainerId,
        tokenHash,
        status: CLIENT_INVITATION_STATUS.PENDING,
        expiresAt,
        usedAt: null,
        revokedAt: null,
    });

    return {
        invitationUrl: buildInvitationUrl(rawToken),
        expiresAt,
    };
};

/**
 * Public preview — no auth.
 *
 * @param {string} rawToken
 */
const previewInvitation = async (rawToken) => {
    const invitation = await findInvitationByRawToken(rawToken);
    const client = await assertInvitationUsable(invitation);

    return {
        valid: true,
        client: {
            firstName: client.firstName,
            lastName: client.lastName,
        },
        expiresAt: invitation.expiresAt,
    };
};

/**
 * Public accept — atomically claim invitation, then set password (no auto-login).
 *
 * @param {string} rawToken
 * @param {string} password
 */
const acceptInvitation = async (rawToken, password) => {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length < 16) {
        throw new ApiError(400, 'Invalid invitation token');
    }

    const tokenHash = hashInvitationToken(rawToken.trim());
    const now = new Date();

    // Atomic claim: only one concurrent acceptor can win
    const claimed = await ClientInvitation.findOneAndUpdate(
        {
            tokenHash,
            status: CLIENT_INVITATION_STATUS.PENDING,
            usedAt: null,
            expiresAt: { $gt: now },
        },
        {
            $set: {
                status: CLIENT_INVITATION_STATUS.USED,
                usedAt: now,
            },
        },
        { new: true }
    );

    if (!claimed) {
        await throwUnusableInvitationError(rawToken);
    }

    try {
        const client = await User.findById(claimed.clientId);

        if (!client || client.role !== 'client') {
            await rollbackClaimedInvitation(claimed._id);
            throw new ApiError(404, 'Client not found');
        }

        if (!client.isActive) {
            await rollbackClaimedInvitation(claimed._id);
            throw new ApiError(403, 'Client account is inactive');
        }

        const trainerBefore = client.trainer ? client.trainer.toString() : null;
        const roleBefore = client.role;

        client.password = password;
        await client.save();

        const refreshed = await User.findById(client._id);
        if (
            refreshed.role !== roleBefore ||
            (refreshed.trainer ? refreshed.trainer.toString() : null) !== trainerBefore
        ) {
            throw new ApiError(500, 'Client relationship integrity check failed');
        }

        return {
            success: true,
            message: 'Password set successfully. You can now log in.',
        };
    } catch (err) {
        // Restore pending so a failed password update can be retried with the same link
        await rollbackClaimedInvitation(claimed._id);
        throw err;
    }
};

export default {
    createInvitation,
    previewInvitation,
    acceptInvitation,
};
