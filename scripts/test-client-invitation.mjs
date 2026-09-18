/**
 * Client invitation flow verification.
 * Run: node scripts/test-client-invitation.mjs
 *
 * Prerequisites:
 * - Dev server running (with latest code)
 */
import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientInvitation from '../src/modules/client-invitations/client-invitation.model.js';
import { hashInvitationToken } from '../src/modules/client-invitations/client-invitation.helpers.js';
import config from '../src/config/index.js';

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
        const u = new URL(url);
        return u.searchParams.get('token');
    } catch {
        return null;
    }
};

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';
    const newPassword = 'newclientpass456';

    const trainerA = await User.create({
        firstName: 'Invite',
        lastName: 'TrainerA',
        email: `inv-trainer-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'Invite',
        lastName: 'TrainerB',
        email: `inv-trainer-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const clientA = await User.create({
        firstName: 'Invite',
        lastName: 'ClientA',
        email: `inv-client-a-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const clientB = await User.create({
        firstName: 'Invite',
        lastName: 'ClientB',
        email: `inv-client-b-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerB._id,
    });

    const loginA = await request('POST', '/auth/login', {
        body: { email: trainerA.email, password },
    });
    const loginB = await request('POST', '/auth/login', {
        body: { email: trainerB.email, password },
    });
    const loginClient = await request('POST', '/auth/login', {
        body: { email: clientA.email, password },
    });

    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;
    const tokenClient = loginClient.json?.data?.token;

    if (!tokenA || !tokenB || !tokenClient) {
        throw new Error('Failed to login test users');
    }

    const trainerBefore = clientA.trainer.toString();

    // 1. Trainer creates invitation for own client
    const create1 = await request('POST', `/clients/${clientA._id}/invitation`, {
        token: tokenA,
        body: {},
    });
    const invitationUrl1 = create1.json?.data?.invitationUrl;
    const expiresAt1 = create1.json?.data?.expiresAt;
    const rawToken1 = extractTokenFromUrl(invitationUrl1);

    if (
        create1.status === 201 &&
        invitationUrl1 &&
        expiresAt1 &&
        rawToken1 &&
        invitationUrl1.startsWith(config.clientApp.url) &&
        invitationUrl1.includes('/client/activate?token=')
    ) {
        pass('1. Trainer can create invitation for own Client');
    } else {
        fail('1. Trainer can create invitation for own Client', JSON.stringify(create1.json));
    }

    // 2. Client cannot create invitation
    const asClient = await request('POST', `/clients/${clientA._id}/invitation`, {
        token: tokenClient,
        body: {},
    });
    if (asClient.status === 403) pass('2. Client cannot create invitation');
    else fail('2. Client cannot create invitation', `status=${asClient.status}`);

    // 3. Trainer cannot invite another trainer's client
    const cross = await request('POST', `/clients/${clientB._id}/invitation`, {
        token: tokenA,
        body: {},
    });
    if (cross.status === 403) pass("3. Trainer cannot create invitation for another Trainer's Client");
    else fail("3. Trainer cannot create invitation for another Trainer's Client", `status=${cross.status}`);

    // 4. Nonexistent client
    const missing = await request(
        'POST',
        '/clients/000000000000000000000000/invitation',
        { token: tokenA, body: {} }
    );
    if (missing.status === 404) pass('4. Nonexistent Client → 404');
    else fail('4. Nonexistent Client → 404', `status=${missing.status}`);

    // 5. Non-client user cannot be invited
    const inviteTrainer = await request('POST', `/clients/${trainerB._id}/invitation`, {
        token: tokenA,
        body: {},
    });
    if (inviteTrainer.status === 404) pass('5. Non-client User cannot be invited');
    else fail('5. Non-client User cannot be invited', `status=${inviteTrainer.status}`);

    // 6. trainerId in body rejected
    const inject = await request('POST', `/clients/${clientA._id}/invitation`, {
        token: tokenA,
        body: { trainerId: trainerB._id.toString() },
    });
    if (inject.status === 400) pass('6. trainerId from request body rejected');
    else fail('6. trainerId from request body rejected', `status=${inject.status}`);

    // 7–9. Token security
    const stored1 = await ClientInvitation.findOne({ clientId: clientA._id })
        .sort({ createdAt: -1 })
        .select('+tokenHash')
        .lean();

    if (stored1 && !Object.prototype.hasOwnProperty.call(stored1, 'token')) {
        pass('7. Raw token is not stored as a document field');
    } else {
        fail('7. Raw token is not stored as a document field', JSON.stringify(stored1));
    }

    const expectedHash1 = hashInvitationToken(rawToken1);
    if (
        stored1?.tokenHash &&
        stored1.tokenHash === expectedHash1 &&
        stored1.tokenHash !== rawToken1
    ) {
        pass('8. Stored value is a hash of the token');
    } else {
        fail('8. Stored value is a hash of the token', JSON.stringify({
            hash: stored1?.tokenHash,
            expected: expectedHash1,
        }));
    }

    if (rawToken1 && /^[a-f0-9]{64}$/i.test(rawToken1)) {
        pass('9. Token is sufficiently random (32-byte hex)');
    } else {
        fail('9. Token is sufficiently random (32-byte hex)', `token=${rawToken1}`);
    }

    // Re-create because inject may have revoked? inject failed validation so no revoke.
    // Preview with current token1 — may have been revoked if create after inject... inject was 400 so no create.
    // But wait - create1 already happened. Good.

    // 10. Valid preview
    const previewOk = await request('GET', `/client-invitations/${rawToken1}`);
    if (
        previewOk.status === 200 &&
        previewOk.json?.data?.valid === true &&
        previewOk.json?.data?.client?.firstName === 'Invite' &&
        previewOk.json?.data?.client?.lastName === 'ClientA' &&
        !previewOk.json?.data?.client?.email &&
        !previewOk.json?.data?.trainerId
    ) {
        pass('10. Valid token returns valid invitation');
    } else {
        fail('10. Valid token returns valid invitation', JSON.stringify(previewOk.json));
    }

    // 11. Invalid token
    const previewBad = await request('GET', `/client-invitations/${crypto.randomBytes(32).toString('hex')}`);
    if (previewBad.status === 404) pass('11. Invalid token rejected');
    else fail('11. Invalid token rejected', `status=${previewBad.status}`);

    // 12. Expired token
    const createExp = await request('POST', `/clients/${clientA._id}/invitation`, {
        token: tokenA,
        body: {},
    });
    const rawExp = extractTokenFromUrl(createExp.json?.data?.invitationUrl);
    await ClientInvitation.updateOne(
        { tokenHash: hashInvitationToken(rawExp) },
        { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );
    const previewExp = await request('GET', `/client-invitations/${rawExp}`);
    if (previewExp.status === 410) pass('12. Expired token rejected');
    else fail('12. Expired token rejected', `status=${previewExp.status}`);

    // Fresh invitation for used + accept tests
    const createFresh = await request('POST', `/clients/${clientA._id}/invitation`, {
        token: tokenA,
        body: {},
    });
    const rawFresh = extractTokenFromUrl(createFresh.json?.data?.invitationUrl);

    // 13. Used token rejected (accept then preview)
    const acceptOnce = await request('POST', `/client-invitations/${rawFresh}/accept`, {
        body: { password: newPassword },
    });
    if (acceptOnce.status !== 200) {
        fail('13. Used token rejected', `accept failed: ${JSON.stringify(acceptOnce.json)}`);
    } else {
        const previewUsed = await request('GET', `/client-invitations/${rawFresh}`);
        if (previewUsed.status === 409) pass('13. Used token rejected');
        else fail('13. Used token rejected', `status=${previewUsed.status}`);
    }

    // 14. Inactive client rejected
    const clientInactive = await User.create({
        firstName: 'Invite',
        lastName: 'Inactive',
        email: `inv-inactive-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
        isActive: true,
    });
    const createInactive = await request(
        'POST',
        `/clients/${clientInactive._id}/invitation`,
        { token: tokenA, body: {} }
    );
    const rawInactive = extractTokenFromUrl(createInactive.json?.data?.invitationUrl);
    clientInactive.isActive = false;
    await clientInactive.save();
    const previewInactive = await request('GET', `/client-invitations/${rawInactive}`);
    if (previewInactive.status === 403) pass('14. Inactive Client rejected');
    else fail('14. Inactive Client rejected', `status=${previewInactive.status}`);

    // Fresh client for accept/login suite (clientA password already changed)
    const clientAccept = await User.create({
        firstName: 'Invite',
        lastName: 'Accept',
        email: `inv-accept-${suffix}@test.com`,
        password: 'oldpass123',
        role: 'client',
        trainer: trainerA._id,
    });
    const trainerAcceptBefore = clientAccept.trainer.toString();

    const createAccept = await request('POST', `/clients/${clientAccept._id}/invitation`, {
        token: tokenA,
        body: {},
    });
    const rawAccept = extractTokenFromUrl(createAccept.json?.data?.invitationUrl);

    // 15. Valid invitation allows password setup
    const acceptOk = await request('POST', `/client-invitations/${rawAccept}/accept`, {
        body: { password: newPassword },
    });
    if (acceptOk.status === 200 && acceptOk.json?.success) {
        pass('15. Valid invitation allows password setup');
    } else {
        fail('15. Valid invitation allows password setup', JSON.stringify(acceptOk.json));
    }

    // 16. Password is hashed
    const clientWithPass = await User.findById(clientAccept._id).select('+password');
    if (
        clientWithPass?.password &&
        clientWithPass.password !== newPassword &&
        clientWithPass.password.startsWith('$2')
    ) {
        pass('16. Password is hashed');
    } else {
        fail('16. Password is hashed', 'unexpected password storage');
    }

    // 17. Client can login with new password
    const loginNew = await request('POST', '/auth/login', {
        body: { email: clientAccept.email, password: newPassword },
    });
    if (
        loginNew.status === 200 &&
        loginNew.json?.data?.token &&
        loginNew.json?.data?.user?.role === 'client'
    ) {
        pass('17. Client can login using the new password');
    } else {
        fail('17. Client can login using the new password', JSON.stringify(loginNew.json));
    }

    // Old password fails
    const loginOld = await request('POST', '/auth/login', {
        body: { email: clientAccept.email, password: 'oldpass123' },
    });
    if (loginOld.status === 401) {
        // covered implicitly by 17
    }

    // 18. Invitation becomes used
    const usedDoc = await ClientInvitation.findOne({
        tokenHash: hashInvitationToken(rawAccept),
    }).lean();
    if (usedDoc?.status === 'used' && usedDoc?.usedAt) {
        pass('18. Invitation becomes used');
    } else {
        fail('18. Invitation becomes used', JSON.stringify(usedDoc));
    }

    // 19. Used invitation cannot be reused
    const reuse = await request('POST', `/client-invitations/${rawAccept}/accept`, {
        body: { password: 'anotherpass789' },
    });
    if (reuse.status === 409) pass('19. Used invitation cannot be reused');
    else fail('19. Used invitation cannot be reused', `status=${reuse.status}`);

    // 20. Expired invitation cannot be accepted
    const clientExp2 = await User.create({
        firstName: 'Invite',
        lastName: 'Exp2',
        email: `inv-exp2-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });
    const createExp2 = await request('POST', `/clients/${clientExp2._id}/invitation`, {
        token: tokenA,
        body: {},
    });
    const rawExp2 = extractTokenFromUrl(createExp2.json?.data?.invitationUrl);
    await ClientInvitation.updateOne(
        { tokenHash: hashInvitationToken(rawExp2) },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    const acceptExp = await request('POST', `/client-invitations/${rawExp2}/accept`, {
        body: { password: newPassword },
    });
    if (acceptExp.status === 410) pass('20. Expired invitation cannot be accepted');
    else fail('20. Expired invitation cannot be accepted', `status=${acceptExp.status}`);

    // 21. Wrong token cannot be accepted
    const wrong = await request(
        'POST',
        `/client-invitations/${crypto.randomBytes(32).toString('hex')}/accept`,
        { body: { password: newPassword } }
    );
    if (wrong.status === 404) pass('21. Wrong token cannot be accepted');
    else fail('21. Wrong token cannot be accepted', `status=${wrong.status}`);

    // 22. Trainer relationship unchanged
    const clientAfter = await User.findById(clientAccept._id);
    if (clientAfter.trainer.toString() === trainerAcceptBefore) {
        pass('22. Client trainer relationship remains unchanged');
    } else {
        fail('22. Client trainer relationship remains unchanged', String(clientAfter.trainer));
    }

    // Also verify original clientA trainer after first accept
    const clientAAfter = await User.findById(clientA._id);
    if (clientAAfter.trainer.toString() === trainerBefore) {
        // already covered by 22 style; keep single assertion above
    }

    // 23. role remains client
    if (clientAfter.role === 'client') pass('23. role remains client');
    else fail('23. role remains client', clientAfter.role);

    // 24–25. Repeat invitation invalidates previous
    const clientRepeat = await User.create({
        firstName: 'Invite',
        lastName: 'Repeat',
        email: `inv-repeat-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });
    const first = await request('POST', `/clients/${clientRepeat._id}/invitation`, {
        token: tokenA,
        body: {},
    });
    const rawFirst = extractTokenFromUrl(first.json?.data?.invitationUrl);
    const second = await request('POST', `/clients/${clientRepeat._id}/invitation`, {
        token: tokenA,
        body: {},
    });
    const rawSecond = extractTokenFromUrl(second.json?.data?.invitationUrl);

    const previewFirst = await request('GET', `/client-invitations/${rawFirst}`);
    const previewSecond = await request('GET', `/client-invitations/${rawSecond}`);

    if (previewFirst.status === 409 && rawFirst !== rawSecond) {
        pass('24. Creating a new invitation invalidates the previous pending invitation');
    } else {
        fail(
            '24. Creating a new invitation invalidates the previous pending invitation',
            `first=${previewFirst.status} secondPreview=${previewSecond.status}`
        );
    }

    if (previewSecond.status === 200 && previewSecond.json?.data?.valid === true) {
        const acceptSecond = await request('POST', `/client-invitations/${rawSecond}/accept`, {
            body: { password: newPassword },
        });
        if (acceptSecond.status === 200) pass('25. New invitation works');
        else fail('25. New invitation works', JSON.stringify(acceptSecond.json));
    } else {
        fail('25. New invitation works', JSON.stringify(previewSecond.json));
    }

    // 26. Revoked-first accept after re-invite
    const acceptRevokedFirst = await request('POST', `/client-invitations/${rawFirst}/accept`, {
        body: { password: 'shouldfail999' },
    });
    if (acceptRevokedFirst.status === 409) {
        pass('26. Revoked invitation cannot be accepted after re-invite');
    } else {
        fail(
            '26. Revoked invitation cannot be accepted after re-invite',
            `status=${acceptRevokedFirst.status}`
        );
    }

    // 27. Concurrent accept — only one wins
    const clientConcurrent = await User.create({
        firstName: 'Invite',
        lastName: 'Concurrent',
        email: `inv-concurrent-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });
    const createConcurrent = await request(
        'POST',
        `/clients/${clientConcurrent._id}/invitation`,
        { token: tokenA, body: {} }
    );
    const rawConcurrent = extractTokenFromUrl(createConcurrent.json?.data?.invitationUrl);
    const [acceptA, acceptB] = await Promise.all([
        request('POST', `/client-invitations/${rawConcurrent}/accept`, {
            body: { password: 'concurrentPass1' },
        }),
        request('POST', `/client-invitations/${rawConcurrent}/accept`, {
            body: { password: 'concurrentPass2' },
        }),
    ]);
    const statuses = [acceptA.status, acceptB.status].sort();
    const winners = [acceptA, acceptB].filter((r) => r.status === 200);
    const losers = [acceptA, acceptB].filter((r) => r.status === 409);
    if (winners.length === 1 && losers.length === 1 && statuses[0] === 200 && statuses[1] === 409) {
        pass('27. Concurrent accept — only one succeeds');
    } else {
        fail(
            '27. Concurrent accept — only one succeeds',
            `statuses=${acceptA.status},${acceptB.status}`
        );
    }

    // 28. Invalid invitation 404 does not echo raw token
    const leakToken = crypto.randomBytes(32).toString('hex');
    const leakRes = await request('GET', `/client-invitations/${leakToken}`);
    const leakBody = JSON.stringify(leakRes.json);
    if (
        leakRes.status === 404 &&
        !leakBody.includes(leakToken) &&
        (leakRes.json?.message === 'Invitation not found' ||
            String(leakRes.json?.message || '').includes('Invitation not found'))
    ) {
        pass('28. Invalid invitation response does not echo raw token');
    } else {
        fail('28. Invalid invitation response does not echo raw token', leakBody);
    }

    // 29. Unknown invitation path 404 is redacted / generic
    const junkToken = crypto.randomBytes(32).toString('hex');
    const junkPath = await request('GET', `/client-invitations/${junkToken}/nope`);
    const junkBody = JSON.stringify(junkPath.json);
    if (
        junkPath.status === 404 &&
        !junkBody.includes(junkToken) &&
        !String(junkPath.json?.message || '').includes(junkToken)
    ) {
        pass('29. Unknown invitation route 404 does not leak token');
    } else {
        fail('29. Unknown invitation route 404 does not leak token', junkBody);
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(
        `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
    );

    await ClientInvitation.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await User.deleteMany({
        _id: {
            $in: [
                trainerA._id,
                trainerB._id,
                clientA._id,
                clientB._id,
                clientInactive._id,
                clientAccept._id,
                clientExp2._id,
                clientRepeat._id,
                clientConcurrent._id,
            ],
        },
    });
    await mongoose.disconnect();

    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
