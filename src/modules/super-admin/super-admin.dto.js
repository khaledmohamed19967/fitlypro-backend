/**
 * Safe Super Admin response shapes (no password / secrets).
 */

/**
 * @param {object} user — lean trainer or mongoose doc
 * @param {number} [clientCount]
 */
export const toTrainerListItem = (user, clientCount = 0) => {
    const id = user._id?.toString?.() ?? user.id?.toString?.() ?? String(user._id);
    const firstName = user.firstName ?? '';
    const lastName = user.lastName ?? '';
    return {
        id,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        email: user.email,
        isActive: Boolean(user.isActive),
        createdAt: user.createdAt ?? null,
        clientCount: Number(clientCount) || 0,
    };
};

/**
 * Trainer profile for Super Admin detail view.
 * @param {object} user
 * @param {number} [clientCount]
 */
export const toTrainerDetail = (user, clientCount = 0) => {
    const base = toTrainerListItem(user, clientCount);
    return {
        ...base,
        role: 'trainer',
        phone: user.phone ?? null,
        phoneCountryIso: user.phoneCountryIso ?? null,
        phoneCountryCode: user.phoneCountryCode ?? null,
        gender: user.gender ?? null,
        dateOfBirth: user.dateOfBirth ?? null,
        updatedAt: user.updatedAt ?? null,
    };
};

/**
 * Client row scoped to a trainer (Super Admin).
 * @param {object} user — lean client or public-profile-like object
 */
export const toTrainerClientListItem = (user) => {
    const id = user._id?.toString?.() ?? user.id?.toString?.() ?? String(user._id);
    const firstName = user.firstName ?? '';
    const lastName = user.lastName ?? '';
    return {
        id,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        email: user.email,
        isActive: Boolean(user.isActive),
        createdAt: user.createdAt ?? null,
        joinedCoachAt: user.joinedCoachAt ?? null,
        packageDuration: user.packageDuration ?? null,
        startDate: user.startDate ?? null,
        endDate: user.endDate ?? null,
    };
};

export default {
    toTrainerListItem,
    toTrainerDetail,
    toTrainerClientListItem,
};
