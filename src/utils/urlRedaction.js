/**
 * Redact sensitive path segments (invitation tokens) from URLs used in logs/errors.
 *
 * @param {string} [url]
 * @returns {string}
 */
export const redactSensitiveUrl = (url = '') =>
    String(url)
        .replace(/(\/client-invitations\/)[^/?#]+/gi, '$1[REDACTED]')
        .replace(/(\/client-prospect-invitations\/)[^/?#]+/gi, '$1[REDACTED]');

/**
 * True when the URL targets a public invitation API (token in path).
 *
 * @param {string} [url]
 * @returns {boolean}
 */
export const isClientInvitationPath = (url = '') =>
    /\/client-invitations\//i.test(String(url)) ||
    /\/client-prospect-invitations\//i.test(String(url));
