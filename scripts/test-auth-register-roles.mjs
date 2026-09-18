/**
 * Public registration role lockdown.
 * Run: node scripts/test-auth-register-roles.mjs
 *
 * Prerequisites: Dev server running with latest code.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';

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

async function request(method, path, { body } = {}) {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const createdIds = [];

    const base = {
        firstName: 'Reg',
        lastName: 'Lock',
        password: 'testpass123',
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

    // 3. Cannot register as trainer
    const trainerReg = await request('POST', '/auth/register', {
        body: {
            ...base,
            email: `reg-trainer-${suffix}@test.com`,
            role: 'trainer',
        },
    });
    const trainerUser = await User.findOne({ email: `reg-trainer-${suffix}@test.com` });
    if (trainerReg.status === 400 && !trainerUser) {
        pass('3. Public register cannot create trainer');
    } else {
        fail(
            '3. Public register cannot create trainer',
            `status=${trainerReg.status} user=${Boolean(trainerUser)}`
        );
        if (trainerUser) createdIds.push(trainerUser._id);
    }

    // 4. Cannot register as admin
    const adminReg = await request('POST', '/auth/register', {
        body: {
            ...base,
            email: `reg-admin-${suffix}@test.com`,
            role: 'admin',
        },
    });
    const adminUser = await User.findOne({ email: `reg-admin-${suffix}@test.com` });
    if (adminReg.status === 400 && !adminUser) {
        pass('4. Public register cannot create admin');
    } else {
        fail(
            '4. Public register cannot create admin',
            `status=${adminReg.status} user=${Boolean(adminUser)}`
        );
        if (adminUser) createdIds.push(adminUser._id);
    }

    // 5. Role injection via unexpected casing / ownership fields
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
        pass('5. Ownership fields on register are rejected');
    } else {
        fail('5. Ownership fields on register are rejected', `status=${inject.status}`);
        if (inject.json?.data?.user?.id) createdIds.push(inject.json.data.user.id);
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
