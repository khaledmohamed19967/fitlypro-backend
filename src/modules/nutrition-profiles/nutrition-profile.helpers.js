/**
 * Shared client access for nutrition profile / calculator modules.
 * Reuses the same ownership rules as client.service (trainer owns client).
 */

import mongoose from 'mongoose';
import User from '../users/user.model.js';
import { ApiError } from '../../utils/ApiError.js';

const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

/**
 * Load a client User document the trainer is authorized to access.
 * Returns the Mongoose document (not public profile) for calculator inputs.
 *
 * @param {string} clientId
 * @param {string} trainerId
 * @returns {Promise<import('mongoose').Document>}
 */
export const loadAccessibleClientDocument = async (clientId, trainerId) => {
    if (!isValidObjectId(clientId)) {
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

    return client;
};

/**
 * Resolve calculator sex from client.gender, with optional request override.
 *
 * @param {object} client
 * @param {string|undefined} sexOverride
 * @returns {'male'|'female'}
 */
export const resolveCalculatorSex = (client, sexOverride) => {
    if (sexOverride === 'male' || sexOverride === 'female') {
        return sexOverride;
    }

    if (client.gender === 'male' || client.gender === 'female') {
        return client.gender;
    }

    throw new ApiError(
        400,
        'Client gender must be male or female for calculation, or provide sex in the request body'
    );
};

/**
 * Weight source of truth: User.currentWeight (progress notes do not update it).
 *
 * @param {object} client
 * @param {number|undefined} weightOverride
 * @returns {number}
 */
export const resolveWeightKg = (client, weightOverride) => {
    if (weightOverride != null && weightOverride !== '') {
        return Number(weightOverride);
    }
    if (client.currentWeight == null) {
        throw new ApiError(400, 'Client current weight is required for calculation');
    }
    return Number(client.currentWeight);
};

/**
 * Height source of truth: User.height (cm).
 *
 * @param {object} client
 * @param {number|undefined} heightOverride
 * @returns {number}
 */
export const resolveHeightCm = (client, heightOverride) => {
    if (heightOverride != null && heightOverride !== '') {
        return Number(heightOverride);
    }
    if (client.height == null) {
        throw new ApiError(400, 'Client height is required for calculation');
    }
    return Number(client.height);
};

export { isValidObjectId };
