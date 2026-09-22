/**
 * GET /api/v1/auth/me coaching-program contract.
 * Run: node scripts/test-auth-me.mjs
 *
 * Prerequisites: Dev server running with latest code.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';

const BASE = process.env.API_URL || 'http://localhost:8000';
const API = `${BASE}/api/v1`;

const PACKAGE_DURATIONS = Object.freeze([
    '1_month',
    '3_months',
    '6_months',
    '12_months',
    'ongoing',
]);

const PROGRAM_TYPES = Object.freeze([
    'personal_training',
    'group_training',
    'online_coaching',
    'nutrition_only',
    'hybrid',
]);

const FIXTURE = Object.freeze({
    startDate: '2026-04-01T00:00:00.000Z',
    endDate: '2026-10-01T00:00:00.000Z',
    packageDuration: '6_months',
    programType: 'online_coaching',
});

const OTHER_FIXTURE = Object.freeze({
    startDate: '2025-01-15T00:00:00.000Z',
    endDate: '2025-07-15T00:00:00.000Z',
    packageDuration: '3_months',
    programType: 'personal_training',
});

const results = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};

const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const isIsoDateString = (value) => {
    if (typeof value !== 'string' || value.trim() === '') {
        return false;
    }
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
};

const toIso = (value) => {
    if (value == null || value === '') {
        return value;
    }
    return new Date(value).toISOString();
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

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';
    const createdIds = [];

    const trainer = await User.create({
        firstName: 'AuthMe',
        lastName: 'Trainer',
        email: `auth-me-trainer-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    createdIds.push(trainer._id);

    const populatedClient = await User.create({
        firstName: 'AuthMe',
        lastName: 'Populated',
        email: `auth-me-populated-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        programType: FIXTURE.programType,
        packageDuration: FIXTURE.packageDuration,
        startDate: new Date(FIXTURE.startDate),
        endDate: new Date(FIXTURE.endDate),
    });
    createdIds.push(populatedClient._id);

    const otherClient = await User.create({
        firstName: 'AuthMe',
        lastName: 'Other',
        email: `auth-me-other-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        programType: OTHER_FIXTURE.programType,
        packageDuration: OTHER_FIXTURE.packageDuration,
        startDate: new Date(OTHER_FIXTURE.startDate),
        endDate: new Date(OTHER_FIXTURE.endDate),
    });
    createdIds.push(otherClient._id);

    const sparseClient = await User.create({
        firstName: 'AuthMe',
        lastName: 'Sparse',
        email: `auth-me-sparse-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });
    createdIds.push(sparseClient._id);

    const loginPopulated = await request('POST', '/auth/login', {
        body: { email: populatedClient.email, password },
    });
    const populatedToken = loginPopulated.json?.data?.token;

    if (!populatedToken) {
        fail('login populated client', JSON.stringify(loginPopulated.json));
        throw new Error('Failed to login populated client');
    }

    // 1. Unauthenticated access is rejected
    const unauth = await request('GET', '/auth/me');
    if (unauth.status === 401 && unauth.json?.success !== true) {
        pass('1. Unauthenticated GET /auth/me is rejected');
    } else {
        fail(
            '1. Unauthenticated GET /auth/me is rejected',
            `status=${unauth.status} body=${JSON.stringify(unauth.json)}`
        );
    }

    // 2. Populated client contract
    const me = await request('GET', '/auth/me', { token: populatedToken });
    const data = me.json?.data;

    if (me.status === 200 && me.json?.success === true && data) {
        pass('2. Authenticated GET /auth/me returns 200 envelope');
    } else {
        fail(
            '2. Authenticated GET /auth/me returns 200 envelope',
            JSON.stringify(me.json)
        );
    }

    if (data?.id && String(data.id) === String(populatedClient._id)) {
        pass('3. data.id is the authenticated client');
    } else {
        fail(
            '3. data.id is the authenticated client',
            `expected=${populatedClient._id} got=${data?.id}`
        );
    }

    if (data?.role === 'client') {
        pass('4. data.role is client');
    } else {
        fail('4. data.role is client', `got=${data?.role}`);
    }

    if (data && !Object.prototype.hasOwnProperty.call(data, 'subscription')) {
        pass('5. response has no data.subscription object');
    } else if (data?.subscription == null) {
        pass('5. response has no data.subscription object');
    } else {
        fail('5. response has no data.subscription object', JSON.stringify(data.subscription));
    }

    if (isIsoDateString(data?.startDate) && toIso(data.startDate) === FIXTURE.startDate) {
        pass('6. data.startDate matches fixture ISO date');
    } else {
        fail(
            '6. data.startDate matches fixture ISO date',
            `got=${data?.startDate}`
        );
    }

    if (isIsoDateString(data?.endDate) && toIso(data.endDate) === FIXTURE.endDate) {
        pass('7. data.endDate matches fixture ISO date');
    } else {
        fail(
            '7. data.endDate matches fixture ISO date',
            `got=${data?.endDate}`
        );
    }

    if (
        isIsoDateString(data?.startDate) &&
        isIsoDateString(data?.endDate) &&
        new Date(data.startDate).getTime() < new Date(data.endDate).getTime()
    ) {
        pass('8. fixture endDate is later than startDate');
    } else {
        fail(
            '8. fixture endDate is later than startDate',
            `start=${data?.startDate} end=${data?.endDate}`
        );
    }

    if (
        data?.packageDuration === FIXTURE.packageDuration &&
        PACKAGE_DURATIONS.includes(data.packageDuration)
    ) {
        pass('9. data.packageDuration matches fixture enum');
    } else {
        fail(
            '9. data.packageDuration matches fixture enum',
            `got=${data?.packageDuration}`
        );
    }

    if (
        data?.programType === FIXTURE.programType &&
        PROGRAM_TYPES.includes(data.programType)
    ) {
        pass('10. data.programType matches fixture enum');
    } else {
        fail(
            '10. data.programType matches fixture enum',
            `got=${data?.programType}`
        );
    }

    if (
        data?.programType !== OTHER_FIXTURE.programType &&
        data?.packageDuration !== OTHER_FIXTURE.packageDuration &&
        toIso(data?.endDate) !== OTHER_FIXTURE.endDate
    ) {
        pass('11. populated client does not receive another client program fields');
    } else {
        fail(
            '11. populated client does not receive another client program fields',
            JSON.stringify({
                programType: data?.programType,
                packageDuration: data?.packageDuration,
                endDate: data?.endDate,
            })
        );
    }

    // 12. Optional fields missing — endpoint still succeeds
    const loginSparse = await request('POST', '/auth/login', {
        body: { email: sparseClient.email, password },
    });
    const sparseToken = loginSparse.json?.data?.token;

    if (!sparseToken) {
        fail('login sparse client', JSON.stringify(loginSparse.json));
    } else {
        const sparseMe = await request('GET', '/auth/me', { token: sparseToken });
        const sparseData = sparseMe.json?.data;
        const missingOk =
            sparseMe.status === 200 &&
            sparseMe.json?.success === true &&
            String(sparseData?.id) === String(sparseClient._id) &&
            sparseData?.role === 'client';

        if (missingOk) {
            pass('12. GET /auth/me succeeds when optional program fields are unset');
        } else {
            fail(
                '12. GET /auth/me succeeds when optional program fields are unset',
                JSON.stringify(sparseMe.json)
            );
        }
    }

    const loginTrainer = await request('POST', '/auth/login', {
        body: { email: trainer.email, password },
    });
    const trainerToken = loginTrainer.json?.data?.token;
    if (!trainerToken) {
        fail('login trainer for package endDate tests', JSON.stringify(loginTrainer.json));
    } else {
        const createBody = {
            firstName: 'AuthMe',
            lastName: 'Derived',
            email: `auth-me-derived-${suffix}@test.com`,
            password,
            primaryFitnessGoal: 'general_fitness',
            programType: 'personal_training',
            sessionsPerWeek: 3,
            startDate: '2026-09-06T00:00:00.000Z',
            packageDuration: '6_months',
        };

        const created = await request('POST', '/clients', {
            token: trainerToken,
            body: createBody,
        });
        const createdId = created.json?.data?.id;
        if (createdId) createdIds.push(createdId);

        const expectedEnd = '2027-03-06T00:00:00.000Z';
        const createdEnd = created.json?.data?.endDate;

        if (
            created.status === 201 &&
            created.json?.success === true &&
            toIso(createdEnd) === expectedEnd
        ) {
            pass('13. POST /clients without endDate persists 2026-09-06 + 6_months → 2027-03-06');
        } else {
            fail(
                '13. POST /clients without endDate persists 2026-09-06 + 6_months → 2027-03-06',
                JSON.stringify(created.json)
            );
        }

        if (createdId) {
            const stored = await User.findById(createdId).select(
                'startDate endDate packageDuration'
            );
            if (stored && toIso(stored.endDate) === expectedEnd) {
                pass('14. Stored User.endDate matches calculated package end');
            } else {
                fail(
                    '14. Stored User.endDate matches calculated package end',
                    JSON.stringify(stored)
                );
            }

            const loginDerived = await request('POST', '/auth/login', {
                body: { email: createBody.email, password },
            });
            const derivedToken = loginDerived.json?.data?.token;
            const derivedMe = await request('GET', '/auth/me', { token: derivedToken });
            if (
                derivedMe.status === 200 &&
                toIso(derivedMe.json?.data?.endDate) === expectedEnd &&
                toIso(derivedMe.json?.data?.startDate) === createBody.startDate &&
                derivedMe.json?.data?.packageDuration === '6_months'
            ) {
                pass('15. GET /auth/me returns persisted calculated endDate');
            } else {
                fail(
                    '15. GET /auth/me returns persisted calculated endDate',
                    JSON.stringify(derivedMe.json)
                );
            }

            const toOneMonth = await request('PUT', `/clients/${createdId}`, {
                token: trainerToken,
                body: { packageDuration: '1_month' },
            });
            if (toIso(toOneMonth.json?.data?.endDate) === '2026-10-06T00:00:00.000Z') {
                pass('16. PUT packageDuration 1_month recalculates endDate');
            } else {
                fail(
                    '16. PUT packageDuration 1_month recalculates endDate',
                    JSON.stringify(toOneMonth.json)
                );
            }

            const newStart = await request('PUT', `/clients/${createdId}`, {
                token: trainerToken,
                body: { startDate: '2026-01-06T00:00:00.000Z' },
            });
            if (toIso(newStart.json?.data?.endDate) === '2026-02-06T00:00:00.000Z') {
                pass('17. PUT startDate recalculates endDate');
            } else {
                fail(
                    '17. PUT startDate recalculates endDate',
                    JSON.stringify(newStart.json)
                );
            }

            const toOngoing = await request('PUT', `/clients/${createdId}`, {
                token: trainerToken,
                body: { packageDuration: 'ongoing' },
            });
            if (toOngoing.json?.data?.endDate == null) {
                pass('18. PUT packageDuration ongoing clears endDate');
            } else {
                fail(
                    '18. PUT packageDuration ongoing clears endDate',
                    JSON.stringify(toOngoing.json)
                );
            }

            const fromOngoing = await request('PUT', `/clients/${createdId}`, {
                token: trainerToken,
                body: { packageDuration: '12_months' },
            });
            if (toIso(fromOngoing.json?.data?.endDate) === '2027-01-06T00:00:00.000Z') {
                pass('19. PUT finite duration after ongoing sets endDate');
            } else {
                fail(
                    '19. PUT finite duration after ongoing sets endDate',
                    JSON.stringify(fromOngoing.json)
                );
            }
        }
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
