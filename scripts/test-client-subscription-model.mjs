/**
 * ClientSubscription model + indexes (Phase 2 data layer).
 * Run: node scripts/test-client-subscription-model.mjs
 * Requires: APP_DB_URL
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientSubscription from '../src/modules/client-subscriptions/client-subscription.model.js';
import {
    CLIENT_SUBSCRIPTION_STATUSES,
    PACKAGE_DURATION_VALUES,
} from '../src/modules/client-subscriptions/client-subscription.constants.js';
import { PACKAGE_DURATION_VALUES as SHARED_PACKAGE_DURATIONS } from '../src/modules/clients/client.package-dates.js';

const results = [];
const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const isDupKey = (err) =>
    err?.code === 11000 ||
    err?.code === '11000' ||
    Boolean(err?.message?.includes('E11000'));

const expectValidationFail = async (name, payload) => {
    try {
        await ClientSubscription.create(payload);
        fail(name, 'expected ValidationError');
    } catch (err) {
        if (err?.name === 'ValidationError') {
            pass(name);
        } else {
            fail(name, `${err?.name}: ${err?.message}`);
        }
    }
};

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);

    // Ensure indexes exist before uniqueness assertions (fresh collection or new defs).
    await ClientSubscription.syncIndexes();

    const indexes = await ClientSubscription.collection.indexes();
    const activeUnique = indexes.find(
        (idx) =>
            idx.name === 'trainerId_1_clientId_1_active_unique' ||
            (idx.unique &&
                idx.key?.trainerId === 1 &&
                idx.key?.clientId === 1 &&
                idx.partialFilterExpression?.status === 'active')
    );
    const historyIdx = indexes.find(
        (idx) =>
            idx.key?.trainerId === 1 &&
            idx.key?.clientId === 1 &&
            idx.key?.startDate === -1 &&
            idx.key?.createdAt === -1
    );

    if (activeUnique?.unique && activeUnique.partialFilterExpression?.status === 'active') {
        pass('Index: partial unique active (trainerId, clientId) present');
    } else {
        fail(
            'Index: partial unique active (trainerId, clientId) present',
            JSON.stringify(indexes)
        );
    }

    if (historyIdx) {
        pass('Index: history (trainerId, clientId, startDate, createdAt) present');
    } else {
        fail(
            'Index: history (trainerId, clientId, startDate, createdAt) present',
            JSON.stringify(indexes)
        );
    }

    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Sub',
        lastName: 'TrainerA',
        email: `cs-model-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const trainerB = await User.create({
        firstName: 'Sub',
        lastName: 'TrainerB',
        email: `cs-model-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const client1 = await User.create({
        firstName: 'Sub',
        lastName: 'Client1',
        email: `cs-model-c1-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });
    const client2 = await User.create({
        firstName: 'Sub',
        lastName: 'Client2',
        email: `cs-model-c2-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-04-01T00:00:00.000Z');

    const baseFinite = {
        trainerId: trainerA._id,
        clientId: client1._id,
        packageDuration: '3_months',
        startDate: start,
        endDate: end,
        status: 'active',
    };

    // --- A. Model validation ---
    try {
        const doc = await ClientSubscription.create(baseFinite);
        if (
            doc &&
            String(doc.trainerId) === String(trainerA._id) &&
            doc.packageDuration === '3_months' &&
            doc.status === 'active' &&
            doc.endDate instanceof Date
        ) {
            pass('Valid finite subscription');
        } else {
            fail('Valid finite subscription', JSON.stringify(doc));
        }
        // Keep this as the single active for later uniqueness tests — complete it first below.
        await ClientSubscription.updateOne(
            { _id: doc._id },
            { $set: { status: 'completed' } }
        );
    } catch (err) {
        fail('Valid finite subscription', err.message);
    }

    await expectValidationFail('Missing trainerId', {
        ...baseFinite,
        trainerId: undefined,
        status: 'completed',
    });
    await expectValidationFail('Missing clientId', {
        ...baseFinite,
        clientId: undefined,
        status: 'completed',
    });
    await expectValidationFail('Missing packageDuration', {
        ...baseFinite,
        packageDuration: undefined,
        status: 'completed',
    });
    await expectValidationFail('Missing startDate', {
        ...baseFinite,
        startDate: undefined,
        status: 'completed',
    });
    await expectValidationFail('Invalid packageDuration', {
        ...baseFinite,
        packageDuration: '8_weeks',
        status: 'completed',
    });
    await expectValidationFail('Invalid status', {
        ...baseFinite,
        status: 'scheduled',
    });
    await expectValidationFail('Finite package with missing endDate', {
        ...baseFinite,
        endDate: undefined,
        status: 'completed',
    });
    await expectValidationFail('Finite package with endDate null', {
        ...baseFinite,
        endDate: null,
        status: 'completed',
    });

    try {
        const ongoing = await ClientSubscription.create({
            trainerId: trainerA._id,
            clientId: client1._id,
            packageDuration: 'ongoing',
            startDate: start,
            endDate: null,
            status: 'completed',
        });
        if (ongoing.endDate === null && ongoing.packageDuration === 'ongoing') {
            pass('ongoing with valid null endDate');
        } else {
            fail('ongoing with valid null endDate', JSON.stringify(ongoing));
        }
    } catch (err) {
        fail('ongoing with valid null endDate', err.message);
    }

    await expectValidationFail('ongoing with non-null endDate', {
        trainerId: trainerA._id,
        clientId: client1._id,
        packageDuration: 'ongoing',
        startDate: start,
        endDate: end,
        status: 'completed',
    });
    await expectValidationFail('endDate earlier than startDate', {
        ...baseFinite,
        startDate: end,
        endDate: start,
        status: 'completed',
    });
    await expectValidationFail('endDate equal to startDate', {
        ...baseFinite,
        endDate: start,
        status: 'completed',
    });

    // --- C. Package compatibility ---
    const userEnum = User.schema.path('packageDuration')?.enumValues ?? [];
    const sharedMatchesModel =
        JSON.stringify([...PACKAGE_DURATION_VALUES]) ===
        JSON.stringify([...SHARED_PACKAGE_DURATIONS]);
    const matchesUser =
        JSON.stringify([...PACKAGE_DURATION_VALUES].sort()) ===
        JSON.stringify([...userEnum].sort());
    const noWeekKeys = !PACKAGE_DURATION_VALUES.some((v) =>
        String(v).includes('week')
    );

    if (PACKAGE_DURATION_VALUES.length === 5 && sharedMatchesModel && matchesUser) {
        pass('All five package duration keys match User + shared constants');
    } else {
        fail(
            'All five package duration keys match User + shared constants',
            JSON.stringify({ PACKAGE_DURATION_VALUES, userEnum })
        );
    }

    if (noWeekKeys) {
        pass('No week-based package keys');
    } else {
        fail('No week-based package keys', JSON.stringify(PACKAGE_DURATION_VALUES));
    }

    for (const duration of PACKAGE_DURATION_VALUES) {
        const payload =
            duration === 'ongoing'
                ? {
                      trainerId: trainerA._id,
                      clientId: client2._id,
                      packageDuration: duration,
                      startDate: start,
                      endDate: null,
                      status: 'cancelled',
                  }
                : {
                      trainerId: trainerA._id,
                      clientId: client2._id,
                      packageDuration: duration,
                      startDate: start,
                      endDate: end,
                      status: 'cancelled',
                  };
        try {
            await ClientSubscription.create(payload);
            pass(`Accepts packageDuration=${duration}`);
        } catch (err) {
            fail(`Accepts packageDuration=${duration}`, err.message);
        }
    }

    if (
        JSON.stringify([...CLIENT_SUBSCRIPTION_STATUSES]) ===
        JSON.stringify(['active', 'completed', 'cancelled'])
    ) {
        pass('Statuses are active|completed|cancelled only');
    } else {
        fail(
            'Statuses are active|completed|cancelled only',
            JSON.stringify(CLIENT_SUBSCRIPTION_STATUSES)
        );
    }

    // --- B. Index behavior ---
    const histStart1 = new Date('2025-01-01T00:00:00.000Z');
    const histEnd1 = new Date('2025-04-01T00:00:00.000Z');
    const histStart2 = new Date('2025-05-01T00:00:00.000Z');
    const histEnd2 = new Date('2025-08-01T00:00:00.000Z');

    try {
        await ClientSubscription.create([
            {
                trainerId: trainerA._id,
                clientId: client1._id,
                packageDuration: '3_months',
                startDate: histStart1,
                endDate: histEnd1,
                status: 'completed',
            },
            {
                trainerId: trainerA._id,
                clientId: client1._id,
                packageDuration: '3_months',
                startDate: histStart2,
                endDate: histEnd2,
                status: 'completed',
            },
        ]);
        pass('Multiple completed subscriptions allowed');
    } catch (err) {
        fail('Multiple completed subscriptions allowed', err.message);
    }

    try {
        await ClientSubscription.create([
            {
                trainerId: trainerA._id,
                clientId: client1._id,
                packageDuration: '1_month',
                startDate: histStart1,
                endDate: new Date('2025-02-01T00:00:00.000Z'),
                status: 'cancelled',
            },
            {
                trainerId: trainerA._id,
                clientId: client1._id,
                packageDuration: '1_month',
                startDate: histStart2,
                endDate: new Date('2025-06-01T00:00:00.000Z'),
                status: 'cancelled',
            },
        ]);
        pass('Multiple cancelled subscriptions allowed');
    } catch (err) {
        fail('Multiple cancelled subscriptions allowed', err.message);
    }

    let activeDoc;
    try {
        activeDoc = await ClientSubscription.create({
            trainerId: trainerA._id,
            clientId: client1._id,
            packageDuration: '6_months',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: new Date('2026-12-01T00:00:00.000Z'),
            status: 'active',
        });
        pass('One active subscription allowed');
    } catch (err) {
        fail('One active subscription allowed', err.message);
    }

    try {
        await ClientSubscription.create({
            trainerId: trainerA._id,
            clientId: client1._id,
            packageDuration: '1_month',
            startDate: new Date('2026-07-01T00:00:00.000Z'),
            endDate: new Date('2026-08-01T00:00:00.000Z'),
            status: 'active',
        });
        fail('Second active rejected by unique index', 'insert succeeded');
    } catch (err) {
        if (isDupKey(err)) {
            pass('Second active rejected by unique index');
        } else {
            fail('Second active rejected by unique index', `${err?.code} ${err?.message}`);
        }
    }

    try {
        await ClientSubscription.create({
            trainerId: trainerA._id,
            clientId: client2._id,
            packageDuration: '1_month',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: new Date('2026-07-01T00:00:00.000Z'),
            status: 'active',
        });
        pass('Different clients may each have an active subscription');
    } catch (err) {
        fail('Different clients may each have an active subscription', err.message);
    }

    try {
        await ClientSubscription.create({
            trainerId: trainerB._id,
            clientId: client1._id,
            packageDuration: '1_month',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: new Date('2026-07-01T00:00:00.000Z'),
            status: 'active',
        });
        pass('Different trainers do not share uniqueness scope');
    } catch (err) {
        fail('Different trainers do not share uniqueness scope', err.message);
    }

    if (activeDoc?._id) {
        await ClientSubscription.updateOne(
            { _id: activeDoc._id },
            { $set: { status: 'completed' } }
        );
    }

    try {
        await ClientSubscription.create({
            trainerId: trainerA._id,
            clientId: client1._id,
            packageDuration: '12_months',
            startDate: new Date('2027-01-01T00:00:00.000Z'),
            endDate: new Date('2028-01-01T00:00:00.000Z'),
            status: 'active',
        });
        pass('Completed then new active subscription allowed');
    } catch (err) {
        fail('Completed then new active subscription allowed', err.message);
    }

    // Cleanup test users + subscriptions (best-effort)
    await ClientSubscription.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await User.deleteMany({
        _id: { $in: [trainerA._id, trainerB._id, client1._id, client2._id] },
    });

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
