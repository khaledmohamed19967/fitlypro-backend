import authService from './auth.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

/**
 * Register a new user
 * @route   POST /api/v1/auth/register
 * @access  Public
 */
const register = asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);

    res.status(201).json(
        new ApiResponse(201, result, 'User registered successfully')
    );
});

/**
 * Login user
 * @route   POST /api/v1/auth/login
 * @access  Public
 */
const login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await authService.login(email, password);

    res.status(200).json(
        new ApiResponse(200, result, 'User logged in successfully')
    );
});

/**
 * Get current user profile
 * @route   GET /api/v1/auth/me
 * @access  Private
 */
const getProfile = asyncHandler(async (req, res) => {
    const result = await authService.getProfile(req.user._id);

    res.status(200).json(
        new ApiResponse(200, result, 'User profile retrieved successfully')
    );
});

/**
 * Update user password
 * @route   PUT /api/v1/auth/password
 * @access  Private
 */
const updatePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const result = await authService.updatePassword(
        req.user._id,
        currentPassword,
        newPassword
    );

    res.status(200).json(
        new ApiResponse(200, result, 'Password updated successfully')
    );
});

export default {
    register,
    login,
    getProfile,
    updatePassword,
};
