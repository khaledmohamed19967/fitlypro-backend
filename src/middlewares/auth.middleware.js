import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
    extractBearerToken,
    verifyAccessToken,
} from '../utils/verifyAccessToken.js';

/**
 * Protect routes - Verify JWT token
 *
 * Status-code compatibility: any verification failure is returned as 401,
 * including deactivated accounts (historical `protect` catch-all behavior).
 */
export const protect = asyncHandler(async (req, res, next) => {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
        throw new ApiError(401, 'Not authorized to access this route');
    }

    try {
        req.user = await verifyAccessToken(token);
        next();
    } catch {
        // Preserve legacy protect semantics: never leak 403 through this middleware.
        throw new ApiError(401, 'Not authorized to access this route');
    }
});

/**
 * Authorize roles
 * @param {...String} roles - Roles allowed to access this route
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
