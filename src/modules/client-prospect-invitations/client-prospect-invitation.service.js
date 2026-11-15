import mongoose from 'mongoose';
import ClientProspectInvitation from './client-prospect-invitation.model.js';
import { CLIENT_PROSPECT_INVITATION_STATUS } from './client-prospect-invitation.constants.js';
import {
    buildProspectInvitationUrl,
    computeProspectInvitationExpiresAt,
    generateInvitationToken,
    hashInvitationToken,
    isInvitationExpired,
} from './client-prospect-invitation.helpers.js';
import ClientRegistrationRequest from '../client-registration-requests/client-registration-request.model.js';
import { CLIENT_REGISTRATION_REQUEST_STATUS } from '../client-registration-requests/client-registration-request.constants.js';
import { validateHealthOptionIdsForCategory } from '../health-reference/health-reference.helpers.js';
import { ApiError } from '../../utils/ApiError.js';
import {
    assertNormalizedPhone,
    isLegacyDigitsOnlyPhone,
    isStoredPhoneValue,
    pickPersistedPhoneFields,
    toPhoneResponseFields,
} from '../../utils/phone.js';

const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

/**
 * Create a prospect invitation for the authenticated coach.
 * Does not create a User or ClientRegistrationRequest.
 * Phone is expected pre-normalized by Joi (`applyPhoneContractToValue`).
 *
 * @param {{ clientName: string, phone: string, phoneCountryIso?: string, phoneCountryCode?: string }} payload
 * @param {string} trainerId
 */
const createProspectInvitation = async (payload, trainerId) => {
    if (!isValidObjectId(trainerId)) {
        throw new ApiError(400, 'Invalid trainer ID');
    }

    const clientName =
        typeof payload.clientName === 'string' ? payload.clientName.trim() : '';

    if (!clientName || clientName.length < 2) {
        throw new ApiError(400, 'Client name is required');
    }

    const hasIso =
        payload.phoneCountryIso != null &&
        String(payload.phoneCountryIso).trim() !== '';

    let phoneFields;
    if (hasIso) {
        const normalized = assertNormalizedPhone(
            {
                phone: payload.phone,
                phoneCountryIso: payload.phoneCountryIso,
                phoneCountryCode: payload.phoneCountryCode,
            },
            { required: true }
        );
        phoneFields = pickPersistedPhoneFields(normalized);
    } else if (isStoredPhoneValue(payload.phone)) {
        phoneFields = pickPersistedPhoneFields({ phone: payload.phone });
    } else if (
        typeof payload.phone === 'string' &&
        isLegacyDigitsOnlyPhone(payload.phone.replace(/\D/g, ''))
    ) {
        phoneFields = pickPersistedPhoneFields({
            phone: payload.phone.replace(/\D/g, ''),
        });
    } else {
        throw new ApiError(400, 'Please provide a valid phone number');
    }

    const phone = phoneFields.phone;
    if (!phone || !isStoredPhoneValue(phone)) {
        throw new ApiError(400, 'Please provide a valid phone number');
    }

    // Exact phone match only (E.164 or legacy digits). No cross-format national-digit matching.
    await ClientProspectInvitation.updateMany(
        {
            trainerId,
            phone,
            status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
        },
        {
            $set: {
                status: CLIENT_PROSPECT_INVITATION_STATUS.REVOKED,
                revokedAt: new Date(),
            },
        }
    );

    const rawToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const expiresAt = computeProspectInvitationExpiresAt();

    const invitation = await ClientProspectInvitation.create({
        trainerId,
        clientName,
        phone,
        phoneCountryIso: phoneFields.phoneCountryIso ?? null,
        phoneCountryCode: phoneFields.phoneCountryCode ?? null,
        tokenHash,
        status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
        expiresAt,
        usedAt: null,
        revokedAt: null,
    });

    return {
        invitationId: invitation._id,
        invitationUrl: buildProspectInvitationUrl(rawToken),
        expiresAt,
    };
};

/**
 * Resolve invitation by raw token (includes tokenHash).
 *
 * @param {string} rawToken
 */
const findProspectInvitationByRawToken = async (rawToken) => {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length < 16) {
        throw new ApiError(400, 'Invalid invitation token');
    }

    const tokenHash = hashInvitationToken(rawToken.trim());
    const invitation = await ClientProspectInvitation.findOne({ tokenHash }).select(
        '+tokenHash'
    );

    if (!invitation) {
        throw new ApiError(404, 'Invitation not found');
    }

    return invitation;
};

/**
 * Shared validity checks for preview (mutates nothing).
 *
 * @param {import('mongoose').Document} invitation
 */
const assertProspectInvitationUsable = (invitation) => {
    if (
        invitation.status === CLIENT_PROSPECT_INVITATION_STATUS.USED ||
        invitation.usedAt
    ) {
        throw new ApiError(409, 'Invitation has already been used');
    }

    if (invitation.status === CLIENT_PROSPECT_INVITATION_STATUS.REVOKED) {
        throw new ApiError(409, 'Invitation is no longer valid');
    }

    if (
        invitation.status !== CLIENT_PROSPECT_INVITATION_STATUS.PENDING ||
        isInvitationExpired(invitation.expiresAt)
    ) {
        throw new ApiError(410, 'Invitation has expired');
    }
};

/**
 * Map a failed claim to a precise status error.
 *
 * @param {string} rawToken
 */
const throwUnusableProspectInvitationError = async (rawToken) => {
    const invitation = await findProspectInvitationByRawToken(rawToken);
    assertProspectInvitationUsable(invitation);
    throw new ApiError(409, 'Invitation has already been used');
};

/**
 * Roll a claimed invitation back to pending if registration create fails.
 *
 * @param {import('mongoose').Types.ObjectId} invitationId
 */
const rollbackClaimedProspectInvitation = async (invitationId) => {
    await ClientProspectInvitation.findOneAndUpdate(
        {
            _id: invitationId,
            status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
        },
        {
            $set: {
                status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
                usedAt: null,
            },
        }
    );
};

/**
 * Public preview — no auth. Does not expose trainer or token hash.
 *
 * @param {string} rawToken
 */
const previewProspectInvitation = async (rawToken) => {
    const invitation = await findProspectInvitationByRawToken(rawToken);
    assertProspectInvitationUsable(invitation);

    return {
        valid: true,
        clientName: invitation.clientName,
        ...toPhoneResponseFields(invitation),
        expiresAt: invitation.expiresAt,
    };
};

/**
 * Validate health reference option IDs (same rules as Add Client create).
 *
 * @param {object} payload
 */
const validateProspectHealthOptionIds = async (payload) => {
    const injuryAreaOptionIds = await validateHealthOptionIdsForCategory({
        category: 'body_area',
        requestedIds: payload.injuryAreaOptionIds,
        existingIds: [],
        fieldName: 'injuryAreaOptionIds',
    });

    const allergyOptionIds = await validateHealthOptionIdsForCategory({
        category: 'allergy',
        requestedIds: payload.allergyOptionIds,
        existingIds: [],
        fieldName: 'allergyOptionIds',
    });

    const dietaryRestrictionOptionIds = await validateHealthOptionIdsForCategory({
        category: 'dietary_restriction',
        requestedIds: payload.dietaryRestrictionOptionIds,
        existingIds: [],
        fieldName: 'dietaryRestrictionOptionIds',
    });

    return {
        injuryAreaOptionIds,
        allergyOptionIds,
        dietaryRestrictionOptionIds,
    };
};

/**
 * Public registration submission — creates ClientRegistrationRequest only.
 * Atomic claim prevents duplicate / concurrent submissions on the same token.
 *
 * @param {string} rawToken
 * @param {object} registrationData — validated body (no password / ownership)
 */
const registerFromProspectInvitation = async (rawToken, registrationData) => {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length < 16) {
        throw new ApiError(400, 'Invalid invitation token');
    }

    const tokenHash = hashInvitationToken(rawToken.trim());
    const now = new Date();

    // Atomic claim: only one concurrent submitter can win
    const claimed = await ClientProspectInvitation.findOneAndUpdate(
        {
            tokenHash,
            status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
            usedAt: null,
            expiresAt: { $gt: now },
        },
        {
            $set: {
                status: CLIENT_PROSPECT_INVITATION_STATUS.USED,
                usedAt: now,
            },
        },
        { new: true }
    );

    if (!claimed) {
        await throwUnusableProspectInvitationError(rawToken);
    }

    try {
        const healthIds = await validateProspectHealthOptionIds(registrationData);

        // Prefer structured/legacy phone from registration body when present; else copy invitation.
        const submittedPhone = pickPersistedPhoneFields(registrationData);
        const phoneFields =
            submittedPhone.phone && isStoredPhoneValue(submittedPhone.phone)
                ? {
                      phone: submittedPhone.phone,
                      phoneCountryIso: submittedPhone.phoneCountryIso ?? null,
                      phoneCountryCode: submittedPhone.phoneCountryCode ?? null,
                  }
                : {
                      phone: claimed.phone,
                      phoneCountryIso: claimed.phoneCountryIso ?? null,
                      phoneCountryCode: claimed.phoneCountryCode ?? null,
                  };

        const injuryDetails =
            registrationData.injuryDetails === '' ||
            registrationData.injuryDetails == null
                ? null
                : registrationData.injuryDetails;

        const requestDoc = await ClientRegistrationRequest.create({
            invitationId: claimed._id,
            trainerId: claimed.trainerId,
            firstName: registrationData.firstName,
            lastName: registrationData.lastName,
            email: registrationData.email,
            phone: phoneFields.phone,
            phoneCountryIso: phoneFields.phoneCountryIso,
            phoneCountryCode: phoneFields.phoneCountryCode,
            dateOfBirth: registrationData.dateOfBirth,
            gender: registrationData.gender,
            primaryFitnessGoal: registrationData.primaryFitnessGoal,
            currentWeight: registrationData.currentWeight,
            targetWeight: registrationData.targetWeight,
            height: registrationData.height,
            experienceLevel: registrationData.experienceLevel,
            programType: registrationData.programType,
            sessionsPerWeek: registrationData.sessionsPerWeek,
            startDate: registrationData.startDate,
            packageDuration: registrationData.packageDuration,
            endDate: registrationData.endDate,
            additionalNotes: registrationData.additionalNotes,
            medicalConditions: registrationData.medicalConditions,
            injuries: registrationData.injuries,
            injuryAreaOptionIds:
                healthIds.injuryAreaOptionIds !== undefined
                    ? healthIds.injuryAreaOptionIds
                    : [],
            injuryDetails,
            allergyOptionIds:
                healthIds.allergyOptionIds !== undefined
                    ? healthIds.allergyOptionIds
                    : [],
            dietaryRestrictionOptionIds:
                healthIds.dietaryRestrictionOptionIds !== undefined
                    ? healthIds.dietaryRestrictionOptionIds
                    : [],
            approvalStatus: CLIENT_REGISTRATION_REQUEST_STATUS.PENDING,
            createdUserId: null,
            reviewedAt: null,
            reviewedBy: null,
            rejectionReason: null,
        });

        return {
            registrationRequestId: requestDoc._id,
            approvalStatus: requestDoc.approvalStatus,
        };
    } catch (err) {
        // Restore pending so a failed submission can be retried with the same link
        await rollbackClaimedProspectInvitation(claimed._id);

        // Unique invitationId: treat as duplicate submission if a request already exists
        if (err && (err.code === 11000 || err.codeName === 'DuplicateKey')) {
            throw new ApiError(409, 'Invitation has already been used');
        }

        throw err;
    }
};

/**
 * Reissue a coach-owned pending prospect invitation.
 * Loads name + phone from the existing doc, then runs createProspectInvitation
 * (which revokes prior pending invites for the same coach + phone).
 *
 * @param {string} invitationId
 * @param {string} trainerId
 */
const reissueProspectInvitation = async (invitationId, trainerId) => {
    if (!isValidObjectId(invitationId)) {
        throw new ApiError(400, 'Invalid invitation ID');
    }
    if (!isValidObjectId(trainerId)) {
        throw new ApiError(400, 'Invalid trainer ID');
    }

    const existing = await ClientProspectInvitation.findOne({
        _id: invitationId,
        trainerId,
    }).select('_id clientName phone phoneCountryIso phoneCountryCode status');

    if (!existing) {
        throw new ApiError(404, 'Invitation not found');
    }

    if (existing.status !== CLIENT_PROSPECT_INVITATION_STATUS.PENDING) {
        throw new ApiError(409, 'Invitation can no longer be reissued');
    }

    return createProspectInvitation(
        {
            clientName: existing.clientName,
            phone: existing.phone,
            phoneCountryIso: existing.phoneCountryIso ?? undefined,
            phoneCountryCode: existing.phoneCountryCode ?? undefined,
        },
        trainerId
    );
};

/**
 * Revoke a coach-owned pending (and unexpired) prospect invitation.
 * Does not create a replacement invitation.
 *
 * Concurrent-safe via findOneAndUpdate on status=pending + expiresAt > now.
 *
 * @param {string} invitationId
 * @param {string} trainerId
 */
const revokeProspectInvitation = async (invitationId, trainerId) => {
    if (!isValidObjectId(invitationId)) {
        throw new ApiError(400, 'Invalid invitation ID');
    }
    if (!isValidObjectId(trainerId)) {
        throw new ApiError(400, 'Invalid trainer ID');
    }

    const now = new Date();

    const updated = await ClientProspectInvitation.findOneAndUpdate(
        {
            _id: invitationId,
            trainerId,
            status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
            expiresAt: { $gt: now },
        },
        {
            $set: {
                status: CLIENT_PROSPECT_INVITATION_STATUS.REVOKED,
                revokedAt: now,
            },
        },
        { new: true }
    ).select('_id status revokedAt');

    if (updated) {
        return {
            invitationId: String(updated._id),
            status: updated.status,
            revokedAt: updated.revokedAt ? updated.revokedAt.toISOString() : null,
        };
    }

    const existing = await ClientProspectInvitation.findOne({
        _id: invitationId,
        trainerId,
    }).select('_id status expiresAt');

    if (!existing) {
        throw new ApiError(404, 'Invitation not found');
    }

    if (
        existing.status === CLIENT_PROSPECT_INVITATION_STATUS.USED ||
        existing.status === CLIENT_PROSPECT_INVITATION_STATUS.REVOKED
    ) {
        throw new ApiError(409, 'Invitation can no longer be cancelled');
    }

    if (
        existing.status !== CLIENT_PROSPECT_INVITATION_STATUS.PENDING ||
        isInvitationExpired(existing.expiresAt)
    ) {
        throw new ApiError(410, 'Invitation has expired');
    }

    throw new ApiError(409, 'Invitation can no longer be cancelled');
};

export default {
    createProspectInvitation,
    reissueProspectInvitation,
    revokeProspectInvitation,
    previewProspectInvitation,
    registerFromProspectInvitation,
};
