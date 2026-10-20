/**
 * GET /clients needsAttention (subscription phase 1) + isolation.
 * Run: node scripts/test-client-list-needs-attention.mjs
 *
 * Prerequisites: dev server running with latest code.
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../src/modules/users/user.model.js'
import PlanAssignment from '../src/modules/workout-plans/plan-assignment.model.js'
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js'
import { utcCalendarDayMs } from '../src/modules/clients/client.subscription-attention.js'

const DAY_MS = 24 * 60 * 60 * 1000

function utcDateWithDayOffset(offsetDays) {
    const todayMs = utcCalendarDayMs(new Date())
    return new Date(todayMs + offsetDays * DAY_MS)
}

const BASE = process.env.API_URL || 'http://localhost:8000'
const API = `${BASE}/api/v1`

const results = []

const pass = (name) => {
    results.push({ name, ok: true })
    console.log(`PASS: ${name}`)
}

const fail = (name, detail) => {
    results.push({ name, ok: false, detail })
    console.log(`FAIL: ${name} — ${detail}`)
}

async function request(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const json = await res.json().catch(() => ({}))
    return { status: res.status, json }
}

function findClient(list, id) {
    return (list || []).find((client) => String(client.id) === String(id))
}

async function main() {
    await mongoose.connect(process.env.APP_DB_URL)

    const suffix = Date.now()
    const password = 'testpass123'
    const searchTag = `ListAtt ${suffix}`

    const trainer = await User.create({
        firstName: 'ListAtt',
        lastName: 'Trainer',
        email: `list-att-tr-${suffix}@test.com`,
        password,
        role: 'trainer',
    })

    const trainerOther = await User.create({
        firstName: 'ListAtt',
        lastName: 'Other',
        email: `list-att-other-${suffix}@test.com`,
        password,
        role: 'trainer',
    })

    const clientExpired = await User.create({
        firstName: searchTag,
        lastName: 'Expired',
        email: `list-att-exp-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        endDate: utcDateWithDayOffset(-1),
    })

    const clientToday = await User.create({
        firstName: searchTag,
        lastName: 'Today',
        email: `list-att-today-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        endDate: utcDateWithDayOffset(0),
    })

    const clientFuture = await User.create({
        firstName: searchTag,
        lastName: 'Future',
        email: `list-att-fut-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        endDate: utcDateWithDayOffset(1),
    })

    const clientOngoing = await User.create({
        firstName: searchTag,
        lastName: 'Ongoing',
        email: `list-att-ong-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        packageDuration: 'ongoing',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: null,
    })

    const clientOther = await User.create({
        firstName: searchTag,
        lastName: 'OtherTrainer',
        email: `list-att-othc-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerOther._id,
        endDate: utcDateWithDayOffset(-1),
    })

    const plan = await WorkoutPlan.create({
        name: `ListAtt Plan ${suffix}`,
        description: 'needs attention test',
        duration: 4,
        daysPerWeek: 2,
        goal: 'muscle_gain',
        level: 'beginner',
        isTemplate: false,
        workoutDays: [],
        ownership: { type: 'trainer', trainerId: trainer._id },
        trainerId: trainer._id,
        status: 'active',
    })

    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: plan._id,
        clientId: clientFuture._id,
        startDate: new Date(),
        status: 'active',
        notes: 'list-att-workout',
    })

    const login = await request('POST', '/auth/login', {
        body: { email: trainer.email, password },
    })
    const token = login.json?.data?.token
    if (!token) throw new Error(`Login failed: ${JSON.stringify(login.json)}`)

    const loginOther = await request('POST', '/auth/login', {
        body: { email: trainerOther.email, password },
    })
    const tokenOther = loginOther.json?.data?.token

    try {
        const search = await request('GET', `/clients?search=${encodeURIComponent(searchTag)}`, {
            token,
        })
        const clients = search.json?.data?.clients
        if (search.status !== 200 || !Array.isArray(clients)) {
            fail('Search returns clients', JSON.stringify(search.json))
        } else {
            pass('Search returns clients')
        }

        const expiredRow = findClient(clients, clientExpired._id)
        if (
            expiredRow?.needsAttention?.kind === 'subscription_expired' &&
            expiredRow.needsAttention.suggestedAction === 'renew_or_archive'
        ) {
            pass('Search: expired client needsAttention')
        } else {
            fail('Search: expired client needsAttention', JSON.stringify(expiredRow?.needsAttention))
        }

        const todayRow = findClient(clients, clientToday._id)
        if (
            todayRow?.needsAttention?.kind === 'subscription_expires_today' &&
            todayRow.needsAttention.suggestedAction === 'send_renewal_reminder'
        ) {
            pass('Search: expires today needsAttention')
        } else {
            fail(
                'Search: expires today needsAttention',
                JSON.stringify(todayRow?.needsAttention)
            )
        }

        const futureRow = findClient(clients, clientFuture._id)
        if (futureRow?.needsAttention === null) {
            pass('Search: future endDate → needsAttention null')
        } else {
            fail('Search: future endDate → needsAttention null', JSON.stringify(futureRow))
        }

        const ongoingRow = findClient(clients, clientOngoing._id)
        if (ongoingRow?.needsAttention === null) {
            pass('Search: ongoing → needsAttention null')
        } else {
            fail('Search: ongoing → needsAttention null', JSON.stringify(ongoingRow))
        }

        if (
            futureRow?.workoutPlanAssignment?.notes === 'list-att-workout' &&
            futureRow.workoutPlanAssignment.plan?.name === plan.name
        ) {
            pass('Search: workoutPlanAssignment unchanged')
        } else {
            fail(
                'Search: workoutPlanAssignment unchanged',
                JSON.stringify(futureRow?.workoutPlanAssignment)
            )
        }

        const paginated = await request('GET', '/clients?page=1&limit=50', { token })
        const pageClients = paginated.json?.data?.clients || []
        const expiredPage = findClient(pageClients, clientExpired._id)
        const todayPage = findClient(pageClients, clientToday._id)
        if (
            expiredPage?.needsAttention?.kind === 'subscription_expired' &&
            todayPage?.needsAttention?.kind === 'subscription_expires_today'
        ) {
            pass('Paginated list: same classification as search')
        } else {
            fail(
                'Paginated list: same classification as search',
                JSON.stringify({
                    expired: expiredPage?.needsAttention,
                    today: todayPage?.needsAttention,
                })
            )
        }

        const otherSearch = await request(
            'GET',
            `/clients?search=${encodeURIComponent(searchTag)}`,
            { token: tokenOther }
        )
        const otherClients = otherSearch.json?.data?.clients || []
        const onlyOther =
            otherClients.length === 1 &&
            String(otherClients[0].id) === String(clientOther._id) &&
            otherClients[0].needsAttention?.kind === 'subscription_expired'
        const noLeak = !findClient(clients, clientOther._id)

        if (onlyOther && noLeak) {
            pass('Trainer isolation: each roster sees only own needsAttention')
        } else {
            fail(
                'Trainer isolation: each roster sees only own needsAttention',
                JSON.stringify({ otherClients, leaked: findClient(clients, clientOther._id) })
            )
        }
    } finally {
        await PlanAssignment.deleteMany({ trainerId: { $in: [trainer._id, trainerOther._id] } })
        await WorkoutPlan.deleteMany({ trainerId: { $in: [trainer._id, trainerOther._id] } })
        await User.deleteMany({
            _id: {
                $in: [
                    trainer._id,
                    trainerOther._id,
                    clientExpired._id,
                    clientToday._id,
                    clientFuture._id,
                    clientOngoing._id,
                    clientOther._id,
                ],
            },
        })
        await mongoose.disconnect()
    }

    const failed = results.filter((r) => !r.ok)
    console.log('\n---')
    console.log(
        `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
    )
    process.exit(failed.length ? 1 : 0)
}

main().catch(async (err) => {
    console.error(err)
    await mongoose.disconnect().catch(() => {})
    process.exit(1)
})
