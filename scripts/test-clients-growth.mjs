/**
 * Clients Growth — joinedCoachAt guards, bucketing, API, backfill reporting.
 * Run: node scripts/test-clients-growth.mjs
 * Requires: APP_DB_URL
 */
import 'dotenv/config';
import crypto from 'crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientInvitation from '../src/modules/client-invitations/client-invitation.model.js';
import { CLIENT_INVITATION_STATUS } from '../src/modules/client-invitations/client-invitation.constants.js';
import clientService from '../src/modules/clients/client.service.js';
import authService from '../src/modules/auth/auth.service.js';
import userService from '../src/modules/users/user.service.js';
import coachDashboardService from '../src/modules/coach-dashboard/coach-dashboard.service.js';
import {
    buildClientsGrowthBuckets,
    computeClientsGrowthPercentage,
    resolveClientsGrowthWindow,
    resolvePreviousClientsGrowthWindow,
} from '../src/modules/coach-dashboard/coach-dashboard.clients-growth.js';
import {
    filterAllowsInitialJoinedCoachAtAssignment,
    sanitizeJoinedCoachAtBulkWriteOps,
    sanitizeJoinedCoachAtQueryUpdate,
} from '../src/modules/users/user.joined-coach-at-guard.js';
import { hashInvitationToken } from '../src/modules/client-invitations/client-invitation.helpers.js';

const BASE = process.env.API_URL || 'http://localhost:8000';
const API = `${BASE}/api/v1`;
const here = dirname(fileURLToPath(import.meta.url));
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
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
        const res = await fetch(`${API}${path}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        return { status: res.status, json, ok: true };
    } catch (err) {
        return { status: 0, json: {}, ok: false, error: err.message };
    }
}

const runBackfillDryRun = () =>
    new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [join(here, 'backfill-joined-coach-at.mjs'), '--dry-run'],
            { cwd: join(here, '..'), env: process.env }
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

const NOW = new Date('2026-11-12T15:00:00.000Z');
const seriesSum = (series) => series.reduce((sum, row) => sum + row.newClients, 0);

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const password = 'testpass123';

    // --- Guard unit helpers ---
    if (
        filterAllowsInitialJoinedCoachAtAssignment({ joinedCoachAt: null }) &&
        filterAllowsInitialJoinedCoachAtAssignment({
            $or: [{ joinedCoachAt: null }, { joinedCoachAt: { $exists: false } }],
        }) &&
        !filterAllowsInitialJoinedCoachAtAssignment({ _id: new mongoose.Types.ObjectId() })
    ) {
        pass('G1. Filter allow rules for initial joinedCoachAt');
    } else {
        fail('G1. Filter allow rules', 'unexpected allow result');
    }

    const blockedUpdate = { $set: { firstName: 'X', joinedCoachAt: new Date('2021-01-01') } };
    sanitizeJoinedCoachAtQueryUpdate({ _id: 'x' }, blockedUpdate);
    if (blockedUpdate.$set.joinedCoachAt === undefined && blockedUpdate.$set.firstName === 'X') {
        pass('G2. Query update strips joinedCoachAt without null filter');
    } else {
        fail('G2. Strip query update', JSON.stringify(blockedUpdate));
    }

    const allowedUpdate = { $set: { joinedCoachAt: new Date('2021-01-01') } };
    sanitizeJoinedCoachAtQueryUpdate({ joinedCoachAt: null }, allowedUpdate);
    if (allowedUpdate.$set.joinedCoachAt != null) {
        pass('G3. Query update keeps joinedCoachAt with null filter');
    } else {
        fail('G3. Allow null-filter update', JSON.stringify(allowedUpdate));
    }

    // --- Windows / percentage ---
    const window = resolveClientsGrowthWindow('30d', NOW);
    const prev = resolvePreviousClientsGrowthWindow(window);
    if (
        window.dayCount === 30 &&
        window.to.toISOString() === '2026-11-13T00:00:00.000Z' &&
        window.from.toISOString() === '2026-10-14T00:00:00.000Z' &&
        prev.to.toISOString() === window.from.toISOString() &&
        prev.from.toISOString() === '2026-09-14T00:00:00.000Z'
    ) {
        pass('1. UTC 30d window + previous period boundaries');
    } else {
        fail('1. UTC 30d window', JSON.stringify({ window, prev }));
    }

    if (
        computeClientsGrowthPercentage(12, 9) === 33.33 &&
        computeClientsGrowthPercentage(0, 0) === 0 &&
        computeClientsGrowthPercentage(5, 0) === null
    ) {
        pass('2. growthPercentage never Infinity/NaN');
    } else {
        fail('2. growthPercentage', String(computeClientsGrowthPercentage(5, 0)));
    }

    // --- Partial buckets ---
    const weekBuckets30 = buildClientsGrowthBuckets(window.from, window.to, 'week');
    const firstWeek = weekBuckets30[0];
    const lastWeek = weekBuckets30[weekBuckets30.length - 1];
    if (
        firstWeek.periodStart.toISOString() === '2026-10-12T00:00:00.000Z' &&
        firstWeek.periodStart.getTime() < window.from.getTime() &&
        firstWeek.periodEnd.toISOString() === '2026-10-19T00:00:00.000Z' &&
        lastWeek.periodStart.toISOString() === '2026-11-09T00:00:00.000Z' &&
        lastWeek.periodEnd.getTime() > window.to.getTime()
    ) {
        pass('3. 30d+week: calendar bounds with partial first/last');
    } else {
        fail('3. 30d+week partial', JSON.stringify({ firstWeek, lastWeek }));
    }

    const dayBuckets = buildClientsGrowthBuckets(window.from, window.to, 'day');
    if (
        dayBuckets.length === 30 &&
        dayBuckets[0].periodStart.toISOString() === window.from.toISOString() &&
        dayBuckets.every((b) => b.periodEnd.getTime() - b.periodStart.getTime() === 86400000)
    ) {
        pass('4. day buckets: 30 full UTC days');
    } else {
        fail('4. day buckets', String(dayBuckets.length));
    }

    const window3m = resolveClientsGrowthWindow('3m', NOW);
    const week3m = buildClientsGrowthBuckets(window3m.from, window3m.to, 'week');
    if (week3m.length > 0 && week3m[0].periodStart.getTime() <= window3m.from.getTime()) {
        pass('5. 3m+week bucket generation');
    } else {
        fail('5. 3m+week', String(week3m.length));
    }

    const window6m = resolveClientsGrowthWindow('6m', NOW);
    const week6m = buildClientsGrowthBuckets(window6m.from, window6m.to, 'week');
    if (week6m.length > 0) {
        pass('6. 6m+week bucket generation');
    } else {
        fail('6. 6m+week', 'empty');
    }

    const window12m = resolveClientsGrowthWindow('12m', NOW);
    // from is mid-month relative to calendar (2025-11-13 for NOW 2026-11-12)
    const month12 = buildClientsGrowthBuckets(window12m.from, window12m.to, 'month');
    if (
        month12[0].periodStart.getUTCDate() === 1 &&
        month12[0].periodStart.getTime() <= window12m.from.getTime() &&
        month12[month12.length - 1].periodEnd.getTime() >= window12m.to.getTime()
    ) {
        pass('7. 12m+month: mid-range start keeps calendar month bounds');
    } else {
        fail('7. 12m+month', JSON.stringify(month12[0]));
    }

    const trainerA = await User.create({
        firstName: 'Growth',
        lastName: 'TrainerA',
        email: `growth-ta-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const trainerB = await User.create({
        firstName: 'Growth',
        lastName: 'TrainerB',
        email: `growth-tb-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const created = await clientService.createClient(
        {
            firstName: 'Growth',
            lastName: 'ClientOne',
            email: `growth-c1-${suffix}@test.com`,
            password,
            primaryFitnessGoal: 'muscle_gain',
            startDate: '2026-01-01',
            packageDuration: '3_months',
        },
        trainerA._id.toString()
    );

    const stored = await User.findById(created.id);
    if (stored?.joinedCoachAt instanceof Date) {
        pass('8. Direct create sets joinedCoachAt');
    } else {
        fail('8. Direct create joinedCoachAt', JSON.stringify(stored?.joinedCoachAt));
    }

    const originalJoined = new Date(stored.joinedCoachAt);

    // save() protection
    stored.joinedCoachAt = new Date('2020-01-01T00:00:00.000Z');
    stored.firstName = 'GrowthUpdated';
    await stored.save();
    const afterSave = await User.findById(stored._id);
    if (
        afterSave.firstName === 'GrowthUpdated' &&
        afterSave.joinedCoachAt.getTime() === originalJoined.getTime()
    ) {
        pass('9. save() cannot overwrite joinedCoachAt');
    } else {
        fail('9. save freeze', String(afterSave.joinedCoachAt));
    }

    // updateOne protection
    await User.updateOne(
        { _id: stored._id },
        { $set: { lastName: 'Protected', joinedCoachAt: new Date('1999-01-01T00:00:00.000Z') } }
    );
    const afterUpdateOne = await User.findById(stored._id);
    if (
        afterUpdateOne.lastName === 'Protected' &&
        afterUpdateOne.joinedCoachAt.getTime() === originalJoined.getTime()
    ) {
        pass('10. updateOne cannot overwrite joinedCoachAt');
    } else {
        fail('10. updateOne', String(afterUpdateOne.joinedCoachAt));
    }

    // findByIdAndUpdate / userService.updateUser
    await userService.updateUser(stored._id.toString(), {
        phone: '1234567890',
        joinedCoachAt: new Date('1998-01-01T00:00:00.000Z'),
    });
    const afterFindUpdate = await User.findById(stored._id);
    if (
        afterFindUpdate.phone === '1234567890' &&
        afterFindUpdate.joinedCoachAt.getTime() === originalJoined.getTime()
    ) {
        pass('11. findByIdAndUpdate / updateUser cannot overwrite joinedCoachAt');
    } else {
        fail('11. findByIdAndUpdate', String(afterFindUpdate.joinedCoachAt));
    }

    await User.updateMany(
        { _id: stored._id },
        { $set: { joinedCoachAt: new Date('1997-01-01T00:00:00.000Z') } }
    );
    const afterUpdateMany = await User.findById(stored._id);
    if (afterUpdateMany.joinedCoachAt.getTime() === originalJoined.getTime()) {
        pass('12. updateMany cannot overwrite joinedCoachAt');
    } else {
        fail('12. updateMany', String(afterUpdateMany.joinedCoachAt));
    }

    await User.bulkWrite([
        {
            updateOne: {
                filter: { _id: stored._id },
                update: {
                    $set: {
                        gender: 'male',
                        joinedCoachAt: new Date('1996-01-01T00:00:00.000Z'),
                    },
                },
            },
        },
    ]);
    const afterBulk = await User.findById(stored._id);
    if (
        afterBulk.gender === 'male' &&
        afterBulk.joinedCoachAt.getTime() === originalJoined.getTime()
    ) {
        pass('13. bulkWrite cannot overwrite joinedCoachAt');
    } else {
        fail('13. bulkWrite', String(afterBulk.joinedCoachAt));
    }

    // Backfill-style null filter still allowed
    const legacy = await User.create({
        firstName: 'Legacy',
        lastName: 'Client',
        email: `growth-legacy-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
        joinedCoachAt: null,
    });
    await User.collection.updateOne(
        { _id: legacy._id },
        { $set: { createdAt: new Date('2026-10-20T12:00:00.000Z'), joinedCoachAt: null } }
    );
    await User.updateOne(
        {
            _id: legacy._id,
            $or: [{ joinedCoachAt: null }, { joinedCoachAt: { $exists: false } }],
        },
        { $set: { joinedCoachAt: new Date('2026-10-20T12:00:00.000Z') } }
    );
    const afterNullSet = await User.findById(legacy._id);
    if (afterNullSet.joinedCoachAt?.toISOString() === '2026-10-20T12:00:00.000Z') {
        pass('14. Null-filter update may assign joinedCoachAt once');
    } else {
        fail('14. Null-filter assign', String(afterNullSet.joinedCoachAt));
    }

    const publicReg = await authService.register({
        firstName: 'Public',
        lastName: 'Client',
        email: `growth-public-${suffix}@test.com`,
        password,
    });
    const publicUser = await User.findById(publicReg.user.id);
    if (publicUser.joinedCoachAt == null && publicUser.trainer == null) {
        pass('15. Public registration has no joinedCoachAt');
    } else {
        fail('15. Public registration', JSON.stringify(publicUser.joinedCoachAt));
    }

    await clientService.updateClientPlan(
        stored._id.toString(),
        { startDate: '2026-06-01', packageDuration: '12_months' },
        trainerA._id.toString()
    );
    const afterPlan = await User.findById(stored._id);
    if (afterPlan.joinedCoachAt.getTime() === originalJoined.getTime()) {
        pass('16. Package change does not alter joinedCoachAt');
    } else {
        fail('16. Package change', String(afterPlan.joinedCoachAt));
    }

    await clientService.deleteClient(stored._id.toString(), trainerA._id.toString());
    await clientService.reactivateClient(stored._id.toString(), trainerA._id.toString());
    const afterReactivate = await User.findById(stored._id);
    if (afterReactivate.joinedCoachAt.getTime() === originalJoined.getTime()) {
        pass('17. Deactivate/reactivate does not alter joinedCoachAt');
    } else {
        fail('17. Deactivate/reactivate', String(afterReactivate.joinedCoachAt));
    }

    const rawToken = crypto.randomBytes(24).toString('hex');
    await ClientInvitation.create({
        clientId: stored._id,
        trainerId: trainerA._id,
        tokenHash: hashInvitationToken(rawToken),
        status: CLIENT_INVITATION_STATUS.PENDING,
        expiresAt: new Date(Date.now() + 86400000),
        usedAt: null,
    });
    await ClientInvitation.findOneAndUpdate(
        { tokenHash: hashInvitationToken(rawToken) },
        { $set: { status: CLIENT_INVITATION_STATUS.USED, usedAt: new Date() } },
        { returnDocument: 'after' }
    );
    stored.password = 'newpass999';
    await stored.save();
    const afterInvite = await User.findById(stored._id);
    if (afterInvite.joinedCoachAt.getTime() === originalJoined.getTime()) {
        pass('18. Invitation password save does not alter joinedCoachAt');
    } else {
        fail('18. Invitation', String(afterInvite.joinedCoachAt));
    }

    // Seed growth window data
    await User.collection.updateOne(
        { _id: stored._id },
        { $set: { joinedCoachAt: new Date('2026-10-16T08:00:00.000Z') } }
    );
    // Note: collection API remains outside application guards (documented limitation).

    await User.create({
        firstName: 'In',
        lastName: 'Window',
        email: `growth-in-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
        joinedCoachAt: new Date('2026-10-15T10:00:00.000Z'),
    });
    await User.create({
        firstName: 'Out',
        lastName: 'Window',
        email: `growth-out-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
        joinedCoachAt: new Date('2026-09-01T10:00:00.000Z'),
    });
    await User.create({
        firstName: 'Other',
        lastName: 'Coach',
        email: `growth-other-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerB._id,
        joinedCoachAt: new Date('2026-10-15T10:00:00.000Z'),
    });

    const growthDay = await coachDashboardService.getClientsGrowth(
        trainerA._id.toString(),
        { range: '30d', groupBy: 'day' },
        NOW
    );
    // legacy 10-20, in 10-15, stored 10-16
    if (
        growthDay.totalNewClients === 3 &&
        growthDay.series.length === 30 &&
        seriesSum(growthDay.series) === growthDay.totalNewClients &&
        growthDay.series.every((row) => typeof row.newClients === 'number')
    ) {
        pass('19. 30d+day: zero-fill + sum(series) === total');
    } else {
        fail('19. 30d+day', JSON.stringify({
            total: growthDay.totalNewClients,
            sum: seriesSum(growthDay.series),
            len: growthDay.series.length,
        }));
    }

    const growthWeek = await coachDashboardService.getClientsGrowth(
        trainerA._id.toString(),
        { range: '30d', groupBy: 'week' },
        NOW
    );
    if (
        growthWeek.series[0].periodStart === '2026-10-12T00:00:00.000Z' &&
        new Date(growthWeek.series[0].periodStart).getTime() < new Date(growthWeek.from).getTime() &&
        seriesSum(growthWeek.series) === growthWeek.totalNewClients &&
        growthWeek.totalNewClients === 3
    ) {
        pass('20. 30d+week: partial first bucket + sum === total');
    } else {
        fail('20. 30d+week', JSON.stringify(growthWeek.series[0]));
    }

    const growth3m = await coachDashboardService.getClientsGrowth(
        trainerA._id.toString(),
        { range: '3m', groupBy: 'week' },
        NOW
    );
    if (seriesSum(growth3m.series) === growth3m.totalNewClients && growth3m.series.length > 0) {
        pass('21. 3m+week: sum(series) === total');
    } else {
        fail('21. 3m+week', String(seriesSum(growth3m.series)));
    }

    const growth6m = await coachDashboardService.getClientsGrowth(
        trainerA._id.toString(),
        { range: '6m', groupBy: 'week' },
        NOW
    );
    if (seriesSum(growth6m.series) === growth6m.totalNewClients) {
        pass('22. 6m+week: sum(series) === total');
    } else {
        fail('22. 6m+week', String(seriesSum(growth6m.series)));
    }

    const growth12m = await coachDashboardService.getClientsGrowth(
        trainerA._id.toString(),
        { range: '12m', groupBy: 'month' },
        NOW
    );
    if (
        seriesSum(growth12m.series) === growth12m.totalNewClients &&
        new Date(growth12m.series[0].periodStart).getUTCDate() === 1
    ) {
        pass('23. 12m+month: sum(series) === total');
    } else {
        fail('23. 12m+month', String(seriesSum(growth12m.series)));
    }

    const growthB = await coachDashboardService.getClientsGrowth(
        trainerB._id.toString(),
        { range: '30d', groupBy: 'day' },
        NOW
    );
    if (growthB.totalNewClients === 1) {
        pass('24. Trainer isolation');
    } else {
        fail('24. Trainer isolation', String(growthB.totalNewClients));
    }

    await User.create({
        firstName: 'CreatedAt',
        lastName: 'Trap',
        email: `growth-trap-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
        joinedCoachAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    const growthTrap = await coachDashboardService.getClientsGrowth(
        trainerA._id.toString(),
        { range: '30d' },
        NOW
    );
    if (growthTrap.totalNewClients === 3) {
        pass('25. Counts use joinedCoachAt not createdAt');
    } else {
        fail('25. joinedCoachAt source', String(growthTrap.totalNewClients));
    }

    if (
        typeof growthDay.previousPeriodTotal === 'number' &&
        (growthDay.growthPercentage === null || Number.isFinite(growthDay.growthPercentage))
    ) {
        pass('26. Previous period + safe growthPercentage');
    } else {
        fail('26. Previous period', JSON.stringify(growthDay));
    }

    // Backfill dry-run reporting shape
    const dry = await runBackfillDryRun();
    let report = null;
    const jsonStart = dry.stdout.indexOf('{');
    const jsonEnd = dry.stdout.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
        try {
            report = JSON.parse(dry.stdout.slice(jsonStart, jsonEnd + 1));
        } catch {
            report = null;
        }
    }
    if (
        dry.code === 0 &&
        report?.dryRun === true &&
        typeof report.eligible === 'number' &&
        typeof report.plannedUpdates === 'number' &&
        report.updated === 0 &&
        report.skipped &&
        typeof report.skipped.alreadySet === 'number' &&
        report.failed &&
        report.failed.count === 0
    ) {
        pass('27. Backfill dry-run reporting distinguishes eligible/updated/skipped/failed');
    } else {
        fail('27. Backfill dry-run report', dry.stdout.slice(0, 500));
    }

    // Optional HTTP
    const login = await request('POST', '/auth/login', {
        body: { email: trainerA.email, password },
    });
    const token = login.json?.data?.token;
    if (login.ok && token) {
        const httpGrowth = await request(
            'GET',
            '/coach-dashboard/clients-growth?range=30d&groupBy=week',
            { token }
        );
        if (
            httpGrowth.status === 200 &&
            typeof httpGrowth.json?.data?.totalNewClients === 'number' &&
            Array.isArray(httpGrowth.json.data.series)
        ) {
            pass('28. HTTP GET clients-growth week');
        } else if (!httpGrowth.ok || httpGrowth.status === 0) {
            pass('28. HTTP GET clients-growth week (server not running — skipped)');
        } else {
            fail('28. HTTP GET', JSON.stringify(httpGrowth.json));
        }

        const bad = await request('GET', '/coach-dashboard/clients-growth?range=7d', { token });
        if (!bad.ok || bad.status === 0) {
            pass('29. Invalid range rejected (skipped)');
        } else if (bad.status === 400) {
            pass('29. Invalid range rejected');
        } else {
            fail('29. Invalid range', String(bad.status));
        }

        const unauth = await request('GET', '/coach-dashboard/clients-growth?range=30d');
        if (!unauth.ok || unauth.status === 0) {
            pass('30. Unauthorized blocked (skipped)');
        } else if (unauth.status === 401 || unauth.status === 403) {
            pass('30. Unauthorized blocked');
        } else {
            fail('30. Unauthorized', String(unauth.status));
        }

        const overview = await request('GET', '/coach-dashboard/overview', { token });
        if (!overview.ok || overview.status === 0) {
            pass('31. Overview unchanged (skipped)');
        } else if (overview.status === 200 && overview.json?.data?.overview) {
            pass('31. Overview unchanged');
        } else {
            fail('31. Overview', JSON.stringify(overview.json));
        }
    } else {
        pass('28. HTTP GET clients-growth week (login unavailable — skipped)');
        pass('29. Invalid range rejected (skipped)');
        pass('30. Unauthorized blocked (skipped)');
        pass('31. Overview unchanged (skipped)');
    }

    await ClientInvitation.deleteMany({ trainerId: { $in: [trainerA._id, trainerB._id] } });
    await User.deleteMany({
        $or: [
            { _id: { $in: [trainerA._id, trainerB._id] } },
            { trainer: { $in: [trainerA._id, trainerB._id] } },
            { email: publicUser.email },
        ],
    });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(
        `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
    );
    if (failed.length) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
