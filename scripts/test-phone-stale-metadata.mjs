/**
 * Phase 2.1: Stale phone country metadata must not survive legacy-only updates.
 * Run: node scripts/test-phone-stale-metadata.mjs
 * Requires: APP_DB_URL
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import clientService from '../src/modules/clients/client.service.js';
import authService from '../src/modules/auth/auth.service.js';
import { validateUpdateClient } from '../src/modules/clients/client.validator.js';
import { validateUpdateProfile } from '../src/modules/auth/auth.validator.js';

const results = [];
const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const joiOk = (schema, body) => {
    const { error, value } = schema.validate(body, {
        abortEarly: false,
        stripUnknown: true,
    });
    if (error) {
        throw new Error(`Joi failed: ${error.message}`);
    }
    return value;
};

const countryFieldsCleared = (doc) => {
    if (!doc) return false;
    const isoMissing =
        !Object.prototype.hasOwnProperty.call(doc, 'phoneCountryIso') ||
        doc.phoneCountryIso == null;
    const codeMissing =
        !Object.prototype.hasOwnProperty.call(doc, 'phoneCountryCode') ||
        doc.phoneCountryCode == null;
    return isoMissing && codeMissing;
};

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const password = 'testpass123';
    const createdIds = [];

    const trainer = await User.create({
        firstName: 'Stale',
        lastName: 'Trainer',
        email: `stale-phone-trainer-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    createdIds.push(trainer._id);

    // ------------------------------------------------------------------
    // client.service.applyAllowlistedUserUpdates via updateClient
    // ------------------------------------------------------------------

    // 1. Structured → legacy-only: country metadata must be removed
    const structuredClient = await User.create({
        firstName: 'Struct',
        lastName: 'ToLegacy',
        email: `stale-client-s2l-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        phone: '+201100450580',
        phoneCountryIso: 'EG',
        phoneCountryCode: '+20',
        primaryFitnessGoal: 'general_fitness',
    });
    createdIds.push(structuredClient._id);

    const legacyOnlyBody = joiOk(validateUpdateClient, { phone: '01100505801' });
    await clientService.updateClient(
        structuredClient._id.toString(),
        legacyOnlyBody,
        trainer._id.toString()
    );
    const afterLegacy = await User.findById(structuredClient._id).lean();
    if (
        afterLegacy?.phone === '01100505801' &&
        countryFieldsCleared(afterLegacy)
    ) {
        pass('client: structured → legacy-only clears stale ISO/code');
    } else {
        fail(
            'client: structured → legacy-only clears stale ISO/code',
            JSON.stringify(afterLegacy)
        );
    }

    // 2. Legacy → structured: all three fields correct
    const legacyClient = await User.create({
        firstName: 'Legacy',
        lastName: 'ToStruct',
        email: `stale-client-l2s-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        phone: '01100505801',
        primaryFitnessGoal: 'general_fitness',
    });
    createdIds.push(legacyClient._id);

    const structuredBody = joiOk(validateUpdateClient, {
        phone: '01004500580',
        phoneCountryIso: 'EG',
    });
    await clientService.updateClient(
        legacyClient._id.toString(),
        structuredBody,
        trainer._id.toString()
    );
    const afterStruct = await User.findById(legacyClient._id).lean();
    if (
        afterStruct?.phone === '+201004500580' &&
        afterStruct.phoneCountryIso === 'EG' &&
        afterStruct.phoneCountryCode === '+20'
    ) {
        pass('client: legacy → structured persists all three fields');
    } else {
        fail(
            'client: legacy → structured persists all three fields',
            JSON.stringify(afterStruct)
        );
    }

    // 3. Structured → structured: consistent update
    const structClient2 = await User.create({
        firstName: 'Struct',
        lastName: 'ToStruct',
        email: `stale-client-s2s-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        phone: '+201100450580',
        phoneCountryIso: 'EG',
        phoneCountryCode: '+20',
        primaryFitnessGoal: 'general_fitness',
    });
    createdIds.push(structClient2._id);

    const usBody = joiOk(validateUpdateClient, {
        phone: '2025550199',
        phoneCountryIso: 'US',
    });
    await clientService.updateClient(
        structClient2._id.toString(),
        usBody,
        trainer._id.toString()
    );
    const afterUs = await User.findById(structClient2._id).lean();
    if (
        afterUs?.phone === '+12025550199' &&
        afterUs.phoneCountryIso === 'US' &&
        afterUs.phoneCountryCode === '+1'
    ) {
        pass('client: structured → structured updates all fields');
    } else {
        fail(
            'client: structured → structured updates all fields',
            JSON.stringify(afterUs)
        );
    }

    // 4. Explicit phone clear: all three cleared
    const clearClient = await User.create({
        firstName: 'Clear',
        lastName: 'Phone',
        email: `stale-client-clear-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        phone: '+201100450580',
        phoneCountryIso: 'EG',
        phoneCountryCode: '+20',
        primaryFitnessGoal: 'general_fitness',
    });
    createdIds.push(clearClient._id);

    const clearBody = joiOk(validateUpdateClient, { phone: '' });
    await clientService.updateClient(
        clearClient._id.toString(),
        clearBody,
        trainer._id.toString()
    );
    const afterClear = await User.findById(clearClient._id).lean();
    if (
        (afterClear?.phone == null ||
            !Object.prototype.hasOwnProperty.call(afterClear, 'phone')) &&
        countryFieldsCleared(afterClear)
    ) {
        pass('client: explicit phone clear removes all three fields');
    } else {
        fail(
            'client: explicit phone clear removes all three fields',
            JSON.stringify(afterClear)
        );
    }

    // 5. Unrelated update: phone fields unchanged
    const untouchedClient = await User.create({
        firstName: 'Keep',
        lastName: 'Phone',
        email: `stale-client-keep-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainer._id,
        phone: '+201100450580',
        phoneCountryIso: 'EG',
        phoneCountryCode: '+20',
        primaryFitnessGoal: 'general_fitness',
    });
    createdIds.push(untouchedClient._id);

    const nameBody = joiOk(validateUpdateClient, { firstName: 'Kept' });
    await clientService.updateClient(
        untouchedClient._id.toString(),
        nameBody,
        trainer._id.toString()
    );
    const afterName = await User.findById(untouchedClient._id).lean();
    if (
        afterName?.firstName === 'Kept' &&
        afterName.phone === '+201100450580' &&
        afterName.phoneCountryIso === 'EG' &&
        afterName.phoneCountryCode === '+20'
    ) {
        pass('client: unrelated update leaves phone fields unchanged');
    } else {
        fail(
            'client: unrelated update leaves phone fields unchanged',
            JSON.stringify(afterName)
        );
    }

    // ------------------------------------------------------------------
    // auth.service.updateProfile
    // ------------------------------------------------------------------

    // 1. Structured → legacy-only
    const profileUser = await User.create({
        firstName: 'Prof',
        lastName: 'S2L',
        email: `stale-profile-s2l-${suffix}@test.com`,
        password,
        role: 'trainer',
        phone: '+201100450580',
        phoneCountryIso: 'EG',
        phoneCountryCode: '+20',
    });
    createdIds.push(profileUser._id);

    const profileLegacy = joiOk(validateUpdateProfile, { phone: '01100505801' });
    await authService.updateProfile(profileUser._id, profileLegacy);
    const profileAfterLegacy = await User.findById(profileUser._id).lean();
    if (
        profileAfterLegacy?.phone === '01100505801' &&
        countryFieldsCleared(profileAfterLegacy)
    ) {
        pass('auth: structured → legacy-only clears stale ISO/code');
    } else {
        fail(
            'auth: structured → legacy-only clears stale ISO/code',
            JSON.stringify(profileAfterLegacy)
        );
    }

    // 2. Legacy → structured
    const profileLegacyUser = await User.create({
        firstName: 'Prof',
        lastName: 'L2S',
        email: `stale-profile-l2s-${suffix}@test.com`,
        password,
        role: 'trainer',
        phone: '01100505801',
    });
    createdIds.push(profileLegacyUser._id);

    const profileStruct = joiOk(validateUpdateProfile, {
        phone: '01004500580',
        phoneCountryIso: 'EG',
    });
    await authService.updateProfile(profileLegacyUser._id, profileStruct);
    const profileAfterStruct = await User.findById(profileLegacyUser._id).lean();
    if (
        profileAfterStruct?.phone === '+201004500580' &&
        profileAfterStruct.phoneCountryIso === 'EG' &&
        profileAfterStruct.phoneCountryCode === '+20'
    ) {
        pass('auth: legacy → structured persists all three fields');
    } else {
        fail(
            'auth: legacy → structured persists all three fields',
            JSON.stringify(profileAfterStruct)
        );
    }

    // 3. Structured → structured
    const profileStructUser = await User.create({
        firstName: 'Prof',
        lastName: 'S2S',
        email: `stale-profile-s2s-${suffix}@test.com`,
        password,
        role: 'trainer',
        phone: '+201100450580',
        phoneCountryIso: 'EG',
        phoneCountryCode: '+20',
    });
    createdIds.push(profileStructUser._id);

    const profileUs = joiOk(validateUpdateProfile, {
        phone: '2025550199',
        phoneCountryIso: 'US',
    });
    await authService.updateProfile(profileStructUser._id, profileUs);
    const profileAfterUs = await User.findById(profileStructUser._id).lean();
    if (
        profileAfterUs?.phone === '+12025550199' &&
        profileAfterUs.phoneCountryIso === 'US' &&
        profileAfterUs.phoneCountryCode === '+1'
    ) {
        pass('auth: structured → structured updates all fields');
    } else {
        fail(
            'auth: structured → structured updates all fields',
            JSON.stringify(profileAfterUs)
        );
    }

    // 4. Explicit clear
    const profileClearUser = await User.create({
        firstName: 'Prof',
        lastName: 'Clear',
        email: `stale-profile-clear-${suffix}@test.com`,
        password,
        role: 'trainer',
        phone: '+201100450580',
        phoneCountryIso: 'EG',
        phoneCountryCode: '+20',
    });
    createdIds.push(profileClearUser._id);

    const profileClear = joiOk(validateUpdateProfile, { phone: '' });
    await authService.updateProfile(profileClearUser._id, profileClear);
    const profileAfterClear = await User.findById(profileClearUser._id).lean();
    if (
        (profileAfterClear?.phone == null ||
            !Object.prototype.hasOwnProperty.call(profileAfterClear, 'phone')) &&
        countryFieldsCleared(profileAfterClear)
    ) {
        pass('auth: explicit phone clear removes all three fields');
    } else {
        fail(
            'auth: explicit phone clear removes all three fields',
            JSON.stringify(profileAfterClear)
        );
    }

    // 5. Unrelated profile update
    const profileKeepUser = await User.create({
        firstName: 'Prof',
        lastName: 'Keep',
        email: `stale-profile-keep-${suffix}@test.com`,
        password,
        role: 'trainer',
        phone: '+201100450580',
        phoneCountryIso: 'EG',
        phoneCountryCode: '+20',
    });
    createdIds.push(profileKeepUser._id);

    const profileName = joiOk(validateUpdateProfile, { firstName: 'Kept' });
    await authService.updateProfile(profileKeepUser._id, profileName);
    const profileAfterName = await User.findById(profileKeepUser._id).lean();
    if (
        profileAfterName?.firstName === 'Kept' &&
        profileAfterName.phone === '+201100450580' &&
        profileAfterName.phoneCountryIso === 'EG' &&
        profileAfterName.phoneCountryCode === '+20'
    ) {
        pass('auth: unrelated update leaves phone fields unchanged');
    } else {
        fail(
            'auth: unrelated update leaves phone fields unchanged',
            JSON.stringify(profileAfterName)
        );
    }

    await User.deleteMany({ _id: { $in: createdIds } });
    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
