import userService from './user.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * User Controller
 * Handles HTTP requests and sends responses
 */

/**
 * @desc    Create a new user
 * @route   POST /api/v1/users
 * @access  Public
 */
export const createUser = asyncHandler(async (req, res) => {
    const user = await userService.createUser(req.body);

    res.status(201).json(
        new ApiResponse(201, user, 'User created successfully')
    );
});

/**
 * @desc    Get all users
 * @route   GET /api/v1/users
 * @access  Public
 */
export const getAllUsers = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search, role, trainer } = req.query;

    const filters = {};
    if (role) filters.role = role;
    if (trainer) filters.trainer = trainer;

    if (search) {
        filters.$or = [
            { firstName: { $regex: search, $options: 'i' } },
            { lastName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
        ];
    }

    const result = await userService.getAllUsers(filters, {
        page: parseInt(page),
        limit: parseInt(limit),
    });

    res.status(200).json(
        new ApiResponse(200, result, 'Users retrieved successfully')
    );
});

/**
 * @desc    Get user by ID
 * @route   GET /api/v1/users/:id
 * @access  Public
 */
export const getUserById = asyncHandler(async (req, res) => {
    const user = await userService.getUserById(req.params.id);

    if (!user) {
        throw new ApiError(404, 'User not found');
    }

    res.status(200).json(
        new ApiResponse(200, user, 'User retrieved successfully')
    );
});

/**
 * @desc    Update user
 * @route   PUT /api/v1/users/:id
 * @access  Private
 */
export const updateUser = asyncHandler(async (req, res) => {
    const user = await userService.updateUser(req.params.id, req.body);

    if (!user) {
        throw new ApiError(404, 'User not found');
    }

    res.status(200).json(
        new ApiResponse(200, user, 'User updated successfully')
    );
});

/**
 * @desc    Delete user
 * @route   DELETE /api/v1/users/:id
 * @access  Private
 */
export const deleteUser = asyncHandler(async (req, res) => {
    const user = await userService.deleteUser(req.params.id);

    if (!user) {
        throw new ApiError(404, 'User not found');
    }

    res.status(200).json(
        new ApiResponse(200, null, 'User deleted successfully')
    );
});

/**
 * @desc    Get user statistics
 * @route   GET /api/v1/users/stats
 * @access  Private
 */
export const getUserStats = asyncHandler(async (req, res) => {
    const stats = await userService.getUserStats();

    res.status(200).json(
        new ApiResponse(200, stats, 'User statistics retrieved successfully')
    );
});
