import mongoose from 'mongoose';
import User from '../users/user.model.js';
import ClientInvitation from '../client-invitations/client-invitation.model.js';
import { CLIENT_INVITATION_STATUS } from '../client-invitations/client-invitation.constants.js';
import ClientProspectInvitation from '../client-prospect-invitations/client-prospect-invitation.model.js';
import { CLIENT_PROSPECT_INVITATION_STATUS } from '../client-prospect-invitations/client-prospect-invitation.constants.js';
import ClientRegistrationRequest from '../client-registration-requests/client-registration-request.model.js';
import { CLIENT_REGISTRATION_REQUEST_STATUS } from '../client-registration-requests/client-registration-request.constants.js';
import { buildClientListScopeQuery } from '../clients/client.list-scope.js';
import { summarizeClientRoster } from '../clients/client.list-summary.js';
import {
    DASHBOARD_PREVIEW_LIMIT,
    DASHBOARD_TIMEZONE,
} from './coach-dashboard.constants.js';
import {
    buildNeedsAttentionSection,
    buildSubscriptionsSection,
} from './coach-dashboard.helpers.js';
import {
    buildClientsGrowthBuckets,
    clientsGrowthBucketKey,
    computeClientsGrowthPercentage,
    fillClientsGrowthSeries,
    resolveClientsGrowthGroupBy,
    resolveClientsGrowthWindow,
    resolvePreviousClientsGrowthWindow,
} from './coach-dashboard.clients-growth.js';

/** Same lean projection as client list summary. */
const ROSTER_SELECT = '_id firstName lastName startDate packageDuration endDate';

/**
 * Aggregate invitation counts for a trainer. Revoked invitations are excluded
 * from accepted / pending / expired buckets.
 *
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @param {Date} [now]
 * @param {number} [previewLimit]
 */
const buildInvitationsSection = async (
    trainerId,
    now = new Date(),
    previewLimit = DASHBOARD_PREVIEW_LIMIT
) => {
    const trainerObjectId = new mongoose.Types.ObjectId(String(trainerId));

    const [counts] = await ClientInvitation.aggregate([
        { $match: { trainerId: trainerObjectId } },
        {
            $group: {
                _id: null,
                accepted: {
                    $sum: {
                        $cond: [
                            { $eq: ['$status', CLIENT_INVITATION_STATUS.USED] },
                            1,
                            0,
                        ],
                    },
                },
                pending: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    {
                                        $eq: [
                                            '$status',
                                            CLIENT_INVITATION_STATUS.PENDING,
                                        ],
                                    },
                                    { $gt: ['$expiresAt', now] },
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
                expired: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    {
                                        $eq: [
                                            '$status',
                                            CLIENT_INVITATION_STATUS.PENDING,
                                        ],
                                    },
                                    { $lte: ['$expiresAt', now] },
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
            },
        },
    ]);

    const pendingDocs = await ClientInvitation.find({
        trainerId: trainerObjectId,
        status: CLIENT_INVITATION_STATUS.PENDING,
        expiresAt: { $gt: now },
    })
        .select('_id clientId expiresAt')
        .sort({ expiresAt: 1, _id: 1 })
        .limit(previewLimit)
        .lean();

    const clientIds = [
        ...new Set(pendingDocs.map((doc) => String(doc.clientId))),
    ];
    const clients =
        clientIds.length === 0
            ? []
            : await User.find({
                  _id: { $in: clientIds },
                  role: 'client',
                  trainer: trainerObjectId,
              })
                  .select('_id firstName lastName')
                  .lean();

    const clientById = new Map(
        clients.map((c) => [
            String(c._id),
            [c.firstName, c.lastName].filter(Boolean).join(' ').trim(),
        ])
    );

    const pendingPreview = pendingDocs.map((doc) => ({
        invitationId: String(doc._id),
        clientId: String(doc.clientId),
        clientName: clientById.get(String(doc.clientId)) || '',
        expiresAt:
            doc.expiresAt instanceof Date
                ? doc.expiresAt.toISOString()
                : new Date(doc.expiresAt).toISOString(),
    }));

    return {
        accepted: counts?.accepted ?? 0,
        pending: counts?.pending ?? 0,
        expired: counts?.expired ?? 0,
        pendingPreview,
    };
};

/**
 * Prospect registration workflow aggregates for a trainer.
 * Separate from password ClientInvitation metrics.
 *
 * Links: ClientProspectInvitation with status pending only.
 * Requests: ClientRegistrationRequest by approvalStatus.
 *
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @param {Date} [now]
 */
const buildRegistrationActivitySection = async (
    trainerId,
    now = new Date(),
    previewLimit = DASHBOARD_PREVIEW_LIMIT
) => {
    const trainerObjectId = new mongoose.Types.ObjectId(String(trainerId));

    const [[linkCounts] = [], [requestCounts] = [], pendingDocs] = await Promise.all([
        ClientProspectInvitation.aggregate([
            { $match: { trainerId: trainerObjectId } },
            {
                $group: {
                    _id: null,
                    activeLinks: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        {
                                            $eq: [
                                                '$status',
                                                CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
                                            ],
                                        },
                                        { $gt: ['$expiresAt', now] },
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                    expiredLinks: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        {
                                            $eq: [
                                                '$status',
                                                CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
                                            ],
                                        },
                                        { $lte: ['$expiresAt', now] },
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                },
            },
        ]),
        ClientRegistrationRequest.aggregate([
            { $match: { trainerId: trainerObjectId } },
            {
                $group: {
                    _id: null,
                    pendingRequests: {
                        $sum: {
                            $cond: [
                                {
                                    $eq: [
                                        '$approvalStatus',
                                        CLIENT_REGISTRATION_REQUEST_STATUS.PENDING,
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                    approvedRequests: {
                        $sum: {
                            $cond: [
                                {
                                    $eq: [
                                        '$approvalStatus',
                                        CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED,
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                    rejectedRequests: {
                        $sum: {
                            $cond: [
                                {
                                    $eq: [
                                        '$approvalStatus',
                                        CLIENT_REGISTRATION_REQUEST_STATUS.REJECTED,
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                },
            },
        ]),
        ClientProspectInvitation.find({
            trainerId: trainerObjectId,
            status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
            expiresAt: { $gt: now },
        })
            .select('_id clientName expiresAt')
            .sort({ expiresAt: 1, _id: 1 })
            .limit(previewLimit)
            .lean(),
    ]);

    const pendingPreview = pendingDocs.map((doc) => ({
        invitationId: String(doc._id),
        clientName: typeof doc.clientName === 'string' ? doc.clientName : '',
        expiresAt:
            doc.expiresAt instanceof Date
                ? doc.expiresAt.toISOString()
                : new Date(doc.expiresAt).toISOString(),
    }));

    return {
        activeLinks: linkCounts?.activeLinks ?? 0,
        expiredLinks: linkCounts?.expiredLinks ?? 0,
        pendingRequests: requestCounts?.pendingRequests ?? 0,
        approvedRequests: requestCounts?.approvedRequests ?? 0,
        rejectedRequests: requestCounts?.rejectedRequests ?? 0,
        pendingPreview,
    };
};

/**
 * Coach Dashboard Overview — Phase 1.
 * Active roster only (default Client List scope). UTC calendar boundaries.
 *
 * @param {string} trainerId
 * @param {Date} [now]
 */
const getOverview = async (trainerId, now = new Date()) => {
    const scopeQuery = buildClientListScopeQuery(trainerId, {});
    const roster = await User.find(scopeQuery).select(ROSTER_SELECT).lean();

    const summary = summarizeClientRoster(roster, now);
    const needsAttention = buildNeedsAttentionSection(
        roster,
        now,
        DASHBOARD_PREVIEW_LIMIT
    );
    const subscriptions = buildSubscriptionsSection(
        roster,
        now,
        DASHBOARD_PREVIEW_LIMIT
    );
    const [invitations, registrationActivity] = await Promise.all([
        buildInvitationsSection(trainerId, now, DASHBOARD_PREVIEW_LIMIT),
        buildRegistrationActivitySection(trainerId, now, DASHBOARD_PREVIEW_LIMIT),
    ]);

    return {
        generatedAt: now.toISOString(),
        timezone: DASHBOARD_TIMEZONE,
        overview: {
            totalClients: summary.totalClients,
            expiresToday: summary.expiresToday.count,
            expiringSoon: summary.expiringSoon.count,
            needsAttention: summary.needsAttention.count,
        },
        needsAttention,
        subscriptions,
        invitations,
        registrationActivity,
    };
};

/**
 * Count coach-owned clients whose joinedCoachAt falls in [from, to).
 *
 * @param {import('mongoose').Types.ObjectId} trainerObjectId
 * @param {Date} from
 * @param {Date} to
 */
const countNewClientsInWindow = (trainerObjectId, from, to) =>
    User.countDocuments({
        role: 'client',
        trainer: trainerObjectId,
        joinedCoachAt: { $gte: from, $lt: to },
    });

/**
 * Load joinedCoachAt values for bucketing (coach-scoped, date-filtered).
 *
 * @param {import('mongoose').Types.ObjectId} trainerObjectId
 * @param {Date} from
 * @param {Date} to
 */
const loadJoinedCoachAtsInWindow = async (trainerObjectId, from, to) => {
    const docs = await User.find({
        role: 'client',
        trainer: trainerObjectId,
        joinedCoachAt: { $gte: from, $lt: to },
    })
        .select('joinedCoachAt')
        .lean();

    return docs
        .map((doc) => doc.joinedCoachAt)
        .filter((value) => value instanceof Date && !Number.isNaN(value.getTime()));
};

/**
 * Clients Growth chart for the authenticated trainer.
 * Source of truth: User.joinedCoachAt (not invitations or package dates).
 *
 * @param {string} trainerId
 * @param {{ range: '30d'|'3m'|'6m'|'12m', groupBy?: 'day'|'week'|'month' }} query
 * @param {Date} [now]
 */
const getClientsGrowth = async (trainerId, query, now = new Date()) => {
    const trainerObjectId = new mongoose.Types.ObjectId(String(trainerId));
    const range = query.range;
    const groupBy = resolveClientsGrowthGroupBy(range, query.groupBy);
    const window = resolveClientsGrowthWindow(range, now);
    const previousWindow = resolvePreviousClientsGrowthWindow(window);

    const [joinedAts, totalNewClients, previousPeriodTotal] = await Promise.all([
        loadJoinedCoachAtsInWindow(trainerObjectId, window.from, window.to),
        countNewClientsInWindow(trainerObjectId, window.from, window.to),
        countNewClientsInWindow(
            trainerObjectId,
            previousWindow.from,
            previousWindow.to
        ),
    ]);

    const countByKey = new Map();
    for (const joinedAt of joinedAts) {
        const key = clientsGrowthBucketKey(joinedAt, groupBy);
        countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    }

    const buckets = buildClientsGrowthBuckets(window.from, window.to, groupBy);
    const series = fillClientsGrowthSeries(buckets, countByKey);

    return {
        range,
        groupBy,
        timezone: DASHBOARD_TIMEZONE,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        totalNewClients,
        previousPeriodTotal,
        growthPercentage: computeClientsGrowthPercentage(
            totalNewClients,
            previousPeriodTotal
        ),
        series,
    };
};

export default {
    getOverview,
    getClientsGrowth,
};
