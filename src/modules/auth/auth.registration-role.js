/**
 * Public registration role resolution.
 *
 * Product language may say "coach"; persisted User.role enum uses "trainer".
 * Admin is never creatable via public registration.
 */

export const PUBLIC_REGISTRATION_ROLES = Object.freeze(['client', 'trainer', 'coach']);

/**
 * Map a validated public registration role input to a persisted User.role.
 *
 * @param {string|undefined|null} requestedRole
 * @returns {'client'|'trainer'}
 */
export const resolvePublicRegistrationRole = (requestedRole) => {
    const role = typeof requestedRole === 'string' ? requestedRole.trim().toLowerCase() : '';

    if (!role || role === 'client') {
        return 'client';
    }

    if (role === 'trainer' || role === 'coach') {
        return 'trainer';
    }

    // Defense in depth — Joi should already reject unsupported values.
    throw new Error(`Unsupported public registration role: ${requestedRole}`);
};
