/**
 * Coach-initiated prospect invitation lifecycle statuses.
 * Expiration is derived from expiresAt (same convention as password invitations).
 */
export const CLIENT_PROSPECT_INVITATION_STATUSES = Object.freeze([
    'pending',
    'used',
    'revoked',
]);

export const CLIENT_PROSPECT_INVITATION_STATUS = Object.freeze({
    PENDING: 'pending',
    USED: 'used',
    REVOKED: 'revoked',
});
