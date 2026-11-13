/**
 * Phase 2: Public prospect invitation preview + registration submission.
 * Run: node scripts/test-client-prospect-invitation-phase2.mjs
 *
 * Prerequisites: Dev server running; APP_DB_URL set.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientProspectInvitation from '../src/modules/client-prospect-invitations/client-prospect-invitation.model.js';
import ClientRegistrationRequest from '../src/modules/client-registration-requests/client-registration-request.model.js';
import { CLIENT_PROSPECT_INVITATION_STATUS } from '../src/modules/client-prospect-invitations/client-prospect-invitation.constants.js';
import { hashInvitationToken } from '../src/modules/client-invitations/client-invitation.helpers.js';

const BASE = process.env.API_URL || 'http://localhost:8000';
const API = `${BASE}/api/v1`;

const results = [];
const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
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

const extractTokenFromUrl = (url) => {
    try {
        return new URL(url).searchParams.get('token');
    } catch {
        return null;
    }
};

const baseRegistration = (suffix, overrides = {}) => ({
    firstName: 'Pros',
    lastName: 'Pect',
    email: `prospect-reg-${suffix}@test.com`,
    primaryFitnessGoal: 'general_fitness',
    experienceLevel: 'beginner',
    ...overrides,
});

async function createInvite(trainerToken, clientName, phone) {
    const res = await request('POST', '/client-prospect-invitations', {
        token: trainerToken,
        body: { clientName, phone },
    });
    const rawToken = extractTokenFromUrl(res.json?.data?.invitationUrl);
    return {
        status: res.status,
        invitationId: res.json?.data?.invitationId,
        expiresAt: res.json?.data?.expiresAt,
        rawToken,
        json: res.json,
    };
}

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const password = 'testpass123';
    const createdUserIds = [];
    const createdInviteIds = [];
    const createdRequestIds = [];

    const trainer = await User.create({
        firstName: 'P2',
        lastName: 'Trainer',
        email: `p2-trainer-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    createdUserIds.push(trainer._id);

    const otherTrainer = await User.create({
        firstName: 'P2',
        lastName: 'Other',
        email: `p2-other-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    createdUserIds.push(otherTrainer._id);

    const login = await request('POST', '/auth/login', {
        body: { email: trainer.email, password },
    });
    const trainerToken = login.json?.data?.token;
    if (!trainerToken) throw new Error('Trainer login failed');

    const usersBefore = await User.countDocuments();

    // --- Create a usable invitation ---
    const invite = await createInvite(
        trainerToken,
        'Preview Client',
        '15550001111'
    );
    if (invite.status !== 201 || !invite.rawToken) {
        throw new Error(`Setup invite failed: ${JSON.stringify(invite.json)}`);
    }
    createdInviteIds.push(invite.invitationId);

    // 1. Valid preview
    const preview = await request(
        'GET',
        `/client-prospect-invitations/${invite.rawToken}`
    );
    const previewData = preview.json?.data;
    if (
        preview.status === 200 &&
        previewData?.valid === true &&
        previewData?.clientName === 'Preview Client' &&
        previewData?.phone === '15550001111' &&
        previewData?.expiresAt &&
        previewData.trainerId === undefined &&
        previewData.tokenHash === undefined &&
        !JSON.stringify(preview.json).includes(String(trainer._id))
    ) {
        pass('1. Valid invitation preview');
    } else {
        fail('1. Valid preview', JSON.stringify(preview.json));
    }

    // 2. Invalid token
    const badToken = await request(
        'GET',
        '/client-prospect-invitations/not-a-real-token-zzzzzzzzzzzzzzzz'
    );
    if (badToken.status === 404 || badToken.status === 400) {
        pass('2. Invalid token rejected');
    } else {
        fail('2. Invalid token', `status=${badToken.status}`);
    }

    // 3. Expired invitation
    const expiredInvite = await createInvite(
        trainerToken,
        'Expired Client',
        '15550002222'
    );
    createdInviteIds.push(expiredInvite.invitationId);
    await ClientProspectInvitation.findByIdAndUpdate(expiredInvite.invitationId, {
        expiresAt: new Date(Date.now() - 60_000),
    });
    const expiredPreview = await request(
        'GET',
        `/client-prospect-invitations/${expiredInvite.rawToken}`
    );
    const expiredRegister = await request(
        'POST',
        `/client-prospect-invitations/${expiredInvite.rawToken}/register`,
        { body: baseRegistration(`${suffix}-exp`) }
    );
    if (expiredPreview.status === 410 && expiredRegister.status === 410) {
        pass('3. Expired invitation rejected on preview and register');
    } else {
        fail(
            '3. Expired',
            `preview=${expiredPreview.status} register=${expiredRegister.status}`
        );
    }

    // 4. Revoked invitation
    const revokeA = await createInvite(trainerToken, 'Revoke A', '15550003333');
    createdInviteIds.push(revokeA.invitationId);
    const revokeB = await createInvite(trainerToken, 'Revoke B', '15550003333');
    createdInviteIds.push(revokeB.invitationId);
    const revokedDoc = await ClientProspectInvitation.findById(revokeA.invitationId);
    const revokedPreview = await request(
        'GET',
        `/client-prospect-invitations/${revokeA.rawToken}`
    );
    if (
        revokedDoc?.status === CLIENT_PROSPECT_INVITATION_STATUS.REVOKED &&
        revokedPreview.status === 409
    ) {
        pass('4. Revoked invitation rejected');
    } else {
        fail(
            '4. Revoked',
            `dbStatus=${revokedDoc?.status} preview=${revokedPreview.status}`
        );
    }

    // 5. Invalid registration data
    const invalidReg = await request(
        'POST',
        `/client-prospect-invitations/${invite.rawToken}/register`,
        {
            body: {
                firstName: 'A',
                lastName: 'B',
                email: 'not-an-email',
                primaryFitnessGoal: 'not_a_goal',
            },
        }
    );
    if (invalidReg.status === 400) {
        pass('5. Invalid registration data rejected');
    } else {
        fail('5. Invalid registration', `status=${invalidReg.status}`);
    }

    // Invitation must still be pending after validation failure
    const stillPending = await ClientProspectInvitation.findById(invite.invitationId);
    if (stillPending?.status === CLIENT_PROSPECT_INVITATION_STATUS.PENDING) {
        pass('5b. Validation failure does not consume invitation');
    } else {
        fail('5b. Still pending after validation fail', stillPending?.status);
    }

    // 6. Privilege injection rejected
    const inject = await request(
        'POST',
        `/client-prospect-invitations/${invite.rawToken}/register`,
        {
            body: {
                ...baseRegistration(`${suffix}-inject`),
                password: 'hackme12',
                role: 'admin',
                trainerId: String(otherTrainer._id),
                trainer: String(otherTrainer._id),
                isActive: true,
                approvalStatus: 'approved',
            },
        }
    );
    if (inject.status === 400) {
        pass('6. Privilege / ownership field injection rejected');
    } else {
        fail('6. Injection', `status=${inject.status} ${JSON.stringify(inject.json)}`);
    }

    // 7. Registration failure after claim rolls back (unknown health option ObjectId)
    const fakeOptionId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const failHealth = await request(
        'POST',
        `/client-prospect-invitations/${invite.rawToken}/register`,
        {
            body: {
                ...baseRegistration(`${suffix}-health`),
                allergyOptionIds: [fakeOptionId],
            },
        }
    );
    const afterFail = await ClientProspectInvitation.findById(invite.invitationId);
    const orphanRequest = await ClientRegistrationRequest.findOne({
        invitationId: invite.invitationId,
    });
    if (
        failHealth.status === 400 &&
        afterFail?.status === CLIENT_PROSPECT_INVITATION_STATUS.PENDING &&
        !afterFail.usedAt &&
        !orphanRequest
    ) {
        pass('7. Registration failure does not leave invitation used');
    } else {
        fail(
            '7. Rollback after failure',
            `status=${failHealth.status} invite=${afterFail?.status} request=${Boolean(orphanRequest)}`
        );
    }

    // 8. Successful registration
    const usersMid = await User.countDocuments();
    const okReg = await request(
        'POST',
        `/client-prospect-invitations/${invite.rawToken}/register`,
        {
            body: baseRegistration(`${suffix}-ok`, {
                phone: '15550001111',
                gender: 'female',
                currentWeight: 70,
                height: 170,
            }),
        }
    );
    const okData = okReg.json?.data;
    const usedInvite = await ClientProspectInvitation.findById(invite.invitationId);
    const requestDoc = await ClientRegistrationRequest.findById(
        okData?.registrationRequestId
    );
    const usersAfterReg = await User.countDocuments();

    if (
        okReg.status === 201 &&
        okData?.registrationRequestId &&
        okData?.approvalStatus === 'pending' &&
        !okData?.token &&
        usedInvite?.status === CLIENT_PROSPECT_INVITATION_STATUS.USED &&
        usedInvite?.usedAt &&
        requestDoc &&
        String(requestDoc.trainerId) === String(trainer._id) &&
        String(requestDoc.invitationId) === String(invite.invitationId) &&
        requestDoc.approvalStatus === 'pending' &&
        requestDoc.createdUserId == null &&
        requestDoc.email === `prospect-reg-${suffix}-ok@test.com` &&
        usersAfterReg === usersMid
    ) {
        pass('8. Successful registration request (no User / JWT)');
        createdRequestIds.push(requestDoc._id);
    } else {
        fail(
            '8. Successful registration',
            JSON.stringify({
                status: okReg.status,
                data: okData,
                inviteStatus: usedInvite?.status,
                users: `${usersMid}->${usersAfterReg}`,
            })
        );
        if (okData?.registrationRequestId) {
            createdRequestIds.push(okData.registrationRequestId);
        }
    }

    // 9. Already-used invitation
    const usedPreview = await request(
        'GET',
        `/client-prospect-invitations/${invite.rawToken}`
    );
    const usedRegister = await request(
        'POST',
        `/client-prospect-invitations/${invite.rawToken}/register`,
        { body: baseRegistration(`${suffix}-dup`) }
    );
    if (usedPreview.status === 409 && usedRegister.status === 409) {
        pass('9. Already-used invitation rejected');
    } else {
        fail(
            '9. Used invitation',
            `preview=${usedPreview.status} register=${usedRegister.status}`
        );
    }

    // 10. Duplicate submission count — only one request for invitation
    const requestCount = await ClientRegistrationRequest.countDocuments({
        invitationId: invite.invitationId,
    });
    if (requestCount === 1) {
        pass('10. Exactly one registration request per invitation');
    } else {
        fail('10. Request count', `count=${requestCount}`);
    }

    // 11. Concurrent submission — only one succeeds
    const concurrentInvite = await createInvite(
        trainerToken,
        'Concurrent Client',
        '15550004444'
    );
    createdInviteIds.push(concurrentInvite.invitationId);
    const concurrentBodies = [
        baseRegistration(`${suffix}-c1`),
        baseRegistration(`${suffix}-c2`),
        baseRegistration(`${suffix}-c3`),
    ];
    const concurrentResults = await Promise.all(
        concurrentBodies.map((body) =>
            request(
                'POST',
                `/client-prospect-invitations/${concurrentInvite.rawToken}/register`,
                { body }
            )
        )
    );
    const successes = concurrentResults.filter((r) => r.status === 201);
    const failures = concurrentResults.filter((r) => r.status !== 201);
    const concurrentRequests = await ClientRegistrationRequest.find({
        invitationId: concurrentInvite.invitationId,
    });
    for (const doc of concurrentRequests) {
        createdRequestIds.push(doc._id);
    }
    if (
        successes.length === 1 &&
        failures.length === concurrentResults.length - 1 &&
        concurrentRequests.length === 1
    ) {
        pass('11. Concurrent submissions — only one succeeds');
    } else {
        fail(
            '11. Concurrent',
            `successes=${successes.length} failures=${failures.length} docs=${concurrentRequests.length}`
        );
    }

    // 12. Coach association only from invitation (not body)
    if (
        requestDoc &&
        String(requestDoc.trainerId) === String(trainer._id) &&
        String(requestDoc.trainerId) !== String(otherTrainer._id)
    ) {
        pass('12. Coach association comes from invitation only');
    } else {
        fail('12. Coach association', String(requestDoc?.trainerId));
    }

    // 13. No extra users overall from this suite's registration path
    const usersFinal = await User.countDocuments();
    if (usersFinal === usersBefore) {
        pass('13. No User documents created during Phase 2 flow');
    } else {
        fail('13. User count drift', `${usersBefore}->${usersFinal}`);
    }

    // Cleanup
    if (createdRequestIds.length) {
        await ClientRegistrationRequest.deleteMany({
            _id: { $in: createdRequestIds },
        });
    }
    if (createdInviteIds.length) {
        await ClientProspectInvitation.deleteMany({
            _id: { $in: createdInviteIds },
        });
    }
    // Also clean any invite created for revokeB phone leftovers
    await ClientProspectInvitation.deleteMany({
        trainerId: trainer._id,
        phone: { $in: ['15550001111', '15550002222', '15550003333', '15550004444'] },
    });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(
        `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
    );
    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
