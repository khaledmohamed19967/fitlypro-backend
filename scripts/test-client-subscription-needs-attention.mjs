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

const expectAttention = (name, client, expected) => {
    const actual = resolveSubscriptionNeedsAttention(client, NOW);
    const ok =
        expected === null
            ? actual === null
            : actual?.kind === expected.kind &&
              actual?.suggestedAction === expected.suggestedAction;
    if (ok) {
        pass(name);
    } else {
        fail(name, JSON.stringify(actual));
    }
};

expectAttention('1. Active, ends in 40 days → null', {
    endDate: '2026-11-20T00:00:00.000Z',
}, null);

expectAttention('2. Ends in 5 days → expiring_soon + renewal reminder', {
    endDate: '2026-10-16T00:00:00.000Z',
}, {
    kind: 'subscription_expiring_soon',
    suggestedAction: 'send_renewal_reminder',
});

expectAttention('3. Ends tomorrow → expiring_soon + renewal reminder', {
    endDate: '2026-10-12T00:00:00.000Z',
}, {
    kind: 'subscription_expiring_soon',
    suggestedAction: 'send_renewal_reminder',
});

expectAttention('4. Ends today (UTC) → expires_today + renewal reminder', {
    endDate: '2026-10-11T18:00:00.000Z',
}, {
    kind: 'subscription_expires_today',
    suggestedAction: 'send_renewal_reminder',
});

expectAttention('5. Expired yesterday → renew_or_archive only', {
    endDate: '2026-10-10T23:59:59.000Z',
}, {
    kind: 'subscription_expired',
    suggestedAction: 'renew_or_archive',
});

const expiredNoRenewal = resolveSubscriptionNeedsAttention(
    { endDate: '2026-10-10T00:00:00.000Z' },
    NOW
);
if (
    expiredNoRenewal?.kind === 'subscription_expired' &&
    expiredNoRenewal.suggestedAction !== 'send_renewal_reminder'
) {
    pass('6. Expired does not also return renewal reminder');
} else {
    fail('6. Expired does not also return renewal reminder', JSON.stringify(expiredNoRenewal));
}

expectAttention('7. Inactive client → null even when expired', {
    endDate: '2026-10-01T00:00:00.000Z',
    isActive: false,
}, null);

expectAttention('8. Ongoing package → null', {
    packageDuration: 'ongoing',
    endDate: '2026-10-10T00:00:00.000Z',
    startDate: '2026-01-01T00:00:00.000Z',
}, null);

expectAttention('9. Invalid endDate → null', { endDate: 'not-a-date' }, null);

expectAttention('10. Missing endDate, cannot resolve → null', {
    packageDuration: '6_months',
    endDate: undefined,
}, null);

const resolvableToday = resolveSubscriptionNeedsAttention(
    {
        startDate: '2026-09-11T00:00:00.000Z',
        packageDuration: '1_month',
        endDate: undefined,
    },
    NOW
);
if (resolvableToday?.kind === 'subscription_expires_today') {
    pass('11. Missing endDate but resolvable 1_month from start → expires today');
} else {
    fail('11. Missing endDate but resolvable 1_month from start → expires today', JSON.stringify(resolvableToday));
}

if (utcCalendarDayMs('2026-10-11T23:59:59Z') === utcCalendarDayMs('2026-10-11T00:00:00Z')) {
    pass('12. UTC calendar day ignores time-of-day');
} else {
    fail('12. UTC calendar day ignores time-of-day', 'mismatch');
}

const failed = results.filter((r) => !r.ok);
console.log('\n---');
console.log(
    `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
);
process.exit(failed.length ? 1 : 0);
