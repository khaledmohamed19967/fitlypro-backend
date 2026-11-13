import mongoose from 'mongoose';
import ClientRegistrationRequest from './client-registration-request.model.js';
import {
    CLIENT_REGISTRATION_REQUEST_STATUS,
    PASSWORD_INVITATION_CLAIM_TTL_MS,
    PASSWORD_INVITATION_INBOX_STATUS,
    PASSWORD_INVITATION_WAIT_ATTEMPTS,
    PASSWORD_INVITATION_WAIT_MS,
} from './client-registration-request.constants.js';
import User from '../users/user.model.js';
import NutritionProfile from '../nutrition-profiles/nutrition-profile.model.js';
import nutritionProfileService from '../nutrition-profiles/nutrition-profile.service.js';
import ClientInvitation from '../client-invitations/client-invitation.model.js';
import { CLIENT_INVITATION_STATUS } from '../client-invitations/client-invitation.constants.js';
import clientInvitationService from '../client-invitations/client-invitation.service.js';
import { applyCoachingPackageEndDate } from '../clients/client.package-dates.js';
import {
    loadHealthOptionsMap,
    mapOrderedHealthOptions,
} from '../health-reference/health-reference.helpers.js';
import { paginateCollection } from '../../utils/pagination.js';
import { ApiError } from '../../utils/ApiError.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toIdString = (value) => (value == null ? null : String(value));

const toIsoDate = (value) => {
    if (value == null || value === '') {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const optionIdList = (values) =>
    (Array.isArray(values) ? values : []).map((id) => String(id)).filter(Boolean);

const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

const isDuplicateKey = (err) => {
    if (!err) return false;
    if (err.code === 11000 || err.codeName === 'DuplicateKey') return true;
    const cause = err.cause;
    return Boolean(cause && (cause.code === 11000 || cause.codeName === 'DuplicateKey'));
};

const unsetCreatedUser = {
    $or: [{ createdUserId: null }, { createdUserId: { $exists: false } }],
};

const emailConflict = () =>
    new ApiError(409, 'User with this email already exists', [
        {
            field: 'email',
            message: 'User with this email already exists',
            code: 'EMAIL_ALREADY_EXISTS',
        },
    ]);

const alreadyRejected = () =>
    new ApiError(409, 'Registration request has already been rejected', [
        {
            field: 'approvalStatus',
            message: 'Registration request has already been rejected',
            code: 'REGISTRATION_REQUEST_REJECTED',
        },
    ]);

const alreadyApproved = () =>
    new ApiError(409, 'Registration request has already been approved', [
        {
            field: 'approvalStatus',
            message: 'Registration request has already been approved',
            code: 'REGISTRATION_REQUEST_APPROVED',
        },
    ]);

const invitationRetryError = (clientId) =>
    new ApiError(
        500,
        'Client was approved, but the password invitation could not be created. Retry approval to finish setup.',
        [
            {
                field: 'invitation',
                message: 'Retry approval to create the password invitation.',
                code: 'INVITATION_RETRYABLE',
                clientId: clientId ? String(clientId) : undefined,
            },
        ]
    );

/**
 * Load a request and prove the caller is the owning trainer.
 * Admin-on-behalf and body-supplied trainer ids are not accepted.
 *
 * @param {string} requestId
 * @param {string} trainerId
 */
const loadOwnedRequest = async (requestId, trainerId) => {
    if (!isValidObjectId(requestId)) {
        throw new ApiError(400, 'Invalid registration request ID');
    }
    if (!isValidObjectId(trainerId)) {
        throw new ApiError(400, 'Invalid trainer ID');
    }

    const request = await ClientRegistrationRequest.findById(requestId);
    if (!request) {
        throw new ApiError(404, 'Registration request not found');
    }

    if (String(request.trainerId) !== String(trainerId)) {
        throw new ApiError(403, 'You do not have access to this registration request');
    }

    return request;
};

const assertEmailAvailableForNewClient = async (request) => {
    const existing = await User.findOne({ email: request.email });
    if (!existing) {
        return;
    }

    const linkedHere =
        existing.registrationRequestId &&
        String(existing.registrationRequestId) === String(request._id);

    if (!linkedHere) {
        throw emailConflict();
    }
};

/**
 * Return the claim to pending only when this request still has no client.
 *
 * @param {import('mongoose').Types.ObjectId} requestId
 */
const revertApprovalClaim = async (requestId) => {
    const linked = await User.findOne({ registrationRequestId: requestId }).select('_id');
    if (linked) {
        return;
    }

    await ClientRegistrationRequest.updateOne(
        {
            _id: requestId,
            approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED,
            ...unsetCreatedUser,
        },
        {
            $set: {
                approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.PENDING,
                reviewedAt: null,
                reviewedBy: null,
            },
        }
    );
};

/**
 * Same cleanup as direct Add Client when the user was created but nutrition setup failed.
 *
 * @param {import('mongoose').Types.ObjectId} requestId
 * @param {import('mongoose').Types.ObjectId|string} userId
 */
const rollbackNewClient = async (requestId, userId) => {
    if (userId) {
        await NutritionProfile.deleteMany({ clientId: userId });
        await User.findByIdAndDelete(userId);
    }
    await revertApprovalClaim(requestId);
};

const idList = (values) => (Array.isArray(values) ? values.map((id) => String(id)) : []);

/**
 * Copy submitted profile fields. Password is intentionally omitted.
 *
 * @param {import('mongoose').Document} request
 */
const buildApprovedClientData = (request) => {
    const data = {
        firstName: request.firstName,
        lastName: request.lastName,
        email: request.email,
        role: 'client',
        trainer: request.trainerId,
        joinedCoachAt: new Date(),
        isActive: true,
        registrationRequestId: request._id,
        primaryFitnessGoal: request.primaryFitnessGoal,
    };

    const optionalKeys = [
        'phone',
        'dateOfBirth',
        'gender',
        'currentWeight',
        'targetWeight',
        'height',
        'experienceLevel',
        'programType',
        'sessionsPerWeek',
        'startDate',
        'packageDuration',
        'additionalNotes',
        'medicalConditions',
        'injuries',
    ];

    for (const key of optionalKeys) {
        if (request[key] != null && request[key] !== '') {
            data[key] = request[key];
        }
    }

    if (request.injuryAreaOptionIds?.length) {
        data.injuryAreaOptionIds = request.injuryAreaOptionIds;
    }

    data.injuryDetails =
        request.injuryDetails == null || request.injuryDetails === ''
            ? null
            : request.injuryDetails;

    applyCoachingPackageEndDate(data);
    return data;
};

const findLinkedUser = (requestId) =>
    User.findOne({ registrationRequestId: requestId });

const createOrRecoverClient = async (request) => {
    const existing = await findLinkedUser(request._id);
    if (existing) {
        return { user: existing, createdInThisCall: false };
    }

    try {
        const user = await User.create(buildApprovedClientData(request));
        return { user, createdInThisCall: true };
    } catch (err) {
        if (!isDuplicateKey(err)) {
            await revertApprovalClaim(request._id);
            throw err;
        }

        const recovered = await findLinkedUser(request._id);
        if (recovered) {
            return { user: recovered, createdInThisCall: false };
        }

        await revertApprovalClaim(request._id);
        throw emailConflict();
    }
};

/**
 * Create a nutrition profile only when the request actually contains restrictions.
 * Direct Add Client skips the profile when those fields are absent.
 *
 * @param {import('mongoose').Document} request
 * @param {import('mongoose').Document} user
 * @param {boolean} createdInThisCall
 */
const ensureNutritionProfile = async (request, user, createdInThisCall) => {
    const allergyOptionIds = idList(request.allergyOptionIds);
    const dietaryRestrictionOptionIds = idList(request.dietaryRestrictionOptionIds);

    if (allergyOptionIds.length === 0 && dietaryRestrictionOptionIds.length === 0) {
        return;
    }

    const existing = await NutritionProfile.findOne({ clientId: user._id }).select('_id');
    if (existing) {
        return;
    }

    const body = {};
    if (allergyOptionIds.length > 0) {
        body.allergyOptionIds = allergyOptionIds;
    }
    if (dietaryRestrictionOptionIds.length > 0) {
        body.dietaryRestrictionOptionIds = dietaryRestrictionOptionIds;
    }

    try {
        await nutritionProfileService.createNutritionProfileForNewClient(
            user._id.toString(),
            String(request.trainerId),
            body
        );
    } catch (err) {
        if (isDuplicateKey(err)) {
            return;
        }
        if (createdInThisCall) {
            await rollbackNewClient(request._id, user._id);
        }
        throw err;
    }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const invitationIsUsable = (invitation) =>
    Boolean(
        invitation &&
            invitation.status === CLIENT_INVITATION_STATUS.PENDING &&
            invitation.usedAt == null &&
            invitation.expiresAt instanceof Date &&
            invitation.expiresAt.getTime() > Date.now()
    );

const findUsablePendingInvitation = async (clientId, trainerId) => {
    return ClientInvitation.findOne({
        clientId,
        trainerId,
        status: CLIENT_INVITATION_STATUS.PENDING,
        usedAt: null,
        expiresAt: { $gt: new Date() },
    }).sort({ expiresAt: -1 });
};

const reusedInvitation = (invitation) => ({
    state: 'reused',
    invitationId: String(invitation._id),
    expiresAt: invitation.expiresAt,
});

const createdInvitation = (created) => ({
    state: 'created',
    invitationId: String(created.invitationId),
    invitationUrl: created.invitationUrl,
    expiresAt: created.expiresAt,
});

const passwordInvitationUnsetClause = {
    $or: [{ passwordInvitationId: null }, { passwordInvitationId: { $exists: false } }],
};

const claimAvailableClause = (now) => {
    const staleBefore = new Date(now.getTime() - PASSWORD_INVITATION_CLAIM_TTL_MS);
    return {
        $or: [
            { passwordInvitationClaimedAt: null },
            { passwordInvitationClaimedAt: { $exists: false } },
            { passwordInvitationClaimedAt: { $lte: staleBefore } },
        ],
    };
};

/**
 * Clear a stale or failed invitation-create claim without touching a finished link.
 *
 * @param {import('mongoose').Types.ObjectId} requestId
 * @param {Date} claimedAt
 */
const releaseInvitationClaim = async (requestId, claimedAt) => {
    await ClientRegistrationRequest.updateOne(
        {
            _id: requestId,
            passwordInvitationClaimedAt: claimedAt,
            $and: [passwordInvitationUnsetClause],
        },
        { $set: { passwordInvitationClaimedAt: null } }
    );
};

/**
 * Persist the invitation produced by the claim holder.
 *
 * @param {import('mongoose').Types.ObjectId} requestId
 * @param {import('mongoose').Types.ObjectId|string} invitationId
 * @param {Date} claimedAt
 */
const persistPasswordInvitationLink = async (requestId, invitationId, claimedAt) => {
    await ClientRegistrationRequest.updateOne(
        {
            _id: requestId,
            passwordInvitationClaimedAt: claimedAt,
            $and: [passwordInvitationUnsetClause],
        },
        {
            $set: {
                passwordInvitationId: invitationId,
                passwordInvitationClaimedAt: null,
            },
        }
    );
};

/**
 * Drop a stored invitation link that is no longer usable so a retry can replace it.
 *
 * @param {import('mongoose').Types.ObjectId} requestId
 * @param {import('mongoose').Types.ObjectId|string} invitationId
 */
const clearUnusablePasswordInvitationLink = async (requestId, invitationId) => {
    await ClientRegistrationRequest.updateOne(
        {
            _id: requestId,
            passwordInvitationId: invitationId,
        },
        {
            $set: {
                passwordInvitationId: null,
                passwordInvitationClaimedAt: null,
            },
        }
    );
};

/**
 * Resolve a usable invitation already associated with this approval, if any.
 *
 * @param {import('mongoose').Document} request
 * @param {import('mongoose').Document} user
 */
const resolveLinkedUsableInvitation = async (request, user) => {
    if (request.passwordInvitationId) {
        const linked = await ClientInvitation.findById(request.passwordInvitationId);
        if (invitationIsUsable(linked)) {
            return linked;
        }
        await clearUnusablePasswordInvitationLink(request._id, request.passwordInvitationId);
    }

    const pending = await findUsablePendingInvitation(user._id, request.trainerId);
    if (!pending) {
        return null;
    }

    await ClientRegistrationRequest.updateOne(
        {
            _id: request._id,
            $and: [passwordInvitationUnsetClause],
        },
        {
            $set: {
                passwordInvitationId: pending._id,
                passwordInvitationClaimedAt: null,
            },
        }
    );

    return pending;
};

/**
 * Wait briefly for the claim holder to finish. Primary safety is the claim itself.
 *
 * @param {import('mongoose').Types.ObjectId} requestId
 * @param {import('mongoose').Document} user
 */
const waitForLinkedUsableInvitation = async (requestId, user) => {
    for (let attempt = 0; attempt < PASSWORD_INVITATION_WAIT_ATTEMPTS; attempt += 1) {
        const fresh = await ClientRegistrationRequest.findById(requestId);
        if (!fresh) {
            return null;
        }

        const linked = await resolveLinkedUsableInvitation(fresh, user);
        if (linked) {
            return linked;
        }

        const claimStillHeld =
            fresh.passwordInvitationClaimedAt instanceof Date &&
            Date.now() - fresh.passwordInvitationClaimedAt.getTime() <
                PASSWORD_INVITATION_CLAIM_TTL_MS;

        if (!claimStillHeld) {
            return null;
        }

        await sleep(PASSWORD_INVITATION_WAIT_MS);
    }

    return null;
};

/**
 * Create or reuse exactly one usable password invitation for an approved request.
 * Concurrent approvals coordinate through passwordInvitationClaimedAt so a returned
 * URL cannot be revoked by a second createInvitation call.
 *
 * @param {import('mongoose').Document} request
 * @param {import('mongoose').Document} user
 * @param {number} [attempt]
 */
const ensurePasswordInvitation = async (request, user, attempt = 0) => {
    const alreadyLinked = await resolveLinkedUsableInvitation(request, user);
    if (alreadyLinked) {
        return reusedInvitation(alreadyLinked);
    }

    const now = new Date();
    const claimed = await ClientRegistrationRequest.findOneAndUpdate(
        {
            _id: request._id,
            approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED,
            $and: [passwordInvitationUnsetClause, claimAvailableClause(now)],
        },
        {
            $set: {
                passwordInvitationClaimedAt: now,
            },
        },
        { new: true }
    );

    if (!claimed) {
        const waited = await waitForLinkedUsableInvitation(request._id, user);
        if (waited) {
            return reusedInvitation(waited);
        }

        // Claim holder finished without linking, or claim became reclaimable.
        if (attempt < 1) {
            const fresh =
                (await ClientRegistrationRequest.findById(request._id)) || request;
            return ensurePasswordInvitation(fresh, user, attempt + 1);
        }

        throw invitationRetryError(user._id);
    }

    try {
        // Another path may have linked a usable invite between our first check and claim.
        const raced = await resolveLinkedUsableInvitation(claimed, user);
        if (raced) {
            await releaseInvitationClaim(request._id, now);
            return reusedInvitation(raced);
        }

        const created = await clientInvitationService.createInvitation(
            user._id.toString(),
            String(request.trainerId)
        );

        await persistPasswordInvitationLink(request._id, created.invitationId, now);
        return createdInvitation(created);
    } catch (err) {
        await releaseInvitationClaim(request._id, now);
        if (err instanceof ApiError && err.errors?.[0]?.code === 'INVITATION_RETRYABLE') {
            throw err;
        }
        throw invitationRetryError(user._id);
    }
};

const persistCreatedUserId = async (requestId, userId) => {
    await ClientRegistrationRequest.updateOne(
        { _id: requestId, ...unsetCreatedUser },
        { $set: { createdUserId: userId } }
    );
};

const toApprovalResponse = (request, user, invitation) => ({
    registrationRequestId: String(request._id),
    approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED,
    clientId: String(user._id),
    invitation,
});

/**
 * Finish an approved request: one client, nutrition only when needed, then invitation.
 * Safe to call again after a crash or a failed invitation.
 *
 * @param {import('mongoose').Document} request
 */
const provisionApprovedRequest = async (request) => {
    const { user, createdInThisCall } = await createOrRecoverClient(request);
    await ensureNutritionProfile(request, user, createdInThisCall);
    await persistCreatedUserId(request._id, user._id);

    // Reload so invitation claim fields are current after concurrent approvals.
    const freshRequest =
        (await ClientRegistrationRequest.findById(request._id)) || request;
    const invitation = await ensurePasswordInvitation(freshRequest, user);
    return toApprovalResponse(freshRequest, user, invitation);
};

/**
 * Claim pending → approved, then create the passwordless client.
 * A repeated call resumes provisioning instead of creating another user.
 *
 * @param {string} requestId
 * @param {string} trainerId authenticated owning trainer
 */
const approve = async (requestId, trainerId) => {
    const request = await loadOwnedRequest(requestId, trainerId);

    if (request.approvalStatus === CLIENT_REGISTRATION_REQUEST_STATUS.REJECTED) {
        throw alreadyRejected();
    }

    if (
        request.approvalStatus === CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED ||
        request.createdUserId
    ) {
        return provisionApprovedRequest(request);
    }

    await assertEmailAvailableForNewClient(request);

    const claimed = await ClientRegistrationRequest.findOneAndUpdate(
        {
            _id: request._id,
            trainerId: request.trainerId,
            approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.PENDING,
            ...unsetCreatedUser,
        },
        {
            $set: {
                approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED,
                reviewedAt: new Date(),
                reviewedBy: request.trainerId,
            },
        },
        { new: true }
    );

    if (!claimed) {
        const fresh = await loadOwnedRequest(requestId, trainerId);
        if (fresh.approvalStatus === CLIENT_REGISTRATION_REQUEST_STATUS.REJECTED) {
            throw alreadyRejected();
        }
        if (
            fresh.approvalStatus === CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED ||
            fresh.createdUserId
        ) {
            return provisionApprovedRequest(fresh);
        }
        throw new ApiError(409, 'Registration request could not be approved');
    }

    return provisionApprovedRequest(claimed);
};

/**
 * Pending → rejected. Does not create a user or a password invitation.
 *
 * @param {string} requestId
 * @param {string} trainerId
 * @param {{ rejectionReason?: string|null }} [body]
 */
const reject = async (requestId, trainerId, body = {}) => {
    const request = await loadOwnedRequest(requestId, trainerId);

    if (request.approvalStatus === CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED || request.createdUserId) {
        throw alreadyApproved();
    }
    if (request.approvalStatus === CLIENT_REGISTRATION_REQUEST_STATUS.REJECTED) {
        throw alreadyRejected();
    }

    const reason =
        typeof body.rejectionReason === 'string' && body.rejectionReason.trim()
            ? body.rejectionReason.trim()
            : null;

    const rejected = await ClientRegistrationRequest.findOneAndUpdate(
        {
            _id: request._id,
            trainerId: request.trainerId,
            approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.PENDING,
            ...unsetCreatedUser,
        },
        {
            $set: {
                approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.REJECTED,
                reviewedAt: new Date(),
                reviewedBy: request.trainerId,
                rejectionReason: reason,
            },
        },
        { new: true }
    );

    if (!rejected) {
        const fresh = await loadOwnedRequest(requestId, trainerId);
        if (fresh.approvalStatus === CLIENT_REGISTRATION_REQUEST_STATUS.APPROVED || fresh.createdUserId) {
            throw alreadyApproved();
        }
        if (fresh.approvalStatus === CLIENT_REGISTRATION_REQUEST_STATUS.REJECTED) {
            throw alreadyRejected();
        }
        throw new ApiError(409, 'Registration request could not be rejected');
    }

    return {
        registrationRequestId: String(rejected._id),
        approvalStatus: rejected.approvalStatus,
        reviewedAt: rejected.reviewedAt,
        rejectionReason: rejected.rejectionReason ?? null,
    };
};

/**
 * Derive inbox invitation status from a linked ClientInvitation document.
 *
 * @param {object|null|undefined} invitation
 * @param {Date} [now]
 */
const derivePasswordInvitationSummary = (invitation, now = new Date()) => {
    if (!invitation) {
        return {
            invitationId: null,
            status: PASSWORD_INVITATION_INBOX_STATUS.NONE,
            expiresAt: null,
            hasUsableInvitation: false,
        };
    }

    const invitationId = toIdString(invitation._id ?? invitation.id);
    const expiresAt = toIsoDate(invitation.expiresAt);
    const expired =
        invitation.expiresAt instanceof Date
            ? invitation.expiresAt.getTime() <= now.getTime()
            : expiresAt
              ? new Date(expiresAt).getTime() <= now.getTime()
              : true;

    if (invitation.status === CLIENT_INVITATION_STATUS.USED || invitation.usedAt) {
        return {
            invitationId,
            status: PASSWORD_INVITATION_INBOX_STATUS.USED,
            expiresAt,
            hasUsableInvitation: false,
        };
    }

    if (invitation.status === CLIENT_INVITATION_STATUS.REVOKED) {
        return {
            invitationId,
            status: PASSWORD_INVITATION_INBOX_STATUS.REVOKED,
            expiresAt,
            hasUsableInvitation: false,
        };
    }

    if (invitation.status === CLIENT_INVITATION_STATUS.PENDING) {
        if (expired) {
            return {
                invitationId,
                status: PASSWORD_INVITATION_INBOX_STATUS.EXPIRED,
                expiresAt,
                hasUsableInvitation: false,
            };
        }

        return {
            invitationId,
            status: PASSWORD_INVITATION_INBOX_STATUS.PENDING,
            expiresAt,
            hasUsableInvitation: true,
        };
    }

    return {
        invitationId,
        status: PASSWORD_INVITATION_INBOX_STATUS.NONE,
        expiresAt,
        hasUsableInvitation: false,
    };
};

const toListInvitationSummary = (summary) => ({
    status: summary.status,
    expiresAt: summary.expiresAt,
    hasUsableInvitation: summary.hasUsableInvitation,
});

const toDetailInvitationSummary = (summary) => ({
    invitationId: summary.invitationId,
    status: summary.status,
    expiresAt: summary.expiresAt,
    hasUsableInvitation: summary.hasUsableInvitation,
});

/**
 * Batch-load ClientInvitation docs for the current list page.
 *
 * @param {Array<object>} requests
 * @returns {Promise<Map<string, object>>}
 */
const loadInvitationsById = async (requests) => {
    const ids = [
        ...new Set(
            requests
                .map((doc) => doc.passwordInvitationId)
                .filter(Boolean)
                .map((id) => String(id))
        ),
    ];

    if (ids.length === 0) {
        return new Map();
    }

    const docs = await ClientInvitation.find({ _id: { $in: ids } })
        .select('_id status expiresAt usedAt')
        .lean();

    return new Map(docs.map((doc) => [String(doc._id), doc]));
};

const mapListItem = (doc, invitationById, now) => {
    const invitation = doc.passwordInvitationId
        ? invitationById.get(String(doc.passwordInvitationId))
        : null;
    const invitationSummary = derivePasswordInvitationSummary(invitation, now);

    return {
        id: String(doc._id),
        firstName: doc.firstName,
        lastName: doc.lastName,
        email: doc.email,
        phone: doc.phone ?? null,
        primaryFitnessGoal: doc.primaryFitnessGoal,
        approvalStatus: doc.approvalStatus,
        createdAt: toIsoDate(doc.createdAt),
        reviewedAt: toIsoDate(doc.reviewedAt),
        clientId: toIdString(doc.createdUserId),
        passwordInvitation: toListInvitationSummary(invitationSummary),
    };
};

const mapDetailItem = async (doc, invitation) => {
    const injuryAreaOptionIds = optionIdList(doc.injuryAreaOptionIds);
    const allergyOptionIds = optionIdList(doc.allergyOptionIds);
    const dietaryRestrictionOptionIds = optionIdList(doc.dietaryRestrictionOptionIds);

    const optionMap = await loadHealthOptionsMap([
        ...injuryAreaOptionIds,
        ...allergyOptionIds,
        ...dietaryRestrictionOptionIds,
    ]);

    const invitationSummary = derivePasswordInvitationSummary(invitation);

    return {
        id: String(doc._id),
        firstName: doc.firstName,
        lastName: doc.lastName,
        email: doc.email,
        phone: doc.phone ?? null,
        dateOfBirth: toIsoDate(doc.dateOfBirth),
        gender: doc.gender ?? null,
        primaryFitnessGoal: doc.primaryFitnessGoal,
        currentWeight: doc.currentWeight ?? null,
        targetWeight: doc.targetWeight ?? null,
        height: doc.height ?? null,
        experienceLevel: doc.experienceLevel ?? null,
        programType: doc.programType ?? null,
        sessionsPerWeek: doc.sessionsPerWeek ?? null,
        startDate: toIsoDate(doc.startDate),
        packageDuration: doc.packageDuration ?? null,
        endDate: toIsoDate(doc.endDate),
        additionalNotes: doc.additionalNotes ?? null,
        medicalConditions: doc.medicalConditions ?? null,
        injuries: doc.injuries ?? null,
        injuryDetails: doc.injuryDetails ?? null,
        injuryAreaOptionIds,
        injuryAreaOptions: mapOrderedHealthOptions(injuryAreaOptionIds, optionMap),
        allergyOptionIds,
        allergyOptions: mapOrderedHealthOptions(allergyOptionIds, optionMap),
        dietaryRestrictionOptionIds,
        dietaryRestrictionOptions: mapOrderedHealthOptions(
            dietaryRestrictionOptionIds,
            optionMap
        ),
        approvalStatus: doc.approvalStatus,
        reviewedAt: toIsoDate(doc.reviewedAt),
        reviewedBy: toIdString(doc.reviewedBy),
        rejectionReason: doc.rejectionReason ?? null,
        clientId: toIdString(doc.createdUserId),
        createdAt: toIsoDate(doc.createdAt),
        updatedAt: toIsoDate(doc.updatedAt),
        passwordInvitation: toDetailInvitationSummary(invitationSummary),
    };
};

/**
 * Trainer-scoped inbox list filter.
 *
 * @param {string} trainerId
 * @param {{ approvalStatus?: string, search?: string }} query
 */
const buildListFilter = (trainerId, { approvalStatus, search } = {}) => {
    if (!isValidObjectId(trainerId)) {
        throw new ApiError(400, 'Invalid trainer ID');
    }

    const filter = {
        trainerId: new mongoose.Types.ObjectId(String(trainerId)),
    };

    if (approvalStatus) {
        filter.approvalStatus = approvalStatus;
    }

    const term = typeof search === 'string' ? search.trim() : '';
    if (term) {
        const regex = new RegExp(escapeRegex(term), 'i');
        filter.$or = [
            { firstName: regex },
            { lastName: regex },
            { email: regex },
            { phone: regex },
        ];
    }

    return filter;
};

/**
 * List registration requests for the authenticated trainer.
 *
 * @param {string} trainerId
 * @param {{ approvalStatus?: string, search?: string, page?: number, limit?: number }} query
 */
const list = async (trainerId, query = {}) => {
    const filter = buildListFilter(trainerId, query);
    const { docs, pagination } = await paginateCollection({
        model: ClientRegistrationRequest,
        filter,
        sort: { createdAt: -1 },
        page: query.page,
        limit: query.limit,
        lean: true,
    });

    const invitationById = await loadInvitationsById(docs);
    const now = new Date();

    return {
        requests: docs.map((doc) => mapListItem(doc, invitationById, now)),
        pagination,
    };
};

/**
 * Get one owned registration request with catalog labels.
 *
 * @param {string} requestId
 * @param {string} trainerId
 */
const getById = async (requestId, trainerId) => {
    const request = await loadOwnedRequest(requestId, trainerId);
    const invitation = request.passwordInvitationId
        ? await ClientInvitation.findById(request.passwordInvitationId)
              .select('_id status expiresAt usedAt')
              .lean()
        : null;

    return mapDetailItem(request, invitation);
};

export default {
    list,
    getById,
    approve,
    reject,
};
