/**
 * Phase 3.3: Coach registration request inbox list + detail APIs.
 * Run: node scripts/test-registration-request-inbox.mjs
 *
 * Prerequisites: Dev server running with the latest code; APP_DB_URL set.
 */
import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientRegistrationRequest from '../src/modules/client-registration-requests/client-registration-request.model.js';
import { CLIENT_REGISTRATION_REQUEST_STATUS } from '../src/modules/client-registration-requests/client-registration-request.constants.js';
import ClientInvitation from '../src/modules/client-invitations/client-invitation.model.js';
import { CLIENT_INVITATION_STATUS } from '../src/modules/client-invitations/client-invitation.constants.js';
import HealthReferenceOption from '../src/modules/health-reference/health-reference.model.js';

const BASE = process.env.API_URL || 'http://localhost:8000';
const API = `${BASE}/api/v1`;
const PASSWORD = 'testpass123';

const results = [];
const createdUserIds = [];
const createdRequestIds = [];
const createdInvitationIds = [];
const createdOptionIds = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const trackUser = (id) => {
    if (id) createdUserIds.push(id);
};
const trackRequest = (id) => {
    if (id) createdRequestIds.push(id);
};
const trackInvitation = (id) => {
    if (id) createdInvitationIds.push(id);
};

async function request(method, path, { token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

async function login(email) {
    const res = await request('POST', '/auth/login', {
        body: { email, password: PASSWORD },
    });
    return res.json?.data?.token || null;
}

async function waitForRoute() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
            const res = await fetch(`${API}/client-registration-requests`);
            if (res.status === 401) return true;
        } catch {
            // Server restarting.
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
}

async function makeRequest(trainerId, overrides = {}) {
    const doc = await ClientRegistrationRequest.create({
        invitationId: new mongoose.Types.ObjectId(),
        trainerId,
        firstName: overrides.firstName || 'Inbox',
        lastName: overrides.lastName || 'Client',
        email: overrides.email,
        phone: overrides.phone,
        primaryFitnessGoal: overrides.primaryFitnessGoal || 'general_fitness',
        approvalStatus:
            overrides.approvalStatus || CLIENT_REGISTRATION_REQUEST_STATUS.PENDING,
        createdUserId: overrides.createdUserId ?? null,
        reviewedAt: overrides.reviewedAt ?? null,
        reviewedBy: overrides.reviewedBy ?? null,
        rejectionReason: overrides.rejectionReason ?? null,
        passwordInvitationId: overrides.passwordInvitationId ?? null,
        injuryAreaOptionIds: overrides.injuryAreaOptionIds ?? [],
        allergyOptionIds: overrides.allergyOptionIds ?? [],
        dietaryRestrictionOptionIds: overrides.dietaryRestrictionOptionIds ?? [],
        injuryDetails: overrides.injuryDetails ?? null,
        dateOfBirth: overrides.dateOfBirth,
        gender: overrides.gender,
        currentWeight: overrides.currentWeight,
        targetWeight: overrides.targetWeight,
        height: overrides.height,
        experienceLevel: overrides.experienceLevel,
        programType: overrides.programType,
        sessionsPerWeek: overrides.sessionsPerWeek,
        startDate: overrides.startDate,
        packageDuration: overrides.packageDuration,
        endDate: overrides.endDate,
        additionalNotes: overrides.additionalNotes,
        medicalConditions: overrides.medicalConditions,
        injuries: overrides.injuries,
        createdAt: overrides.createdAt,
    });
    trackRequest(doc._id);

    if (overrides.createdAt instanceof Date) {
        await ClientRegistrationRequest.collection.updateOne(
            { _id: doc._id },
            { $set: { createdAt: overrides.createdAt } }
        );
        doc.createdAt = overrides.createdAt;
    }

    return doc;
}

async function makeInvitation(clientId, trainerId, overrides = {}) {
    const invitation = await ClientInvitation.create({
        clientId,
        trainerId,
        tokenHash: crypto.randomBytes(32).toString('hex'),
        status: overrides.status || CLIENT_INVITATION_STATUS.PENDING,
        expiresAt: overrides.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        usedAt: overrides.usedAt ?? null,
        revokedAt: overrides.revokedAt ?? null,
    });
    trackInvitation(invitation._id);
    return invitation;
}

const responseHasForbiddenSecrets = (payload) => {
    const text = JSON.stringify(payload);
    return (
        text.includes('tokenHash') ||
        text.includes('passwordInvitationClaimedAt') ||
        text.includes('"$2a$') ||
        text.includes('"$2b$') ||
        /"password"\s*:/.test(text)
    );
};

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const email = (label) => `inbox-${label}-${suffix}@test.com`;

    if (!(await waitForRoute())) {
        throw new Error('Inbox routes were not reachable');
    }

    const trainer = await User.create({
        firstName: 'Inbox',
        lastName: 'Trainer',
        email: email('trainer'),
        password: PASSWORD,
        role: 'trainer',
    });
    trackUser(trainer._id);

    const otherTrainer = await User.create({
        firstName: 'Other',
        lastName: 'Trainer',
        email: email('other'),
        password: PASSWORD,
        role: 'trainer',
    });
    trackUser(otherTrainer._id);

    const admin = await User.create({
        firstName: 'Inbox',
        lastName: 'Admin',
        email: email('admin'),
        password: PASSWORD,
        role: 'admin',
    });
    trackUser(admin._id);

    const clientUser = await User.create({
        firstName: 'Inbox',
        lastName: 'Player',
        email: email('player'),
        password: PASSWORD,
        role: 'client',
        trainer: trainer._id,
    });
    trackUser(clientUser._id);

    const trainerToken = await login(trainer.email);
    const otherToken = await login(otherTrainer.email);
    const adminToken = await login(admin.email);
    const clientToken = await login(clientUser.email);
    if (!trainerToken || !otherToken || !adminToken || !clientToken) {
        throw new Error('Fixture login failed');
    }

    const unauthList = await request('GET', '/client-registration-requests');
    const unauthDetail = await request(
        'GET',
        `/client-registration-requests/${new mongoose.Types.ObjectId()}`
    );
    if (unauthList.status === 401 && unauthDetail.status === 401) {
        pass('1. Unauthenticated list and detail are rejected');
    } else {
        fail(
            '1. Unauthenticated list and detail are rejected',
            `list=${unauthList.status} detail=${unauthDetail.status}`
        );
    }

    const clientList = await request('GET', '/client-registration-requests', {
        token: clientToken,
    });
    const adminList = await request('GET', '/client-registration-requests', {
        token: adminToken,
    });
    if (clientList.status === 403 && adminList.status === 403) {
        pass('2. Client and admin tokens cannot access the inbox');
    } else {
        fail(
            '2. Client and admin tokens cannot access the inbox',
            `client=${clientList.status} admin=${adminList.status}`
        );
    }

    const foreign = await makeRequest(otherTrainer._id, {
        email: email('foreign'),
        firstName: 'Foreign',
        lastName: 'Prospect',
    });
    const ownedPending = await makeRequest(trainer._id, {
        email: email('pending'),
        firstName: 'Alpha',
        lastName: 'Pending',
        phone: '15551110001',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const ownedApprovedClient = await User.create({
        firstName: 'Approved',
        lastName: 'Client',
        email: email('approved-client'),
        role: 'client',
        trainer: trainer._id,
        isActive: true,
        primaryFitnessGoal: 'strength',
        joinedCoachAt: new Date(),
    });
    trackUser(ownedApprovedClient._id);
    const pendingInvite = await makeInvitation(ownedApprovedClient._id, trainer._id, {
        expiresAt: new Date(Date.now() + 86400000),
    });
    const ownedApproved = await makeRequest(trainer._id, {
        email: email('approved'),
        firstName: 'Bravo',
        lastName: 'Approved',
        phone: '15551110002',
        approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED,
        createdUserId: ownedApprovedClient._id,
        reviewedAt: new Date(),
        reviewedBy: trainer._id,
        passwordInvitationId: pendingInvite._id,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const ownedRejected = await makeRequest(trainer._id, {
        email: email('rejected'),
        firstName: 'Charlie',
        lastName: 'Rejected',
        phone: '15551110003',
        approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.REJECTED,
        reviewedAt: new Date(),
        reviewedBy: trainer._id,
        rejectionReason: 'Not a fit',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const foreignList = await request('GET', '/client-registration-requests', {
        token: trainerToken,
    });
    const foreignIds = (foreignList.json?.data?.requests || []).map((row) => row.id);
    const foreignDetail = await request(
        'GET',
        `/client-registration-requests/${foreign._id}`,
        { token: trainerToken }
    );
    if (
        foreignList.status === 200 &&
        !foreignIds.includes(String(foreign._id)) &&
        foreignDetail.status === 403
    ) {
        pass('3. Trainer A never sees Trainer B requests in list or detail');
    } else {
        fail(
            '3. Trainer A never sees Trainer B requests in list or detail',
            `listHasForeign=${foreignIds.includes(String(foreign._id))} detail=${foreignDetail.status}`
        );
    }

    const badId = await request('GET', '/client-registration-requests/not-an-id', {
        token: trainerToken,
    });
    const missingId = await request(
        'GET',
        `/client-registration-requests/${new mongoose.Types.ObjectId()}`,
        { token: trainerToken }
    );
    if (badId.status === 400 && missingId.status === 404) {
        pass('4. Invalid id returns 400 and unknown id returns 404');
    } else {
        fail(
            '4. Invalid id returns 400 and unknown id returns 404',
            `bad=${badId.status} missing=${missingId.status}`
        );
    }

    const defaultList = await request('GET', '/client-registration-requests', {
        token: trainerToken,
    });
    const defaultRows = defaultList.json?.data?.requests || [];
    const defaultPagination = defaultList.json?.data?.pagination;
    const dates = defaultRows.map((row) => row.createdAt);
    const sortedNewestFirst = [...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    const onlyOwned = defaultRows.every((row) =>
        [String(ownedPending._id), String(ownedApproved._id), String(ownedRejected._id)].includes(
            row.id
        )
    );
    if (
        defaultList.status === 200 &&
        defaultPagination?.page === 1 &&
        defaultPagination?.limit === 24 &&
        defaultPagination?.total >= 3 &&
        dates.join('|') === sortedNewestFirst.join('|') &&
        onlyOwned &&
        !responseHasForbiddenSecrets(defaultList.json)
    ) {
        pass('5. Default list uses page 1 / limit 24, newest first, trainer-scoped');
    } else {
        fail(
            '5. Default list uses page 1 / limit 24, newest first, trainer-scoped',
            `page=${defaultPagination?.page} limit=${defaultPagination?.limit} total=${defaultPagination?.total}`
        );
    }

    const pendingOnly = await request(
        'GET',
        '/client-registration-requests?approvalStatus=pending',
        { token: trainerToken }
    );
    const approvedOnly = await request(
        'GET',
        '/client-registration-requests?approvalStatus=approved',
        { token: trainerToken }
    );
    const rejectedOnly = await request(
        'GET',
        '/client-registration-requests?approvalStatus=rejected',
        { token: trainerToken }
    );
    const pendingIds = (pendingOnly.json?.data?.requests || []).map((row) => row.id);
    const approvedIds = (approvedOnly.json?.data?.requests || []).map((row) => row.id);
    const rejectedIds = (rejectedOnly.json?.data?.requests || []).map((row) => row.id);
    if (
        pendingIds.includes(String(ownedPending._id)) &&
        !pendingIds.includes(String(ownedApproved._id)) &&
        approvedIds.includes(String(ownedApproved._id)) &&
        rejectedIds.includes(String(ownedRejected._id)) &&
        (pendingOnly.json?.data?.requests || []).every((row) => row.approvalStatus === 'pending')
    ) {
        pass('6. approvalStatus filters pending, approved, and rejected correctly');
    } else {
        fail('6. approvalStatus filters pending, approved, and rejected correctly', 'filter mismatch');
    }

    const searchFirst = await request(
        'GET',
        '/client-registration-requests?search=alpha',
        { token: trainerToken }
    );
    const searchLast = await request(
        'GET',
        '/client-registration-requests?search=APPROVED',
        { token: trainerToken }
    );
    const searchEmail = await request(
        'GET',
        `/client-registration-requests?search=${encodeURIComponent(email('rejected'))}`,
        { token: trainerToken }
    );
    const searchPhone = await request(
        'GET',
        '/client-registration-requests?search=15551110002',
        { token: trainerToken }
    );
    const searchRegex = await request(
        'GET',
        `/client-registration-requests?search=${encodeURIComponent('(+)')}`,
        { token: trainerToken }
    );
    const combined = await request(
        'GET',
        '/client-registration-requests?approvalStatus=pending&search=alpha',
        { token: trainerToken }
    );
    if (
        (searchFirst.json?.data?.requests || []).some((row) => row.id === String(ownedPending._id)) &&
        (searchLast.json?.data?.requests || []).some((row) => row.id === String(ownedApproved._id)) &&
        (searchEmail.json?.data?.requests || []).some((row) => row.id === String(ownedRejected._id)) &&
        (searchPhone.json?.data?.requests || []).some((row) => row.id === String(ownedApproved._id)) &&
        searchRegex.status === 200 &&
        (combined.json?.data?.requests || []).length === 1 &&
        combined.json.data.requests[0].id === String(ownedPending._id)
    ) {
        pass('7. Search matches first/last/email/phone case-insensitively and escapes regex');
    } else {
        fail(
            '7. Search matches first/last/email/phone case-insensitively and escapes regex',
            `regexStatus=${searchRegex.status} combined=${combined.json?.data?.requests?.length}`
        );
    }

    const page1 = await request('GET', '/client-registration-requests?page=1&limit=2', {
        token: trainerToken,
    });
    const page2 = await request('GET', '/client-registration-requests?page=2&limit=2', {
        token: trainerToken,
    });
    const emptySearch = await request(
        'GET',
        '/client-registration-requests?search=zzznomatchinbox',
        { token: trainerToken }
    );
    if (
        page1.json?.data?.pagination?.limit === 2 &&
        page1.json?.data?.requests?.length === 2 &&
        page2.json?.data?.requests?.length >= 1 &&
        page1.json.data.requests[0].id !== page2.json.data.requests[0]?.id &&
        emptySearch.json?.data?.requests?.length === 0 &&
        emptySearch.json?.data?.pagination?.total === 0 &&
        emptySearch.json?.data?.pagination?.pages === 0
    ) {
        pass('8. Pagination metadata and empty results are correct');
    } else {
        fail(
            '8. Pagination metadata and empty results are correct',
            `p1=${page1.json?.data?.requests?.length} p2=${page2.json?.data?.requests?.length}`
        );
    }

    const forbiddenQuery = await request(
        'GET',
        `/client-registration-requests?trainerId=${trainer._id}`,
        { token: trainerToken }
    );
    const badStatus = await request(
        'GET',
        '/client-registration-requests?approvalStatus=nope',
        { token: trainerToken }
    );
    if (forbiddenQuery.status === 400 && badStatus.status === 400) {
        pass('9. Forbidden ownership query fields and invalid status are rejected');
    } else {
        fail(
            '9. Forbidden ownership query fields and invalid status are rejected',
            `forbidden=${forbiddenQuery.status} status=${badStatus.status}`
        );
    }

    const approvedRow = (defaultList.json?.data?.requests || []).find(
        (row) => row.id === String(ownedApproved._id)
    );
    const pendingRow = (defaultList.json?.data?.requests || []).find(
        (row) => row.id === String(ownedPending._id)
    );
    if (
        approvedRow?.clientId === String(ownedApprovedClient._id) &&
        approvedRow?.passwordInvitation?.status === 'pending' &&
        approvedRow?.passwordInvitation?.hasUsableInvitation === true &&
        approvedRow?.passwordInvitation?.invitationUrl === undefined &&
        pendingRow?.clientId == null &&
        pendingRow?.passwordInvitation?.status === 'none' &&
        pendingRow?.passwordInvitation?.hasUsableInvitation === false
    ) {
        pass('10. List invitation summary derives pending and none without URLs');
    } else {
        fail(
            '10. List invitation summary derives pending and none without URLs',
            JSON.stringify({
                approved: approvedRow?.passwordInvitation,
                pending: pendingRow?.passwordInvitation,
            })
        );
    }

    const allergy = await HealthReferenceOption.create({
        category: 'allergy',
        code: `inbox-allergy-${suffix}`,
        label: 'Inbox Allergy',
        status: 'active',
    });
    const dietary = await HealthReferenceOption.create({
        category: 'dietary_restriction',
        code: `inbox-diet-${suffix}`,
        label: 'Inbox Diet',
        status: 'active',
    });
    const injury = await HealthReferenceOption.create({
        category: 'body_area',
        code: `inbox-injury-${suffix}`,
        label: 'Inbox Knee',
        status: 'active',
    });
    createdOptionIds.push(allergy._id, dietary._id, injury._id);

    const detailSource = await makeRequest(trainer._id, {
        email: email('detail'),
        firstName: 'Delta',
        lastName: 'Detail',
        phone: '15551119999',
        dateOfBirth: new Date('1990-05-01T00:00:00.000Z'),
        gender: 'female',
        primaryFitnessGoal: 'endurance',
        currentWeight: 70,
        targetWeight: 65,
        height: 170,
        experienceLevel: 'intermediate',
        programType: 'online_coaching',
        sessionsPerWeek: 4,
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        packageDuration: '3_months',
        endDate: new Date('2026-07-01T00:00:00.000Z'),
        additionalNotes: 'Note',
        medicalConditions: 'None',
        injuries: 'Old sprain',
        injuryDetails: 'Left knee',
        injuryAreaOptionIds: [injury._id],
        allergyOptionIds: [allergy._id],
        dietaryRestrictionOptionIds: [dietary._id],
    });

    const detail = await request(
        'GET',
        `/client-registration-requests/${detailSource._id}`,
        { token: trainerToken }
    );
    const data = detail.json?.data;
    if (
        detail.status === 200 &&
        data?.id === String(detailSource._id) &&
        data.firstName === 'Delta' &&
        data.lastName === 'Detail' &&
        data.email === email('detail') &&
        data.phone === '15551119999' &&
        data.primaryFitnessGoal === 'endurance' &&
        data.currentWeight === 70 &&
        data.targetWeight === 65 &&
        data.height === 170 &&
        data.experienceLevel === 'intermediate' &&
        data.programType === 'online_coaching' &&
        data.sessionsPerWeek === 4 &&
        data.packageDuration === '3_months' &&
        data.additionalNotes === 'Note' &&
        data.medicalConditions === 'None' &&
        data.injuries === 'Old sprain' &&
        data.injuryDetails === 'Left knee' &&
        data.injuryAreaOptionIds.includes(String(injury._id)) &&
        data.allergyOptionIds.includes(String(allergy._id)) &&
        data.dietaryRestrictionOptionIds.includes(String(dietary._id)) &&
        data.injuryAreaOptions?.[0]?.label === 'Inbox Knee' &&
        data.allergyOptions?.[0]?.label === 'Inbox Allergy' &&
        data.dietaryRestrictionOptions?.[0]?.label === 'Inbox Diet' &&
        data.clientId == null &&
        data.passwordInvitation?.status === 'none' &&
        data.passwordInvitation?.invitationId == null &&
        !responseHasForbiddenSecrets(detail.json)
    ) {
        pass('11. Detail returns allowlisted fields, catalog labels, and no secrets');
    } else {
        fail(
            '11. Detail returns allowlisted fields, catalog labels, and no secrets',
            `status=${detail.status} goal=${data?.primaryFitnessGoal}`
        );
    }

    const approvedDetail = await request(
        'GET',
        `/client-registration-requests/${ownedApproved._id}`,
        { token: trainerToken }
    );
    if (
        approvedDetail.status === 200 &&
        approvedDetail.json?.data?.clientId === String(ownedApprovedClient._id) &&
        approvedDetail.json?.data?.passwordInvitation?.status === 'pending' &&
        approvedDetail.json?.data?.passwordInvitation?.invitationId ===
            String(pendingInvite._id) &&
        approvedDetail.json?.data?.passwordInvitation?.hasUsableInvitation === true
    ) {
        pass('12. Approved detail returns clientId and pending invitation summary');
    } else {
        fail(
            '12. Approved detail returns clientId and pending invitation summary',
            JSON.stringify(approvedDetail.json?.data?.passwordInvitation)
        );
    }

    // Invitation status matrix on list/detail
    const usedInvite = await makeInvitation(ownedApprovedClient._id, trainer._id, {
        status: CLIENT_INVITATION_STATUS.USED,
        usedAt: new Date(),
    });
    const revokedInvite = await makeInvitation(ownedApprovedClient._id, trainer._id, {
        status: CLIENT_INVITATION_STATUS.REVOKED,
        revokedAt: new Date(),
    });
    const expiredInvite = await makeInvitation(ownedApprovedClient._id, trainer._id, {
        status: CLIENT_INVITATION_STATUS.PENDING,
        expiresAt: new Date(Date.now() - 1000),
    });

    const usedReq = await makeRequest(trainer._id, {
        email: email('used-inv'),
        approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED,
        createdUserId: ownedApprovedClient._id,
        passwordInvitationId: usedInvite._id,
    });
    const revokedReq = await makeRequest(trainer._id, {
        email: email('revoked-inv'),
        approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED,
        createdUserId: ownedApprovedClient._id,
        passwordInvitationId: revokedInvite._id,
    });
    const expiredReq = await makeRequest(trainer._id, {
        email: email('expired-inv'),
        approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED,
        createdUserId: ownedApprovedClient._id,
        passwordInvitationId: expiredInvite._id,
    });
    const missingInviteReq = await makeRequest(trainer._id, {
        email: email('missing-inv'),
        approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED,
        createdUserId: ownedApprovedClient._id,
        passwordInvitationId: new mongoose.Types.ObjectId(),
    });

    const usedDetail = await request('GET', `/client-registration-requests/${usedReq._id}`, {
        token: trainerToken,
    });
    const revokedDetail = await request(
        'GET',
        `/client-registration-requests/${revokedReq._id}`,
        { token: trainerToken }
    );
    const expiredDetail = await request(
        'GET',
        `/client-registration-requests/${expiredReq._id}`,
        { token: trainerToken }
    );
    const missingDetail = await request(
        'GET',
        `/client-registration-requests/${missingInviteReq._id}`,
        { token: trainerToken }
    );

    if (
        usedDetail.json?.data?.passwordInvitation?.status === 'used' &&
        usedDetail.json?.data?.passwordInvitation?.hasUsableInvitation === false &&
        revokedDetail.json?.data?.passwordInvitation?.status === 'revoked' &&
        expiredDetail.json?.data?.passwordInvitation?.status === 'expired' &&
        missingDetail.json?.data?.passwordInvitation?.status === 'none'
    ) {
        pass('13. Invitation status handles used, revoked, expired, and missing records');
    } else {
        fail(
            '13. Invitation status handles used, revoked, expired, and missing records',
            JSON.stringify({
                used: usedDetail.json?.data?.passwordInvitation?.status,
                revoked: revokedDetail.json?.data?.passwordInvitation?.status,
                expired: expiredDetail.json?.data?.passwordInvitation?.status,
                missing: missingDetail.json?.data?.passwordInvitation?.status,
            })
        );
    }
}

main()
    .catch((err) => {
        console.error(err);
        fail('suite', err?.message || String(err));
    })
    .finally(async () => {
        if (createdInvitationIds.length) {
            await ClientInvitation.deleteMany({ _id: { $in: createdInvitationIds } });
        }
        if (createdRequestIds.length) {
            await ClientRegistrationRequest.deleteMany({ _id: { $in: createdRequestIds } });
        }
        if (createdOptionIds.length) {
            await HealthReferenceOption.deleteMany({ _id: { $in: createdOptionIds } });
        }
        if (createdUserIds.length) {
            await User.deleteMany({ _id: { $in: createdUserIds } });
        }
        const failed = results.filter((item) => !item.ok);
        console.log('\n---');
        console.log(
            `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
        );
        await mongoose.disconnect().catch(() => {});
        process.exit(failed.length ? 1 : 0);
    });
