import User from '../users/user.model.js';
import { ApiError } from '../../utils/ApiError.js';

// =========================================================================
// Helper Functions (Private)
// =========================================================================

/**
 * Verify password validity
 * @param {Document} user 
 * @param {string} password 
 * @param {string} errorMessage 
 */
export const verifyPassword = async (user, password, errorMessage = 'Invalid email or password') => {
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
        throw new ApiError(401, errorMessage);
    }
};


/**
 * Find user by email specifically for authentication (includes password)
 * @param {string} email
 * @returns {Promise<Document>} User document with password selected
 */
export const findUserForAuth = async (email) => {
    const user = await User.findByEmail(email).select('+password');
    if (!user) {
        throw new ApiError(401, 'Invalid email or password');
    }
    return user;
};

/**
 * Find user by ID specifically for sensitive operations (includes password)
 * @param {string} userId
 * @returns {Promise<Document>} User document with password selected
 */
export const findUserByIdWithPassword = async (userId) => {
    const user = await User.findById(userId).select('+password');
    if (!user) {
        throw new ApiError(404, 'User not found');
    }
    return user;
};