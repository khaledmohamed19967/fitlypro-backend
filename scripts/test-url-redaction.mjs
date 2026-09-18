/**
 * URL redaction helper unit checks.
 * Run: node scripts/test-url-redaction.mjs
 */
import assert from 'node:assert/strict';
import { redactSensitiveUrl, isClientInvitationPath } from '../src/utils/urlRedaction.js';

const raw = '/api/v1/client-invitations/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const redacted = redactSensitiveUrl(raw);

assert.equal(redacted, '/api/v1/client-invitations/[REDACTED]');
assert.ok(!redacted.includes('abcdef'));
assert.equal(isClientInvitationPath(raw), true);
assert.equal(isClientInvitationPath('/api/v1/clients/123'), false);
assert.equal(
    redactSensitiveUrl('/api/v1/clients/abc'),
    '/api/v1/clients/abc'
);

console.log('test-url-redaction.mjs: all checks passed');
