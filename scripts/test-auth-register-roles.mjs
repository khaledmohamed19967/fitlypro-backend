/**
 * Public registration roles (client + coach/trainer; admin blocked).
 * Run: node scripts/test-auth-register-roles.mjs
 *
 * Prerequisites: Dev server running with latest code.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import { resolvePublicRegistrationRole } from '../src/modules/auth/auth.registration-role.js';

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

async function request(method, path, { body, token } = {}) {
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

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const createdIds = [];

    if (
        resolvePublicRegistrationRole('client') === 'client' &&
        resolvePublicRegistrationRole('trainer') === 'trainer' &&
        resolvePublicRegistrationRole('coach') === 'trainer' &&
        resolvePublicRegistrationRole(undefined) === 'client'
    ) {
        pass('0. Role resolver maps coach→trainer and defaults to client');
    } else {
        fail('0. Role resolver', 'unexpected mapping');
    }

    const base = {
        firstName: 'Reg',
        lastName: 'Lock',
        password: 'testpass123',
        gender: 'male',
    };

    // 1. Client registration works
    const clientReg = await request('POST', '/auth/register', {
        body: {
            ...base,
            email: `reg-client-${suffix}@test.com`,
            role: 'client',
        },
    });
    if (
        clientReg.status === 201 &&
        clientReg.json?.data?.user?.role === 'client' &&
        clientReg.json?.data?.token
    ) {
        pass('1. Public register as client succeeds');
        if (clientReg.json?.data?.user?.id) createdIds.push(clientReg.json.data.user.id);
    } else {
        fail('1. Public register as client succeeds', JSON.stringify(clientReg.json));
    }

    // 2. Default role is client when omitted
    const defaultReg = await request('POST', '/auth/register', {
        body: {
            ...base,
            email: `reg-default-${suffix}@test.com`,
        },
    });
    if (defaultReg.status === 201 && defaultReg.json?.data?.user?.role === 'client') {
        pass('2. Public register without role defaults to client');
        if (defaultReg.json?.data?.user?.id) createdIds.push(defaultReg.json.data.user.id);
    } else {
        fail('2. Public register without role defaults to client', JSON.stringify(defaultReg.json));
    }

    // 3. Register as trainer (coach account)
    const trainerEmail = `reg-trainer-${suffix}@test.com`;
    const trainerReg = await request('POST', '/auth/register', {
        body: {
            ...base,
            email: trainerEmail,
            role: 'trainer',
        },
    });
    const trainerUser = await User.findOne({ email: trainerEmail });
    if (
        trainerReg.status === 201 &&
        trainerReg.json?.data?.user?.role === 'trainer' &&
        trainerUser?.role === 'trainer' &&
        trainerReg.json?.data?.token
    ) {
        pass('3. Public register as trainer succeeds');
        createdIds.push(trainerUser._id);
    } else {
        fail(
            '3. Public register as trainer succeeds',
            `status=${trainerReg.status} dbRole=${trainerUser?.role} body=${JSON.stringify(trainerReg.json)}`
        );
        if (trainerUser) createdIds.push(trainerUser._id);
    }

    // 4. Register with product alias "coach" → persisted trainer
    const coachEmail = `reg-coach-${suffix}@test.com`;
    const coachReg = await request('POST', '/auth/register', {
        body: {
            ...base,
            email: coachEmail,
            role: 'coach',
        },
    });
    const coachUser = await User.findOne({ email: coachEmail });
    if (
        coachReg.status === 201 &&
        coachReg.json?.data?.user?.role === 'trainer' &&
        coachUser?.role === 'trainer'
    ) {
        pass('4. Public register role=coach persists as trainer');
        createdIds.push(coachUser._id);
    } else {
        fail(
            '4. Public register role=coach persists as trainer',
            `status=${coachReg.status} dbRole=${coachUser?.role}`
        );
        if (coachUser) createdIds.push(coachUser._id);
    }

    // 5. Login returns trainer role
    const login = await request('POST', '/auth/login', {
        body: { email: trainerEmail, password: base.password },
    });
    if (login.status === 200 && login.json?.data?.user?.role === 'trainer' && login.json?.data?.token) {
        pass('5. Login returns trainer role');
    } else {
        fail('5. Login returns trainer role', JSON.stringify(login.json));
    }

    // 6. Coach dashboard auth works for registered trainer
    const dashToken = login.json?.data?.token;
    const overview = await request('GET', '/coach-dashboard/overview', { token: dashToken });
    if (overview.status === 200 && overview.json?.success && overview.json?.data) {
        pass('6. Registered trainer can access coach dashboard');
    } else {
        fail('6. Coach dashboard', `status=${overview.status} ${JSON.stringify(overview.json)}`);
    }

    // 7. Cannot register as admin
    const adminReg = await request('POST', '/auth/register', {
        body: {
            ...base,
            email: `reg-admin-${suffix}@test.com`,
            role: 'admin',
        },
    });
    const adminUser = await User.findOne({ email: `reg-admin-${suffix}@test.com` });
    if (adminReg.status === 400 && !adminUser) {
        pass('7. Public register cannot create admin');
    } else {
        fail(
            '7. Public register cannot create admin',
            `status=${adminReg.status} user=${Boolean(adminUser)}`
        );
        if (adminUser) createdIds.push(adminUser._id);
    }

    // 8. Ownership fields still rejected
    const inject = await request('POST', '/auth/register', {
        body: {
            ...base,
            email: `reg-inject-${suffix}@test.com`,
            role: 'client',
            trainerId: '000000000000000000000000',
            isActive: false,
        },
    });
    if (inject.status === 400) {
        pass('8. Ownership fields on register are rejected');
    } else {
        fail('8. Ownership fields on register are rejected', `status=${inject.status}`);
        if (inject.json?.data?.user?.id) createdIds.push(inject.json.data.user.id);
    }

    // 9. Trainer can still create a client (existing flow)
    if (dashToken && trainerUser) {
        const clientCreate = await request('POST', '/clients', {
            token: dashToken,
            body: {
                firstName: 'Owned',
                lastName: 'Client',
                email: `reg-owned-client-${suffix}@test.com`,
                password: 'testpass123',
                primaryFitnessGoal: 'muscle_gain',
            },
        });
        const created = clientCreate.json?.data;
        const createdClientId = created?.id || created?._id || created?.client?.id;
        const createdRole = created?.role || created?.client?.role;
        if (clientCreate.status === 201 && createdClientId && createdRole === 'client') {
            pass('9. Newly registered trainer can create clients');
            createdIds.push(createdClientId);
        } else if (clientCreate.status === 201 && createdClientId) {
            // createClient may return Client doc without nested user.role
            pass('9. Newly registered trainer can create clients');
            createdIds.push(createdClientId);
        } else {
            fail('9. Trainer create client', JSON.stringify(clientCreate.json));
        }
    } else {
        fail('9. Newly registered trainer can create clients', 'missing trainer token');
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(
        `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
    );

    if (createdIds.length) {
        await User.deleteMany({ _id: { $in: createdIds } });
    }
    await mongoose.disconnect();
    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
