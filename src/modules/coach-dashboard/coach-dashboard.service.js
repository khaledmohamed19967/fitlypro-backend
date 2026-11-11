import mongoose from 'mongoose';
import User from '../users/user.model.js';
import ClientInvitation from '../client-invitations/client-invitation.model.js';
import { CLIENT_INVITATION_STATUS } from '../client-invitations/client-invitation.constants.js';
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
    const invitations = await buildInvitationsSection(
        trainerId,
        now,
        DASHBOARD_PREVIEW_LIMIT
    );

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
    };
};

export default {
    getOverview,
};
