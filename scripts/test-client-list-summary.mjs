/**
 * Client list summary cards (unit + HTTP).
 * Run: node scripts/test-client-list-summary.mjs
 *
 * Prerequisites for HTTP section: dev server running.
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../src/modules/users/user.model.js'
import {
    classifySubscriptionPackage,
    EXPIRING_SOON_DAYS_MAX,
    EXPIRING_SOON_DAYS_MIN,
    resolveSubscriptionNeedsAttention,
    utcCalendarDayMs,
} from '../src/modules/clients/client.subscription-attention.js'
import {
    isEffectiveEndInRecentlyExpiredWindow,
    summarizeClientRoster,
    SUMMARY_PREVIEW_LIMIT,
} from '../src/modules/clients/client.list-summary.js'

const BASE = process.env.API_URL || 'http://localhost:8000'
const API = `${BASE}/api/v1`
const DAY_MS = 24 * 60 * 60 * 1000

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

function utcOffsetDate(offsetDays) {
    return new Date(utcCalendarDayMs(NOW) + offsetDays * DAY_MS)
}

function rosterRow(id, lastName, endOffsetDays) {
    return {
        _id: id,
        firstName: 'Summary',
        lastName,
        endDate: utcOffsetDate(endOffsetDays),
    }
}

// --- Unit: boundaries ---
if (classifySubscriptionPackage({ endDate: utcOffsetDate(-1) }, NOW)?.bucket === 'expired') {
    pass('Unit: yesterday → expired')
} else {
    fail('Unit: yesterday → expired', '')
}

if (classifySubscriptionPackage({ endDate: utcOffsetDate(0) }, NOW)?.bucket === 'expires_today') {
    pass('Unit: today → expires_today')
} else {
    fail('Unit: today → expires_today', '')
}

if (classifySubscriptionPackage({ endDate: utcOffsetDate(1) }, NOW)?.bucket === 'expiring_soon') {
    pass('Unit: tomorrow → expiring_soon')
} else {
    fail('Unit: tomorrow → expiring_soon', '')
}

if (classifySubscriptionPackage({ endDate: utcOffsetDate(7) }, NOW)?.bucket === 'expiring_soon') {
    pass(`Unit: +${EXPIRING_SOON_DAYS_MAX} days → expiring_soon`)
} else {
    fail(`Unit: +${EXPIRING_SOON_DAYS_MAX} days → expiring_soon`, '')
}

if (classifySubscriptionPackage({ endDate: utcOffsetDate(8) }, NOW) === null) {
    pass('Unit: +8 days → no bucket')
} else {
    fail('Unit: +8 days → no bucket', '')
}

if (classifySubscriptionPackage({ packageDuration: 'ongoing' }, NOW) === null) {
    pass('Unit: ongoing → no bucket')
} else {
    fail('Unit: ongoing → no bucket', '')
}

if (classifySubscriptionPackage({ endDate: 'bad' }, NOW) === null) {
    pass('Unit: invalid endDate → no bucket')
} else {
    fail('Unit: invalid endDate → no bucket', '')
}

const boundaryTime = new Date('2026-10-11T23:59:59.000Z')
if (classifySubscriptionPackage({ endDate: boundaryTime }, NOW)?.bucket === 'expires_today') {
    pass('Unit: UTC end-of-day still expires_today')
} else {
    fail('Unit: UTC end-of-day still expires_today', '')
}

const OCT20 = new Date('2026-10-20T12:00:00.000Z')
const oct20Day = (offset) => new Date(utcCalendarDayMs(OCT20) + offset * DAY_MS)

if (isEffectiveEndInRecentlyExpiredWindow(oct20Day(-1), OCT20)) {
    pass('Unit: recentlyExpired includes yesterday (Oct 19)')
} else {
    fail('Unit: recentlyExpired includes yesterday (Oct 19)', '')
}

if (isEffectiveEndInRecentlyExpiredWindow(oct20Day(-7), OCT20)) {
    pass('Unit: recentlyExpired includes 7 days ago (Oct 13)')
} else {
    fail('Unit: recentlyExpired includes 7 days ago (Oct 13)', '')
}

if (!isEffectiveEndInRecentlyExpiredWindow(oct20Day(0), OCT20)) {
    pass('Unit: recentlyExpired excludes today (Oct 20)')
} else {
    fail('Unit: recentlyExpired excludes today (Oct 20)', '')
}

if (!isEffectiveEndInRecentlyExpiredWindow(oct20Day(-8), OCT20)) {
    pass('Unit: recentlyExpired excludes older than 7 days (Oct 12)')
} else {
    fail('Unit: recentlyExpired excludes older than 7 days (Oct 12)', '')
}

if (!isEffectiveEndInRecentlyExpiredWindow(oct20Day(3), OCT20)) {
    pass('Unit: recentlyExpired excludes future end dates')
} else {
    fail('Unit: recentlyExpired excludes future end dates', '')
}

if (!isEffectiveEndInRecentlyExpiredWindow('bad', OCT20)) {
    pass('Unit: recentlyExpired excludes invalid end dates')
} else {
    fail('Unit: recentlyExpired excludes invalid end dates', '')
}

// --- Unit: roster summary ---
const manyExpired = Array.from({ length: 8 }, (_, i) =>
    rosterRow(`exp-${i}`, `E${i}`, -1 - i)
)
const summaryMany = summarizeClientRoster(manyExpired, NOW)
if (
    summaryMany.needsAttention.count === 8 &&
    summaryMany.needsAttention.clients.length === SUMMARY_PREVIEW_LIMIT
) {
    pass('Unit: needAttention count full, preview capped at 5')
} else {
    fail(
        'Unit: needAttention count full, preview capped at 5',
        JSON.stringify(summaryMany.needsAttention)
    )
}

const mixed = [
    rosterRow('a', 'Expired', -2),
    rosterRow('b', 'Today', 0),
    rosterRow('c', 'Soon', 3),
    rosterRow('d', 'Later', 30),
]
const mixedSummary = summarizeClientRoster(mixed, NOW)
if (
    mixedSummary.totalClients === 4 &&
    mixedSummary.needsAttention.count === 2 &&
    mixedSummary.recentlyExpired.count === 1 &&
    mixedSummary.expiresToday.count === 1 &&
    mixedSummary.expiringSoon.count === 1
) {
    pass('Unit: mixed roster card counts')
} else {
    fail('Unit: mixed roster card counts', JSON.stringify(mixedSummary))
}

if (mixedSummary.recentlyExpired.clients[0]?.id === 'a') {
    pass('Unit: recentlyExpired preview is earliest in window')
} else {
    fail(
        'Unit: recentlyExpired preview is earliest in window',
        JSON.stringify(mixedSummary.recentlyExpired)
    )
}

const windowRoster = [
    {
        _id: 'old',
        firstName: 'Summary',
        lastName: 'TooOld',
        endDate: oct20Day(-8),
    },
    {
        _id: 'edge',
        firstName: 'Summary',
        lastName: 'SevenDays',
        endDate: oct20Day(-7),
    },
    {
        _id: 'yday',
        firstName: 'Summary',
        lastName: 'Yesterday',
        endDate: oct20Day(-1),
    },
    {
        _id: 'today',
        firstName: 'Summary',
        lastName: 'Today',
        endDate: oct20Day(0),
    },
]
const windowSummary = summarizeClientRoster(windowRoster, OCT20)
if (
    windowSummary.recentlyExpired.count === 2 &&
    windowSummary.recentlyExpired.clients.map((c) => c.id).join(',') === 'edge,yday'
) {
    pass('Unit: recentlyExpired roster window boundaries')
} else {
    fail('Unit: recentlyExpired roster window boundaries', JSON.stringify(windowSummary.recentlyExpired))
}

if (summaryMany.needsAttention.count === 8) {
    pass('Unit: needsAttention unchanged by recentlyExpired')
} else {
    fail('Unit: needsAttention unchanged by recentlyExpired', String(summaryMany.needsAttention.count))
}

if (summaryMany.recentlyExpired.count === 7) {
    pass('Unit: recentlyExpired count across full roster (excludes 8th day)')
} else {
    fail('Unit: recentlyExpired count across full roster', JSON.stringify(summaryMany.recentlyExpired))
}

const previewIds = mixedSummary.needsAttention.clients.map((c) => c.id)
if (new Set(previewIds).size === previewIds.length) {
    pass('Unit: no duplicate previews in needAttention')
} else {
    fail('Unit: no duplicate previews in needAttention', previewIds.join(','))
}

const todayRow = mixedSummary.expiresToday.clients.find((c) => c.id === 'b')
if (
    todayRow &&
    resolveSubscriptionNeedsAttention({ endDate: utcOffsetDate(0) }, NOW)?.kind ===
        todayRow.needsAttention?.kind
) {
    pass('Unit: expiresToday preview aligns with needsAttention kind')
} else {
    fail('Unit: expiresToday preview aligns with needsAttention kind', JSON.stringify(todayRow))
}

// --- HTTP integration ---
async function request(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`${API}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
    const json = await res.json().catch(() => ({}))
    return { status: res.status, json }
}

async function runHttpTests() {
    await mongoose.connect(process.env.APP_DB_URL)
    const suffix = Date.now()
    const password = 'testpass123'

    const trainer = await User.create({
        firstName: 'Sum',
        lastName: 'Trainer',
        email: `sum-tr-${suffix}@test.com`,
        password,
        role: 'trainer',
    })

    const trainerB = await User.create({
        firstName: 'Sum',
        lastName: 'Other',
        email: `sum-other-${suffix}@test.com`,
        password,
        role: 'trainer',
    })

    const now = new Date()
    const day = (n) => new Date(utcCalendarDayMs(now) + n * DAY_MS)

    const clients = []
    for (let i = 0; i < 6; i++) {
        clients.push(
            await User.create({
                firstName: 'Card',
                lastName: `Expired${i}`,
                email: `sum-exp-${i}-${suffix}@test.com`,
                password,
                role: 'client',
                trainer: trainer._id,
                endDate: day(-1 - i),
            })
        )
    }
    clients.push(
        await User.create({
            firstName: 'Card',
            lastName: 'Today',
            email: `sum-today-${suffix}@test.com`,
            password,
            role: 'client',
            trainer: trainer._id,
            endDate: day(0),
        })
    )
    clients.push(
        await User.create({
            firstName: 'Card',
            lastName: 'Soon',
            email: `sum-soon-${suffix}@test.com`,
            password,
            role: 'client',
            trainer: trainer._id,
            endDate: day(3),
        })
    )
    clients.push(
        await User.create({
            firstName: 'Card',
            lastName: 'Other',
            email: `sum-oth-${suffix}@test.com`,
            password,
            role: 'client',
            trainer: trainerB._id,
            endDate: day(-1),
        })
    )

    const login = await request('POST', '/auth/login', {
        body: { email: trainer.email, password },
    })
    const token = login.json?.data?.token

    try {
        const list = await request('GET', '/clients?page=1&limit=2', { token })
        const data = list.json?.data
        if (
            list.status === 200 &&
            data?.summary?.totalClients === 8 &&
            data.summary.needsAttention.count === 7 &&
            data.summary.expiresToday.count === 1 &&
            data.summary.expiringSoon.count === 1 &&
            data.summary.needsAttention.clients.length === 5 &&
            typeof data.summary.recentlyExpired?.count === 'number' &&
            data.clients.length === 2 &&
            data.pagination.total === 8
        ) {
            pass('HTTP: summary full roster; page independent')
        } else {
            fail('HTTP: summary full roster; page independent', JSON.stringify(data?.summary))
        }

        if (data?.clients?.[0]?.workoutPlanAssignment !== undefined || true) {
            const hasField = data.clients.every((c) => 'needsAttention' in c)
            if (hasField) {
                pass('HTTP: list rows still include needsAttention')
            } else {
                fail('HTTP: list rows still include needsAttention', '')
            }
        }

        const search = await request('GET', `/clients?search=Card&page=1&limit=10`, { token })
        const searchData = search.json?.data
        if (
            search.status === 200 &&
            searchData?.summary?.totalClients === 8 &&
            searchData.pagination.total === 8
        ) {
            pass('HTTP: search scope matches summary total')
        } else {
            fail(
                'HTTP: search scope matches summary total',
                JSON.stringify({
                    total: searchData?.summary?.totalClients,
                    pagination: searchData?.pagination,
                })
            )
        }

        const loginB = await request('POST', '/auth/login', {
            body: { email: trainerB.email, password },
        })
        const listB = await request('GET', '/clients', { token: loginB.json?.data?.token })
        if (
            listB.json?.data?.summary?.totalClients === 1 &&
            listB.json?.data?.summary?.needsAttention?.count === 1
        ) {
            pass('HTTP: trainer isolation for summary')
        } else {
            fail('HTTP: trainer isolation for summary', JSON.stringify(listB.json?.data?.summary))
        }
    } finally {
        await User.deleteMany({
            _id: { $in: [trainer._id, trainerB._id, ...clients.map((c) => c._id)] },
        })
        await mongoose.disconnect()
    }
}

await runHttpTests().catch((err) => {
    console.error(err)
    fail('HTTP suite', err.message)
    mongoose.disconnect().catch(() => {})
})

const failed = results.filter((r) => !r.ok)
console.log('\n---')
console.log(
    `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
)
process.exit(failed.length ? 1 : 0)
