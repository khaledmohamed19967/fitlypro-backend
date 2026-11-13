/**
 * Phase 3.2: registration request approval and rejection.
 * Run: node scripts/test-registration-request-approval.mjs
 *
 * Prerequisites: dev server running with the latest code (HTTP cases).
 */
import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientRegistrationRequest from '../src/modules/client-registration-requests/client-registration-request.model.js';
import { CLIENT_REGISTRATION_REQUEST_STATUS } from '../src/modules/client-registration-requests/client-registration-request.constants.js';
import clientRegistrationRequestService from '../src/modules/client-registration-requests/client-registration-request.service.js';
import ClientInvitation from '../src/modules/client-invitations/client-invitation.model.js';
import clientInvitationService from '../src/modules/client-invitations/client-invitation.service.js';
import { CLIENT_INVITATION_STATUS } from '../src/modules/client-invitations/client-invitation.constants.js';
import ClientProspectInvitation from '../src/modules/client-prospect-invitations/client-prospect-invitation.model.js';
import { CLIENT_PROSPECT_INVITATION_STATUS } from '../src/modules/client-prospect-invitations/client-prospect-invitation.constants.js';
import NutritionProfile from '../src/modules/nutrition-profiles/nutrition-profile.model.js';
import HealthReferenceOption from '../src/modules/health-reference/health-reference.model.js';
import clientService from '../src/modules/clients/client.service.js';

const BASE = process.env.API_URL || 'http://localhost:8000';
const API = `${BASE}/api/v1`;
const PASSWORD = 'testpass123';

const results = [];
const createdUserIds = [];
const createdRequestIds = [];
const createdOptionIds = [];
const createdProspectIds = [];

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

const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$/.test(value);

async function login(email) {
    const res = await request('POST', '/auth/login', {
        body: { email, password: PASSWORD },
    });
    return res.json?.data?.token || null;
}

async function waitForRoute() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
            const res = await fetch(
                `${API}/client-registration-requests/000000000000000000000000/approve`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                }
            );
            if (res.status === 401) return true;
        } catch {
            // Server is restarting.
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
}

async function makeRequest(trainerId, overrides = {}) {
    const doc = await ClientRegistrationRequest.create({
        invitationId: new mongoose.Types.ObjectId(),
        trainerId,
        firstName: 'Pending',
        lastName: 'Client',
        email: overrides.email,
        primaryFitnessGoal: 'general_fitness',
        approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.PENDING,
        ...overrides,
    });
    trackRequest(doc._id);
    return doc;
}

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const email = (label) => `p32-${label}-${suffix}@test.com`;

    const trainer = await User.create({
        firstName: 'Owner',
        lastName: 'Coach',
        email: email('trainer'),
        password: PASSWORD,
        role: 'trainer',
    });
    trackUser(trainer._id);

    const otherTrainer = await User.create({
        firstName: 'Other',
        lastName: 'Coach',
        email: email('other'),
        password: PASSWORD,
        role: 'trainer',
    });
    trackUser(otherTrainer._id);

    const admin = await User.create({
        firstName: 'Admin',
        lastName: 'User',
        email: email('admin'),
        password: PASSWORD,
        role: 'admin',
    });
    trackUser(admin._id);

    const routeReady = await waitForRoute();
    if (!routeReady) {
        throw new Error('Approval route was not reachable');
    }

    const trainerToken = await login(trainer.email);
    const otherToken = await login(otherTrainer.email);
    const adminToken = await login(admin.email);
    if (!trainerToken || !otherToken || !adminToken) {
        throw new Error('Fixture login failed');
    }

    const unauthRequest = await makeRequest(trainer._id, { email: email('unauth') });
    const unauth = await request(
        'POST',
        `/client-registration-requests/${unauthRequest._id}/approve`
    );
    const unauthAfter = await ClientRegistrationRequest.findById(unauthRequest._id);
    if (unauth.status === 401 && unauthAfter.approvalStatus === 'pending') {
        pass('1. Unauthenticated approval is rejected');
    } else {
        fail('1. Unauthenticated approval is rejected', `status=${unauth.status}`);
    }

    const foreignRequest = await makeRequest(trainer._id, { email: email('foreign') });
    const foreign = await request(
        'POST',
        `/client-registration-requests/${foreignRequest._id}/approve`,
        { token: otherToken }
    );
    const foreignAfter = await ClientRegistrationRequest.findById(foreignRequest._id);
    if (foreign.status === 403 && foreignAfter.approvalStatus === 'pending') {
        pass('2. Another trainer cannot approve the request');
    } else {
        fail('2. Another trainer cannot approve the request', `status=${foreign.status}`);
    }

    const adminRequest = await makeRequest(trainer._id, { email: email('admin-try') });
    const adminAttempt = await request(
        'POST',
        `/client-registration-requests/${adminRequest._id}/approve`,
        { token: adminToken }
    );
    const adminAfter = await ClientRegistrationRequest.findById(adminRequest._id);
    if (adminAttempt.status === 403 && adminAfter.approvalStatus === 'pending') {
        pass('3. Admin cannot approve on behalf of the trainer');
    } else {
        fail('3. Admin cannot approve on behalf of the trainer', `status=${adminAttempt.status}`);
    }

    const injected = await makeRequest(trainer._id, { email: email('inject') });
    const injectedRes = await request(
        'POST',
        `/client-registration-requests/${injected._id}/approve`,
        { token: trainerToken, body: { trainerId: String(otherTrainer._id) } }
    );
    const injectedAfter = await ClientRegistrationRequest.findById(injected._id);
    if (injectedRes.status === 400 && injectedAfter.approvalStatus === 'pending') {
        pass('4. Trainer id in the body is rejected');
    } else {
        fail('4. Trainer id in the body is rejected', `status=${injectedRes.status}`);
    }

    const startDate = new Date('2026-04-01T00:00:00.000Z');
    const prospect = await ClientProspectInvitation.create({
        trainerId: trainer._id,
        clientName: 'Package Client',
        phone: '15550001001',
        tokenHash: crypto.randomBytes(32).toString('hex'),
        status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
        expiresAt: new Date(Date.now() + 86400000),
        usedAt: new Date(),
    });
    createdProspectIds.push(prospect._id);

    const packageRequest = await makeRequest(trainer._id, {
        invitationId: prospect._id,
        email: email('package'),
        firstName: 'Package',
        lastName: 'Client',
        phone: '15550001002',
        gender: 'female',
        primaryFitnessGoal: 'strength',
        startDate,
        packageDuration: '6_months',
        endDate: new Date('2020-01-01T00:00:00.000Z'),
    });
    const approved = await request(
        'POST',
        `/client-registration-requests/${packageRequest._id}/approve`,
        { token: trainerToken, body: {} }
    );
    const approvedUser = await User.findOne({ email: email('package') }).select('+password');
    trackUser(approvedUser?._id);
    const direct = await clientService.createClient(
        {
            firstName: 'Direct',
            lastName: 'Compare',
            email: email('direct'),
            password: PASSWORD,
            primaryFitnessGoal: 'strength',
            startDate,
            packageDuration: '6_months',
            endDate: new Date('2020-01-01T00:00:00.000Z'),
        },
        trainer._id.toString()
    );
    trackUser(direct?.id);
    const directUser = await User.findById(direct.id);
    const prospectAfter = await ClientProspectInvitation.findById(prospect._id);
    const storedRequest = await ClientRegistrationRequest.findById(packageRequest._id);
    const invitationCount = await ClientInvitation.countDocuments({
        clientId: approvedUser?._id,
        status: CLIENT_INVITATION_STATUS.PENDING,
    });
    const responseText = JSON.stringify(approved.json);
    const endDatesMatch =
        approvedUser?.endDate instanceof Date &&
        directUser?.endDate instanceof Date &&
        approvedUser.endDate.toISOString() === directUser.endDate.toISOString();

    if (
        approved.status === 200 &&
        approved.json?.data?.approvalStatus === 'approved' &&
        approved.json?.data?.clientId === String(approvedUser?._id) &&
        approved.json?.data?.invitation?.state === 'created' &&
        typeof approved.json?.data?.invitation?.invitationUrl === 'string' &&
        approved.json?.data?.token === undefined &&
        !responseText.includes('tokenHash') &&
        !responseText.includes('$2a$') &&
        !responseText.includes('$2b$') &&
        approvedUser?.role === 'client' &&
        String(approvedUser.trainer) === String(trainer._id) &&
        approvedUser.isActive === true &&
        approvedUser.joinedCoachAt instanceof Date &&
        !isBcryptHash(approvedUser.password) &&
        (approvedUser.password == null || approvedUser.password === '') &&
        String(approvedUser.registrationRequestId) === String(packageRequest._id) &&
        String(storedRequest.createdUserId) === String(approvedUser._id) &&
        storedRequest.approvalStatus === 'approved' &&
        String(storedRequest.reviewedBy) === String(trainer._id) &&
        endDatesMatch &&
        approvedUser.phone === '15550001002' &&
        invitationCount === 1 &&
        prospectAfter.status === CLIENT_PROSPECT_INVITATION_STATUS.USED
    ) {
        pass('5. Owning trainer approval creates one passwordless active client and an invitation');
    } else {
        fail(
            '5. Owning trainer approval creates one passwordless active client and an invitation',
            `status=${approved.status} endMatch=${endDatesMatch} role=${approvedUser?.role} password=${approvedUser?.password} invites=${invitationCount}`
        );
    }

    const nutritionProfiles = await NutritionProfile.countDocuments({
        clientId: approvedUser?._id,
    });
    if (nutritionProfiles === 0) {
        pass('6. No nutrition profile is created when no restrictions were submitted');
    } else {
        fail('6. No nutrition profile is created when no restrictions were submitted', `count=${nutritionProfiles}`);
    }

    const firstInvitation = await ClientInvitation.findOne({ clientId: approvedUser._id });
    const again = await request(
        'POST',
        `/client-registration-requests/${packageRequest._id}/approve`,
        { token: trainerToken, body: {} }
    );
    const invitationsAfterRepeat = await ClientInvitation.find({ clientId: approvedUser._id });
    const stillPending = invitationsAfterRepeat.filter(
        (item) => item.status === CLIENT_INVITATION_STATUS.PENDING
    );
    const usersForRequest = await User.countDocuments({
        registrationRequestId: packageRequest._id,
    });
    if (
        again.status === 200 &&
        again.json?.data?.invitation?.state === 'reused' &&
        again.json?.data?.invitation?.invitationUrl === undefined &&
        again.json?.data?.invitation?.invitationId === String(firstInvitation._id) &&
        again.json?.data?.clientId === String(approvedUser._id) &&
        stillPending.length === 1 &&
        String(stillPending[0]._id) === String(firstInvitation._id) &&
        firstInvitation.status === CLIENT_INVITATION_STATUS.PENDING &&
        usersForRequest === 1
    ) {
        pass('7. Repeated approval reuses the pending invitation and does not create another user');
    } else {
        fail(
            '7. Repeated approval reuses the pending invitation and does not create another user',
            `status=${again.status} state=${again.json?.data?.invitation?.state} pending=${stillPending.length} users=${usersForRequest}`
        );
    }

    const takenEmail = email('taken');
    const unrelated = await User.create({
        firstName: 'Already',
        lastName: 'Exists',
        email: takenEmail,
        password: PASSWORD,
        role: 'client',
    });
    trackUser(unrelated._id);
    const conflictRequest = await makeRequest(trainer._id, { email: takenEmail });
    const conflict = await request(
        'POST',
        `/client-registration-requests/${conflictRequest._id}/approve`,
        { token: trainerToken, body: {} }
    );
    const conflictAfter = await ClientRegistrationRequest.findById(conflictRequest._id);
    const unrelatedAfter = await User.findById(unrelated._id);
    const adopted = await User.countDocuments({ registrationRequestId: conflictRequest._id });
    if (
        conflict.status === 409 &&
        conflict.json?.errors?.[0]?.code === 'EMAIL_ALREADY_EXISTS' &&
        conflictAfter.approvalStatus === 'pending' &&
        conflictAfter.createdUserId == null &&
        unrelatedAfter.registrationRequestId == null &&
        adopted === 0
    ) {
        pass('8. Email conflict returns 409, stays pending, and does not adopt the existing user');
    } else {
        fail(
            '8. Email conflict returns 409, stays pending, and does not adopt the existing user',
            `status=${conflict.status} approval=${conflictAfter.approvalStatus} adopted=${adopted}`
        );
    }

    const allergy = await HealthReferenceOption.create({
        category: 'allergy',
        code: `p32-allergy-${suffix}`,
        label: 'Phase 32 allergy',
        status: 'active',
    });
    const dietary = await HealthReferenceOption.create({
        category: 'dietary_restriction',
        code: `p32-diet-${suffix}`,
        label: 'Phase 32 diet',
        status: 'active',
    });
    createdOptionIds.push(allergy._id, dietary._id);

    const nutritionRequest = await makeRequest(trainer._id, {
        email: email('nutrition'),
        allergyOptionIds: [allergy._id],
        dietaryRestrictionOptionIds: [dietary._id],
    });
    const nutritionApproval = await clientRegistrationRequestService.approve(
        nutritionRequest._id.toString(),
        trainer._id.toString()
    );
    const nutritionUser = await User.findById(nutritionApproval.clientId);
    trackUser(nutritionUser?._id);
    const profiles = await NutritionProfile.find({ clientId: nutritionUser._id });
    await clientRegistrationRequestService.approve(
        nutritionRequest._id.toString(),
        trainer._id.toString()
    );
    const profilesAfterRetry = await NutritionProfile.countDocuments({
        clientId: nutritionUser._id,
    });
    const allergyIds = (profiles[0]?.allergyOptionIds ?? []).map(String);
    const dietIds = (profiles[0]?.dietaryRestrictionOptionIds ?? []).map(String);
    if (
        profiles.length === 1 &&
        profilesAfterRetry === 1 &&
        allergyIds.includes(String(allergy._id)) &&
        dietIds.includes(String(dietary._id))
    ) {
        pass('9. Nutrition restrictions are saved once and retries do not duplicate the profile');
    } else {
        fail(
            '9. Nutrition restrictions are saved once and retries do not duplicate the profile',
            `before=${profiles.length} after=${profilesAfterRetry}`
        );
    }

    const bogusRequest = await makeRequest(trainer._id, {
        email: email('bogus-option'),
        allergyOptionIds: [new mongoose.Types.ObjectId()],
    });
    let nutritionFailed = false;
    try {
        await clientRegistrationRequestService.approve(
            bogusRequest._id.toString(),
            trainer._id.toString()
        );
    } catch (err) {
        nutritionFailed = err.statusCode === 400;
    }
    const bogusAfter = await ClientRegistrationRequest.findById(bogusRequest._id);
    const bogusUser = await User.findOne({ email: email('bogus-option') });
    trackUser(bogusUser?._id);
    if (
        nutritionFailed &&
        bogusAfter.approvalStatus === 'pending' &&
        bogusAfter.createdUserId == null &&
        !bogusUser
    ) {
        pass('10. Nutrition profile failure rolls the new client back and leaves the request pending');
    } else {
        fail(
            '10. Nutrition profile failure rolls the new client back and leaves the request pending',
            `failed=${nutritionFailed} status=${bogusAfter.approvalStatus} user=${Boolean(bogusUser)}`
        );
    }

    const crashRequest = await makeRequest(trainer._id, { email: email('crash') });
    const recoveredUser = await User.create({
        firstName: 'Crash',
        lastName: 'Client',
        email: email('crash'),
        role: 'client',
        trainer: trainer._id,
        joinedCoachAt: new Date('2026-03-01T00:00:00.000Z'),
        isActive: true,
        registrationRequestId: crashRequest._id,
        primaryFitnessGoal: 'general_fitness',
    });
    trackUser(recoveredUser._id);
    crashRequest.approvalStatus = CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED;
    crashRequest.reviewedAt = new Date();
    crashRequest.reviewedBy = trainer._id;
    crashRequest.createdUserId = null;
    await crashRequest.save();
    const resumed = await clientRegistrationRequestService.approve(
        crashRequest._id.toString(),
        trainer._id.toString()
    );
    const crashUsers = await User.find({ registrationRequestId: crashRequest._id });
    const crashStored = await ClientRegistrationRequest.findById(crashRequest._id);
    const crashJoined = await User.findById(recoveredUser._id);
    if (
        resumed.clientId === String(recoveredUser._id) &&
        crashUsers.length === 1 &&
        String(crashStored.createdUserId) === String(recoveredUser._id) &&
        crashJoined.joinedCoachAt.toISOString() === '2026-03-01T00:00:00.000Z'
    ) {
        pass('11. Retry after a crash reuses the user linked by registrationRequestId');
    } else {
        fail(
            '11. Retry after a crash reuses the user linked by registrationRequestId',
            `clientId=${resumed.clientId} users=${crashUsers.length}`
        );
    }

    const inviteFailRequest = await makeRequest(trainer._id, { email: email('invite-fail') });
    const originalCreate = ClientInvitation.create.bind(ClientInvitation);
    ClientInvitation.create = async () => {
        throw new Error('forced invitation failure');
    };
    let inviteError = null;
    try {
        await clientRegistrationRequestService.approve(
            inviteFailRequest._id.toString(),
            trainer._id.toString()
        );
    } catch (err) {
        inviteError = err;
    } finally {
        ClientInvitation.create = originalCreate;
    }
    const inviteFailUser = await User.findOne({ email: email('invite-fail') }).select('+password');
    trackUser(inviteFailUser?._id);
    const inviteFailRequestAfter = await ClientRegistrationRequest.findById(inviteFailRequest._id);
    const retryInvite = await clientRegistrationRequestService.approve(
        inviteFailRequest._id.toString(),
        trainer._id.toString()
    );
    const inviteFailUsers = await User.countDocuments({
        registrationRequestId: inviteFailRequest._id,
    });
    const inviteFailPending = await ClientInvitation.countDocuments({
        clientId: inviteFailUser?._id,
        status: CLIENT_INVITATION_STATUS.PENDING,
    });
    if (
        inviteError?.statusCode === 500 &&
        inviteError?.errors?.[0]?.code === 'INVITATION_RETRYABLE' &&
        inviteFailRequestAfter.approvalStatus === 'approved' &&
        String(inviteFailRequestAfter.createdUserId) === String(inviteFailUser?._id) &&
        inviteFailUser?.isActive === true &&
        !isBcryptHash(inviteFailUser?.password) &&
        retryInvite.invitation?.state === 'created' &&
        retryInvite.clientId === String(inviteFailUser._id) &&
        inviteFailUsers === 1 &&
        inviteFailPending === 1
    ) {
        pass('12. Invitation failure keeps the client, and retry creates the invitation');
    } else {
        fail(
            '12. Invitation failure keeps the client, and retry creates the invitation',
            `status=${inviteError?.statusCode} code=${inviteError?.errors?.[0]?.code} retry=${retryInvite?.invitation?.state} users=${inviteFailUsers}`
        );
    }

    const concurrentRequest = await makeRequest(trainer._id, { email: email('concurrent') });
    const concurrentSettled = await Promise.allSettled([
        clientRegistrationRequestService.approve(
            concurrentRequest._id.toString(),
            trainer._id.toString()
        ),
        clientRegistrationRequestService.approve(
            concurrentRequest._id.toString(),
            trainer._id.toString()
        ),
    ]);
    const concurrentUsers = await User.find({ registrationRequestId: concurrentRequest._id });
    concurrentUsers.forEach((user) => trackUser(user._id));
    const concurrentFulfilled = concurrentSettled
        .filter((item) => item.status === 'fulfilled')
        .map((item) => item.value);
    const concurrentPending = await ClientInvitation.find({
        clientId: { $in: concurrentUsers.map((user) => user._id) },
        status: CLIENT_INVITATION_STATUS.PENDING,
        usedAt: null,
        expiresAt: { $gt: new Date() },
    });
    const concurrentRevoked = await ClientInvitation.countDocuments({
        clientId: { $in: concurrentUsers.map((user) => user._id) },
        status: CLIENT_INVITATION_STATUS.REVOKED,
    });
    const createdUrls = concurrentFulfilled
        .map((item) => item.invitation?.invitationUrl)
        .filter(Boolean);
    const invitationIds = [
        ...new Set(
            concurrentFulfilled
                .map((item) => item.invitation?.invitationId)
                .filter(Boolean)
        ),
    ];
    const concurrentRequestDoc = await ClientRegistrationRequest.findById(concurrentRequest._id);
    let firstUrlStillValid = true;
    if (createdUrls.length > 0) {
        const token = new URL(createdUrls[0]).searchParams.get('token');
        const preview = await request('GET', `/client-invitations/${token}`);
        firstUrlStillValid = preview.status === 200 && preview.json?.data?.valid === true;
    }
    if (
        concurrentUsers.length === 1 &&
        concurrentFulfilled.length >= 1 &&
        concurrentPending.length === 1 &&
        concurrentRevoked === 0 &&
        invitationIds.length === 1 &&
        String(concurrentRequestDoc.passwordInvitationId) === String(concurrentPending[0]._id) &&
        concurrentRequestDoc.passwordInvitationClaimedAt == null &&
        firstUrlStillValid
    ) {
        pass('13. Concurrent approvals share one usable invitation and do not revoke it');
    } else {
        fail(
            '13. Concurrent approvals share one usable invitation and do not revoke it',
            `users=${concurrentUsers.length} fulfilled=${concurrentFulfilled.length} pending=${concurrentPending.length} revoked=${concurrentRevoked} ids=${invitationIds.length} urlValid=${firstUrlStillValid}`
        );
    }

    // Deterministic race: hold createInvitation until both approvals have entered the path.
    const inviteRaceRequest = await makeRequest(trainer._id, { email: email('invite-race') });
    const originalCreateInvitation = clientInvitationService.createInvitation;
    let createCalls = 0;
    let releaseGate;
    const gate = new Promise((resolve) => {
        releaseGate = resolve;
    });
    let firstEntered;
    const entered = new Promise((resolve) => {
        firstEntered = resolve;
    });
    let secondEntered = false;
    clientInvitationService.createInvitation = async (...args) => {
        createCalls += 1;
        if (createCalls === 1) {
            firstEntered();
            await gate;
        } else {
            secondEntered = true;
        }
        return originalCreateInvitation(...args);
    };
    const inviteRaceA = clientRegistrationRequestService.approve(
        inviteRaceRequest._id.toString(),
        trainer._id.toString()
    );
    await entered;
    const inviteRaceB = clientRegistrationRequestService.approve(
        inviteRaceRequest._id.toString(),
        trainer._id.toString()
    );
    // Give the second approval time to hit the claim before the first finishes create.
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseGate();
    const inviteRaceSettled = await Promise.allSettled([inviteRaceA, inviteRaceB]);
    clientInvitationService.createInvitation = originalCreateInvitation;
    const inviteRaceUsers = await User.find({
        registrationRequestId: inviteRaceRequest._id,
    });
    inviteRaceUsers.forEach((user) => trackUser(user._id));
    const inviteRaceFulfilled = inviteRaceSettled
        .filter((item) => item.status === 'fulfilled')
        .map((item) => item.value);
    const inviteRacePending = await ClientInvitation.find({
        clientId: { $in: inviteRaceUsers.map((user) => user._id) },
        status: CLIENT_INVITATION_STATUS.PENDING,
        usedAt: null,
        expiresAt: { $gt: new Date() },
    });
    const inviteRaceRevoked = await ClientInvitation.countDocuments({
        clientId: { $in: inviteRaceUsers.map((user) => user._id) },
        status: CLIENT_INVITATION_STATUS.REVOKED,
    });
    const inviteRaceCreatedUrl = inviteRaceFulfilled.find(
        (item) => item.invitation?.state === 'created'
    )?.invitation?.invitationUrl;
    let inviteRaceUrlStillValid = false;
    if (inviteRaceCreatedUrl) {
        const token = new URL(inviteRaceCreatedUrl).searchParams.get('token');
        const preview = await request('GET', `/client-invitations/${token}`);
        inviteRaceUrlStillValid =
            preview.status === 200 && preview.json?.data?.valid === true;
    }
    if (
        createCalls === 1 &&
        secondEntered === false &&
        inviteRaceUsers.length === 1 &&
        inviteRaceFulfilled.length === 2 &&
        inviteRacePending.length === 1 &&
        inviteRaceRevoked === 0 &&
        inviteRaceUrlStillValid
    ) {
        pass('13b. Gated concurrent approvals call createInvitation once and keep the URL valid');
    } else {
        fail(
            '13b. Gated concurrent approvals call createInvitation once and keep the URL valid',
            `createCalls=${createCalls} secondEntered=${secondEntered} fulfilled=${inviteRaceFulfilled.length} pending=${inviteRacePending.length} revoked=${inviteRaceRevoked} urlValid=${inviteRaceUrlStillValid}`
        );
    }

    // Stale claim recovery
    const staleRequest = await makeRequest(trainer._id, { email: email('stale-claim') });
    const staleApproved = await clientRegistrationRequestService.approve(
        staleRequest._id.toString(),
        trainer._id.toString()
    );
    trackUser(staleApproved.clientId);
    await ClientInvitation.deleteMany({ clientId: staleApproved.clientId });
    await ClientRegistrationRequest.updateOne(
        { _id: staleRequest._id },
        {
            $set: {
                passwordInvitationId: null,
                passwordInvitationClaimedAt: new Date(Date.now() - 60_000),
            },
        }
    );
    const staleRetry = await clientRegistrationRequestService.approve(
        staleRequest._id.toString(),
        trainer._id.toString()
    );
    const stalePending = await ClientInvitation.countDocuments({
        clientId: staleApproved.clientId,
        status: CLIENT_INVITATION_STATUS.PENDING,
        expiresAt: { $gt: new Date() },
    });
    const staleDoc = await ClientRegistrationRequest.findById(staleRequest._id);
    if (
        staleRetry.invitation?.state === 'created' &&
        stalePending === 1 &&
        staleDoc.passwordInvitationClaimedAt == null &&
        staleDoc.passwordInvitationId
    ) {
        pass('13c. A stale invitation claim can be recovered and creates a usable invitation');
    } else {
        fail(
            '13c. A stale invitation claim can be recovered and creates a usable invitation',
            `state=${staleRetry.invitation?.state} pending=${stalePending}`
        );
    }

    // Expired linked invitation is replaced
    const expiredRequest = await makeRequest(trainer._id, { email: email('expired-invite') });
    const expiredApproved = await clientRegistrationRequestService.approve(
        expiredRequest._id.toString(),
        trainer._id.toString()
    );
    trackUser(expiredApproved.clientId);
    const expiredInvite = await ClientInvitation.findById(
        expiredApproved.invitation.invitationId
    );
    expiredInvite.expiresAt = new Date(Date.now() - 1000);
    await expiredInvite.save();
    const expiredRetry = await clientRegistrationRequestService.approve(
        expiredRequest._id.toString(),
        trainer._id.toString()
    );
    const expiredPending = await ClientInvitation.find({
        clientId: expiredApproved.clientId,
        status: CLIENT_INVITATION_STATUS.PENDING,
        expiresAt: { $gt: new Date() },
    });
    if (
        expiredRetry.invitation?.state === 'created' &&
        expiredPending.length === 1 &&
        String(expiredPending[0]._id) !== String(expiredInvite._id)
    ) {
        pass('13d. An expired invitation is replaced on retry');
    } else {
        fail(
            '13d. An expired invitation is replaced on retry',
            `state=${expiredRetry.invitation?.state} pending=${expiredPending.length}`
        );
    }

    // Accepted invitation is not reused
    const acceptedRequest = await makeRequest(trainer._id, { email: email('accepted-invite') });
    const acceptedApproved = await clientRegistrationRequestService.approve(
        acceptedRequest._id.toString(),
        trainer._id.toString()
    );
    trackUser(acceptedApproved.clientId);
    const acceptedInvite = await ClientInvitation.findById(
        acceptedApproved.invitation.invitationId
    );
    acceptedInvite.status = CLIENT_INVITATION_STATUS.USED;
    acceptedInvite.usedAt = new Date();
    await acceptedInvite.save();
    // Also force password set so createInvitation remains valid for an active client.
    await User.updateOne(
        { _id: acceptedApproved.clientId },
        { $set: { password: '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUV' } }
    );
    const acceptedRetry = await clientRegistrationRequestService.approve(
        acceptedRequest._id.toString(),
        trainer._id.toString()
    );
    const acceptedPending = await ClientInvitation.find({
        clientId: acceptedApproved.clientId,
        status: CLIENT_INVITATION_STATUS.PENDING,
        expiresAt: { $gt: new Date() },
    });
    if (
        acceptedRetry.invitation?.state === 'created' &&
        acceptedPending.length === 1 &&
        String(acceptedPending[0]._id) !== String(acceptedInvite._id)
    ) {
        pass('13e. An accepted invitation is not reused; a new pending invitation is created');
    } else {
        fail(
            '13e. An accepted invitation is not reused; a new pending invitation is created',
            `state=${acceptedRetry.invitation?.state} pending=${acceptedPending.length}`
        );
    }

    // Failed create releases the claim
    const releaseRequest = await makeRequest(trainer._id, { email: email('release-claim') });
    const originalInvitationCreate = ClientInvitation.create.bind(ClientInvitation);
    ClientInvitation.create = async () => {
        throw new Error('forced invitation failure for claim release');
    };
    let releaseError = null;
    try {
        await clientRegistrationRequestService.approve(
            releaseRequest._id.toString(),
            trainer._id.toString()
        );
    } catch (err) {
        releaseError = err;
    } finally {
        ClientInvitation.create = originalInvitationCreate;
    }
    const releaseDoc = await ClientRegistrationRequest.findById(releaseRequest._id);
    const releaseUser = await User.findOne({ email: email('release-claim') });
    trackUser(releaseUser?._id);
    if (
        releaseError?.errors?.[0]?.code === 'INVITATION_RETRYABLE' &&
        releaseDoc.approvalStatus === 'approved' &&
        releaseDoc.passwordInvitationClaimedAt == null &&
        releaseDoc.passwordInvitationId == null &&
        releaseUser
    ) {
        pass('13f. Invitation creation failure releases the claim without deleting the client');
    } else {
        fail(
            '13f. Invitation creation failure releases the claim without deleting the client',
            `code=${releaseError?.errors?.[0]?.code} claim=${releaseDoc?.passwordInvitationClaimedAt}`
        );
    }
    const releaseRetry = await clientRegistrationRequestService.approve(
        releaseRequest._id.toString(),
        trainer._id.toString()
    );
    if (releaseRetry.invitation?.state === 'created') {
        pass('13g. Retry after a released claim creates a usable invitation');
    } else {
        fail(
            '13g. Retry after a released claim creates a usable invitation',
            `state=${releaseRetry.invitation?.state}`
        );
    }

    const rejectRequest = await makeRequest(trainer._id, { email: email('reject') });
    const invitesBeforeReject = await ClientInvitation.countDocuments({ trainerId: trainer._id });
    const rejected = await request(
        'POST',
        `/client-registration-requests/${rejectRequest._id}/reject`,
        { token: trainerToken, body: { rejectionReason: 'Not a fit' } }
    );
    const rejectedDoc = await ClientRegistrationRequest.findById(rejectRequest._id);
    const rejectedUser = await User.findOne({ email: email('reject') });
    const invitesAfterReject = await ClientInvitation.countDocuments({ trainerId: trainer._id });
    if (
        rejected.status === 200 &&
        rejected.json?.data?.approvalStatus === 'rejected' &&
        rejected.json?.data?.rejectionReason === 'Not a fit' &&
        rejectedDoc.approvalStatus === 'rejected' &&
        String(rejectedDoc.reviewedBy) === String(trainer._id) &&
        !rejectedUser &&
        invitesAfterReject === invitesBeforeReject
    ) {
        pass('14. Owning trainer can reject a pending request without creating a user');
    } else {
        fail('14. Owning trainer can reject a pending request without creating a user', `status=${rejected.status}`);
    }

    const rejectAgain = await request(
        'POST',
        `/client-registration-requests/${rejectRequest._id}/reject`,
        { token: trainerToken, body: {} }
    );
    const approveRejected = await request(
        'POST',
        `/client-registration-requests/${rejectRequest._id}/approve`,
        { token: trainerToken, body: {} }
    );
    if (rejectAgain.status === 409 && approveRejected.status === 409) {
        pass('15. Repeated rejection and approval of a rejected request conflict');
    } else {
        fail(
            '15. Repeated rejection and approval of a rejected request conflict',
            `reject=${rejectAgain.status} approve=${approveRejected.status}`
        );
    }

    const foreignReject = await request(
        'POST',
        `/client-registration-requests/${unauthRequest._id}/reject`,
        { token: otherToken, body: {} }
    );
    const foreignRejectAfter = await ClientRegistrationRequest.findById(unauthRequest._id);
    if (foreignReject.status === 403 && foreignRejectAfter.approvalStatus === 'pending') {
        pass('16. Another trainer cannot reject the request');
    } else {
        fail('16. Another trainer cannot reject the request', `status=${foreignReject.status}`);
    }

    const raceRequest = await makeRequest(trainer._id, { email: email('race') });
    const race = await Promise.allSettled([
        clientRegistrationRequestService.approve(
            raceRequest._id.toString(),
            trainer._id.toString()
        ),
        clientRegistrationRequestService.reject(raceRequest._id.toString(), trainer._id.toString()),
    ]);
    const raceDoc = await ClientRegistrationRequest.findById(raceRequest._id);
    const raceUsers = await User.find({
        $or: [{ registrationRequestId: raceRequest._id }, { email: email('race') }],
    });
    raceUsers.forEach((user) => trackUser(user._id));
    const raceSuccesses = race.filter((item) => item.status === 'fulfilled').length;
    const raceConsistent =
        (raceDoc.approvalStatus === 'approved' && raceUsers.length === 1) ||
        (raceDoc.approvalStatus === 'rejected' && raceUsers.length === 0);
    if (raceSuccesses === 1 && raceConsistent) {
        pass('17. Concurrent approval and rejection cannot both succeed');
    } else {
        fail(
            '17. Concurrent approval and rejection cannot both succeed',
            `successes=${raceSuccesses} status=${raceDoc.approvalStatus} users=${raceUsers.length}`
        );
    }

    const rejectApproved = await request(
        'POST',
        `/client-registration-requests/${packageRequest._id}/reject`,
        { token: trainerToken, body: {} }
    );
    const packageStillApproved = await ClientRegistrationRequest.findById(packageRequest._id);
    if (rejectApproved.status === 409 && packageStillApproved.approvalStatus === 'approved') {
        pass('18. Rejecting an approved request conflicts and leaves the client in place');
    } else {
        fail(
            '18. Rejecting an approved request conflicts and leaves the client in place',
            `status=${rejectApproved.status}`
        );
    }
}

main()
    .catch((err) => {
        console.error(err);
        fail('suite', err?.message || String(err));
    })
    .finally(async () => {
        const clientIds = createdUserIds.filter(Boolean);
        if (clientIds.length) {
            await NutritionProfile.deleteMany({ clientId: { $in: clientIds } });
            await ClientInvitation.deleteMany({ clientId: { $in: clientIds } });
        }
        if (createdRequestIds.length) {
            await ClientRegistrationRequest.deleteMany({ _id: { $in: createdRequestIds } });
        }
        if (createdProspectIds.length) {
            await ClientProspectInvitation.deleteMany({ _id: { $in: createdProspectIds } });
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
