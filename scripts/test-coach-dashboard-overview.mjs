/**
 * Coach Dashboard Overview — Phase 1 tests.
 * Run: node scripts/test-coach-dashboard-overview.mjs
 * Requires: APP_DB_URL
 *
 * Optional HTTP checks when API_URL server is reachable.
 */
import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientInvitation from '../src/modules/client-invitations/client-invitation.model.js';
import { CLIENT_INVITATION_STATUS } from '../src/modules/client-invitations/client-invitation.constants.js';
import ClientProspectInvitation from '../src/modules/client-prospect-invitations/client-prospect-invitation.model.js';
import { CLIENT_PROSPECT_INVITATION_STATUS } from '../src/modules/client-prospect-invitations/client-prospect-invitation.constants.js';
import ClientRegistrationRequest from '../src/modules/client-registration-requests/client-registration-request.model.js';
import { CLIENT_REGISTRATION_REQUEST_STATUS } from '../src/modules/client-registration-requests/client-registration-request.constants.js';
import { buildClientListScopeQuery } from '../src/modules/clients/client.list-scope.js';
import { summarizeClientRoster } from '../src/modules/clients/client.list-summary.js';
import coachDashboardService from '../src/modules/coach-dashboard/coach-dashboard.service.js';
import {
    buildNeedsAttentionSection,
    buildSubscriptionsSection,
    formatUtcDateKey,
    getUtcRollingEightDayRange,
    getUtcWeekRange,
} from '../src/modules/coach-dashboard/coach-dashboard.helpers.js';

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

const NOW = new Date('2026-11-11T15:30:00.000Z'); // Wednesday UTC

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

const hashToken = (raw) =>
    crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const password = 'testpass123';

    // --- Unit: calendar week (Mon–Sun UTC) still used by clients-growth ---
    const week = getUtcWeekRange(NOW);
    if (
        formatUtcDateKey(week.weekStart) === '2026-11-09' &&
        formatUtcDateKey(week.weekEnd) === '2026-11-15' &&
        week.days.length === 7
    ) {
        pass('UTC week Mon–Sun for 2026-11-11');
    } else {
        fail(
            'UTC week Mon–Sun for 2026-11-11',
            `${formatUtcDateKey(week.weekStart)}..${formatUtcDateKey(week.weekEnd)}`
        );
    }

    // --- Unit: subscriptions timeline = today → today+7 UTC (8 columns) ---
    const rolling = getUtcRollingEightDayRange(NOW);
    if (
        formatUtcDateKey(rolling.weekStart) === '2026-11-11' &&
        formatUtcDateKey(rolling.weekEnd) === '2026-11-18' &&
        formatUtcDateKey(rolling.days[0]) === '2026-11-11' &&
        formatUtcDateKey(rolling.days[7]) === '2026-11-18' &&
        rolling.days.length === 8
    ) {
        pass('UTC rolling eight-day window starts today for 2026-11-11');
    } else {
        fail(
            'UTC rolling eight-day window starts today for 2026-11-11',
            `${formatUtcDateKey(rolling.weekStart)}..${formatUtcDateKey(rolling.weekEnd)}`
        );
    }

    const trainerA = await User.create({
        firstName: 'Dash',
        lastName: 'TrainerA',
        email: `dash-trainer-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const trainerB = await User.create({
        firstName: 'Dash',
        lastName: 'TrainerB',
        email: `dash-trainer-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const mkClient = async (trainer, lastName, fields = {}) =>
        User.create({
            firstName: 'Dash',
            lastName,
            email: `dash-${lastName.toLowerCase()}-${suffix}@test.com`,
            password,
            role: 'client',
            trainer: trainer._id,
            isActive: true,
            primaryFitnessGoal: 'general_fitness',
            ...fields,
        });

    // Active clients with various package ends (relative to NOW)
    const cExpiresToday = await mkClient(trainerA, 'Today', {
        endDate: '2026-11-11T18:00:00.000Z',
        packageDuration: undefined,
    });
    const cExpiringSoon = await mkClient(trainerA, 'Soon', {
        endDate: '2026-11-14T00:00:00.000Z',
    });
    const cExpired = await mkClient(trainerA, 'Expired', {
        endDate: '2026-11-01T00:00:00.000Z',
    });
    const cOutsideWindow = await mkClient(trainerA, 'Far', {
        endDate: '2026-12-20T00:00:00.000Z',
    });
    const cNoEnd = await mkClient(trainerA, 'Ongoing', {
        packageDuration: 'ongoing',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: null,
    });
    const cSameDay2 = await mkClient(trainerA, 'TodayTwo', {
        endDate: '2026-11-11T08:00:00.000Z',
    });
    // Inactive — must not appear in overview totals
    await mkClient(trainerA, 'Inactive', {
        isActive: false,
        endDate: '2026-11-11T00:00:00.000Z',
    });
    // Other trainer — isolation
    await mkClient(trainerB, 'Other', {
        endDate: '2026-11-11T00:00:00.000Z',
    });

    const overviewA = await coachDashboardService.getOverview(
        trainerA._id.toString(),
        NOW
    );

    // Consistency with summarizeClientRoster
    const scope = buildClientListScopeQuery(trainerA._id, {});
    const roster = await User.find(scope)
        .select('_id firstName lastName startDate packageDuration endDate')
        .lean();
    const summary = summarizeClientRoster(roster, NOW);

    if (overviewA.overview.totalClients === summary.totalClients) {
        pass('Overview totalClients matches summarizeClientRoster');
    } else {
        fail(
            'Overview totalClients matches summarizeClientRoster',
            `${overviewA.overview.totalClients} vs ${summary.totalClients}`
        );
    }

    if (
        overviewA.overview.expiresToday === summary.expiresToday.count &&
        overviewA.overview.expiringSoon === summary.expiringSoon.count &&
        overviewA.overview.needsAttention === summary.needsAttention.count
    ) {
        pass('Overview expiry / needsAttention counts match list summary');
    } else {
        fail(
            'Overview expiry / needsAttention counts match list summary',
            JSON.stringify(overviewA.overview)
        );
    }

    // Active vs inactive: inactive client with today end must not inflate counts
    if (overviewA.overview.totalClients === 6) {
        pass('Active-only totalClients (inactive excluded)');
    } else {
        fail(
            'Active-only totalClients (inactive excluded)',
            `got ${overviewA.overview.totalClients}`
        );
    }

    if (overviewA.overview.expiresToday === 2) {
        pass('Expires today count (2 active)');
    } else {
        fail('Expires today count (2 active)', String(overviewA.overview.expiresToday));
    }

    if (overviewA.overview.expiringSoon === 1) {
        pass('Expiring soon count (1)');
    } else {
        fail('Expiring soon count (1)', String(overviewA.overview.expiringSoon));
    }

    // needsAttention = expired + expires today = 1 + 2 = 3
    if (overviewA.overview.needsAttention === 3) {
        pass('Needs attention = expired + expires today');
    } else {
        fail(
            'Needs attention = expired + expires today',
            String(overviewA.overview.needsAttention)
        );
    }

    if (overviewA.needsAttention.total === overviewA.overview.needsAttention) {
        pass('needsAttention.total matches overview.needsAttention');
    } else {
        fail('needsAttention.total matches overview.needsAttention', 'mismatch');
    }

    const reasons = Object.fromEntries(
        overviewA.needsAttention.byReason.map((r) => [r.reason, r.count])
    );
    if (
        reasons.subscription_expired === 1 &&
        reasons.subscription_expires_today === 2 &&
        !reasons.subscription_expiring_soon
    ) {
        pass('Needs attention byReason (no expiring_soon)');
    } else {
        fail('Needs attention byReason (no expiring_soon)', JSON.stringify(reasons));
    }

    // Far + ongoing not in needs attention / expiring
    const previewIds = new Set(
        overviewA.needsAttention.preview.map((p) => p.clientId)
    );
    if (
        !previewIds.has(String(cOutsideWindow._id)) &&
        !previewIds.has(String(cNoEnd._id)) &&
        !previewIds.has(String(cExpiringSoon._id))
    ) {
        pass('Outside window / ongoing / soon excluded from needsAttention preview');
    } else {
        fail('Outside window / ongoing / soon excluded from needsAttention preview', '');
    }

    // Suggested action present
    const expiredPreview = overviewA.needsAttention.preview.find(
        (p) => p.clientId === String(cExpired._id)
    );
    if (expiredPreview?.suggestedAction === 'renew_or_archive') {
        pass('Expired client suggestedAction renew_or_archive');
    } else {
        fail('Expired client suggestedAction renew_or_archive', JSON.stringify(expiredPreview));
    }

    // Subscriptions week: today = 2 on 2026-11-11; soon on 2026-11-14
    const dayToday = overviewA.subscriptions.week.days.find(
        (d) => d.date === '2026-11-11'
    );
    const daySoon = overviewA.subscriptions.week.days.find(
        (d) => d.date === '2026-11-14'
    );
    if (dayToday?.expiringCount === 2 && daySoon?.expiringCount === 1) {
        pass('Weekly grouping: same-day + soon day counts');
    } else {
        fail(
            'Weekly grouping: same-day + soon day counts',
            JSON.stringify({ dayToday, daySoon })
        );
    }

    if (
        overviewA.subscriptions.week.convention === 'utc_today_plus_7' &&
        overviewA.timezone === 'UTC' &&
        overviewA.subscriptions.week.days[0]?.date === '2026-11-11' &&
        overviewA.subscriptions.week.days.length === 8
    ) {
        pass('Timezone UTC and subscriptions week starts today (8 days)');
    } else {
        fail(
            'Timezone UTC and subscriptions week starts today (8 days)',
            JSON.stringify({
                timezone: overviewA.timezone,
                convention: overviewA.subscriptions.week.convention,
                first: overviewA.subscriptions.week.days[0],
                length: overviewA.subscriptions.week.days.length,
            })
        );
    }

    const rollingDays = overviewA.subscriptions.week.days.map((d) => d.date);
    const rollingAscending = rollingDays.every(
        (date, i) => i === 0 || date > rollingDays[i - 1]
    );
    if (rollingAscending && rollingDays[0] === '2026-11-11' && rollingDays[7] === '2026-11-18') {
        pass('Subscriptions week days ascend from today through today+7');
    } else {
        fail('Subscriptions week days ascend from today through today+7', rollingDays.join(','));
    }

    // Day +7 (eighth column) is included in aggregation when a subscription ends that day.
    const endsOnDaySeven = buildSubscriptionsSection(
        [
            {
                _id: 'day7',
                firstName: 'Day',
                lastName: 'Seven',
                endDate: '2026-11-18T12:00:00.000Z',
                packageDuration: '1_month',
                startDate: '2026-10-18T00:00:00.000Z',
            },
            {
                _id: 'before',
                firstName: 'Day',
                lastName: 'Before',
                endDate: '2026-11-10T12:00:00.000Z',
                packageDuration: '1_month',
                startDate: '2026-10-10T00:00:00.000Z',
            },
        ],
        NOW
    );
    const daySeven = endsOnDaySeven.week.days.find((d) => d.date === '2026-11-18');
    const dayBefore = endsOnDaySeven.week.days.find((d) => d.date === '2026-11-10');
    if (daySeven?.expiringCount === 1 && !dayBefore && endsOnDaySeven.week.days.length === 8) {
        pass('Eighth column includes today+7 expiries; prior day excluded');
    } else {
        fail(
            'Eighth column includes today+7 expiries; prior day excluded',
            JSON.stringify({ daySeven, days: endsOnDaySeven.week.days })
        );
    }

    // Empty week helper: roster with no ends in week
    const emptyWeek = buildSubscriptionsSection(
        [{ _id: 'x', endDate: '2027-01-01T00:00:00.000Z' }],
        NOW
    );
    if (emptyWeek.week.days.every((d) => d.expiringCount === 0)) {
        pass('Empty week histogram when no expirations');
    } else {
        fail('Empty week histogram when no expirations', '');
    }

    // Subscription preview includes today + soon, not expired
    const subPreviewIds = overviewA.subscriptions.preview.map((p) => p.clientId);
    if (
        subPreviewIds.includes(String(cExpiresToday._id)) &&
        subPreviewIds.includes(String(cExpiringSoon._id)) &&
        !subPreviewIds.includes(String(cExpired._id))
    ) {
        pass('Subscription preview: today + soon, not expired');
    } else {
        fail('Subscription preview: today + soon, not expired', JSON.stringify(subPreviewIds));
    }

    // --- Invitations ---
    const usedInv = await ClientInvitation.create({
        clientId: cExpiresToday._id,
        trainerId: trainerA._id,
        tokenHash: hashToken(`used-${suffix}`),
        status: CLIENT_INVITATION_STATUS.USED,
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
        usedAt: new Date('2026-11-01T00:00:00.000Z'),
    });
    const pendingInv = await ClientInvitation.create({
        clientId: cExpiringSoon._id,
        trainerId: trainerA._id,
        tokenHash: hashToken(`pending-${suffix}`),
        status: CLIENT_INVITATION_STATUS.PENDING,
        expiresAt: new Date('2026-11-20T00:00:00.000Z'),
    });
    await ClientInvitation.create({
        clientId: cExpired._id,
        trainerId: trainerA._id,
        tokenHash: hashToken(`expired-${suffix}`),
        status: CLIENT_INVITATION_STATUS.PENDING,
        expiresAt: new Date('2026-11-01T00:00:00.000Z'),
    });
    await ClientInvitation.create({
        clientId: cOutsideWindow._id,
        trainerId: trainerA._id,
        tokenHash: hashToken(`revoked-${suffix}`),
        status: CLIENT_INVITATION_STATUS.REVOKED,
        expiresAt: new Date('2026-11-20T00:00:00.000Z'),
        revokedAt: new Date('2026-11-05T00:00:00.000Z'),
    });
    const otherClient = await User.findOne({
        email: `dash-other-${suffix}@test.com`,
    });
    await ClientInvitation.create({
        clientId: otherClient._id,
        trainerId: trainerB._id,
        tokenHash: hashToken(`b-pending-${suffix}`),
        status: CLIENT_INVITATION_STATUS.PENDING,
        expiresAt: new Date('2026-11-20T00:00:00.000Z'),
    });

    const overviewInv = await coachDashboardService.getOverview(
        trainerA._id.toString(),
        NOW
    );

    if (
        overviewInv.invitations.accepted === 1 &&
        overviewInv.invitations.pending === 1 &&
        overviewInv.invitations.expired === 1
    ) {
        pass('Invitation counts: used / pending / expired');
    } else {
        fail(
            'Invitation counts: used / pending / expired',
            JSON.stringify(overviewInv.invitations)
        );
    }

    if (
        overviewInv.invitations.pendingPreview.length === 1 &&
        overviewInv.invitations.pendingPreview[0].invitationId ===
            String(pendingInv._id) &&
        overviewInv.invitations.pendingPreview[0].clientId ===
            String(cExpiringSoon._id) &&
        overviewInv.invitations.pendingPreview[0].clientName.includes('Soon')
    ) {
        pass('Pending invitation preview fields');
    } else {
        fail(
            'Pending invitation preview fields',
            JSON.stringify(overviewInv.invitations.pendingPreview)
        );
    }

    const invJson = JSON.stringify(overviewInv.invitations);
    if (
        !invJson.includes('tokenHash') &&
        !invJson.includes(hashToken(`pending-${suffix}`)) &&
        !invJson.includes('invitationUrl')
    ) {
        pass('No tokenHash / raw token / invitationUrl in invitations payload');
    } else {
        fail('No tokenHash / raw token / invitationUrl in invitations payload', invJson);
    }

    // Empty registrationActivity before seeding prospect data
    if (
        overviewInv.registrationActivity &&
        overviewInv.registrationActivity.activeLinks === 0 &&
        overviewInv.registrationActivity.expiredLinks === 0 &&
        overviewInv.registrationActivity.pendingRequests === 0 &&
        overviewInv.registrationActivity.approvedRequests === 0 &&
        overviewInv.registrationActivity.rejectedRequests === 0 &&
        Array.isArray(overviewInv.registrationActivity.pendingPreview) &&
        overviewInv.registrationActivity.pendingPreview.length === 0
    ) {
        pass('registrationActivity empty zeros before prospect seed');
    } else {
        fail(
            'registrationActivity empty zeros before prospect seed',
            JSON.stringify(overviewInv.registrationActivity)
        );
    }

    // Password invitation metrics unchanged after registrationActivity exists
    const passwordInvSnapshot = { ...overviewInv.invitations };
    delete passwordInvSnapshot.pendingPreview;

    // --- Registration activity (prospect links + requests) ---
    let phoneSeq = 0;
    const nextPhone = () =>
        `9${String(suffix).slice(-8)}${String(phoneSeq++).padStart(1, '0')}`.slice(
            0,
            10
        );
    const mkProspect = async (trainerId, overrides = {}) =>
        ClientProspectInvitation.create({
            trainerId,
            clientName: 'Prospect Dash',
            phone: nextPhone(),
            tokenHash: hashToken(`prospect-${suffix}-${Math.random()}`),
            status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
            expiresAt: new Date('2026-11-20T00:00:00.000Z'),
            ...overrides,
        });

    const activeLinkA = await mkProspect(trainerA._id, {
        expiresAt: new Date('2026-11-20T00:00:00.000Z'),
    });
    // Boundary: expiresAt === NOW counts as expired (lte)
    await mkProspect(trainerA._id, {
        expiresAt: NOW,
    });
    await mkProspect(trainerA._id, {
        expiresAt: new Date('2026-11-01T00:00:00.000Z'),
    });
    await mkProspect(trainerA._id, {
        status: CLIENT_PROSPECT_INVITATION_STATUS.REVOKED,
        expiresAt: new Date('2026-11-20T00:00:00.000Z'),
        revokedAt: new Date('2026-11-05T00:00:00.000Z'),
    });
    await mkProspect(trainerA._id, {
        status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
        expiresAt: new Date('2026-11-20T00:00:00.000Z'),
        usedAt: new Date('2026-11-05T00:00:00.000Z'),
    });
    // Trainer B noise
    await mkProspect(trainerB._id, {
        expiresAt: new Date('2026-11-20T00:00:00.000Z'),
    });
    await mkProspect(trainerB._id, {
        expiresAt: new Date('2026-11-01T00:00:00.000Z'),
    });

    const mkRequest = async (trainerId, invitationId, approvalStatus) =>
        ClientRegistrationRequest.create({
            invitationId,
            trainerId,
            firstName: 'Reg',
            lastName: 'Req',
            phone: nextPhone(),
            email: `reg-req-${invitationId}@test.com`,
            gender: 'male',
            dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
            height: 180,
            currentWeight: 80,
            primaryFitnessGoal: 'general_fitness',
            approvalStatus,
            ...(approvalStatus === CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED
                ? {
                      reviewedAt: NOW,
                      reviewedBy: trainerId,
                      createdUserId: cExpiresToday._id,
                  }
                : {}),
            ...(approvalStatus === CLIENT_REGISTRATION_REQUEST_STATUS.REJECTED
                ? {
                      reviewedAt: NOW,
                      reviewedBy: trainerId,
                      rejectionReason: 'Not a fit',
                  }
                : {}),
        });

    const pendingInvForReq = await mkProspect(trainerA._id, {
        status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
        usedAt: NOW,
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    });
    const approvedInvForReq = await mkProspect(trainerA._id, {
        status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
        usedAt: NOW,
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    });
    const rejectedInvForReq = await mkProspect(trainerA._id, {
        status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
        usedAt: NOW,
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    });
    const bInvForReq = await mkProspect(trainerB._id, {
        status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
        usedAt: NOW,
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    });

    await mkRequest(
        trainerA._id,
        pendingInvForReq._id,
        CLIENT_REGISTRATION_REQUEST_STATUS.PENDING
    );
    await mkRequest(
        trainerA._id,
        approvedInvForReq._id,
        CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED
    );
    await mkRequest(
        trainerA._id,
        rejectedInvForReq._id,
        CLIENT_REGISTRATION_REQUEST_STATUS.REJECTED
    );
    await mkRequest(
        trainerB._id,
        bInvForReq._id,
        CLIENT_REGISTRATION_REQUEST_STATUS.PENDING
    );

    const overviewReg = await coachDashboardService.getOverview(
        trainerA._id.toString(),
        NOW
    );

    if (
        overviewReg.registrationActivity.activeLinks === 1 &&
        overviewReg.registrationActivity.expiredLinks === 2 &&
        overviewReg.registrationActivity.pendingRequests === 1 &&
        overviewReg.registrationActivity.approvedRequests === 1 &&
        overviewReg.registrationActivity.rejectedRequests === 1
    ) {
        pass('registrationActivity counts for trainer A');
    } else {
        fail(
            'registrationActivity counts for trainer A',
            JSON.stringify(overviewReg.registrationActivity)
        );
    }

    if (
        overviewReg.invitations.accepted === passwordInvSnapshot.accepted &&
        overviewReg.invitations.pending === passwordInvSnapshot.pending &&
        overviewReg.invitations.expired === passwordInvSnapshot.expired
    ) {
        pass('Password invitation metrics unchanged with registrationActivity');
    } else {
        fail(
            'Password invitation metrics unchanged with registrationActivity',
            JSON.stringify({
                before: passwordInvSnapshot,
                after: overviewReg.invitations,
            })
        );
    }

    const preview = overviewReg.registrationActivity.pendingPreview;
    if (
        Array.isArray(preview) &&
        preview.length === 1 &&
        preview[0].invitationId === String(activeLinkA._id) &&
        preview[0].clientName === activeLinkA.clientName &&
        typeof preview[0].expiresAt === 'string' &&
        !preview[0].tokenHash &&
        !preview[0].invitationUrl &&
        !preview[0].phone
    ) {
        pass('registrationActivity pendingPreview for active prospect link');
    } else {
        fail(
            'registrationActivity pendingPreview for active prospect link',
            JSON.stringify(preview)
        );
    }

    const regJson = JSON.stringify(overviewReg.registrationActivity);
    if (
        !regJson.includes('tokenHash') &&
        !regJson.includes('invitationUrl') &&
        !regJson.includes('"phone"')
    ) {
        pass('registrationActivity omits tokens, URLs, and phone');
    } else {
        fail(
            'registrationActivity omits tokens, URLs, and phone',
            regJson
        );
    }

    const overviewB = await coachDashboardService.getOverview(
        trainerB._id.toString(),
        NOW
    );
    if (
        overviewB.overview.totalClients === 1 &&
        overviewB.invitations.pending === 1 &&
        overviewB.invitations.accepted === 0 &&
        overviewB.registrationActivity.activeLinks === 1 &&
        overviewB.registrationActivity.expiredLinks === 1 &&
        overviewB.registrationActivity.pendingRequests === 1 &&
        overviewB.registrationActivity.approvedRequests === 0 &&
        overviewB.registrationActivity.rejectedRequests === 0
    ) {
        pass('Trainer isolation for overview + invitations + registrationActivity');
    } else {
        fail(
            'Trainer isolation for overview + invitations + registrationActivity',
            JSON.stringify({
                overview: overviewB.overview,
                invitations: overviewB.invitations,
                registrationActivity: overviewB.registrationActivity,
            })
        );
    }

    // Backward-compatible shape: prior keys still present
    if (
        overviewReg.overview &&
        overviewReg.needsAttention &&
        overviewReg.subscriptions &&
        overviewReg.invitations &&
        overviewReg.registrationActivity &&
        typeof overviewReg.generatedAt === 'string'
    ) {
        pass('Overview response remains backward-compatible with new section');
    } else {
        fail(
            'Overview response remains backward-compatible with new section',
            Object.keys(overviewReg).join(',')
        );
    }

    // Deferred sections absent
    if (
        overviewA.clientsGrowth === undefined &&
        overviewA.achievements === undefined &&
        overviewA.thisWeek === undefined
    ) {
        pass('Deferred sections not present in Phase 1 payload');
    } else {
        fail('Deferred sections not present in Phase 1 payload', 'unexpected keys');
    }

    // buildNeedsAttentionSection unit empty
    const emptyAttn = buildNeedsAttentionSection([], NOW);
    if (emptyAttn.total === 0 && emptyAttn.preview.length === 0) {
        pass('Empty needsAttention section');
    } else {
        fail('Empty needsAttention section', '');
    }

    // --- Optional HTTP ---
    const health = await request('GET', '/health');
    if (!health.ok || health.status !== 200) {
        pass('HTTP checks skipped (API not reachable)');
    } else {
        const unauth = await request('GET', '/coach-dashboard/overview');
        if (unauth.status === 401) pass('HTTP: unauthenticated rejected');
        else fail('HTTP: unauthenticated rejected', String(unauth.status));

        const loginClient = await request('POST', '/auth/login', {
            body: {
                email: `dash-today-${suffix}@test.com`,
                password,
            },
        });
        const clientToken = loginClient.json?.data?.token;
        if (clientToken) {
            const asClient = await request('GET', '/coach-dashboard/overview', {
                token: clientToken,
            });
            if (asClient.status === 403) pass('HTTP: client role forbidden');
            else fail('HTTP: client role forbidden', String(asClient.status));
        } else {
            fail('HTTP: client role forbidden', 'login failed');
        }

        const loginA = await request('POST', '/auth/login', {
            body: { email: trainerA.email, password },
        });
        const tokenA = loginA.json?.data?.token;
        if (tokenA) {
            const httpOverview = await request('GET', '/coach-dashboard/overview', {
                token: tokenA,
            });
            if (
                httpOverview.status === 200 &&
                typeof httpOverview.json?.data?.overview?.totalClients === 'number' &&
                typeof httpOverview.json?.data?.registrationActivity?.activeLinks ===
                    'number' &&
                typeof httpOverview.json?.data?.invitations?.pending === 'number' &&
                !JSON.stringify(httpOverview.json).includes('tokenHash')
            ) {
                pass('HTTP: trainer overview succeeds without secrets');
            } else {
                fail(
                    'HTTP: trainer overview succeeds without secrets',
                    JSON.stringify(httpOverview.json)
                );
            }
        } else {
            fail('HTTP: trainer overview succeeds without secrets', 'login failed');
        }
    }

    // Cleanup
    await ClientRegistrationRequest.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await ClientProspectInvitation.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await ClientInvitation.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await User.deleteMany({
        email: {
            $in: [
                trainerA.email,
                trainerB.email,
                `dash-today-${suffix}@test.com`,
                `dash-soon-${suffix}@test.com`,
                `dash-expired-${suffix}@test.com`,
                `dash-far-${suffix}@test.com`,
                `dash-ongoing-${suffix}@test.com`,
                `dash-todaytwo-${suffix}@test.com`,
                `dash-inactive-${suffix}@test.com`,
                `dash-other-${suffix}@test.com`,
            ],
        },
    });
    void usedInv;

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
