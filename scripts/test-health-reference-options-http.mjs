/**
 * HTTP checks for GET /api/v1/health-reference-options (Express 5 query validation).
 * Run: node scripts/test-health-reference-options-http.mjs
 * Prerequisites: Dev server running; APP_DB_URL in env.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';

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

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const password = 'testpass123';

    const trainer = await User.create({
        firstName: 'Href',
        lastName: 'Trainer',
        email: `href-http-trainer-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const client = await User.create({
        firstName: 'Href',
        lastName: 'Client',
        email: `href-http-client-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
    });

    const login = await request('POST', '/auth/login', {
        body: { email: trainer.email, password },
    });
    const token = login.json?.data?.token;
    if (!token) {
        fail('Trainer login', JSON.stringify(login.json));
    } else {
        pass('Trainer login');
    }

    // 1. Valid list (no query)
    const listAll = await request('GET', '/health-reference-options', { token });
    if (
        listAll.status === 200 &&
        Array.isArray(listAll.json?.data?.options) &&
        !String(listAll.json?.message || '').includes('only a getter')
    ) {
        pass('1. GET /health-reference-options succeeds');
    } else {
        fail('1. GET list', `status=${listAll.status} ${JSON.stringify(listAll.json)}`);
    }

    // 2. Valid category filter
    const byCat = await request('GET', '/health-reference-options?category=allergy', {
        token,
    });
    if (
        byCat.status === 200 &&
        Array.isArray(byCat.json?.data?.options) &&
        byCat.json.data.options.every((o) => o.category === 'allergy')
    ) {
        pass('2. category=allergy filters options');
    } else {
        fail('2. category filter', `status=${byCat.status} ${JSON.stringify(byCat.json)}`);
    }

    // 3. Invalid category → 400 (not 500 / getter error)
    const badCat = await request('GET', '/health-reference-options?category=not-a-category', {
        token,
    });
    if (
        badCat.status === 400 &&
        badCat.json?.success === false &&
        !String(badCat.json?.message || '').includes('only a getter')
    ) {
        pass('3. Invalid category returns 400');
    } else {
        fail('3. Invalid category', `status=${badCat.status} ${JSON.stringify(badCat.json)}`);
    }

    // 4. Unauthenticated public catalog → 200
    const noAuth = await request('GET', '/health-reference-options');
    const noAuthOptions = noAuth.json?.data?.options;
    const publicFieldsOnly =
        Array.isArray(noAuthOptions) &&
        noAuthOptions.every(
            (o) =>
                o &&
                typeof o.id === 'string' &&
                typeof o.code === 'string' &&
                typeof o.label === 'string' &&
                typeof o.category === 'string' &&
                !('trainerId' in o) &&
                !('clientId' in o) &&
                !('password' in o)
        );
    if (noAuth.status === 200 && publicFieldsOnly) {
        pass('4. Unauthenticated catalog returns 200 with public fields only');
    } else {
        fail(
            '4. Unauthenticated public catalog',
            `status=${noAuth.status} fieldsOk=${publicFieldsOnly}`
        );
    }

    // 5. Client role can also read the public catalog
    const clientLogin = await request('POST', '/auth/login', {
        body: { email: client.email, password },
    });
    const clientToken = clientLogin.json?.data?.token;
    const clientCall = await request('GET', '/health-reference-options', {
        token: clientToken,
    });
    if (clientCall.status === 200 && Array.isArray(clientCall.json?.data?.options)) {
        pass('5. Client role can read public catalog (200)');
    } else {
        fail('5. Client catalog access', `status=${clientCall.status}`);
    }

    // 6. Error handler: controlled throw must not surface req.query assignment errors
    await new Promise((resolve) => {
        const fakeErr = new Error('controlled-test-error');
        const fakeReq = { originalUrl: '/api/v1/health-reference-options' };
        const fakeRes = {
            statusCode: null,
            body: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                this.body = payload;
                if (
                    this.statusCode === 500 &&
                    payload?.message === 'controlled-test-error' &&
                    !String(payload?.message || '').includes('only a getter') &&
                    payload?.success === false
                ) {
                    pass('6. errorHandler returns primary error without secondary getter throw');
                } else {
                    fail('6. errorHandler', JSON.stringify(payload));
                }
                resolve();
            },
        };
        try {
            errorHandler(fakeErr, fakeReq, fakeRes, () => {});
        } catch (secondary) {
            fail('6. errorHandler secondary throw', secondary.message);
            resolve();
        }
    });

    // 7. includeInactive query conversion does not 500
    const withInactive = await request(
        'GET',
        '/health-reference-options?includeInactive=true',
        { token }
    );
    if (withInactive.status === 200 && Array.isArray(withInactive.json?.data?.options)) {
        pass('7. includeInactive=true succeeds');
    } else {
        fail(
            '7. includeInactive',
            `status=${withInactive.status} ${JSON.stringify(withInactive.json)}`
        );
    }

    // 8. Public category filters without auth
    const publicCategories = ['allergy', 'dietary_restriction', 'body_area'];
    let publicCatsOk = true;
    for (const category of publicCategories) {
        const res = await request(
            'GET',
            `/health-reference-options?category=${category}`
        );
        if (
            res.status !== 200 ||
            !Array.isArray(res.json?.data?.options) ||
            !res.json.data.options.every((o) => o.category === category)
        ) {
            publicCatsOk = false;
            fail(
                `8. Public category=${category}`,
                `status=${res.status} count=${res.json?.data?.options?.length}`
            );
            break;
        }
    }
    if (publicCatsOk) {
        pass('8. Public requests for each supported category succeed');
    }

    // 9. Nested client nutrition-profile still requires auth
    const nutritionNoAuth = await request(
        'GET',
        `/clients/${client._id}/nutrition-profile`
    );
    if (nutritionNoAuth.status === 401) {
        pass('9. Nutrition profile endpoint still requires authentication');
    } else {
        fail(
            '9. Nutrition profile still protected',
            `status=${nutritionNoAuth.status}`
        );
    }

    await User.deleteMany({ _id: { $in: [trainer._id, client._id] } });
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
