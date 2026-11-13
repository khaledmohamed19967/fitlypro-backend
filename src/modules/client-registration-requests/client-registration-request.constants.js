/**
 * Coach review statuses for prospect-submitted registration data.
 */
export const CLIENT_REGISTRATION_REQUEST_STATUSES = Object.freeze([
    'pending',
    'approved',
    'rejected',
]);

export const CLIENT_REGISTRATION_REQUEST_STATUS = Object.freeze({
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
});

/**
 * How long one approval call may hold the password-invitation creation claim.
 * After this, another approval may take over (crash / hung create recovery).
 */
export const PASSWORD_INVITATION_CLAIM_TTL_MS = 30_000;

/**
 * How long a concurrent approval waits for the claim holder to finish.
 * Short fixed polls — not the primary concurrency mechanism.
 */
export const PASSWORD_INVITATION_WAIT_ATTEMPTS = 20;
export const PASSWORD_INVITATION_WAIT_MS = 50;

/**
 * Derived inbox invitation statuses (ClientInvitation + expiry).
 */
export const PASSWORD_INVITATION_INBOX_STATUSES = Object.freeze([
    'none',
    'pending',
    'used',
    'revoked',
    'expired',
]);

export const PASSWORD_INVITATION_INBOX_STATUS = Object.freeze({
    NONE: 'none',
    PENDING: 'pending',
    USED: 'used',
    REVOKED: 'revoked',
    EXPIRED: 'expired',
});
