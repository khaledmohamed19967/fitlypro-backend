/**
 * Shared access-token verification used by production `protect` and Studio auth.
 *
 * Throws ApiError:
 * - 401 missing/invalid/expired token or missing user
 * - 403 deactivated account
 *
 * Callers that must preserve legacy `protect` behavior (map all failures to 401)
 * should catch and normalize; Studio may surface 403 as-is.
 */

import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import User from '../modules/users/user.model.js';
import { ApiError } from './ApiError.js';

/**
 * Extract a Bearer token from an Authorization header.
 * Matches production `protect` parsing: `Bearer <token>`.
 *
 * @param {string|undefined|null} authorizationHeader
 * @returns {string|null}
 */
export const extractBearerToken = (authorizationHeader) => {
    if (
        typeof authorizationHeader !== 'string' ||
        !authorizationHeader.startsWith('Bearer')
    ) {
        return null;
    }
    const token = authorizationHeader.split(' ')[1];
    return token || null;
};

/**
 * Verify JWT and load the user document.
 *
 * @param {string|null|undefined} token
 * @returns {Promise<import('mongoose').Document>}
 */
export const verifyAccessToken = async (token) => {
    if (!token || typeof token !== 'string') {
        throw new ApiError(401, 'Not authorized to access this route');
    }

    let decoded;
    try {
        decoded = jwt.verify(token, config.jwt.secret);
    } catch {
        throw new ApiError(401, 'Not authorized to access this route');
    }

    if (!decoded?.id) {
        throw new ApiError(401, 'Not authorized to access this route');
    }

    const user = await User.findById(decoded.id);
    if (!user) {
        throw new ApiError(401, 'User not found');
    }

    if (!user.isActive) {
        throw new ApiError(403, 'Your account has been deactivated');
    }

    return user;
};

export default {
    extractBearerToken,
    verifyAccessToken,
};
