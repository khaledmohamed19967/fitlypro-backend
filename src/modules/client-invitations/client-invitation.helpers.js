import crypto from 'crypto';
import config from '../../config/index.js';

/**
 * Parse durations like "7d", "24h", "60m", "30s" into milliseconds.
 * Falls back to 7 days on invalid input.
 *
 * @param {string} value
 * @returns {number}
 */
export const parseDurationToMs = (value) => {
    const fallback = 7 * 24 * 60 * 60 * 1000;
    if (!value || typeof value !== 'string') {
        return fallback;
    }

    const match = value.trim().match(/^(\d+)\s*([smhd])$/i);
    if (!match) {
        return fallback;
    }

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
    };

    return amount * multipliers[unit];
};

/**
 * Cryptographically secure invitation token (URL-safe hex).
 *
 * @returns {string}
 */
export const generateInvitationToken = () => crypto.randomBytes(32).toString('hex');

/**
 * SHA-256 hex digest of the raw token.
 *
 * @param {string} rawToken
 * @returns {string}
 */
export const hashInvitationToken = (rawToken) =>
    crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');

/**
 * Build the client-facing activation URL (raw token in query only).
 *
 * @param {string} rawToken
 * @returns {string}
 */
export const buildInvitationUrl = (rawToken) => {
    const base = config.clientApp.url.replace(/\/+$/, '');
    return `${base}/client/activate?token=${encodeURIComponent(rawToken)}`;
};

/**
 * Compute expiresAt from config.
 *
 * @returns {Date}
 */
export const computeInvitationExpiresAt = () =>
    new Date(Date.now() + parseDurationToMs(config.clientInvitation.expiresIn));

/**
 * @param {Date|string} expiresAt
 * @returns {boolean}
 */
export const isInvitationExpired = (expiresAt) => {
    if (!expiresAt) {
        return true;
    }
    return new Date(expiresAt).getTime() <= Date.now();
};
