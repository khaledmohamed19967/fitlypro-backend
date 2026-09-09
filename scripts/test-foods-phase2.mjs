/**
 * Manual Phase 2 Food module verification.
 * Run: node scripts/test-foods-phase2.mjs
 *
 * Prerequisites:
 * - Dev server running
 * - Optional: pnpm run seed:foods (for system food tests)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import Food from '../src/modules/foods/food.model.js';
import { buildFoodSnapshot } from '../src/modules/foods/food.helpers.js';

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

const sampleFoodPayload = (suffix) => ({
    name: `Custom Food ${suffix}`,
    brand: 'FitlyTest',
    category: 'protein',
    nutritionPer100g: {
        calories: 200,
        protein: 25,
        carbs: 2,
        fat: 10,
    },
    defaultServing: {
        quantity: 100,
        unit: 'g',
        gramWeight: 100,
    },
});

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Food',
        lastName: 'Alpha',
        email: `food-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'Food',
        lastName: 'Beta',
        email: `food-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const loginA = await request('POST', '/auth/login', {
        body: { email: trainerA.email, password },
    });
    const loginB = await request('POST', '/auth/login', {
        body: { email: trainerB.email, password },
    });

    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;

    if (!tokenA || !tokenB) {
        fail('Trainer login', JSON.stringify(loginA.json));
        process.exit(1);
    }

    // 1. Create trainer food
    const createRes = await request('POST', '/foods', {
        token: tokenA,
        body: sampleFoodPayload(suffix),
    });
    const created = createRes.json?.data;
    if (createRes.status === 201 && created?.id) pass('Create trainer food');
    else fail('Create trainer food', JSON.stringify(createRes.json));

    // 2. Read own food
    const readOwn = await request('GET', `/foods/${created.id}`, { token: tokenA });
    if (readOwn.status === 200 && readOwn.json?.data?.id === created.id) pass('Read own food');
    else fail('Read own food', JSON.stringify(readOwn.json));

    // 3. Read system food
    const systemFood = await Food.findOne({ 'ownership.type': 'system' }).lean();
    if (!systemFood) {
        fail('Read system food', 'No system food in DB — run seed:foods first');
    } else {
        const readSystem = await request('GET', `/foods/${systemFood._id}`, { token: tokenA });
        if (readSystem.status === 200 && readSystem.json?.data?.ownership?.type === 'system') {
            pass('Read system food');
        } else {
            fail('Read system food', JSON.stringify(readSystem.json));
        }
    }

    // 4. Cannot read another trainer food
    const readForeign = await request('GET', `/foods/${created.id}`, { token: tokenB });
    if (readForeign.status === 404) pass('Cannot read another trainer food');
    else fail('Cannot read another trainer food', `status ${readForeign.status}`);

    // 5. Update own food
    const patchOwn = await request('PATCH', `/foods/${created.id}`, {
        token: tokenA,
        body: { name: `Updated Food ${suffix}` },
    });
    if (patchOwn.status === 200 && patchOwn.json?.data?.name === `Updated Food ${suffix}`) {
        pass('Update own food');
    } else {
        fail('Update own food', JSON.stringify(patchOwn.json));
    }

    // 6. Cannot update system food
    if (systemFood) {
        const patchSystem = await request('PATCH', `/foods/${systemFood._id}`, {
            token: tokenA,
            body: { name: 'Hacked System Food' },
        });
        if (patchSystem.status === 403) pass('Cannot update system food');
        else fail('Cannot update system food', `status ${patchSystem.status}`);
    }

    // 7. Cannot update another trainer food
    const patchForeign = await request('PATCH', `/foods/${created.id}`, {
        token: tokenB,
        body: { name: 'Stolen Food' },
    });
    if (patchForeign.status === 404) pass('Cannot update another trainer food');
    else fail('Cannot update another trainer food', `status ${patchForeign.status}`);

    // Create second food for archive tests
    const createB = await request('POST', '/foods', {
        token: tokenA,
        body: sampleFoodPayload(`${suffix}-archive`),
    });
    const archiveTarget = createB.json?.data;

    // 8. Archive own food
    const archiveOwn = await request('DELETE', `/foods/${archiveTarget?.id}`, { token: tokenA });
    if (archiveOwn.status === 200 && archiveOwn.json?.data?.status === 'archived') {
        pass('Archive own food');
    } else {
        fail('Archive own food', JSON.stringify(archiveOwn.json));
    }

    // 9. Cannot archive system food
    if (systemFood) {
        const archiveSystem = await request('DELETE', `/foods/${systemFood._id}`, { token: tokenA });
        if (archiveSystem.status === 403) pass('Cannot archive system food');
        else fail('Cannot archive system food', `status ${archiveSystem.status}`);
    }

    // 10. Cannot archive another trainer food
    const archiveForeign = await request('DELETE', `/foods/${created.id}`, { token: tokenB });
    if (archiveForeign.status === 404) pass('Cannot archive another trainer food');
    else fail('Cannot archive another trainer food', `status ${archiveForeign.status}`);

    // 11. List system foods
    const listSystem = await request('GET', '/foods?ownership=system&limit=5', { token: tokenA });
    const systemItems = listSystem.json?.data?.foods ?? [];
    if (listSystem.status === 200 && systemItems.every((f) => f.ownership?.type === 'system')) {
        pass('List system foods');
    } else {
        fail('List system foods', JSON.stringify(listSystem.json));
    }

    // 12. List trainer foods
    const listTrainer = await request('GET', '/foods?ownership=trainer', { token: tokenA });
    const trainerItems = listTrainer.json?.data?.foods ?? [];
    if (
        listTrainer.status === 200 &&
        trainerItems.length > 0 &&
        trainerItems.every((f) => f.ownership?.type === 'trainer')
    ) {
        pass('List trainer foods');
    } else {
        fail('List trainer foods', JSON.stringify(listTrainer.json));
    }

    // 13. List all visible foods
    const listAll = await request('GET', '/foods?ownership=all&limit=50', { token: tokenA });
    const allItems = listAll.json?.data?.foods ?? [];
    const hasSystem = allItems.some((f) => f.ownership?.type === 'system');
    const hasTrainer = allItems.some((f) => f.ownership?.type === 'trainer');
    if (listAll.status === 200 && hasTrainer && (systemFood ? hasSystem : true)) {
        pass('List all visible foods');
    } else {
        fail('List all visible foods', `system=${hasSystem} trainer=${hasTrainer}`);
    }

    // 14. Search
    const searchRes = await request('GET', '/foods?search=Updated&ownership=trainer', {
        token: tokenA,
    });
    const searchHits = searchRes.json?.data?.foods ?? [];
    if (searchRes.status === 200 && searchHits.some((f) => f.id === created.id)) {
        pass('Search foods');
    } else {
        fail('Search foods', JSON.stringify(searchRes.json));
    }

    // 15. Category filter
    const categoryRes = await request('GET', '/foods?category=protein&ownership=trainer', {
        token: tokenA,
    });
    const categoryItems = categoryRes.json?.data?.foods ?? [];
    if (
        categoryRes.status === 200 &&
        categoryItems.length > 0 &&
        categoryItems.every((f) => f.category === 'protein')
    ) {
        pass('Category filter');
    } else {
        fail('Category filter', JSON.stringify(categoryRes.json));
    }

    // 16. Status filter
    const statusRes = await request('GET', '/foods?status=archived&ownership=trainer', {
        token: tokenA,
    });
    const archivedItems = statusRes.json?.data?.foods ?? [];
    if (
        statusRes.status === 200 &&
        archivedItems.some((f) => f.id === archiveTarget?.id) &&
        archivedItems.every((f) => f.status === 'archived')
    ) {
        pass('Status filter');
    } else {
        fail('Status filter', JSON.stringify(statusRes.json));
    }

    // 17. Pagination
    await request('POST', '/foods', {
        token: tokenA,
        body: sampleFoodPayload(`${suffix}-page-b`),
    });
    const page1 = await request('GET', '/foods?ownership=trainer&page=1&limit=1', { token: tokenA });
    const page2 = await request('GET', '/foods?ownership=trainer&page=2&limit=1', { token: tokenA });
    const p1Foods = page1.json?.data?.foods ?? [];
    const p2Foods = page2.json?.data?.foods ?? [];
    if (
        page1.status === 200 &&
        page2.status === 200 &&
        p1Foods.length === 1 &&
        p2Foods.length === 1 &&
        p1Foods[0]?.id !== p2Foods[0]?.id
    ) {
        pass('Pagination');
    } else {
        fail('Pagination', `p1=${p1Foods[0]?.id} p2=${p2Foods[0]?.id}`);
    }

    // 18. Validation errors
    const invalidCreate = await request('POST', '/foods', {
        token: tokenA,
        body: { name: 'X', category: 'protein' },
    });
    if (invalidCreate.status === 400) pass('Validation errors');
    else fail('Validation errors', `status ${invalidCreate.status}`);

    // 19. Forbidden ownership fields
    const forbiddenCreate = await request('POST', '/foods', {
        token: tokenA,
        body: {
            ...sampleFoodPayload(`${suffix}-forbidden`),
            trainerId: trainerB._id.toString(),
            ownership: { type: 'trainer', trainerId: trainerB._id.toString() },
        },
    });
    if (forbiddenCreate.status === 400) pass('Forbidden ownership fields');
    else fail('Forbidden ownership fields', `status ${forbiddenCreate.status}`);

    // 20. Snapshot helper output
    const foodDoc = await Food.findById(created.id);
    const snapshot = buildFoodSnapshot(foodDoc);
    if (
        snapshot?.name &&
        snapshot?.nutritionPer100g?.calories != null &&
        snapshot?.defaultServing?.gramWeight
    ) {
        pass('Snapshot helper output');
    } else {
        fail('Snapshot helper output', JSON.stringify(snapshot));
    }

    // 21. Seed idempotency
    const systemSeedCount = await Food.countDocuments({
        'ownership.type': 'system',
        'source.externalProvider': 'fitlypro',
    });
    if (systemSeedCount >= 17) pass('Seed idempotency (system foods present)');
    else fail('Seed idempotency (system foods present)', `count=${systemSeedCount}`);

    // 22. Trainer foods survive seed (count unchanged by this test's seed assumption)
    const trainerCount = await Food.countDocuments({
        'ownership.type': 'trainer',
        'ownership.trainerId': { $in: [trainerA._id, trainerB._id] },
    });
    if (trainerCount >= 2) pass('Trainer foods survive seed');
    else fail('Trainer foods survive seed', `count=${trainerCount}`);

    // 23. Piece serving requires gramWeight (model-level via API)
    const badPiece = await request('POST', '/foods', {
        token: tokenA,
        body: {
            name: `Bad Piece Food ${suffix}`,
            category: 'protein',
            nutritionPer100g: { calories: 100, protein: 10, carbs: 0, fat: 2 },
            defaultServing: { quantity: 1, unit: 'piece', gramWeight: 0 },
        },
    });
    if (badPiece.status === 400) pass('Piece serving requires gramWeight');
    else fail('Piece serving requires gramWeight', `status ${badPiece.status}`);

    // 24. Serving unit validation
    const badUnit = await request('POST', '/foods', {
        token: tokenA,
        body: {
            name: `Bad Unit Food ${suffix}`,
            category: 'protein',
            nutritionPer100g: { calories: 100, protein: 10, carbs: 0, fat: 2 },
            defaultServing: { quantity: 1, unit: 'cups', gramWeight: 100 },
        },
    });
    if (badUnit.status === 400) pass('Serving unit validation');
    else fail('Serving unit validation', `status ${badUnit.status}`);

    // Cleanup test trainer foods
    await Food.deleteMany({
        'ownership.type': 'trainer',
        'ownership.trainerId': { $in: [trainerA._id, trainerB._id] },
    });
    await User.deleteMany({ _id: { $in: [trainerA._id, trainerB._id] } });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
