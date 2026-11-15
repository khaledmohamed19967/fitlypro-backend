/**
 * Phase 2: Structured phone integration (models, validators, prospect, approval, search).
 * Run: node scripts/test-phone-phase2.mjs
 * Requires: APP_DB_URL
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientProspectInvitation from '../src/modules/client-prospect-invitations/client-prospect-invitation.model.js';
import ClientRegistrationRequest from '../src/modules/client-registration-requests/client-registration-request.model.js';
import ClientInvitation from '../src/modules/client-invitations/client-invitation.model.js';
import { CLIENT_PROSPECT_INVITATION_STATUS } from '../src/modules/client-prospect-invitations/client-prospect-invitation.constants.js';
import { CLIENT_REGISTRATION_REQUEST_STATUS } from '../src/modules/client-registration-requests/client-registration-request.constants.js';
import { CLIENT_INVITATION_STATUS } from '../src/modules/client-invitations/client-invitation.constants.js';
import { validateCreateClientProspectInvitation } from '../src/modules/client-prospect-invitations/client-prospect-invitation.validator.js';
import { validateCreateClient } from '../src/modules/clients/client.validator.js';
import clientProspectInvitationService from '../src/modules/client-prospect-invitations/client-prospect-invitation.service.js';
import clientRegistrationRequestService from '../src/modules/client-registration-requests/client-registration-request.service.js';
import clientService from '../src/modules/clients/client.service.js';
import {
    buildPhoneInboxSearchClauses,
    isE164Phone,
    isLegacyDigitsOnlyPhone,
} from '../src/utils/phone.js';
import crypto from 'crypto';

const results = [];
const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const hashToken = (raw) =>
    crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');

const joiOk = (schema, body) => {
    const { error, value } = schema.validate(body, {
        abortEarly: false,
        stripUnknown: true,
    });
    return { error, value };
};

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Phone',
        lastName: 'TrainerA',
        email: `phone-trainer-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const trainerB = await User.create({
        firstName: 'Phone',
        lastName: 'TrainerB',
        email: `phone-trainer-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    // --- Distinction strategy ---
    if (isE164Phone('+201004500580') && !isLegacyDigitsOnlyPhone('+201004500580')) {
        pass('E.164 distinguished by leading +');
    } else {
        fail('E.164 distinguished by leading +', '');
    }
    if (isLegacyDigitsOnlyPhone('01004500580') && !isE164Phone('01004500580')) {
        pass('Legacy digits distinguished (no +)');
    } else {
        fail('Legacy digits distinguished (no +)', '');
    }

    // --- Joi: structured EG ---
    {
        const { error } = joiOk(validateCreateClientProspectInvitation, {
            clientName: 'Salma EG',
            phone: '01004500580',
            phoneCountryIso: 'EG',
            phoneCountryCode: '+999',
        });
        if (error) pass('Conflicting calling code rejected');
        else fail('Conflicting calling code rejected', 'expected error');
    }

    {
        const { error, value } = joiOk(validateCreateClientProspectInvitation, {
            clientName: 'Salma EG',
            phone: '01004500580',
            phoneCountryIso: 'EG',
        });
        if (
            !error &&
            value.phone === '+201004500580' &&
            value.phoneCountryIso === 'EG' &&
            value.phoneCountryCode === '+20'
        ) {
            pass('Structured Egyptian phone Joi normalize');
        } else {
            fail(
                'Structured Egyptian phone Joi normalize',
                error?.message || JSON.stringify(value)
            );
        }
    }

    {
        const { error } = joiOk(validateCreateClientProspectInvitation, {
            clientName: 'Bad ISO',
            phone: '01004500580',
            phoneCountryIso: 'XX',
        });
        if (error) pass('Invalid selected ISO rejected');
        else fail('Invalid selected ISO rejected', 'expected error');
    }

    {
        const { error } = joiOk(validateCreateClientProspectInvitation, {
            clientName: 'Bad national',
            phone: '12345',
            phoneCountryIso: 'EG',
        });
        if (error) pass('Invalid national number rejected');
        else fail('Invalid national number rejected', 'expected error');
    }

    {
        const { error, value } = joiOk(validateCreateClientProspectInvitation, {
            clientName: 'Legacy Digits',
            phone: '+1 (555) 987-6543',
        });
        // legacy strip → digits; 15559876543 is 11 digits - valid legacy
        if (
            !error &&
            value.phone === '15559876543' &&
            value.phoneCountryIso === undefined &&
            value.phoneCountryCode === undefined
        ) {
            pass('Legacy digits-only request compatibility (no fabricated ISO)');
        } else {
            fail(
                'Legacy digits-only request compatibility (no fabricated ISO)',
                error?.message || JSON.stringify(value)
            );
        }
    }

    {
        const { error, value } = joiOk(validateCreateClient, {
            firstName: 'US',
            lastName: 'Client',
            email: `us-client-${suffix}@test.com`,
            password,
            primaryFitnessGoal: 'general_fitness',
            phone: '2025550123',
            phoneCountryIso: 'US',
        });
        if (
            !error &&
            value.phone === '+12025550123' &&
            value.phoneCountryIso === 'US' &&
            value.phoneCountryCode === '+1'
        ) {
            pass('Structured US phone create-client Joi');
        } else {
            fail(
                'Structured US phone create-client Joi',
                error?.message || JSON.stringify(value)
            );
        }
    }

    {
        const { error, value } = joiOk(validateCreateClient, {
            firstName: 'SA',
            lastName: 'Client',
            email: `sa-client-${suffix}@test.com`,
            password,
            primaryFitnessGoal: 'general_fitness',
            phone: '0512345678',
            phoneCountryIso: 'SA',
        });
        if (
            !error &&
            value.phone === '+966512345678' &&
            value.phoneCountryIso === 'SA' &&
            value.phoneCountryCode === '+966'
        ) {
            pass('Structured Saudi phone create-client Joi');
        } else {
            fail(
                'Structured Saudi phone create-client Joi',
                error?.message || JSON.stringify(value)
            );
        }
    }

    // --- Persistence EG structured ---
    const egInvite = await clientProspectInvitationService.createProspectInvitation(
        {
            clientName: 'EG Structured',
            phone: '+201004500580',
            phoneCountryIso: 'EG',
            phoneCountryCode: '+20',
        },
        trainerA._id.toString()
    );
    const egDoc = await ClientProspectInvitation.findById(egInvite.invitationId).lean();
    if (
        egDoc?.phone === '+201004500580' &&
        egDoc.phoneCountryIso === 'EG' &&
        egDoc.phoneCountryCode === '+20'
    ) {
        pass('Structured Egyptian phone creation and persistence');
    } else {
        fail('Structured Egyptian phone creation and persistence', JSON.stringify(egDoc));
    }

    // Duplicate matching E.164 — second create revokes first pending
    const egInvite2 = await clientProspectInvitationService.createProspectInvitation(
        {
            clientName: 'EG Structured 2',
            phone: '01004500580',
            phoneCountryIso: 'EG',
        },
        trainerA._id.toString()
    );
    const egDoc1After = await ClientProspectInvitation.findById(egInvite.invitationId).lean();
    const egDoc2 = await ClientProspectInvitation.findById(egInvite2.invitationId).lean();
    if (
        egDoc1After?.status === CLIENT_PROSPECT_INVITATION_STATUS.REVOKED &&
        egDoc2?.status === CLIENT_PROSPECT_INVITATION_STATUS.PENDING &&
        egDoc2.phone === '+201004500580'
    ) {
        pass('Prospect duplicate matching with E.164');
    } else {
        fail(
            'Prospect duplicate matching with E.164',
            JSON.stringify({ egDoc1After, egDoc2 })
        );
    }

    // Cross-country: legacy national digits must NOT revoke E.164 pending
    await ClientProspectInvitation.create({
        trainerId: trainerA._id,
        clientName: 'Legacy National',
        phone: '1004500580',
        tokenHash: hashToken(`legacy-nat-${suffix}`),
        status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
        expiresAt: new Date(Date.now() + 86400000),
    });
    const beforeCross = await ClientProspectInvitation.countDocuments({
        trainerId: trainerA._id,
        phone: '+201004500580',
        status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
    });
    await clientProspectInvitationService.createProspectInvitation(
        { clientName: 'Legacy create', phone: '1004500580' },
        trainerA._id.toString()
    );
    const afterCrossE164 = await ClientProspectInvitation.countDocuments({
        trainerId: trainerA._id,
        phone: '+201004500580',
        status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
    });
    if (beforeCross >= 1 && afterCrossE164 === beforeCross) {
        pass('No cross-country / cross-format false matching on revoke');
    } else {
        fail(
            'No cross-country / cross-format false matching on revoke',
            JSON.stringify({ beforeCross, afterCrossE164 })
        );
    }

    // Trainer B independent
    await clientProspectInvitationService.createProspectInvitation(
        {
            clientName: 'B EG',
            phone: '01004500580',
            phoneCountryIso: 'EG',
        },
        trainerB._id.toString()
    );
    const pendingA = await ClientProspectInvitation.countDocuments({
        trainerId: trainerA._id,
        phone: '+201004500580',
        status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
    });
    const pendingB = await ClientProspectInvitation.countDocuments({
        trainerId: trainerB._id,
        phone: '+201004500580',
        status: CLIENT_PROSPECT_INVITATION_STATUS.PENDING,
    });
    if (pendingA >= 1 && pendingB === 1) {
        pass('Different trainers remain independent for same E.164');
    } else {
        fail(
            'Different trainers remain independent for same E.164',
            JSON.stringify({ pendingA, pendingB })
        );
    }

    // Legacy record readable without fabricated country
    const legacyUser = await User.create({
        firstName: 'Legacy',
        lastName: 'Phone',
        email: `legacy-phone-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
        phone: '01100505801',
        primaryFitnessGoal: 'general_fitness',
    });
    const legacyProfile = legacyUser.getPublicProfile();
    if (
        legacyProfile.phone === '01100505801' &&
        (legacyProfile.phoneCountryIso == null || legacyProfile.phoneCountryIso === null) &&
        (legacyProfile.phoneCountryCode == null || legacyProfile.phoneCountryCode === null)
    ) {
        pass('Legacy records remain readable without fabricated country fields');
    } else {
        fail(
            'Legacy records remain readable without fabricated country fields',
            JSON.stringify(legacyProfile)
        );
    }

    // Public registration copies structured fields
    const regInvite = await clientProspectInvitationService.createProspectInvitation(
        {
            clientName: 'Reg Copy',
            phone: '01004500581',
            phoneCountryIso: 'EG',
        },
        trainerA._id.toString()
    );
    const regInviteDoc = await ClientProspectInvitation.findById(
        regInvite.invitationId
    ).select('+tokenHash');
    // Need raw token — create returns URL; extract via creating with known flow:
    // Use service register with token from URL
    const tokenFromUrl = new URL(regInvite.invitationUrl).searchParams.get('token');
    const registered = await clientProspectInvitationService.registerFromProspectInvitation(
        tokenFromUrl,
        {
            firstName: 'Reg',
            lastName: 'Copy',
            email: `reg-copy-${suffix}@test.com`,
            primaryFitnessGoal: 'general_fitness',
        }
    );
    const reqDoc = await ClientRegistrationRequest.findById(
        registered.registrationRequestId
    ).lean();
    if (
        reqDoc?.phone === '+201004500581' &&
        reqDoc.phoneCountryIso === 'EG' &&
        reqDoc.phoneCountryCode === '+20'
    ) {
        pass('Public registration copies structured fields');
    } else {
        fail('Public registration copies structured fields', JSON.stringify(reqDoc));
        void regInviteDoc;
    }

    // Approval copies structured fields to User
    const approved = await clientRegistrationRequestService.approve(
        registered.registrationRequestId,
        trainerA._id.toString()
    );
    const reqAfter = await ClientRegistrationRequest.findById(
        registered.registrationRequestId
    ).lean();
    const createdUser = await User.findById(
        reqAfter.createdUserId || approved.clientId
    ).lean();
    if (
        createdUser?.phone === '+201004500581' &&
        createdUser.phoneCountryIso === 'EG' &&
        createdUser.phoneCountryCode === '+20'
    ) {
        pass('Approval copies structured fields to User');
    } else {
        fail(
            'Approval copies structured fields to User',
            JSON.stringify({ createdUser, approved })
        );
    }

    // Inbox search E.164 exact + legacy exact
    const searchE164 = buildPhoneInboxSearchClauses('+201004500581');
    const searchLegacy = buildPhoneInboxSearchClauses('01100505801');
    const foundE164 = await ClientRegistrationRequest.find({
        trainerId: trainerA._id,
        $or: searchE164,
    }).lean();
    const foundLegacy = await User.find({
        trainer: trainerA._id,
        $or: searchLegacy,
    }).lean();
    if (foundE164.some((d) => d.phone === '+201004500581')) {
        pass('Inbox search supports E.164 values');
    } else {
        fail('Inbox search supports E.164 values', JSON.stringify(searchE164));
    }
    if (foundLegacy.some((d) => d.phone === '01100505801')) {
        pass('Inbox search supports legacy digit values');
    } else {
        fail('Inbox search supports legacy digit values', JSON.stringify(foundLegacy));
    }

    // Cross-format: searching legacy national must not match E.164 via substring clauses
    const falseMatchClauses = buildPhoneInboxSearchClauses('1004500581');
    const falseMatches = await ClientRegistrationRequest.find({
        trainerId: trainerA._id,
        $or: falseMatchClauses,
    }).lean();
    if (!falseMatches.some((d) => String(d.phone).startsWith('+'))) {
        pass('Inbox search avoids E.164 false match on legacy national digits');
    } else {
        fail(
            'Inbox search avoids E.164 false match on legacy national digits',
            JSON.stringify(falseMatches.map((d) => d.phone))
        );
    }

    // Add/edit client compatibility
    const addBody = joiOk(validateCreateClient, {
        firstName: 'Add',
        lastName: 'Client',
        email: `add-client-phone-${suffix}@test.com`,
        password,
        primaryFitnessGoal: 'general_fitness',
        phone: '01004500582',
        phoneCountryIso: 'EG',
    });
    const createdClient = await clientService.createClient(
        addBody.value,
        trainerA._id.toString()
    );
    const clientId = createdClient.id || createdClient._id;
    const clientLean = await User.findById(clientId).lean();
    if (
        clientLean?.phone === '+201004500582' &&
        clientLean.phoneCountryIso === 'EG'
    ) {
        pass('Add client structured phone persistence');
    } else {
        fail('Add client structured phone persistence', JSON.stringify(clientLean));
    }

    const { validateUpdateClient } = await import(
        '../src/modules/clients/client.validator.js'
    );
    const updateBody = joiOk(validateUpdateClient, {
        phone: '2025550199',
        phoneCountryIso: 'US',
    });
    await clientService.updateClient(
        clientId,
        updateBody.value,
        trainerA._id.toString()
    );
    const clientUpdated = await User.findById(clientId).lean();
    if (
        clientUpdated?.phone === '+12025550199' &&
        clientUpdated.phoneCountryIso === 'US' &&
        clientUpdated.phoneCountryCode === '+1'
    ) {
        pass('Edit client structured phone compatibility');
    } else {
        fail('Edit client structured phone compatibility', JSON.stringify(clientUpdated));
    }

    // Password invitation workflow unchanged (no phone on schema)
    const paths = ClientInvitation.schema.paths;
    if (!paths.phone && !paths.phoneCountryIso && !paths.phoneCountryCode) {
        pass('Password ClientInvitation schema has no phone fields');
    } else {
        fail('Password ClientInvitation schema has no phone fields', Object.keys(paths).join(','));
    }

    const pwdInv = await ClientInvitation.create({
        clientId: createdUser._id,
        trainerId: trainerA._id,
        tokenHash: hashToken(`pwd-${suffix}`),
        status: CLIENT_INVITATION_STATUS.PENDING,
        expiresAt: new Date(Date.now() + 86400000),
    });
    if (pwdInv.status === CLIENT_INVITATION_STATUS.PENDING) {
        pass('Password invitation create still works');
    } else {
        fail('Password invitation create still works', String(pwdInv.status));
    }

    // No phone uniqueness index
    const userIndexes = await User.collection.indexes();
    const prospectIndexes = await ClientProspectInvitation.collection.indexes();
    const requestIndexes = await ClientRegistrationRequest.collection.indexes();
    const isPhoneUnique = (indexes) =>
        indexes.some(
            (idx) =>
                idx.unique &&
                idx.key &&
                (idx.key.phone === 1 || idx.key.phone === -1) &&
                Object.keys(idx.key).length === 1
        );
    if (
        !isPhoneUnique(userIndexes) &&
        !isPhoneUnique(prospectIndexes) &&
        !isPhoneUnique(requestIndexes)
    ) {
        pass('No phone uniqueness index introduced');
    } else {
        fail('No phone uniqueness index introduced', 'unique phone index found');
    }

    // Cleanup
    await ClientInvitation.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await ClientRegistrationRequest.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await ClientProspectInvitation.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await User.deleteMany({
        email: {
            $regex: new RegExp(
                `^(phone-trainer-|legacy-phone-|reg-copy-|add-client-phone-|us-client-|sa-client-).*${suffix}@test\\.com$`
            ),
        },
    });
    // approved client email
    await User.deleteMany({
        _id: {
            $in: [trainerA._id, trainerB._id, legacyUser._id, createdUser?._id, clientId].filter(
                Boolean
            ),
        },
    });
    await User.deleteMany({
        email: `reg-copy-${suffix}@test.com`,
    });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
