/**
 * Contact Us — public landing-page inquiry constants.
 */

export const CONTACT_MESSAGE_STATUSES = Object.freeze(['new', 'read', 'archived']);

export const CONTACT_EMAIL_STATUSES = Object.freeze([
    'pending',
    'sent',
    'failed',
    'skipped',
]);

/** Reasonable field ceilings (frontend + backend). */
export const CONTACT_FULL_NAME_MIN = 2;
export const CONTACT_FULL_NAME_MAX = 100;
export const CONTACT_EMAIL_MAX = 254;
export const CONTACT_MESSAGE_MIN = 1;
export const CONTACT_MESSAGE_MAX = 5000;

/**
 * Per-IP submission window (Mongo-backed — safe for serverless instances).
 * 5 submissions / 15 minutes.
 */
export const CONTACT_RATE_LIMIT_MAX = 5;
export const CONTACT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Default support inbox for notification emails. */
export const CONTACT_SUPPORT_EMAIL_DEFAULT = 'support@fitlyflow.com';
