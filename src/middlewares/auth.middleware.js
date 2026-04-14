import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { ApiError } from '../utils/ApiError.js';
import User from '../modules/users/user.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Protect routes - Verify JWT token
 */
export const protect = asyncHandler(async (req, res, next) => {
    let token;

    // Check header for token
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        throw new ApiError(401, 'Not authorized to access this route');
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, config.jwt.secret);

        // Find user
        const user = await User.findById(decoded.id);

        if (!user) {
            throw new ApiError(401, 'User not found');
        }

        if (!user.isActive) {
            throw new ApiError(403, 'Your account has been deactivated');
        }

        // Attach user to request
        req.user = user;
        next();
    } catch (error) {
        throw new ApiError(401, 'Not authorized to access this route');
    }
});

/**
 * Authorize roles
 * @param {...String} roles - Roles allowed to access the route
 */
export const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            throw new ApiError(
                403,
                `User role ${req.user.role} is not authorized to access this route`
            );
        }
        next();
    };
};
