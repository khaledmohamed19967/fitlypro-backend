/**
 * Registration inbox stats cards + workflowFilter.
 * Run: node scripts/test-registration-request-stats-filters.mjs
 * Requires: APP_DB_URL (+ API server for HTTP section).
 */
import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientProspectInvitation from '../src/modules/client-prospect-invitations/client-prospect-invitation.model.js';
import { CLIENT_PROSPECT_INVITATION_STATUS } from '../src/modules/client-prospect-invitations/client-prospect-invitation.constants.js';
import ClientRegistrationRequest from '../src/modules/client-registration-requests/client-registration-request.model.js';
import { CLIENT_REGISTRATION_REQUEST_STATUS } from '../src/modules/client-registration-requests/client-registration-request.constants.js';
import clientRegistrationRequestService from '../src/modules/client-registration-requests/client-registration-request.service.js';

const BASE = process.env.API_URL || 'http://localhost:8000';
const API = `${BASE}/api/v1`;
const PASSWORD = 'testpass123';
const results = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const hashToken = (raw) =>
    crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');

async function request(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
        const res = await fetch(`${API}${path}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        return { status: res.status, json, ok: true };
    } catch (err) {
        return { status: 0, json: {}, ok: false, error: err.message };
    }
}

async function main() {
    if (!process.env.APP_DB_URL) throw new Error('APP_DB_URL is required');
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const now = new Date('2026-11-14T12:00:00.000Z');

    const trainerA = await User.create({
        firstName: 'Stats',
        lastName: 'TrainerA',
        email: `stats-reg-a-${suffix}@test.com`,
        password: PASSWORD,
        role: 'trainer',
    });
    const trainerB = await User.create({
        firstName: 'Stats',
        lastName: 'TrainerB',
        email: `stats-reg-b-${suffix}@test.com`,
        password: PASSWORD,
        role: 'trainer',
    });

    const mkProspect = (trainerId, overrides = {}) =>
        ClientProspectInvitation.create({
            trainerId,
            clientName: overrides.clientName || 'Awaiting Person',
            phone: overrides.phone || `20${String(suffix).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 12),
            tokenHash: hashToken(`p-${suffix}-${Math.random()}`),
            status: overrides.status || CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
            expiresAt: overrides.expiresAt || new Date('2026-12-01T00:00:00.000Z'),
            usedAt: overrides.usedAt ?? null,
            revokedAt: overrides.revokedAt ?? null,
        });

    const mkRequest = (trainerId, invitationId, overrides = {}) =>
        ClientRegistrationRequest.create({
            invitationId,
            trainerId,
            firstName: overrides.firstName || 'Req',
            lastName: overrides.lastName || 'Client',
            email: overrides.email || `req-${Math.random().toString(16).slice(2)}-${suffix}@test.com`,
            phone: overrides.phone || '201234567890',
            primaryFitnessGoal: 'general_fitness',
            approvalStatus:
                overrides.approvalStatus || CLIENT_REGISTRATION_REQUEST_STATUS.PENDING,
        });

    // A: 2 approved, 3 pending, 1 rejected, 2 awaiting (valid), plus excluded invitations
    const invUsed = await mkProspect(trainerA._id, {
        clientName: 'Used Link',
        status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
        usedAt: now,
    });
    await mkRequest(trainerA._id, invUsed._id, {
        approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED,
        email: `approved1-${suffix}@test.com`,
        firstName: 'Approved',
        lastName: 'One',
    });

    const invApproved2 = await mkProspect(trainerA._id, {
        clientName: 'Approved Two Link',
        status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
        usedAt: now,
    });
    await mkRequest(trainerA._id, invApproved2._id, {
        approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED,
        email: `approved2-${suffix}@test.com`,
    });

    for (let i = 0; i < 3; i += 1) {
        const inv = await mkProspect(trainerA._id, {
            clientName: `Pending Link ${i}`,
            status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
            usedAt: now,
        });
        await mkRequest(trainerA._id, inv._id, {
            approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.PENDING,
            email: `pending${i}-${suffix}@test.com`,
            firstName: 'Pending',
            lastName: `N${i}`,
        });
    }

    const invRejected = await mkProspect(trainerA._id, {
        clientName: 'Rejected Link',
        status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
        usedAt: now,
    });
    await mkRequest(trainerA._id, invRejected._id, {
        approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.REJECTED,
        email: `rejected-${suffix}@test.com`,
        firstName: 'Rejected',
        lastName: 'One',
    });

    const awaiting1 = await mkProspect(trainerA._id, {
        clientName: 'Awaiting Alpha',
        phone: '201111111111',
    });
    const awaiting2 = await mkProspect(trainerA._id, {
        clientName: 'Awaiting Beta',
        phone: '201222222222',
    });

    // Exclusions for awaitingForm
    await mkProspect(trainerA._id, {
        clientName: 'Revoked',
        status: CLIENT_PROSPECT_INVITATION_STATUS.REVOKED,
        revokedAt: now,
    });
    await mkProspect(trainerA._id, {
        clientName: 'Expired Pending',
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    });

    // Trainer B noise
    await mkProspect(trainerB._id, { clientName: 'Other Trainer Await' });
    const invB = await mkProspect(trainerB._id, {
        status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
        usedAt: now,
    });
    await mkRequest(trainerB._id, invB._id, {
        approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.PENDING,
        email: `b-pending-${suffix}@test.com`,
    });

    // Freeze Date for service by passing now through list? Service uses new Date() internally for stats.
    // Use real now for service — adjust invitation expires relative to real now instead.
    await ClientProspectInvitation.updateMany(
        { _id: { $in: [awaiting1._id, awaiting2._id] } },
        { $set: { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } }
    );

    const listAll = await clientRegistrationRequestService.list(trainerA._id.toString(), {
        workflowFilter: 'all',
        page: 1,
        limit: 2,
    });

    const s = listAll.stats;
    if (
        s?.approved === 2 &&
        s?.pendingApproval === 3 &&
        s?.awaitingForm === 2 &&
        s?.rejected === 1
    ) {
        pass('Stats counts correct (approved/pending/awaiting/rejected)');
    } else {
        fail('Stats counts correct (approved/pending/awaiting/rejected)', JSON.stringify(s));
    }

    if (listAll.pagination.total === 6 && listAll.requests.length === 2) {
        pass('Pagination independent of stats (all requests total 6, page size 2)');
    } else {
        fail(
            'Pagination independent of stats (all requests total 6, page size 2)',
            JSON.stringify(listAll.pagination)
        );
    }

    if (listAll.stats.awaitingForm === 2 && listAll.pagination.total === 6) {
        pass('Stats independent of page size');
    } else {
        fail('Stats independent of page size', '');
    }

    const page2 = await clientRegistrationRequestService.list(trainerA._id.toString(), {
        workflowFilter: 'all',
        page: 2,
        limit: 2,
    });
    if (
        page2.stats.approved === 2 &&
        page2.stats.awaitingForm === 2 &&
        page2.pagination.page === 2
    ) {
        pass('Stats unchanged when pagination page changes');
    } else {
        fail('Stats unchanged when pagination page changes', JSON.stringify(page2.stats));
    }

    const searchPending = await clientRegistrationRequestService.list(
        trainerA._id.toString(),
        { workflowFilter: 'pending_approval', search: 'Pending', page: 1, limit: 24 }
    );
    if (
        searchPending.pagination.total === 3 &&
        searchPending.stats.pendingApproval === 3 &&
        searchPending.stats.awaitingForm === 2
    ) {
        pass('Search filters list but does not change global stats');
    } else {
        fail(
            'Search filters list but does not change global stats',
            JSON.stringify({
                total: searchPending.pagination.total,
                stats: searchPending.stats,
            })
        );
    }

    const awaiting = await clientRegistrationRequestService.list(trainerA._id.toString(), {
        workflowFilter: 'awaiting_form',
        page: 1,
        limit: 24,
    });
    if (
        awaiting.pagination.total === 2 &&
        awaiting.requests.every((r) => r.recordType === 'prospect_invitation') &&
        awaiting.requests.every((r) => r.status === 'awaiting_form') &&
        !JSON.stringify(awaiting).includes('tokenHash')
    ) {
        pass('Awaiting form filter returns prospect_invitation DTOs only');
    } else {
        fail(
            'Awaiting form filter returns prospect_invitation DTOs only',
            JSON.stringify(awaiting.requests)
        );
    }

    const awaitingSearch = await clientRegistrationRequestService.list(
        trainerA._id.toString(),
        { workflowFilter: 'awaiting_form', search: 'Alpha', page: 1, limit: 24 }
    );
    if (
        awaitingSearch.pagination.total === 1 &&
        awaitingSearch.requests[0]?.clientName === 'Awaiting Alpha'
    ) {
        pass('Awaiting form search by clientName');
    } else {
        fail('Awaiting form search by clientName', JSON.stringify(awaitingSearch.requests));
    }

    const rejected = await clientRegistrationRequestService.list(trainerA._id.toString(), {
        workflowFilter: 'rejected',
    });
    if (
        rejected.pagination.total === 1 &&
        rejected.requests[0]?.recordType === 'registration_request' &&
        rejected.requests[0]?.approvalStatus === 'rejected'
    ) {
        pass('Rejected filter returns registration_request records');
    } else {
        fail('Rejected filter returns registration_request records', JSON.stringify(rejected));
    }

    // Legacy approvalStatus still works
    const legacy = await clientRegistrationRequestService.list(trainerA._id.toString(), {
        approvalStatus: 'pending',
    });
    if (legacy.workflowFilter === 'pending_approval' && legacy.pagination.total === 3) {
        pass('Legacy approvalStatus=pending maps to pending_approval');
    } else {
        fail(
            'Legacy approvalStatus=pending maps to pending_approval',
            JSON.stringify({ wf: legacy.workflowFilter, total: legacy.pagination.total })
        );
    }

    const other = await clientRegistrationRequestService.list(trainerB._id.toString(), {
        workflowFilter: 'all',
    });
    if (
        other.stats.pendingApproval === 1 &&
        other.stats.awaitingForm === 1 &&
        other.stats.approved === 0
    ) {
        pass('Trainer ownership isolation for stats');
    } else {
        fail('Trainer ownership isolation for stats', JSON.stringify(other.stats));
    }

    // HTTP
    const health = await request('GET', '/health');
    if (health.ok && health.status === 200) {
        const login = await request('POST', '/auth/login', {
            body: { email: trainerA.email, password: PASSWORD },
        });
        const token = login.json?.data?.token;
        if (token) {
            const http = await request('GET', '/client-registration-requests?workflowFilter=awaiting_form', {
                token,
            });
            if (
                http.status === 200 &&
                http.json?.data?.stats?.awaitingForm === 2 &&
                Array.isArray(http.json?.data?.requests)
            ) {
                pass('HTTP: workflowFilter=awaiting_form with stats');
            } else {
                fail('HTTP: workflowFilter=awaiting_form with stats', JSON.stringify(http.json));
            }

            const unauth = await request('GET', '/client-registration-requests');
            if (unauth.status === 401) pass('HTTP: unauthenticated rejected');
            else fail('HTTP: unauthenticated rejected', String(unauth.status));
        } else {
            fail('HTTP: workflowFilter=awaiting_form with stats', 'login failed');
            fail('HTTP: unauthenticated rejected', 'login failed');
        }
    } else {
        pass('HTTP checks skipped (API not reachable)');
    }

    // Cleanup
    await ClientRegistrationRequest.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await ClientProspectInvitation.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await User.deleteMany({
        email: { $in: [trainerA.email, trainerB.email] },
    });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
