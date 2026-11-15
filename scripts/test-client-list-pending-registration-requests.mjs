/**
 * GET /clients pendingRegistrationRequests count.
 * Run: node scripts/test-client-list-pending-registration-requests.mjs
 * Requires: APP_DB_URL
 */
import 'dotenv/config'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import User from '../src/modules/users/user.model.js'
import ClientProspectInvitation from '../src/modules/client-prospect-invitations/client-prospect-invitation.model.js'
import ClientRegistrationRequest from '../src/modules/client-registration-requests/client-registration-request.model.js'
import ClientInvitation from '../src/modules/client-invitations/client-invitation.model.js'
import { CLIENT_REGISTRATION_REQUEST_STATUS } from '../src/modules/client-registration-requests/client-registration-request.constants.js'
import { CLIENT_PROSPECT_INVITATION_STATUS } from '../src/modules/client-prospect-invitations/client-prospect-invitation.constants.js'
import { CLIENT_INVITATION_STATUS } from '../src/modules/client-invitations/client-invitation.constants.js'
import clientService from '../src/modules/clients/client.service.js'

const here = dirname(fileURLToPath(import.meta.url))
const serviceSource = readFileSync(
  join(here, '../src/modules/clients/client.service.js'),
  'utf8'
)

const results = []
const pass = (name) => {
  results.push({ name, ok: true })
  console.log(`PASS: ${name}`)
}
const fail = (name, detail) => {
  results.push({ name, ok: false, detail })
  console.log(`FAIL: ${name} — ${detail}`)
}

function hashToken(raw) {
  return createHash('sha256').update(raw).digest('hex')
}

async function createInvite(trainerId, suffix, phone) {
  return ClientProspectInvitation.create({
    trainerId,
    clientName: `Prospect ${suffix}`,
    phone,
    tokenHash: hashToken(randomBytes(24).toString('hex')),
    status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })
}

async function createRequest(trainerId, invitationId, suffix, approvalStatus) {
  return ClientRegistrationRequest.create({
    invitationId,
    trainerId,
    firstName: 'Req',
    lastName: suffix,
    email: `pending-count-${suffix}-${Date.now()}@test.com`,
    primaryFitnessGoal: 'general_fitness',
    approvalStatus,
  })
}

async function main() {
  if (!process.env.APP_DB_URL) {
    throw new Error('APP_DB_URL is required')
  }

  // Source contract
  if (
    /ClientRegistrationRequest\.countDocuments/.test(serviceSource) &&
    /approvalStatus:\s*CLIENT_REGISTRATION_REQUEST_STATUS\.PENDING/.test(serviceSource) &&
    /pendingRegistrationRequestsPromise/.test(serviceSource) &&
    /pendingRegistrationRequests/.test(serviceSource)
  ) {
    pass('source: listTrainerClients counts PENDING via countDocuments in parallel')
  } else {
    fail('source: listTrainerClients counts PENDING via countDocuments in parallel', '')
  }

  await mongoose.connect(process.env.APP_DB_URL)
  const suffix = Date.now()
  const password = 'testpass123'
  const cleanupIds = {
    users: [],
    invites: [],
    requests: [],
    passwordInvites: [],
  }

  try {
    const trainerA = await User.create({
      firstName: 'Count',
      lastName: 'TrainerA',
      email: `pending-count-trainer-a-${suffix}@test.com`,
      password,
      role: 'trainer',
    })
    cleanupIds.users.push(trainerA._id)

    const trainerB = await User.create({
      firstName: 'Count',
      lastName: 'TrainerB',
      email: `pending-count-trainer-b-${suffix}@test.com`,
      password,
      role: 'trainer',
    })
    cleanupIds.users.push(trainerB._id)

    const invitePending1 = await createInvite(trainerA._id, `p1-${suffix}`, '01000000001')
    const invitePending2 = await createInvite(trainerA._id, `p2-${suffix}`, '01000000002')
    const inviteApproved = await createInvite(trainerA._id, `a-${suffix}`, '01000000003')
    const inviteRejected = await createInvite(trainerA._id, `r-${suffix}`, '01000000004')
    const inviteOtherTrainer = await createInvite(trainerB._id, `b-${suffix}`, '01000000005')
    const inviteAwaiting = await createInvite(trainerA._id, `await-${suffix}`, '01000000006')
    cleanupIds.invites.push(
      invitePending1._id,
      invitePending2._id,
      inviteApproved._id,
      inviteRejected._id,
      inviteOtherTrainer._id,
      inviteAwaiting._id
    )

    const req1 = await createRequest(
      trainerA._id,
      invitePending1._id,
      `p1-${suffix}`,
      CLIENT_REGISTRATION_REQUEST_STATUS.PENDING
    )
    const req2 = await createRequest(
      trainerA._id,
      invitePending2._id,
      `p2-${suffix}`,
      CLIENT_REGISTRATION_REQUEST_STATUS.PENDING
    )
    const reqApproved = await createRequest(
      trainerA._id,
      inviteApproved._id,
      `a-${suffix}`,
      CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED
    )
    const reqRejected = await createRequest(
      trainerA._id,
      inviteRejected._id,
      `r-${suffix}`,
      CLIENT_REGISTRATION_REQUEST_STATUS.REJECTED
    )
    const reqOther = await createRequest(
      trainerB._id,
      inviteOtherTrainer._id,
      `b-${suffix}`,
      CLIENT_REGISTRATION_REQUEST_STATUS.PENDING
    )
    cleanupIds.requests.push(
      req1._id,
      req2._id,
      reqApproved._id,
      reqRejected._id,
      reqOther._id
    )

    // Password invitation must not affect count
    const clientUser = await User.create({
      firstName: 'Listed',
      lastName: 'Client',
      email: `pending-count-client-${suffix}@test.com`,
      password,
      role: 'client',
      trainer: trainerA._id,
      primaryFitnessGoal: 'general_fitness',
    })
    cleanupIds.users.push(clientUser._id)

    const passwordInvite = await ClientInvitation.create({
      trainerId: trainerA._id,
      clientId: clientUser._id,
      tokenHash: hashToken(randomBytes(24).toString('hex')),
      status: CLIENT_INVITATION_STATUS.PENDING,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    cleanupIds.passwordInvites.push(passwordInvite._id)

    const page1 = await clientService.listTrainerClients(trainerA._id.toString(), {
      page: 1,
      limit: 1,
    })

    if (page1.pendingRegistrationRequests === 2) {
      pass('count: two pending for trainer A')
    } else {
      fail('count: two pending for trainer A', String(page1.pendingRegistrationRequests))
    }

    if (page1.summary && typeof page1.summary.totalClients === 'number') {
      pass('summary: still present beside pending count')
    } else {
      fail('summary: still present beside pending count', JSON.stringify(page1.summary))
    }

    if (Array.isArray(page1.clients) && page1.pagination) {
      pass('clients + pagination: unchanged shape')
    } else {
      fail('clients + pagination: unchanged shape', '')
    }

    const searched = await clientService.listTrainerClients(trainerA._id.toString(), {
      page: 1,
      limit: 10,
      search: 'Listed',
    })
    if (searched.pendingRegistrationRequests === 2) {
      pass('count: independent of search')
    } else {
      fail('count: independent of search', String(searched.pendingRegistrationRequests))
    }

    const page2 = await clientService.listTrainerClients(trainerA._id.toString(), {
      page: 2,
      limit: 1,
    })
    if (page2.pendingRegistrationRequests === 2) {
      pass('count: independent of pagination')
    } else {
      fail('count: independent of pagination', String(page2.pendingRegistrationRequests))
    }

    const other = await clientService.listTrainerClients(trainerB._id.toString(), {
      page: 1,
      limit: 10,
    })
    if (other.pendingRegistrationRequests === 1) {
      pass('count: trainer isolation')
    } else {
      fail('count: trainer isolation', String(other.pendingRegistrationRequests))
    }

    // Approved/rejected + awaiting prospect invite + password invite must not inflate A beyond 2
    if (
      page1.pendingRegistrationRequests === 2 &&
      reqApproved.approvalStatus === 'approved' &&
      reqRejected.approvalStatus === 'rejected' &&
      inviteAwaiting.status === CLIENT_PROSPECT_INVITATION_STATUS.PENDING
    ) {
      pass('count: excludes approved/rejected/prospect-awaiting/password invites')
    } else {
      fail('count: excludes approved/rejected/prospect-awaiting/password invites', '')
    }
  } finally {
    await ClientRegistrationRequest.deleteMany({ _id: { $in: cleanupIds.requests } })
    await ClientProspectInvitation.deleteMany({ _id: { $in: cleanupIds.invites } })
    await ClientInvitation.deleteMany({ _id: { $in: cleanupIds.passwordInvites } })
    await User.deleteMany({ _id: { $in: cleanupIds.users } })
    await mongoose.disconnect()
  }

  const failed = results.filter((r) => !r.ok)
  if (failed.length) {
    console.error(`\n${failed.length} failed`)
    process.exitCode = 1
  } else {
    console.log(`\nAll ${results.length} checks passed`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
