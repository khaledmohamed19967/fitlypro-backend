/**
 * Super Admin Phase 1 — trainers count/list/detail/clients.
 * Run: node scripts/test-super-admin-phase1.mjs
 * Requires: APP_DB_URL
 */
import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import superAdminService from '../src/modules/super-admin/super-admin.service.js';
import superAdminRoutes from '../src/modules/super-admin/super-admin.routes.js';
import userRoutes from '../src/modules/users/user.routes.js';
import { authorize } from '../src/middlewares/auth.middleware.js';
import { ApiError } from '../src/utils/ApiError.js';

const results = [];
const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const createdIds = [];

const track = (doc) => {
    if (doc?._id) createdIds.push(doc._id);
    return doc;
};

async function cleanup() {
    if (createdIds.length) {
        await User.deleteMany({ _id: { $in: createdIds } });
    }
}

/**
 * Minimal Express app mounting Super Admin routes (in-process HTTP).
 */
const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/super-admin', superAdminRoutes);
    app.use('/api/v1/users', userRoutes);
    app.use((err, _req, res, _next) => {
        const status = err.statusCode || err.status || 500;
        res.status(status).json({
            success: false,
            message: err.message || 'Error',
            errors: err.errors || undefined,
        });
    });
    return app;
};

const listen = (app) =>
    new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                server,
                base: `http://127.0.0.1:${port}/api/v1`,
            });
        });
    });

async function request(base, method, path, { token, body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const password = 'testpass123';

    // --- authorize middleware unit ---
    {
        const mw = authorize('admin');
        let denied = false;
        try {
            mw({ user: { role: 'trainer' } }, {}, () => {});
        } catch (err) {
            denied = err instanceof ApiError && err.statusCode === 403;
        }
        if (denied) pass('authorize: trainer denied for admin-only route');
        else fail('authorize: trainer denied for admin-only route', 'expected 403');

        let allowed = false;
        mw({ user: { role: 'admin' } }, {}, () => {
            allowed = true;
        });
        if (allowed) pass('authorize: admin allowed');
        else fail('authorize: admin allowed', 'next not called');
    }

    const admin = track(
        await User.create({
            firstName: 'Super',
            lastName: 'Admin',
            email: `sa-admin-${suffix}@test.com`,
            password,
            role: 'admin',
        })
    );
    const trainerA = track(
        await User.create({
            firstName: 'Alpha',
            lastName: 'Coach',
            email: `sa-trainer-a-${suffix}@test.com`,
            password,
            role: 'trainer',
        })
    );
    const trainerB = track(
        await User.create({
            firstName: 'Beta',
            lastName: 'Coach',
            email: `sa-trainer-b-${suffix}@test.com`,
            password,
            role: 'trainer',
            isActive: false,
        })
    );
    const plainUser = track(
        await User.create({
            firstName: 'Plain',
            lastName: 'Client',
            email: `sa-client-plain-${suffix}@test.com`,
            password,
            role: 'client',
        })
    );

    const clientA1 = track(
        await User.create({
            firstName: 'Ann',
            lastName: 'Active',
            email: `sa-c-a1-${suffix}@test.com`,
            password,
            role: 'client',
            trainer: trainerA._id,
            joinedCoachAt: new Date('2026-01-10T00:00:00.000Z'),
            packageDuration: '3_months',
        })
    );
    const clientA2 = track(
        await User.create({
            firstName: 'Inactive',
            lastName: 'Assigned',
            email: `sa-c-a2-${suffix}@test.com`,
            password,
            role: 'client',
            trainer: trainerA._id,
            isActive: false,
            joinedCoachAt: new Date('2026-01-11T00:00:00.000Z'),
        })
    );
    track(
        await User.create({
            firstName: 'Other',
            lastName: 'TrainerClient',
            email: `sa-c-b1-${suffix}@test.com`,
            password,
            role: 'client',
            trainer: trainerB._id,
            joinedCoachAt: new Date('2026-01-12T00:00:00.000Z'),
        })
    );

    // --- Service: count only trainers ---
    const countBeforeSearch = await superAdminService.getTrainerCount();
    const listedAll = await superAdminService.listTrainers({
        page: 1,
        limit: 100,
        search: `sa-trainer-`,
    });
    // Count endpoint is global; assert our two trainers are trainers and not counted as clients
    const roleCheck = await User.countDocuments({
        _id: { $in: [admin._id, trainerA._id, trainerB._id, plainUser._id] },
        role: 'trainer',
    });
    if (roleCheck === 2 && countBeforeSearch.totalTrainers >= 2) {
        pass('total trainer count includes only trainer role accounts');
    } else {
        fail(
            'total trainer count includes only trainer role accounts',
            JSON.stringify({ roleCheck, countBeforeSearch })
        );
    }

    // --- Service: list client counts (no N+1 correctness) ---
    const listA = await superAdminService.listTrainers({
        page: 1,
        limit: 10,
        search: `sa-trainer-a-${suffix}`,
    });
    const rowA = listA.trainers.find((t) => t.id === String(trainerA._id));
    if (rowA && rowA.clientCount === 2) {
        pass('trainer list returns accurate client counts');
    } else {
        fail(
            'trainer list returns accurate client counts',
            JSON.stringify(listA)
        );
    }

    const listB = await superAdminService.listTrainers({
        page: 1,
        limit: 10,
        search: `sa-trainer-b-${suffix}`,
    });
    const rowB = listB.trainers.find((t) => t.id === String(trainerB._id));
    if (rowB && rowB.clientCount === 1 && rowB.isActive === false) {
        pass('inactive trainer listed with correct client count');
    } else {
        fail(
            'inactive trainer listed with correct client count',
            JSON.stringify(listB)
        );
    }

    // Zero clients trainer
    const trainerEmpty = track(
        await User.create({
            firstName: 'Empty',
            lastName: 'Roster',
            email: `sa-trainer-empty-${suffix}@test.com`,
            password,
            role: 'trainer',
        })
    );
    const emptyList = await superAdminService.listTrainers({
        search: `sa-trainer-empty-${suffix}`,
    });
    const emptyRow = emptyList.trainers[0];
    if (emptyRow?.clientCount === 0) {
        pass('trainers with zero clients handled correctly');
    } else {
        fail(
            'trainers with zero clients handled correctly',
            JSON.stringify(emptyList)
        );
    }

    // Search + pagination
    const page1 = await superAdminService.listTrainers({
        page: 1,
        limit: 1,
        search: `sa-trainer-`,
    });
    const page2 = await superAdminService.listTrainers({
        page: 2,
        limit: 1,
        search: `sa-trainer-`,
    });
    if (
        page1.pagination.total >= 3 &&
        page1.trainers.length === 1 &&
        page2.trainers.length === 1 &&
        page1.trainers[0].id !== page2.trainers[0].id
    ) {
        pass('search and pagination work correctly');
    } else {
        fail(
            'search and pagination work correctly',
            JSON.stringify({ page1, page2 })
        );
    }

    // Detail
    const detail = await superAdminService.getTrainerById(String(trainerA._id));
    if (
        detail.id === String(trainerA._id) &&
        detail.email === trainerA.email &&
        detail.clientCount === 2 &&
        detail.password === undefined &&
        !('password' in detail)
    ) {
        pass('trainer details return correct safe profile');
    } else {
        fail('trainer details return correct safe profile', JSON.stringify(detail));
    }

    // Clients scoped
    const clientsA = await superAdminService.listTrainerClients(
        String(trainerA._id),
        { page: 1, limit: 10 }
    );
    const clientIds = clientsA.clients.map((c) => c.id).sort();
    const expectedIds = [String(clientA1._id), String(clientA2._id)].sort();
    if (
        clientsA.pagination.total === 2 &&
        clientIds.join(',') === expectedIds.join(',') &&
        clientsA.clients.every((c) => !('password' in c))
    ) {
        pass('trainer clients are scoped to the selected trainer');
    } else {
        fail(
            'trainer clients are scoped to the selected trainer',
            JSON.stringify(clientsA)
        );
    }

    const emptyClients = await superAdminService.listTrainerClients(
        String(trainerEmpty._id),
        { page: 1, limit: 10 }
    );
    if (
        emptyClients.clients.length === 0 &&
        emptyClients.pagination.total === 0
    ) {
        pass('empty trainer clients list returns zero rows');
    } else {
        fail(
            'empty trainer clients list returns zero rows',
            JSON.stringify(emptyClients)
        );
    }

    // Search clients
    const searchClients = await superAdminService.listTrainerClients(
        String(trainerA._id),
        { search: 'Ann' }
    );
    if (
        searchClients.pagination.total === 1 &&
        searchClients.clients[0]?.firstName === 'Ann'
    ) {
        pass('trainer clients search works');
    } else {
        fail('trainer clients search works', JSON.stringify(searchClients));
    }

    // Active / inactive filter
    const activeOnly = await superAdminService.listTrainerClients(
        String(trainerA._id),
        { status: 'active' }
    );
    const inactiveOnly = await superAdminService.listTrainerClients(
        String(trainerA._id),
        { status: 'inactive' }
    );
    if (
        activeOnly.pagination.total === 1 &&
        activeOnly.clients[0]?.id === String(clientA1._id) &&
        inactiveOnly.pagination.total === 1 &&
        inactiveOnly.clients[0]?.id === String(clientA2._id)
    ) {
        pass('active/inactive client status filters work');
    } else {
        fail(
            'active/inactive client status filters work',
            JSON.stringify({ activeOnly, inactiveOnly })
        );
    }

    // Isolation: trainer B clients must not appear under trainer A
    const isolation = await superAdminService.listTrainerClients(
        String(trainerA._id),
        { search: 'Other' }
    );
    if (isolation.pagination.total === 0 && isolation.clients.length === 0) {
        pass('client isolation: other trainer clients excluded');
    } else {
        fail(
            'client isolation: other trainer clients excluded',
            JSON.stringify(isolation)
        );
    }

    // DTO field allowlists (no medical / password / internal fields)
    const allowedTrainerKeys = new Set([
        'id',
        'firstName',
        'lastName',
        'fullName',
        'email',
        'isActive',
        'createdAt',
        'clientCount',
        'role',
        'phone',
        'phoneCountryIso',
        'phoneCountryCode',
        'gender',
        'dateOfBirth',
        'updatedAt',
    ]);
    const allowedClientKeys = new Set([
        'id',
        'firstName',
        'lastName',
        'fullName',
        'email',
        'isActive',
        'createdAt',
        'joinedCoachAt',
        'packageDuration',
        'startDate',
        'endDate',
    ]);
    const forbidden = [
        'password',
        'medicalConditions',
        'injuries',
        'progressNotes',
        '__v',
    ];
    const detailKeys = Object.keys(detail);
    const clientKeys = Object.keys(clientsA.clients[0] || {});
    const trainerKeysOk = detailKeys.every((k) => allowedTrainerKeys.has(k));
    const clientKeysOk = clientKeys.every((k) => allowedClientKeys.has(k));
    const noForbidden =
        forbidden.every((k) => !(k in detail)) &&
        forbidden.every((k) => !(k in (clientsA.clients[0] || {})));
    if (trainerKeysOk && clientKeysOk && noForbidden) {
        pass('DTOs expose only intended safe fields');
    } else {
        fail(
            'DTOs expose only intended safe fields',
            JSON.stringify({ detailKeys, clientKeys })
        );
    }

    // Pagination edge: page beyond last returns empty page, stable total
    const beyond = await superAdminService.listTrainers({
        page: 999,
        limit: 1,
        search: `sa-trainer-empty-${suffix}`,
    });
    if (
        beyond.pagination.total === 1 &&
        beyond.trainers.length === 0 &&
        beyond.pagination.pages === 1
    ) {
        pass('pagination edge: page beyond last returns empty slice');
    } else {
        fail(
            'pagination edge: page beyond last returns empty slice',
            JSON.stringify(beyond)
        );
    }

    // Invalid / non-trainer ids
    let notFound = false;
    try {
        await superAdminService.getTrainerById(String(admin._id));
    } catch (err) {
        notFound = err instanceof ApiError && err.statusCode === 404;
    }
    if (notFound) pass('admin id is not treated as a trainer (404)');
    else fail('admin id is not treated as a trainer (404)', 'expected 404');

    let badId = false;
    try {
        await superAdminService.getTrainerById('not-an-object-id');
    } catch (err) {
        badId = err instanceof ApiError && err.statusCode === 400;
    }
    if (badId) pass('invalid trainer id returns 400');
    else fail('invalid trainer id returns 400', 'expected 400');

    let missing = false;
    try {
        await superAdminService.getTrainerById(
            new mongoose.Types.ObjectId().toString()
        );
    } catch (err) {
        missing = err instanceof ApiError && err.statusCode === 404;
    }
    if (missing) pass('unknown trainer id returns 404');
    else fail('unknown trainer id returns 404', 'expected 404');

    // Consistency: list clientCount matches clients total without status filter
    if (detail.clientCount === clientsA.pagination.total) {
        pass('client count matches trainer clients list total');
    } else {
        fail(
            'client count matches trainer clients list total',
            `${detail.clientCount} vs ${clientsA.pagination.total}`
        );
    }

    // --- In-process HTTP auth + routes ---
    const { server, base } = await listen(buildApp());
    try {
        const adminToken = admin.generateAuthToken();
        const trainerToken = trainerA.generateAuthToken();
        const clientToken = plainUser.generateAuthToken();

        const unauth = await request(base, 'GET', '/super-admin/trainers/count');
        if (unauth.status === 401) pass('HTTP: unauthenticated denied (401)');
        else fail('HTTP: unauthenticated denied (401)', JSON.stringify(unauth));

        const asTrainer = await request(
            base,
            'GET',
            '/super-admin/trainers/count',
            { token: trainerToken }
        );
        if (asTrainer.status === 403) pass('HTTP: trainer denied (403)');
        else fail('HTTP: trainer denied (403)', JSON.stringify(asTrainer));

        const asClient = await request(
            base,
            'GET',
            '/super-admin/trainers',
            { token: clientToken }
        );
        if (asClient.status === 403) pass('HTTP: client denied (403)');
        else fail('HTTP: client denied (403)', JSON.stringify(asClient));

        const countHttp = await request(
            base,
            'GET',
            '/super-admin/trainers/count',
            { token: adminToken }
        );
        if (
            countHttp.status === 200 &&
            typeof countHttp.json?.data?.totalTrainers === 'number' &&
            countHttp.json.data.totalTrainers >= 3
        ) {
            pass('HTTP: admin can read trainer count');
        } else {
            fail('HTTP: admin can read trainer count', JSON.stringify(countHttp));
        }

        const listHttp = await request(
            base,
            'GET',
            `/super-admin/trainers?search=sa-trainer-a-${suffix}&limit=5`,
            { token: adminToken }
        );
        if (
            listHttp.status === 200 &&
            Array.isArray(listHttp.json?.data?.trainers) &&
            listHttp.json.data.trainers[0]?.clientCount === 2 &&
            listHttp.json.data.pagination
        ) {
            pass('HTTP: admin trainer list with client counts');
        } else {
            fail(
                'HTTP: admin trainer list with client counts',
                JSON.stringify(listHttp)
            );
        }

        const detailHttp = await request(
            base,
            'GET',
            `/super-admin/trainers/${trainerA._id}`,
            { token: adminToken }
        );
        if (
            detailHttp.status === 200 &&
            detailHttp.json?.data?.id === String(trainerA._id) &&
            detailHttp.json.data.password === undefined
        ) {
            pass('HTTP: admin trainer detail');
        } else {
            fail('HTTP: admin trainer detail', JSON.stringify(detailHttp));
        }

        const clientsHttp = await request(
            base,
            'GET',
            `/super-admin/trainers/${trainerA._id}/clients?page=1&limit=10`,
            { token: adminToken }
        );
        if (
            clientsHttp.status === 200 &&
            clientsHttp.json?.data?.pagination?.total === 2
        ) {
            pass('HTTP: admin trainer clients list');
        } else {
            fail(
                'HTTP: admin trainer clients list',
                JSON.stringify(clientsHttp)
            );
        }

        const badHttp = await request(
            base,
            'GET',
            `/super-admin/trainers/${admin._id}`,
            { token: adminToken }
        );
        if (badHttp.status === 404) pass('HTTP: non-trainer id → 404');
        else fail('HTTP: non-trainer id → 404', JSON.stringify(badHttp));

        const invalidParam = await request(
            base,
            'GET',
            '/super-admin/trainers/not-valid-id',
            { token: adminToken }
        );
        if (invalidParam.status === 400) {
            pass('HTTP: invalid trainerId param → 400');
        } else {
            fail(
                'HTTP: invalid trainerId param → 400',
                JSON.stringify(invalidParam)
            );
        }

        // Legacy GET /users must not be public
        const usersUnauth = await request(base, 'GET', '/users?limit=5');
        if (usersUnauth.status === 401) {
            pass('HTTP: GET /users unauthenticated → 401');
        } else {
            fail(
                'HTTP: GET /users unauthenticated → 401',
                JSON.stringify(usersUnauth)
            );
        }
        const usersAsTrainer = await request(base, 'GET', '/users?limit=5', {
            token: trainerToken,
        });
        if (usersAsTrainer.status === 403) {
            pass('HTTP: GET /users non-admin → 403');
        } else {
            fail(
                'HTTP: GET /users non-admin → 403',
                JSON.stringify(usersAsTrainer)
            );
        }
        const usersAsAdmin = await request(base, 'GET', '/users?limit=5', {
            token: adminToken,
        });
        const usersBody = JSON.stringify(usersAsAdmin.json);
        if (
            usersAsAdmin.status === 200 &&
            Array.isArray(usersAsAdmin.json?.data?.users) &&
            !usersBody.includes('"$2a$') &&
            !usersBody.includes('"$2b$')
        ) {
            pass('HTTP: GET /users admin ok without password hashes');
        } else {
            fail(
                'HTTP: GET /users admin ok without password hashes',
                JSON.stringify({
                    status: usersAsAdmin.status,
                    keys: Object.keys(usersAsAdmin.json?.data || {}),
                })
            );
        }
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }

    // Existing client list scope still trainer-scoped (unaffected contract smoke)
    const { buildClientListScopeQuery } = await import(
        '../src/modules/clients/client.list-scope.js'
    );
    const scope = buildClientListScopeQuery(trainerA._id);
    if (
        scope.role === 'client' &&
        String(scope.trainer) === String(trainerA._id) &&
        scope.isActive === true
    ) {
        pass('existing trainer client list scope unchanged');
    } else {
        fail('existing trainer client list scope unchanged', JSON.stringify(scope));
    }

    await cleanup();
    await mongoose.disconnect();

    console.log('\nSuper Admin Phase 1 checks:');
    for (const r of results) {
        console.log(
            `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`
        );
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
}

main().catch(async (err) => {
    console.error(err);
    try {
        await cleanup();
    } catch {
        /* ignore */
    }
    try {
        await mongoose.disconnect();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
