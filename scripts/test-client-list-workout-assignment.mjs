/**
 * Trainer client list includes the current workout assignment (no N+1).
 * Run: node scripts/test-client-list-workout-assignment.mjs
 *
 * Prerequisites:
 * - Dev server running (with latest code)
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../src/modules/users/user.model.js'
import Exercise from '../src/modules/exercises/exercise.model.js'
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js'
import PlanAssignment from '../src/modules/workout-plans/plan-assignment.model.js'
import NutritionPlanAssignment from '../src/modules/nutrition-plan-assignments/nutrition-plan-assignment.model.js'

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

async function loginTrainer(email, password) {
    const login = await request('POST', '/auth/login', {
        body: { email, password },
    })
    const token = login.json?.data?.token
    if (!token) {
        throw new Error(`Login failed for ${email}: ${JSON.stringify(login.json)}`)
    }
    return token
}

async function cleanupFixtures({
    trainerIds = [],
    userIds = [],
    planTrainerIds = [],
}) {
    const trainers = [...new Set(trainerIds.map(String))]
    if (trainers.length > 0) {
        await PlanAssignment.deleteMany({ trainerId: { $in: trainers } })
        await NutritionPlanAssignment.deleteMany({ trainerId: { $in: trainers } })
        await WorkoutPlan.deleteMany({ trainerId: { $in: trainers } })
    }
    const users = [...new Set(userIds.map(String))]
    if (users.length > 0) {
        await User.deleteMany({ _id: { $in: users } })
    }
    for (const tid of [...new Set(planTrainerIds.map(String))]) {
        if (!trainers.includes(tid)) {
            await WorkoutPlan.deleteMany({ trainerId: tid })
        }
    }
}

async function main() {
    await mongoose.connect(process.env.APP_DB_URL)

    const suffix = Date.now()
    const password = 'testpass123'
    const searchTag = `ListWp ${suffix}`

    const trainerIds = []
    const userIds = []

    const trainer = await User.create({
        firstName: 'ListWp',
        lastName: 'Trainer',
        email: `list-wp-tr-${suffix}@test.com`,
        password,
        role: 'trainer',
    })
    trainerIds.push(trainer._id)

    const clientActive = await User.create({
        firstName: searchTag,
        lastName: 'Active',
        email: `list-wp-active-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        primaryFitnessGoal: 'muscle_gain',
    })

    const clientEmpty = await User.create({
        firstName: searchTag,
        lastName: 'Empty',
        email: `list-wp-empty-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        primaryFitnessGoal: 'weight_loss',
    })

    const clientPaused = await User.create({
        firstName: searchTag,
        lastName: 'Paused',
        email: `list-wp-paused-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    })

    const clientNutrition = await User.create({
        firstName: searchTag,
        lastName: 'Nutrition',
        email: `list-wp-nutrition-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    })

    const clientMulti = await User.create({
        firstName: searchTag,
        lastName: 'Multi',
        email: `list-wp-multi-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    })

    const clientArchived = await User.create({
        firstName: searchTag,
        lastName: 'Archived',
        email: `list-wp-archived-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    })

    const clientDraft = await User.create({
        firstName: searchTag,
        lastName: 'Draft',
        email: `list-wp-draft-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    })

    const clientMissingPlan = await User.create({
        firstName: searchTag,
        lastName: 'MissingPlan',
        email: `list-wp-missing-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    })

    const clientCompleted = await User.create({
        firstName: searchTag,
        lastName: 'Completed',
        email: `list-wp-completed-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    })

    const clientCancelled = await User.create({
        firstName: searchTag,
        lastName: 'Cancelled',
        email: `list-wp-cancelled-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    })

    const clientTieBreak = await User.create({
        firstName: searchTag,
        lastName: 'TieBreak',
        email: `list-wp-tie-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    })

    userIds.push(
        clientActive._id,
        clientEmpty._id,
        clientPaused._id,
        clientNutrition._id,
        clientMulti._id,
        clientArchived._id,
        clientDraft._id,
        clientMissingPlan._id,
        clientCompleted._id,
        clientCancelled._id,
        clientTieBreak._id
    )

    const token = await loginTrainer(trainer.email, password)

    let systemExercise = await Exercise.findOne({
        'ownership.type': 'system',
        status: 'active',
    })
    if (!systemExercise) {
        systemExercise = await Exercise.create({
            name: `ListWp Exercise ${suffix}`,
            slug: `list-wp-ex-${suffix}`,
            muscles: { primary: 'chest', secondary: [] },
            equipment: ['dumbbell'],
            category: 'strength',
            difficulty: 'beginner',
            ownership: { type: 'system', trainerId: null },
            source: { type: 'manual' },
            status: 'active',
        })
    }

    const planPayload = {
        name: `Hypertrophy Block ${suffix}`,
        description: 'List current-plan coverage',
        duration: 6,
        daysPerWeek: 3,
        goal: 'muscle_gain',
        level: 'beginner',
        isTemplate: false,
        workoutDays: [],
    }

    const activePlan = await request('POST', '/workout-plans', {
        token,
        body: planPayload,
    })
    const activePlanId = activePlan.json?.data?.workoutPlan?.id
    if (!activePlanId) {
        throw new Error(`Active plan create failed: ${JSON.stringify(activePlan.json)}`)
    }

    const olderPlan = await request('POST', '/workout-plans', {
        token,
        body: { ...planPayload, name: `Older Strength ${suffix}` },
    })
    const olderPlanId = olderPlan.json?.data?.workoutPlan?.id

    const newerPlan = await request('POST', '/workout-plans', {
        token,
        body: { ...planPayload, name: `Newer Cut ${suffix}` },
    })
    const newerPlanId = newerPlan.json?.data?.workoutPlan?.id

    const tieOlderPlan = await request('POST', '/workout-plans', {
        token,
        body: { ...planPayload, name: `Tie Older ${suffix}` },
    })
    const tieOlderPlanId = tieOlderPlan.json?.data?.workoutPlan?.id

    const tieNewerPlan = await request('POST', '/workout-plans', {
        token,
        body: { ...planPayload, name: `Tie Newer ${suffix}` },
    })
    const tieNewerPlanId = tieNewerPlan.json?.data?.workoutPlan?.id

    const archivedPlan = await request('POST', '/workout-plans', {
        token,
        body: { ...planPayload, name: `Archived Hypertrophy ${suffix}` },
    })
    const archivedPlanId = archivedPlan.json?.data?.workoutPlan?.id

    const draftPlan = await request('POST', '/workout-plans', {
        token,
        body: { ...planPayload, name: `Draft Hidden ${suffix}` },
    })
    const draftPlanId = draftPlan.json?.data?.workoutPlan?.id

    const completedPlan = await request('POST', '/workout-plans', {
        token,
        body: { ...planPayload, name: `Completed Only ${suffix}` },
    })
    const completedPlanId = completedPlan.json?.data?.workoutPlan?.id

    const assignActive = await request('POST', `/workout-plans/${activePlanId}/assignments`, {
        token,
        body: {
            clientIds: [clientActive._id.toString()],
            startDate: new Date().toISOString(),
            notes: 'list-active',
        },
    })
    if (assignActive.status !== 201) {
        throw new Error(`Assign active failed: ${JSON.stringify(assignActive.json)}`)
    }

    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: activePlanId,
        clientId: clientPaused._id,
        startDate: new Date(),
        status: 'paused',
        notes: 'list-paused',
    })

    await NutritionPlanAssignment.create({
        trainerId: trainer._id,
        planId: new mongoose.Types.ObjectId(),
        clientId: clientNutrition._id,
        startDate: new Date(),
        status: 'active',
        notes: 'nutrition-only',
    })

    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: olderPlanId,
        clientId: clientMulti._id,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        status: 'active',
        notes: 'older-active',
    })
    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: newerPlanId,
        clientId: clientMulti._id,
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        status: 'active',
        notes: 'newer-active',
    })

    const sharedStart = new Date('2026-03-15T00:00:00.000Z')
    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: tieOlderPlanId,
        clientId: clientTieBreak._id,
        startDate: sharedStart,
        status: 'active',
        notes: 'tie-older-created-first',
    })
    await new Promise((resolve) => setTimeout(resolve, 15))
    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: tieNewerPlanId,
        clientId: clientTieBreak._id,
        startDate: sharedStart,
        status: 'active',
        notes: 'tie-newer-created-second',
    })

    const ghostPlanId = new mongoose.Types.ObjectId()
    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: ghostPlanId,
        clientId: clientMissingPlan._id,
        startDate: new Date(),
        status: 'active',
        notes: 'missing-plan-document',
    })

    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: completedPlanId,
        clientId: clientCompleted._id,
        startDate: new Date(),
        status: 'completed',
        notes: 'completed-only',
    })

    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: completedPlanId,
        clientId: clientCancelled._id,
        startDate: new Date(),
        status: 'cancelled',
        notes: 'cancelled-only',
    })

    const assignArchived = await request(
        'POST',
        `/workout-plans/${archivedPlanId}/assignments`,
        {
            token,
            body: {
                clientIds: [clientArchived._id.toString()],
                startDate: new Date().toISOString(),
            },
        }
    )
    if (assignArchived.status !== 201) {
        throw new Error(`Assign archived failed: ${JSON.stringify(assignArchived.json)}`)
    }
    const archiveRes = await request('DELETE', `/workout-plans/${archivedPlanId}`, { token })
    if (archiveRes.status !== 200) {
        throw new Error(`Archive plan failed: ${JSON.stringify(archiveRes.json)}`)
    }

    await WorkoutPlan.findByIdAndUpdate(draftPlanId, { status: 'draft' })
    await PlanAssignment.create({
        trainerId: trainer._id,
        planId: draftPlanId,
        clientId: clientDraft._id,
        startDate: new Date(),
        status: 'active',
        notes: 'draft-plan',
    })

    // --- Cross-trainer fixtures ---
    const trainerOther = await User.create({
        firstName: 'ListWp',
        lastName: 'Other',
        email: `list-wp-tr-other-${suffix}@test.com`,
        password,
        role: 'trainer',
    })
    trainerIds.push(trainerOther._id)

    const clientOtherTrainer = await User.create({
        firstName: searchTag,
        lastName: 'OtherTrainerClient',
        email: `list-wp-other-client-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerOther._id,
    })
    userIds.push(clientOtherTrainer._id)

    const tokenOther = await loginTrainer(trainerOther.email, password)

    const otherPlanRes = await request('POST', '/workout-plans', {
        token: tokenOther,
        body: {
            ...planPayload,
            name: `Other Trainer Secret Plan ${suffix}`,
        },
    })
    const otherPlanId = otherPlanRes.json?.data?.workoutPlan?.id
    if (!otherPlanId) {
        throw new Error(`Other trainer plan failed: ${JSON.stringify(otherPlanRes.json)}`)
    }

    await request('POST', `/workout-plans/${otherPlanId}/assignments`, {
        token: tokenOther,
        body: {
            clientIds: [clientOtherTrainer._id.toString()],
            startDate: new Date().toISOString(),
            notes: 'other-trainer-assignment',
        },
    })

    // Wrong-trainerId assignment on trainer A's client (must not override trainer A's active plan)
    await PlanAssignment.create({
        trainerId: trainerOther._id,
        planId: otherPlanId,
        clientId: clientActive._id,
        startDate: new Date('2099-01-01T00:00:00.000Z'),
        status: 'active',
        notes: 'cross-trainer-wrong-owner',
    })

    // --- Pagination-only trainer (isolated roster) ---
    const trainerPag = await User.create({
        firstName: 'ListWp',
        lastName: 'Paginate',
        email: `list-wp-pag-${suffix}@test.com`,
        password,
        role: 'trainer',
    })
    trainerIds.push(trainerPag._id)

    const pagTag = `ListWpPag ${suffix}`
    const pagClients = []
    // Create oldest → newest so default createdAt desc matches Row0, Row1, Row2.
    for (let i = 2; i >= 0; i--) {
        const client = await User.create({
            firstName: pagTag,
            lastName: `Row${i}`,
            email: `list-wp-pag-${i}-${suffix}@test.com`,
            password,
            role: 'client',
            trainer: trainerPag._id,
        })
        pagClients[i] = client
        userIds.push(client._id)
        if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
    }

    const tokenPag = await loginTrainer(trainerPag.email, password)

    const pagPlanAlpha = await request('POST', '/workout-plans', {
        token: tokenPag,
        body: { ...planPayload, name: `Pagination Plan Alpha ${suffix}` },
    })
    const pagPlanAlphaId = pagPlanAlpha.json?.data?.workoutPlan?.id

    const pagPlanBeta = await request('POST', '/workout-plans', {
        token: tokenPag,
        body: { ...planPayload, name: `Pagination Plan Beta ${suffix}` },
    })
    const pagPlanBetaId = pagPlanBeta.json?.data?.workoutPlan?.id

    await request('POST', `/workout-plans/${pagPlanAlphaId}/assignments`, {
        token: tokenPag,
        body: {
            clientIds: [pagClients[0]._id.toString()],
            startDate: new Date().toISOString(),
            notes: 'pag-alpha',
        },
    })
    await request('POST', `/workout-plans/${pagPlanBetaId}/assignments`, {
        token: tokenPag,
        body: {
            clientIds: [pagClients[2]._id.toString()],
            startDate: new Date().toISOString(),
            notes: 'pag-beta',
        },
    })

    try {
        const list = await request('GET', `/clients?search=${encodeURIComponent(searchTag)}`, {
            token,
        })
        const clients = list.json?.data?.clients
        if (list.status === 200 && Array.isArray(clients)) {
            pass('1. GET /clients search returns clients')
        } else {
            fail('1. GET /clients search returns clients', JSON.stringify(list.json))
        }

        const activeRow = findClient(clients, clientActive._id)
        if (
            activeRow?.workoutPlanAssignment?.status === 'active' &&
            activeRow.workoutPlanAssignment.plan?.name === planPayload.name &&
            activeRow.workoutPlanAssignment.planId === activePlanId
        ) {
            pass('2. Active assignment → workoutPlanAssignment.plan.name')
        } else {
            fail(
                '2. Active assignment → workoutPlanAssignment.plan.name',
                JSON.stringify(activeRow?.workoutPlanAssignment)
            )
        }

        const emptyRow = findClient(clients, clientEmpty._id)
        if (emptyRow && emptyRow.workoutPlanAssignment === null) {
            pass('3. No assignment → workoutPlanAssignment null')
        } else {
            fail(
                '3. No assignment → workoutPlanAssignment null',
                JSON.stringify(emptyRow?.workoutPlanAssignment)
            )
        }

        const pausedRow = findClient(clients, clientPaused._id)
        if (pausedRow && pausedRow.workoutPlanAssignment === null) {
            pass('4. Paused assignment → null')
        } else {
            fail('4. Paused assignment → null', JSON.stringify(pausedRow?.workoutPlanAssignment))
        }

        const nutritionRow = findClient(clients, clientNutrition._id)
        if (nutritionRow && nutritionRow.workoutPlanAssignment === null) {
            pass('5. Nutrition-only assignment is not used as current workout plan')
        } else {
            fail(
                '5. Nutrition-only assignment is not used as current workout plan',
                JSON.stringify(nutritionRow?.workoutPlanAssignment)
            )
        }

        const multiRow = findClient(clients, clientMulti._id)
        if (
            multiRow?.workoutPlanAssignment?.notes === 'newer-active' &&
            multiRow.workoutPlanAssignment.plan?.id === newerPlanId
        ) {
            pass('6. Multiple actives → newest startDate')
        } else {
            fail(
                '6. Multiple actives → newest startDate',
                JSON.stringify(multiRow?.workoutPlanAssignment)
            )
        }

        const archivedRow = findClient(clients, clientArchived._id)
        if (archivedRow?.workoutPlanAssignment?.plan?.id === archivedPlanId) {
            pass('7. Active assignment on archived plan remains visible')
        } else {
            fail(
                '7. Active assignment on archived plan remains visible',
                JSON.stringify(archivedRow?.workoutPlanAssignment)
            )
        }

        const draftRow = findClient(clients, clientDraft._id)
        if (draftRow && draftRow.workoutPlanAssignment === null) {
            pass('8. Active assignment on draft plan is omitted')
        } else {
            fail(
                '8. Active assignment on draft plan is omitted',
                JSON.stringify(draftRow?.workoutPlanAssignment)
            )
        }

        const detail = await request(
            'GET',
            `/clients/${clientActive._id}/workout-plan-assignment`,
            { token }
        )
        if (
            detail.status === 200 &&
            detail.json?.data?.assignment?.id === activeRow?.workoutPlanAssignment?.id &&
            detail.json?.data?.assignment?.plan?.name ===
                activeRow?.workoutPlanAssignment?.plan?.name
        ) {
            pass('9. List DTO matches GET /clients/:id/workout-plan-assignment')
        } else {
            fail(
                '9. List DTO matches GET /clients/:id/workout-plan-assignment',
                JSON.stringify({
                    list: activeRow?.workoutPlanAssignment,
                    detail: detail.json?.data?.assignment,
                })
            )
        }

        const missingRow = findClient(clients, clientMissingPlan._id)
        const missingDetail = await request(
            'GET',
            `/clients/${clientMissingPlan._id}/workout-plan-assignment`,
            { token }
        )
        const missingListOk =
            missingRow &&
            missingRow.workoutPlanAssignment === null &&
            !missingRow.workoutPlanAssignment?.plan?.name
        const missingDetailOk =
            missingDetail.status === 200 && missingDetail.json?.data?.assignment === null
        if (missingListOk && missingDetailOk) {
            pass('10. Missing plan document → list null and detail assignment null')
        } else {
            fail(
                '10. Missing plan document → list null and detail assignment null',
                JSON.stringify({
                    list: missingRow?.workoutPlanAssignment,
                    detail: missingDetail.json?.data,
                })
            )
        }

        const completedRow = findClient(clients, clientCompleted._id)
        if (completedRow && completedRow.workoutPlanAssignment === null) {
            pass('11. Completed-only assignment → null')
        } else {
            fail(
                '11. Completed-only assignment → null',
                JSON.stringify(completedRow?.workoutPlanAssignment)
            )
        }

        const cancelledRow = findClient(clients, clientCancelled._id)
        if (cancelledRow && cancelledRow.workoutPlanAssignment === null) {
            pass('12. Cancelled-only assignment → null')
        } else {
            fail(
                '12. Cancelled-only assignment → null',
                JSON.stringify(cancelledRow?.workoutPlanAssignment)
            )
        }

        const tieRow = findClient(clients, clientTieBreak._id)
        if (
            tieRow?.workoutPlanAssignment?.notes === 'tie-newer-created-second' &&
            tieRow.workoutPlanAssignment.plan?.id === tieNewerPlanId
        ) {
            pass('13. Same startDate → newer createdAt wins')
        } else {
            fail(
                '13. Same startDate → newer createdAt wins',
                JSON.stringify(tieRow?.workoutPlanAssignment)
            )
        }

        const listTrainer1 = clients || []
        const leakedOtherClient = listTrainer1.some(
            (c) => String(c.id) === String(clientOtherTrainer._id)
        )
        const leakedOtherPlan = listTrainer1.some(
            (c) => c.workoutPlanAssignment?.plan?.name === `Other Trainer Secret Plan ${suffix}`
        )
        if (!leakedOtherClient && !leakedOtherPlan) {
            pass('14. Trainer A search does not expose trainer B clients or plans')
        } else {
            fail(
                '14. Trainer A search does not expose trainer B clients or plans',
                JSON.stringify(
                    listTrainer1.map((c) => ({
                        id: c.id,
                        plan: c.workoutPlanAssignment?.plan?.name,
                    }))
                )
            )
        }

        const listOther = await request(
            'GET',
            `/clients?search=${encodeURIComponent(searchTag)}`,
            { token: tokenOther }
        )
        const otherClients = listOther.json?.data?.clients || []
        const onlyOwn =
            otherClients.length === 1 &&
            String(otherClients[0].id) === String(clientOtherTrainer._id) &&
            otherClients[0].workoutPlanAssignment?.plan?.name ===
                `Other Trainer Secret Plan ${suffix}`
        if (listOther.status === 200 && onlyOwn) {
            pass('15. Trainer B list only includes own client with correct plan')
        } else {
            fail(
                '15. Trainer B list only includes own client with correct plan',
                JSON.stringify(otherClients)
            )
        }

        if (
            activeRow?.workoutPlanAssignment?.plan?.name === planPayload.name &&
            activeRow.workoutPlanAssignment.notes === 'list-active'
        ) {
            pass('16. Cross-trainer assignment on same clientId does not override owned plan')
        } else {
            fail(
                '16. Cross-trainer assignment on same clientId does not override owned plan',
                JSON.stringify(activeRow?.workoutPlanAssignment)
            )
        }

        const forbiddenDetail = await request(
            'GET',
            `/clients/${clientOtherTrainer._id}/workout-plan-assignment`,
            { token }
        )
        if (forbiddenDetail.status === 403 || forbiddenDetail.status === 404) {
            pass('17. Trainer A cannot read trainer B client workout assignment')
        } else {
            fail(
                '17. Trainer A cannot read trainer B client workout assignment',
                String(forbiddenDetail.status)
            )
        }

        const page1 = await request('GET', '/clients?page=1&limit=2', { token: tokenPag })
        const page1Clients = page1.json?.data?.clients || []
        const page1Meta = page1.json?.data?.pagination
        const row0 = findClient(page1Clients, pagClients[0]._id)
        const row1 = findClient(page1Clients, pagClients[1]._id)
        const row2OnPage1 = findClient(page1Clients, pagClients[2]._id)

        const page1Ok =
            page1.status === 200 &&
            page1Meta?.total === 3 &&
            page1Meta?.pages === 2 &&
            page1Clients.length === 2 &&
            row0?.workoutPlanAssignment?.plan?.name === `Pagination Plan Alpha ${suffix}` &&
            row1?.workoutPlanAssignment === null &&
            !row2OnPage1

        if (page1Ok) {
            pass('18. Page 1 limit=2: correct plan names, empty assignment, no page-2 leak')
        } else {
            fail(
                '18. Page 1 limit=2: correct plan names, empty assignment, no page-2 leak',
                JSON.stringify({
                    meta: page1Meta,
                    clients: page1Clients.map((c) => ({
                        id: c.id,
                        plan: c.workoutPlanAssignment?.plan?.name,
                    })),
                })
            )
        }

        const page2 = await request('GET', '/clients?page=2&limit=2', { token: tokenPag })
        const page2Clients = page2.json?.data?.clients || []
        const row2 = findClient(page2Clients, pagClients[2]._id)
        const page2Ok =
            page2.status === 200 &&
            page2.json?.data?.pagination?.total === 3 &&
            page2Clients.length === 1 &&
            row2?.workoutPlanAssignment?.plan?.name === `Pagination Plan Beta ${suffix}` &&
            !findClient(page2Clients, pagClients[0]._id)

        if (page2Ok) {
            pass('19. Page 2 limit=2: correct plan only for oldest client on page')
        } else {
            fail(
                '19. Page 2 limit=2: correct plan only for oldest client on page',
                JSON.stringify({
                    meta: page2.json?.data?.pagination,
                    clients: page2Clients.map((c) => ({
                        id: c.id,
                        plan: c.workoutPlanAssignment?.plan?.name,
                    })),
                })
            )
        }

        const emptyPage = await request('GET', '/clients?page=99&limit=10', {
            token: tokenPag,
        })
        if (
            emptyPage.status === 200 &&
            Array.isArray(emptyPage.json?.data?.clients) &&
            emptyPage.json.data.clients.length === 0 &&
            emptyPage.json.data.pagination?.total === 3
        ) {
            pass('20. Empty page returns no clients; total unchanged')
        } else {
            fail(
                '20. Empty page returns no clients; total unchanged',
                JSON.stringify(emptyPage.json?.data?.pagination)
            )
        }
    } finally {
        await cleanupFixtures({
            trainerIds: [...trainerIds, trainer._id, trainerOther._id, trainerPag._id],
            userIds: [...userIds, trainer._id, trainerOther._id, trainerPag._id],
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
