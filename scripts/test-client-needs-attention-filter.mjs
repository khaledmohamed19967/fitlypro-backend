/**
 * Shared Needs Attention membership + list filter composition.
 * Run: node scripts/test-client-needs-attention-filter.mjs
 */
import {
    isClientInNeedsAttentionSet,
    resolveNeedsAttentionForClient,
    utcCalendarDayMs,
} from '../src/modules/clients/client.subscription-attention.js';
import { buildNeedsAttentionSection } from '../src/modules/coach-dashboard/coach-dashboard.helpers.js';
import { summarizeClientRoster } from '../src/modules/clients/client.list-summary.js';
import { filterClientsBySubscriptionExpiry } from '../src/modules/clients/client.subscription-expiry-filter.js';

const results = [];
const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const NOW = new Date('2026-10-11T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function utcOffsetDate(offsetDays) {
    return new Date(utcCalendarDayMs(NOW) + offsetDays * DAY_MS);
}

function client(partial) {
    return {
        _id: 'c',
        firstName: 'Test',
        lastName: 'Client',
        isActive: true,
        packageDuration: '1_month',
        endDate: utcOffsetDate(0),
        ...partial,
    };
}

// Membership boundaries (shared classifier)
const cases = [
    { name: 'today → in set', offset: 0, expect: true },
    { name: 'yesterday → in set', offset: -1, expect: true },
    { name: '7 days ago → in set', offset: -7, expect: true },
    { name: '8 days ago → out', offset: -8, expect: false },
    { name: 'months ago → out', offset: -90, expect: false },
    { name: 'tomorrow → out (expiring_soon)', offset: 1, expect: false },
    { name: '+5 days → out', offset: 5, expect: false },
    { name: '+20 days → out', offset: 20, expect: false },
];

for (const entry of cases) {
    const row = client({ endDate: utcOffsetDate(entry.offset) });
    const ok = isClientInNeedsAttentionSet(row, NOW) === entry.expect;
    if (ok) pass(`Membership: ${entry.name}`);
    else fail(`Membership: ${entry.name}`, String(isClientInNeedsAttentionSet(row, NOW)));
}

if (!isClientInNeedsAttentionSet(client({ packageDuration: 'ongoing', endDate: null }), NOW)) {
    pass('Membership: ongoing excluded');
} else {
    fail('Membership: ongoing excluded', '');
}

if (
    !isClientInNeedsAttentionSet(
        client({ isActive: false, endDate: utcOffsetDate(0) }),
        NOW
    )
) {
    pass('Membership: inactive excluded');
} else {
    fail('Membership: inactive excluded', '');
}

const todayRecord = resolveNeedsAttentionForClient(client({ endDate: utcOffsetDate(0) }), NOW);
if (todayRecord?.kind === 'subscription_expires_today') {
    pass('Record: today → expires_today');
} else {
    fail('Record: today → expires_today', JSON.stringify(todayRecord));
}

const recentRecord = resolveNeedsAttentionForClient(client({ endDate: utcOffsetDate(-2) }), NOW);
if (recentRecord?.kind === 'subscription_expired') {
    pass('Record: recent → expired');
} else {
    fail('Record: recent → expired', JSON.stringify(recentRecord));
}

if (resolveNeedsAttentionForClient(client({ endDate: utcOffsetDate(-30) }), NOW) === null) {
    pass('Record: long-expired → null');
} else {
    fail('Record: long-expired → null', '');
}

// Overview section uses shared membership
const roster = [
    client({ _id: 'today', endDate: utcOffsetDate(0) }),
    client({ _id: 'recent', endDate: utcOffsetDate(-3) }),
    client({ _id: 'old', endDate: utcOffsetDate(-30) }),
    client({ _id: 'soon', endDate: utcOffsetDate(4) }),
    client({ _id: 'active', endDate: utcOffsetDate(40) }),
    client({ _id: 'ongoing', packageDuration: 'ongoing', endDate: null }),
];

const section = buildNeedsAttentionSection(roster, NOW, 10);
const sectionIds = section.preview.map((p) => p.clientId).sort();
if (section.total === 2 && sectionIds.join(',') === 'recent,today') {
    pass('Overview section matches shared membership');
} else {
    fail(
        'Overview section matches shared membership',
        JSON.stringify({ total: section.total, sectionIds })
    );
}

const summary = summarizeClientRoster(roster, NOW);
if (summary.needsAttention.count === 2) {
    pass('List summary needsAttention count matches Overview');
} else {
    fail('List summary needsAttention count matches Overview', String(summary.needsAttention.count));
}

// Deduped filter (one client, one row) + composition with expired
const filteredAttention = roster.filter((c) => isClientInNeedsAttentionSet(c, NOW));
if (filteredAttention.length === 2) {
    pass('Filter: needsAttention set size=2 (no dupes)');
} else {
    fail('Filter: needsAttention set size=2 (no dupes)', String(filteredAttention.length));
}

const expiredThenAttention = filterClientsBySubscriptionExpiry(roster, 'expired', NOW).filter(
    (c) => isClientInNeedsAttentionSet(c, NOW)
);
if (
    expiredThenAttention.length === 1 &&
    expiredThenAttention[0]._id === 'recent'
) {
    pass('Compose: expired ∩ needsAttention = recent only');
} else {
    fail(
        'Compose: expired ∩ needsAttention = recent only',
        JSON.stringify(expiredThenAttention.map((c) => c._id))
    );
}

const activeThenAttention = filterClientsBySubscriptionExpiry(roster, 'active', NOW).filter((c) =>
    isClientInNeedsAttentionSet(c, NOW)
);
if (activeThenAttention.length === 0) {
    pass('Compose: active ∩ needsAttention = empty');
} else {
    fail('Compose: active ∩ needsAttention = empty', String(activeThenAttention.length));
}

// Pagination after filter
const pageSize = 1;
const page1 = filteredAttention.slice(0, pageSize);
const page2 = filteredAttention.slice(pageSize, pageSize * 2);
if (filteredAttention.length === 2 && page1.length === 1 && page2.length === 1) {
    pass('Pagination: filter before slice');
} else {
    fail('Pagination: filter before slice', '');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
