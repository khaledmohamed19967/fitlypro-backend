import User from '../users/user.model.js';
import userService from '../users/user.service.js';
import { checkEmailUnique, checkUserActive } from '../users/user.helpers.js';
import { verifyPassword, findUserForAuth, findUserByIdWithPassword } from './auth.helpers.js';
import { ApiError } from '../../utils/ApiError.js';


// =========================================================================
// Service Methods
// =========================================================================

/**
 * Register a new user
 */
const register = async (userData) => {
    // 1. Validate uniqueness
    await checkEmailUnique(userData.email);

    // 2. Create user
    const user = await User.create(userData);

    // 3. Generate token
    const token = user.generateAuthToken();

    return {
        user: user.getPublicProfile(),
        token,
    };
};

/**
 * Login user
 */
const login = async (email, password) => {
    // 1. Find user (delegated to user service)
    const user = await findUserForAuth(email);

    // 2. Check status (delegated to user service)
    checkUserActive(user);

    // 3. Verify credentials
    await verifyPassword(user, password);

    // 4. Generate token
    const token = user.generateAuthToken();

    return {
        user: user.getPublicProfile(),
        token,
    };
};

/**
 * Get current user profile
 */
const getProfile = async (userId) => {
    const user = await userService.getUserById(userId);
    if (!user) {
        throw new ApiError(404, 'User not found');
    }
    return user.getPublicProfile();
};

/**
 * Update user password
 */
const updatePassword = async (userId, currentPassword, newPassword) => {
    // 1. Find user with password
    const user = await findUserByIdWithPassword(userId);

    // 2. Verify current password
    await verifyPassword(user, currentPassword, 'Current password is incorrect');

    // 3. Update password
    user.password = newPassword;
    await user.save();

    return {
        message: 'Password updated successfully',
    };
};

export default {
    register,
    login,
    getProfile,
    updatePassword,
};
