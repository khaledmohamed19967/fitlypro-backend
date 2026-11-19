/**
 * Studio authentication — shared JWT verification + Studio role gate.
 */

import { ApiError } from '../../../utils/ApiError.js';
import {
    extractBearerToken,
    verifyAccessToken,
} from '../../../utils/verifyAccessToken.js';

const STUDIO_ROLES = Object.freeze(['trainer', 'admin']);

export { extractBearerToken };

/**
 * Verify JWT and require an active trainer/admin.
 * Identity comes only from the verified token — never from request body.
 *
 * Surfaces 403 for inactive users / wrong roles (unlike production `protect`,
 * which historically maps verification failures to 401).
 *
 * @param {string|null|undefined} token
 * @returns {Promise<{ id: string, role: string, email: string|null }>}
 */
export const authenticateStudioUser = async (token) => {
    const user = await verifyAccessToken(token);

    if (!STUDIO_ROLES.includes(user.role)) {
        throw new ApiError(
            403,
            `User role ${user.role} is not authorized to access this route`
        );
    }

    return {
        id: String(user._id),
        role: user.role,
        email: user.email ? String(user.email) : null,
    };
};

export default {
    extractBearerToken,
    authenticateStudioUser,
    STUDIO_ROLES,
};
