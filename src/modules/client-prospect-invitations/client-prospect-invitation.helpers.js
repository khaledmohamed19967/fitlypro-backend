import config from '../../config/index.js';
import {
    generateInvitationToken,
    hashInvitationToken,
    isInvitationExpired,
    parseDurationToMs,
} from '../client-invitations/client-invitation.helpers.js';

/**
 * Normalize WhatsApp / phone input to digits-only form used project-wide.
 *
 * @param {unknown} phone
 * @returns {string}
 */
export const normalizeProspectPhone = (phone) => {
    if (phone == null) {
        return '';
    }
    return String(phone).replace(/\D/g, '');
};

/**
 * Validate normalized phone (10–15 digits) — matches User / client validators.
 *
 * @param {string} normalizedPhone
 * @returns {boolean}
 */
export const isValidProspectPhone = (normalizedPhone) =>
    /^[0-9]{10,15}$/.test(normalizedPhone);

/**
 * Build the prospect-facing registration URL (raw token in query only).
 * Distinct from password-activation `/client/activate`.
 *
 * @param {string} rawToken
 * @returns {string}
 */
export const buildProspectInvitationUrl = (rawToken) => {
    const base = config.clientApp.url.replace(/\/+$/, '');
    return `${base}/client/prospect-register?token=${encodeURIComponent(rawToken)}`;
};

/**
 * Compute expiresAt — defaults to exactly 7 days (existing duration parser).
 *
 * @returns {Date}
 */
export const computeProspectInvitationExpiresAt = () =>
    new Date(
        Date.now() +
            parseDurationToMs(config.clientProspectInvitation.expiresIn)
    );

export {
    generateInvitationToken,
    hashInvitationToken,
    isInvitationExpired,
};
