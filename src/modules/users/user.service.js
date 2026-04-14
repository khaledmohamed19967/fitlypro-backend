import User from './user.model.js';
import { checkEmailUnique } from './user.helpers.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * User Service
 * Contains business logic for user operations
 */



// =========================================================================
// Service Methods
// =========================================================================

/**
 * Create a new user
 */
const createUser = async (userData) => {
    // Check if user already exists
    await checkEmailUnique(userData.email);

    const user = await User.create(userData);
    return user;
};

/**
 * Get all users with pagination
 */
const getAllUsers = async (filters = {}, options = {}) => {
    const { page = 1, limit = 10 } = options;
    const skip = (page - 1) * limit;

    const [users, totalCount] = await Promise.all([
        User.find(filters)
            .select('-__v')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        User.countDocuments(filters),
    ]);

    return {
        users,
        pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit),
            totalCount,
            hasNextPage: page * limit < totalCount,
            hasPrevPage: page > 1,
        },
    };
};

/**
 * Get user by ID
 */
const getUserById = async (userId) => {
    const user = await User.findById(userId).select('-__v');
    return user;
};

/**
 * Update user
 */
const updateUser = async (userId, updateData) => {
    // Prevent email update if it already exists for another user
    if (updateData.email) {
        await checkEmailUnique(updateData.email, userId);
    }

    const user = await User.findByIdAndUpdate(
        userId,
        { $set: updateData },
        { new: true, runValidators: true }
    ).select('-__v');

    return user;
};

/**
 * Delete user (soft delete by setting isActive to false)
 */
const deleteUser = async (userId) => {
    // Soft delete
    const user = await User.findByIdAndUpdate(
        userId,
        { isActive: false },
        { new: true }
    );

    // For hard delete, use:
    // const user = await User.findByIdAndDelete(userId);

    return user;
};

/**
 * Get user statistics
 */
const getUserStats = async () => {
    const stats = await User.aggregate([
        {
            $facet: {
                totalUsers: [{ $count: 'count' }],
                activeUsers: [
                    { $match: { isActive: true } },
                    { $count: 'count' },
                ],
                usersByRole: [
                    { $group: { _id: '$role', count: { $sum: 1 } } },
                ],
                usersByGender: [
                    { $group: { _id: '$gender', count: { $sum: 1 } } },
                ],
                recentUsers: [
                    { $sort: { createdAt: -1 } },
                    { $limit: 5 },
                    {
                        $project: {
                            fullName: { $concat: ['$firstName', ' ', '$lastName'] },
                            email: 1,
                            createdAt: 1,
                        },
                    },
                ],
            },
        },
    ]);

    return {
        totalUsers: stats[0].totalUsers[0]?.count || 0,
        activeUsers: stats[0].activeUsers[0]?.count || 0,
        usersByRole: stats[0].usersByRole,
        usersByGender: stats[0].usersByGender,
        recentUsers: stats[0].recentUsers,
    };
};

export default {
    // Core User Operations
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser,
    getUserStats,
};
