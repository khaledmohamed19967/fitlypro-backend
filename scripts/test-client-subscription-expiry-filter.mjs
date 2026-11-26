/**
 * GET /clients `subscriptionExpiry` filter (unit + optional HTTP).
 * Run: node scripts/test-client-subscription-expiry-filter.mjs
 */
import 'dotenv/config'
import {
    EXPIRING_SOON_DAYS_MAX,
    utcCalendarDayMs,
} from '../src/modules/clients/client.subscription-attention.js'
import {
    SUBSCRIPTION_EXPIRY_FILTER_VALUES,
    filterClientsBySubscriptionExpiry,
    isSubscriptionExpiryFilter,
    matchesSubscriptionExpiryFilter,
} from '../src/modules/clients/client.subscription-expiry-filter.js'

const results = []
const pass = (name) => {
    results.push({ name, ok: true })
    console.log(`PASS: ${name}`)
}
const fail = (name, detail) => {
    results.push({ name, ok: false, detail })
    console.log(`FAIL: ${name} — ${detail}`)
}

const NOW = new Date('2026-10-11T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function utcOffsetDate(offsetDays) {
    return new Date(utcCalendarDayMs(NOW) + offsetDays * DAY_MS)
}

function client(partial) {
    return {
        startDate: undefined,
        packageDuration: '1_month',
        endDate: utcOffsetDate(0),
        ...partial,
    }
}

// --- Validation ---
for (const value of SUBSCRIPTION_EXPIRY_FILTER_VALUES) {
    if (isSubscriptionExpiryFilter(value)) {
        pass(`Validate: ${value} accepted`)
    } else {
        fail(`Validate: ${value} accepted`, '')
    }
}

if (isSubscriptionExpiryFilter('expired')) {
    pass('Validate: expired accepted')
} else {
    fail('Validate: expired accepted', '')
}

if (!isSubscriptionExpiryFilter('all')) {
    pass('Validate: all omitted (not a filter value)')
} else {
    fail('Validate: all omitted (not a filter value)', '')
}

if (!isSubscriptionExpiryFilter('bogus')) {
    pass('Validate: unsupported value rejected')
} else {
    fail('Validate: unsupported value rejected', '')
}

// --- Boundaries ---
const cases = [
    {
        name: 'expiring_soon: +1 day',
        filter: 'expiring_soon',
        endOffset: 1,
        expect: true,
    },
    {
        name: 'expiring_soon: +7 days',
        filter: 'expiring_soon',
        endOffset: EXPIRING_SOON_DAYS_MAX,
        expect: true,
    },
    {
        name: 'expiring_soon: +8 days excluded',
        filter: 'expiring_soon',
        endOffset: 8,
        expect: false,
    },
    {
        name: 'expiring_soon: today excluded',
        filter: 'expiring_soon',
        endOffset: 0,
        expect: false,
    },
    {
        name: 'expires_today: today',
        filter: 'expires_today',
        endOffset: 0,
        expect: true,
    },
    {
        name: 'expires_today: tomorrow excluded',
        filter: 'expires_today',
        endOffset: 1,
        expect: false,
    },
    {
        name: 'recently_expired: yesterday',
        filter: 'recently_expired',
        endOffset: -1,
        expect: true,
    },
    {
        name: 'recently_expired: 7 days ago',
        filter: 'recently_expired',
        endOffset: -7,
        expect: true,
    },
    {
        name: 'recently_expired: 8 days ago excluded',
        filter: 'recently_expired',
        endOffset: -8,
        expect: false,
    },
    {
        name: 'recently_expired: today excluded',
        filter: 'recently_expired',
        endOffset: 0,
        expect: false,
    },
    {
        name: 'expired: yesterday',
        filter: 'expired',
        endOffset: -1,
        expect: true,
    },
    {
        name: 'expired: 7 days ago',
        filter: 'expired',
        endOffset: -7,
        expect: true,
    },
    {
        name: 'expired: 8 days ago',
        filter: 'expired',
        endOffset: -8,
        expect: true,
    },
    {
        name: 'expired: months ago',
        filter: 'expired',
        endOffset: -90,
        expect: true,
    },
    {
        name: 'expired: today excluded',
        filter: 'expired',
        endOffset: 0,
        expect: false,
    },
    {
        name: 'expired: future excluded',
        filter: 'expired',
        endOffset: 3,
        expect: false,
    },
    {
        name: 'active: +8 days',
        filter: 'active',
        endOffset: 8,
        expect: true,
    },
    {
        name: 'active: +7 days excluded',
        filter: 'active',
        endOffset: 7,
        expect: false,
    },
    {
        name: 'active: yesterday excluded',
        filter: 'active',
        endOffset: -1,
        expect: false,
    },
]

for (const entry of cases) {
    const ok = matchesSubscriptionExpiryFilter(
        client({ endDate: utcOffsetDate(entry.endOffset) }),
        entry.filter,
        NOW
    )
    if (ok === entry.expect) {
        pass(`Boundary: ${entry.name}`)
    } else {
        fail(`Boundary: ${entry.name}`, `got ${ok}`)
    }
}

if (
    matchesSubscriptionExpiryFilter(
        client({ packageDuration: 'ongoing', endDate: null }),
        'active',
        NOW
    )
) {
    pass('Boundary: ongoing → active')
} else {
    fail('Boundary: ongoing → active', '')
}

if (
    !matchesSubscriptionExpiryFilter(
        client({ packageDuration: 'ongoing', endDate: null }),
        'expiring_soon',
        NOW
    )
) {
    pass('Boundary: ongoing excluded from expiring_soon')
} else {
    fail('Boundary: ongoing excluded from expiring_soon', '')
}

if (
    !matchesSubscriptionExpiryFilter(
        client({ packageDuration: 'ongoing', endDate: null }),
        'expired',
        NOW
    )
) {
    pass('Boundary: ongoing excluded from expired')
} else {
    fail('Boundary: ongoing excluded from expired', '')
}

// Overlap: recently_expired ⊂ expired
for (const offset of [-1, -7]) {
    const row = client({ endDate: utcOffsetDate(offset) })
    const inRecent = matchesSubscriptionExpiryFilter(row, 'recently_expired', NOW)
    const inExpired = matchesSubscriptionExpiryFilter(row, 'expired', NOW)
    if (inRecent && inExpired) {
        pass(`Overlap: ${offset}d ago in recently_expired and expired`)
    } else {
        fail(
            `Overlap: ${offset}d ago in recently_expired and expired`,
            JSON.stringify({ inRecent, inExpired })
        )
    }
}

{
    const row = client({ endDate: utcOffsetDate(-8) })
    const inRecent = matchesSubscriptionExpiryFilter(row, 'recently_expired', NOW)
    const inExpired = matchesSubscriptionExpiryFilter(row, 'expired', NOW)
    if (!inRecent && inExpired) {
        pass('Overlap: 8d ago in expired only')
    } else {
        fail('Overlap: 8d ago in expired only', JSON.stringify({ inRecent, inExpired }))
    }
}

if (
    !matchesSubscriptionExpiryFilter(
        client({ packageDuration: undefined, endDate: undefined }),
        'active',
        NOW
    )
) {
    pass('Boundary: missing dates excluded from active')
} else {
    fail('Boundary: missing dates excluded from active', '')
}

// --- Filter before pagination (in-memory roster) ---
const roster = [
    client({ _id: 'soon', endDate: utcOffsetDate(3) }),
    client({ _id: 'today', endDate: utcOffsetDate(0) }),
    client({ _id: 'recent', endDate: utcOffsetDate(-2) }),
    client({ _id: 'active', endDate: utcOffsetDate(20) }),
    client({ _id: 'old', endDate: utcOffsetDate(-30) }),
    client({ _id: 'ongoing', packageDuration: 'ongoing', endDate: null }),
]

const soon = filterClientsBySubscriptionExpiry(roster, 'expiring_soon', NOW)
if (soon.length === 1 && soon[0]._id === 'soon') {
    pass('Filter: expiring_soon roster')
} else {
    fail('Filter: expiring_soon roster', JSON.stringify(soon.map((c) => c._id)))
}

const today = filterClientsBySubscriptionExpiry(roster, 'expires_today', NOW)
if (today.length === 1 && today[0]._id === 'today') {
    pass('Filter: expires_today roster')
} else {
    fail('Filter: expires_today roster', JSON.stringify(today.map((c) => c._id)))
}

const recent = filterClientsBySubscriptionExpiry(roster, 'recently_expired', NOW)
if (recent.length === 1 && recent[0]._id === 'recent') {
    pass('Filter: recently_expired roster')
} else {
    fail('Filter: recently_expired roster', JSON.stringify(recent.map((c) => c._id)))
}

const expired = filterClientsBySubscriptionExpiry(roster, 'expired', NOW)
const expiredIds = expired.map((c) => c._id).sort()
if (expiredIds.join(',') === 'old,recent') {
    pass('Filter: expired roster includes recent + long-expired')
} else {
    fail('Filter: expired roster includes recent + long-expired', expiredIds.join(','))
}

const active = filterClientsBySubscriptionExpiry(roster, 'active', NOW)
const activeIds = active.map((c) => c._id).sort()
if (activeIds.join(',') === 'active,ongoing') {
    pass('Filter: active roster (ongoing + >7 days)')
} else {
    fail('Filter: active roster (ongoing + >7 days)', activeIds.join(','))
}

const allPass = filterClientsBySubscriptionExpiry(roster, undefined, NOW)
if (allPass.length === roster.length) {
    pass('Filter: omit param → all')
} else {
    fail('Filter: omit param → all', String(allPass.length))
}

// Simulate filter-then-paginate totals
const pageSize = 1
const filteredActive = filterClientsBySubscriptionExpiry(roster, 'active', NOW)
const total = filteredActive.length
const page1 = filteredActive.slice(0, pageSize)
const page2 = filteredActive.slice(pageSize, pageSize * 2)
if (total === 2 && page1.length === 1 && page2.length === 1) {
    pass('Pagination: filter before slice preserves total=2 across pages')
} else {
    fail(
        'Pagination: filter before slice preserves total=2 across pages',
        JSON.stringify({ total, page1: page1.length, page2: page2.length })
    )
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
    process.exitCode = 1
}
