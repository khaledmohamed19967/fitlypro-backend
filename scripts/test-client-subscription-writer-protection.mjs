/**
 * Phase 6.2 — snapshot ownership & Add Client subscription integration.
 * Run: node scripts/test-client-subscription-writer-protection.mjs
 * Requires: APP_DB_URL (HTTP checks need API server for optional route tests)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientSubscription from '../src/modules/client-subscriptions/client-subscription.model.js';
import clientService from '../src/modules/clients/client.service.js';
import {
    addCalendarMonthsUtc,
} from '../src/modules/clients/client.package-dates.js';
import { utcMidnightToday } from '../src/modules/client-subscriptions/client-subscription.helpers.js';
import { ApiError } from '../src/utils/ApiError.js';
import {
    validateUpdateClient,
    validateUpdateClientPlan,
    validateCreateClient,
} from '../src/modules/clients/client.validator.js';

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

const joiFails = (schema, value) => {
    const { error } = schema.validate(value, {
        abortEarly: false,
        stripUnknown: true,
    });
    return Boolean(error);
};

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);
    await ClientSubscription.syncIndexes();

    const suffix = Date.now();
    const password = 'testpass123';

    const trainer = await User.create({
        firstName: 'WP',
        lastName: 'Trainer',
        email: `cs-wp-t-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const trainerId = String(trainer._id);

    // --- Validator protection ---
    if (
        joiFails(validateUpdateClient, { packageDuration: '1_month' }) &&
        joiFails(validateUpdateClient, { startDate: new Date() }) &&
        joiFails(validateUpdateClient, { endDate: new Date() })
    ) {
        pass('Validator: PUT client forbids subscription snapshot fields');
    } else {
        fail('Validator: PUT client forbids subscription snapshot fields', 'expected Joi failure');
    }

    if (
        joiFails(validateUpdateClientPlan, { packageDuration: '3_months' }) &&
        joiFails(validateUpdateClientPlan, {
            startDate: new Date(),
            primaryFitnessGoal: 'strength',
        })
    ) {
        pass('Validator: PUT plan forbids subscription snapshot fields');
    } else {
        fail('Validator: PUT plan forbids subscription snapshot fields', 'expected Joi failure');
    }

    if (
        !joiFails(validateUpdateClient, { firstName: 'Ok' }) &&
        !joiFails(validateUpdateClientPlan, { sessionsPerWeek: 3 })
    ) {
        pass('Validator: unrelated update fields still accepted');
    } else {
        fail('Validator: unrelated update fields still accepted', 'unexpected Joi failure');
    }

    const createOk = validateCreateClient.validate(
        {
            firstName: 'Ada',
            lastName: 'Client',
            email: `cs-wp-create-${suffix}@test.com`,
            password,
            primaryFitnessGoal: 'general_fitness',
            packageDuration: '1_month',
        },
        { abortEarly: false, stripUnknown: true }
    );
    if (!createOk.error && createOk.value.packageDuration === '1_month') {
        pass('Validator: create still accepts optional packageDuration');
    } else {
        fail(
            'Validator: create still accepts optional packageDuration',
            createOk.error?.message
        );
    }

    // --- Add Client without package ---
    const plain = await clientService.createClient(
        {
            firstName: 'No',
            lastName: 'Sub',
            email: `cs-wp-nosub-${suffix}@test.com`,
            password,
        },
        trainerId
    );
    const plainSubs = await ClientSubscription.countDocuments({
        clientId: plain.id,
        trainerId: trainer._id,
    });
    const plainUser = await User.findById(plain.id).lean();
    if (
        plainSubs === 0 &&
        plainUser?.packageDuration == null &&
        plainUser?.startDate == null &&
        plainUser?.endDate == null
    ) {
        pass('Add Client: no packageDuration → no Subscription / no snapshot');
    } else {
        fail(
            'Add Client: no packageDuration → no Subscription / no snapshot',
            JSON.stringify({ plainSubs, plainUser })
        );
    }

    // --- Add Client with durations ---
    const expectedStart = utcMidnightToday().toISOString();
    for (const [duration, months] of [
        ['1_month', 1],
        ['3_months', 3],
        ['6_months', 6],
        ['12_months', 12],
    ]) {
        const created = await clientService.createClient(
            {
                firstName: 'With',
                lastName: duration,
                email: `cs-wp-${duration}-${suffix}@test.com`,
                password,
                packageDuration: duration,
            },
            trainerId
        );
        const sub = await ClientSubscription.findOne({
            clientId: created.id,
            trainerId: trainer._id,
            status: 'active',
        });
        const user = await User.findById(created.id).lean();
        const expectedEnd = addCalendarMonthsUtc(expectedStart, months).toISOString();
        const ok =
            sub &&
            sub.packageDuration === duration &&
            new Date(sub.startDate).toISOString() === expectedStart &&
            new Date(sub.endDate).toISOString() === expectedEnd &&
            user?.packageDuration === duration &&
            new Date(user.startDate).toISOString() === expectedStart &&
            new Date(user.endDate).toISOString() === expectedEnd &&
            (await ClientSubscription.countDocuments({
                clientId: created.id,
                trainerId: trainer._id,
            })) === 1;
        if (ok) pass(`Add Client: ${duration} → Subscription + snapshot`);
        else {
            fail(
                `Add Client: ${duration} → Subscription + snapshot`,
                JSON.stringify({ sub, user: {
                    packageDuration: user?.packageDuration,
                    startDate: user?.startDate,
                    endDate: user?.endDate,
                } })
            );
        }
    }

    const ongoing = await clientService.createClient(
        {
            firstName: 'On',
            lastName: 'Going',
            email: `cs-wp-ongoing-${suffix}@test.com`,
            password,
            packageDuration: 'ongoing',
        },
        trainerId
    );
    const ongoingSub = await ClientSubscription.findOne({
        clientId: ongoing.id,
        status: 'active',
    });
    const ongoingUser = await User.findById(ongoing.id).lean();
    if (
        ongoingSub?.packageDuration === 'ongoing' &&
        ongoingSub?.endDate == null &&
        ongoingUser?.packageDuration === 'ongoing' &&
        ongoingUser?.endDate == null
    ) {
        pass('Add Client: ongoing → active Subscription with null endDate');
    } else {
        fail(
            'Add Client: ongoing → active Subscription with null endDate',
            JSON.stringify({ ongoingSub, ongoingUser })
        );
    }

    // Invalid duration at create validation
    const badCreate = validateCreateClient.validate(
        {
            firstName: 'Bad',
            lastName: 'Dur',
            email: `cs-wp-bad-${suffix}@test.com`,
            password,
            primaryFitnessGoal: 'general_fitness',
            packageDuration: '8_weeks',
        },
        { abortEarly: false, stripUnknown: true }
    );
    if (badCreate.error) pass('Add Client: invalid packageDuration rejected by Joi');
    else fail('Add Client: invalid packageDuration rejected by Joi', 'expected error');

    // --- Update protection (service allowlist) ---
    const seeded = await clientService.createClient(
        {
            firstName: 'Seed',
            lastName: 'Snap',
            email: `cs-wp-seed-${suffix}@test.com`,
            password,
            packageDuration: '3_months',
        },
        trainerId
    );
    const before = await User.findById(seeded.id).lean();
    await clientService.updateClient(
        seeded.id,
        {
            firstName: 'Seeded',
            packageDuration: '12_months',
            startDate: '2030-01-01T00:00:00.000Z',
            endDate: '2031-01-01T00:00:00.000Z',
        },
        trainerId
    );
    const afterUpdate = await User.findById(seeded.id).lean();
    if (
        afterUpdate.firstName === 'Seeded' &&
        afterUpdate.packageDuration === before.packageDuration &&
        new Date(afterUpdate.startDate).toISOString() ===
            new Date(before.startDate).toISOString() &&
        new Date(afterUpdate.endDate).toISOString() ===
            new Date(before.endDate).toISOString()
    ) {
        pass('Update client: profile changes; snapshot fields ignored by allowlist');
    } else {
        fail(
            'Update client: profile changes; snapshot fields ignored by allowlist',
            JSON.stringify({ before, afterUpdate })
        );
    }

    await clientService.updateClientPlan(
        seeded.id,
        {
            packageDuration: '1_month',
            startDate: '2020-01-01T00:00:00.000Z',
            currentWeight: 80,
        },
        trainerId
    );
    const afterPlan = await User.findById(seeded.id).lean();
    if (
        afterPlan.currentWeight === 80 &&
        afterPlan.packageDuration === before.packageDuration
    ) {
        pass('Update plan: fitness updates; subscription snapshot unchanged');
    } else {
        fail(
            'Update plan: fitness updates; subscription snapshot unchanged',
            JSON.stringify(afterPlan)
        );
    }

    // Ownership: subscription belongs to creating trainer
    const ownedSub = await ClientSubscription.findOne({
        clientId: seeded.id,
        trainerId: trainer._id,
        status: 'active',
    });
    if (ownedSub && String(ownedSub.clientId) === String(seeded.id)) {
        pass('Add Client subscription ownership matches trainer/client');
    } else {
        fail('Add Client subscription ownership matches trainer/client', 'missing');
    }

    // Subscription create failure → roll back newly created client.
    const subSvc = (await import(
        '../src/modules/client-subscriptions/client-subscription.service.js'
    )).default;
    const prevCreateSubscription = subSvc.createSubscription;
    subSvc.createSubscription = async () => {
        throw new ApiError(500, 'Simulated subscription failure', [
            { field: 'clientId', code: 'SUBSCRIPTION_SNAPSHOT_SYNC_FAILED' },
        ]);
    };

    const failEmail = `cs-wp-fail-${suffix}@test.com`;
    try {
        await clientService.createClient(
            {
                firstName: 'Fail',
                lastName: 'Sub',
                email: failEmail,
                password,
                packageDuration: '1_month',
            },
            trainerId
        );
        fail('Add Client: subscription failure does not return success', 'expected throw');
    } catch (err) {
        const orphanUser = await User.findOne({ email: failEmail });
        const orphanSubs = orphanUser
            ? await ClientSubscription.countDocuments({ clientId: orphanUser._id })
            : 0;
        if (!orphanUser && orphanSubs === 0 && err instanceof ApiError) {
            pass('Add Client: subscription failure rolls back client; error preserved');
        } else {
            fail(
                'Add Client: subscription failure rolls back client; error preserved',
                JSON.stringify({
                    orphanUser: Boolean(orphanUser),
                    orphanSubs,
                    err: err?.message,
                })
            );
        }
    } finally {
        subSvc.createSubscription = prevCreateSubscription;
    }

    // HTTP smoke if server up
    const login = await request('POST', '/auth/login', {
        body: { email: trainer.email, password },
    });
    const token = login.json?.data?.token;
    if (token) {
        const httpForbidden = await request('PUT', `/clients/${seeded.id}`, {
            token,
            body: { packageDuration: '1_month' },
        });
        if (httpForbidden.status === 400) {
            pass('HTTP: PUT client rejects packageDuration');
        } else {
            fail(
                'HTTP: PUT client rejects packageDuration',
                `status ${httpForbidden.status}`
            );
        }

        const httpPlanForbidden = await request('PUT', `/clients/${seeded.id}/plan`, {
            token,
            body: { packageDuration: '6_months', currentWeight: 77 },
        });
        if (httpPlanForbidden.status === 400) {
            pass('HTTP: PUT plan rejects packageDuration');
        } else {
            fail(
                'HTTP: PUT plan rejects packageDuration',
                `status ${httpPlanForbidden.status}`
            );
        }

        const httpCreate = await request('POST', '/clients', {
            token,
            body: {
                firstName: 'Http',
                lastName: 'Add',
                email: `cs-wp-http-${suffix}@test.com`,
                password,
                primaryFitnessGoal: 'general_fitness',
                packageDuration: '1_month',
            },
        });
        if (httpCreate.status === 201 && httpCreate.json?.data?.id) {
            const httpSub = await ClientSubscription.findOne({
                clientId: httpCreate.json.data.id,
                status: 'active',
            });
            if (httpSub?.packageDuration === '1_month') {
                pass('HTTP: POST clients with packageDuration creates Subscription');
            } else {
                fail(
                    'HTTP: POST clients with packageDuration creates Subscription',
                    JSON.stringify(httpSub)
                );
            }
        } else {
            fail(
                'HTTP: POST clients with packageDuration creates Subscription',
                JSON.stringify(httpCreate)
            );
        }
    } else {
        fail('HTTP login for writer-protection smoke', JSON.stringify(login.json));
    }

    // Cleanup trainer's test clients
    const clients = await User.find({ trainer: trainer._id, role: 'client' }).select('_id');
    const ids = clients.map((c) => c._id);
    await ClientSubscription.deleteMany({ trainerId: trainer._id });
    await User.deleteMany({ _id: { $in: [...ids, trainer._id] } });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(
        `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
    );
    process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
