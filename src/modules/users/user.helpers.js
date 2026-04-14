import User from './user.model.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Check if email is already in use
 * @param {string} email
 * @param {string} [excludeUserId] - Optional user ID to exclude (for updates)
 * @throws {ApiError} if email is taken
 */
export const checkEmailUnique = async (email, excludeUserId = null) => {
    const query = { email: email.toLowerCase() };
    if (excludeUserId) {
        query._id = { $ne: excludeUserId };
    }

    const existingUser = await User.findOne(query);
    if (existingUser) {
        throw new ApiError(400, 'User with this email already exists');
    }
};

/**
 * Check if user is active
 * @param {Document} user
 * @throws {ApiError} if user is not active
 */
export const checkUserActive = (user) => {
    if (!user.isActive) {
        throw new ApiError(403, 'Your account has been deactivated. Please contact support.');
    }
};


