/**
 * Subscription needsAttention resolver (no HTTP / DB).
 * Run: node scripts/test-client-subscription-needs-attention.mjs
 */
import {
    resolveSubscriptionNeedsAttention,
    utcCalendarDayMs,
} from '../src/modules/clients/client.subscription-attention.js';

const results = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};

const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const NOW = new Date('2026-10-11T15:30:00.000Z');

const expired = resolveSubscriptionNeedsAttention(
    { endDate: '2026-10-10T23:59:59.000Z' },
    NOW
);
if (
    expired?.kind === 'subscription_expired' &&
    expired.suggestedAction === 'renew_or_archive'
) {
    pass('1. End date yesterday (UTC) → subscription_expired');
} else {
    fail('1. End date yesterday (UTC) → subscription_expired', JSON.stringify(expired));
}

const today = resolveSubscriptionNeedsAttention(
    { endDate: '2026-10-11T18:00:00.000Z' },
    NOW
);
if (
    today?.kind === 'subscription_expires_today' &&
    today.suggestedAction === 'send_renewal_reminder'
) {
    pass('2. End date today (UTC) → subscription_expires_today');
} else {
    fail('2. End date today (UTC) → subscription_expires_today', JSON.stringify(today));
}

const tomorrow = resolveSubscriptionNeedsAttention(
    { endDate: '2026-10-12T00:00:00.000Z' },
    NOW
);
if (tomorrow === null) {
    pass('3. End date tomorrow → null');
} else {
    fail('3. End date tomorrow → null', JSON.stringify(tomorrow));
}

const ongoing = resolveSubscriptionNeedsAttention(
    {
        packageDuration: 'ongoing',
        endDate: '2026-10-10T00:00:00.000Z',
        startDate: '2026-01-01T00:00:00.000Z',
    },
    NOW
);
if (ongoing === null) {
    pass('4. Ongoing package → null');
} else {
    fail('4. Ongoing package → null', JSON.stringify(ongoing));
}

const missingEndResolvable = resolveSubscriptionNeedsAttention(
    {
        startDate: '2026-09-11T00:00:00.000Z',
        packageDuration: '1_month',
        endDate: undefined,
    },
    NOW
);
if (missingEndResolvable?.kind === 'subscription_expires_today') {
    pass('5. Missing endDate but resolvable 1_month from start → expires today');
} else {
    fail(
        '5. Missing endDate but resolvable 1_month from start → expires today',
        JSON.stringify(missingEndResolvable)
    );
}

const missingEndNotResolvable = resolveSubscriptionNeedsAttention(
    { packageDuration: '6_months', endDate: undefined },
    NOW
);
if (missingEndNotResolvable === null) {
    pass('6. Missing endDate and cannot resolve → null');
} else {
    fail('6. Missing endDate and cannot resolve → null', JSON.stringify(missingEndNotResolvable));
}

const invalid = resolveSubscriptionNeedsAttention({ endDate: 'not-a-date' }, NOW);
if (invalid === null) {
    pass('7. Invalid endDate → null');
} else {
    fail('7. Invalid endDate → null', JSON.stringify(invalid));
}

if (utcCalendarDayMs('2026-10-11T23:59:59Z') === utcCalendarDayMs('2026-10-11T00:00:00Z')) {
    pass('8. UTC calendar day ignores time-of-day');
} else {
    fail('8. UTC calendar day ignores time-of-day', 'mismatch');
}

const failed = results.filter((r) => !r.ok);
console.log('\n---');
console.log(
    `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
);
process.exit(failed.length ? 1 : 0);
