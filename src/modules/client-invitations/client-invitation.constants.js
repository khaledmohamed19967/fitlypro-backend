/**
 * Client invitation lifecycle statuses.
 */
export const CLIENT_INVITATION_STATUSES = Object.freeze([
    'pending',
    'used',
    'revoked',
]);

export const CLIENT_INVITATION_STATUS = Object.freeze({
    PENDING: 'pending',
    USED: 'used',
    REVOKED: 'revoked',
});
