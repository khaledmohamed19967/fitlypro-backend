import mongoose from 'mongoose';
import User from '../users/user.model.js';
import { ApiError } from '../../utils/ApiError.js';

export const isValidClientObjectId = (clientId) =>
    mongoose.Types.ObjectId.isValid(clientId) &&
    new mongoose.Types.ObjectId(clientId).toString() === String(clientId);

/**
 * Load a client user the coach may mutate (trainer ownership).
 *
 * @param {string} clientId
 * @param {string} trainerId
 */
export const loadClientForCoachMutation = async (clientId, trainerId) => {
    if (!isValidClientObjectId(clientId)) {
        throw new ApiError(400, 'Invalid client ID');
    }

    const client = await User.findOne({
        _id: clientId,
        role: 'client',
    });

    if (!client) {
        throw new ApiError(404, 'Client not found');
    }

    if (
        trainerId &&
        client.trainer &&
        client.trainer.toString() !== trainerId.toString()
    ) {
        throw new ApiError(403, 'You do not have access to this client');
    }

    if (trainerId && !client.trainer) {
        throw new ApiError(403, 'You do not have access to this client');
    }

    return client;
};

/**
 * Block new assignments / invitations for deactivated clients.
 *
 * @param {import('mongoose').Document} client
 */
export const assertClientActiveForNewActivity = (client) => {
    if (!client.isActive) {
        throw new ApiError(403, 'Client is deactivated', [
            {
                field: 'clientId',
                message: 'Client is deactivated',
                code: 'CLIENT_DEACTIVATED',
            },
        ]);
    }
};
