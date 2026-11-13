/**
 * Phase 1: Coach prospect invitation creation.
 * Run: node scripts/test-client-prospect-invitation.mjs
 *
 * Prerequisites: Dev server running with latest code; APP_DB_URL set.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientProspectInvitation from '../src/modules/client-prospect-invitations/client-prospect-invitation.model.js';
import ClientRegistrationRequest from '../src/modules/client-registration-requests/client-registration-request.model.js';
import { hashInvitationToken } from '../src/modules/client-invitations/client-invitation.helpers.js';
import config from '../src/config/index.js';

const BASE = process.env.API_URL || 'http://localhost:8000';
const API = `${BASE}/api/v1`;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const password = 'testpass123';
    const createdUserIds = [];
    const createdInviteIds = [];

    const trainer = await User.create({
        firstName: 'Prospect',
        lastName: 'Trainer',
        email: `prospect-trainer-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    createdUserIds.push(trainer._id);

    const admin = await User.create({
        firstName: 'Prospect',
        lastName: 'Admin',
        email: `prospect-admin-${suffix}@test.com`,
        password,
        role: 'admin',
    });
    createdUserIds.push(admin._id);

    const client = await User.create({
        firstName: 'Prospect',
        lastName: 'Client',
        email: `prospect-client-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });
    createdUserIds.push(client._id);

    const usersBefore = await User.countDocuments();
    const requestsBefore = await ClientRegistrationRequest.countDocuments();

    const loginTrainer = await request('POST', '/auth/login', {
        body: { email: trainer.email, password },
    });
    const loginAdmin = await request('POST', '/auth/login', {
        body: { email: admin.email, password },
    });
    const loginClient = await request('POST', '/auth/login', {
        body: { email: client.email, password },
    });

    const tokenTrainer = loginTrainer.json?.data?.token;
    const tokenAdmin = loginAdmin.json?.data?.token;
    const tokenClient = loginClient.json?.data?.token;

    if (!tokenTrainer || !tokenAdmin || !tokenClient) {
        throw new Error('Failed to login test users');
    }

    // 1. Unauthenticated cannot create
    const unauth = await request('POST', '/client-prospect-invitations', {
        body: { clientName: 'Ada Lovelace', phone: '15551234567' },
    });
    if (unauth.status === 401) {
        pass('1. Unauthenticated cannot create prospect invitation');
    } else {
        fail('1. Unauthenticated', `status=${unauth.status}`);
    }

    // 2. Client role forbidden
    const clientCreate = await request('POST', '/client-prospect-invitations', {
        token: tokenClient,
        body: { clientName: 'Ada Lovelace', phone: '15551234568' },
    });
    if (clientCreate.status === 403) {
        pass('2. Client role cannot create prospect invitation');
    } else {
        fail('2. Client role', `status=${clientCreate.status}`);
    }

    // 3. Invalid name / phone rejected
    const badName = await request('POST', '/client-prospect-invitations', {
        token: tokenTrainer,
        body: { clientName: 'A', phone: '15551234567' },
    });
    const badPhone = await request('POST', '/client-prospect-invitations', {
        token: tokenTrainer,
        body: { clientName: 'Ada Lovelace', phone: '123' },
    });
    if (badName.status === 400 && badPhone.status === 400) {
        pass('3. Invalid name and phone are rejected');
    } else {
        fail(
            '3. Invalid name/phone',
            `name=${badName.status} phone=${badPhone.status}`
        );
    }

    // 4. Authenticated coach creates invitation
    const beforeCreate = Date.now();
    const create = await request('POST', '/client-prospect-invitations', {
        token: tokenTrainer,
        body: {
            clientName: '  Ada Lovelace  ',
            phone: '+1 (555) 123-4567',
        },
    });
    const afterCreate = Date.now();
    const data = create.json?.data;
    const rawToken = extractTokenFromUrl(data?.invitationUrl);

    if (
        create.status === 201 &&
        data?.invitationId &&
        data?.invitationUrl &&
        data?.expiresAt &&
        rawToken
    ) {
        pass('4. Authenticated coach can create prospect invitation');
        createdInviteIds.push(data.invitationId);
    } else {
        fail('4. Coach create', JSON.stringify(create.json));
    }

    // 5. URL contains raw token; path is prospect-register
    if (
        rawToken &&
        data?.invitationUrl?.includes('/client/prospect-register?token=') &&
        data.invitationUrl.startsWith(config.clientApp.url)
    ) {
        pass('5. URL contains raw token on prospect-register path');
    } else {
        fail('5. Invitation URL', data?.invitationUrl);
    }

    // 6. Token stored hashed only
    const stored = await ClientProspectInvitation.findById(data?.invitationId).select(
        '+tokenHash'
    );
    const expectedHash = rawToken ? hashInvitationToken(rawToken) : null;
    const lean = stored?.toObject({ getters: false });
    const hasPlainTokenField =
        lean &&
        Object.values(lean).some(
            (v) => typeof v === 'string' && rawToken && v === rawToken
        );

    if (
        stored &&
        stored.tokenHash === expectedHash &&
        stored.tokenHash !== rawToken &&
        !hasPlainTokenField
    ) {
        pass('6. Token is stored hashed, not plaintext');
    } else {
        fail(
            '6. Token hash',
            `hashMatch=${stored?.tokenHash === expectedHash} plainLeak=${hasPlainTokenField}`
        );
    }

    // 7. Expiration exactly 7 days (±5s skew for request latency)
    const expiresMs = new Date(data?.expiresAt).getTime();
    const expectedLow = beforeCreate + SEVEN_DAYS_MS - 5000;
    const expectedHigh = afterCreate + SEVEN_DAYS_MS + 5000;
    if (expiresMs >= expectedLow && expiresMs <= expectedHigh) {
        pass('7. Expiration is exactly 7 days');
    } else {
        fail(
            '7. Expiration',
            `expiresAt=${data?.expiresAt} deltaFromNow=${expiresMs - Date.now()}`
        );
    }

    // 8. Invitation belongs to authenticated coach; phone normalized
    if (
        stored &&
        String(stored.trainerId) === String(trainer._id) &&
        stored.clientName === 'Ada Lovelace' &&
        stored.phone === '15551234567' &&
        stored.status === 'pending'
    ) {
        pass('8. Invitation belongs to coach with normalized phone');
    } else {
        fail(
            '8. Ownership/normalization',
            JSON.stringify({
                trainerId: stored?.trainerId,
                clientName: stored?.clientName,
                phone: stored?.phone,
                status: stored?.status,
            })
        );
    }

    // 9. No User or Registration Request created
    const usersAfter = await User.countDocuments();
    const requestsAfter = await ClientRegistrationRequest.countDocuments();
    const phoneUser = await User.findOne({ phone: '15551234567' });
    if (
        usersAfter === usersBefore &&
        requestsAfter === requestsBefore &&
        !phoneUser
    ) {
        pass('9. No User or Registration Request created on invite');
    } else {
        fail(
            '9. Side effects',
            `users ${usersBefore}->${usersAfter} requests ${requestsBefore}->${requestsAfter} phoneUser=${Boolean(phoneUser)}`
        );
    }

    // 10. Admin follows authorize('trainer','admin') convention
    const adminCreate = await request('POST', '/client-prospect-invitations', {
        token: tokenAdmin,
        body: { clientName: 'Admin Prospect', phone: '15559876543' },
    });
    if (adminCreate.status === 201 && adminCreate.json?.data?.invitationId) {
        pass('10. Admin can create prospect invitation (existing authz convention)');
        createdInviteIds.push(adminCreate.json.data.invitationId);
        const adminInvite = await ClientProspectInvitation.findById(
            adminCreate.json.data.invitationId
        );
        if (String(adminInvite?.trainerId) !== String(admin._id)) {
            fail('10b. Admin invite trainerId', String(adminInvite?.trainerId));
        }
    } else {
        fail('10. Admin create', JSON.stringify(adminCreate.json));
    }

    // 11. Re-invite same coach+phone revokes prior pending
    const create2 = await request('POST', '/client-prospect-invitations', {
        token: tokenTrainer,
        body: { clientName: 'Ada Relink', phone: '15551234567' },
    });
    if (create2.status === 201 && create2.json?.data?.invitationId) {
        createdInviteIds.push(create2.json.data.invitationId);
        const prior = await ClientProspectInvitation.findById(data.invitationId);
        if (prior?.status === 'revoked' && prior.revokedAt) {
            pass('11. Re-invite same phone revokes earlier pending invitation');
        } else {
            fail('11. Revoke prior', `status=${prior?.status}`);
        }
    } else {
        fail('11. Re-invite', JSON.stringify(create2.json));
    }

    // Cleanup
    if (createdInviteIds.length) {
        await ClientProspectInvitation.deleteMany({
            _id: { $in: createdInviteIds },
        });
    }
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
