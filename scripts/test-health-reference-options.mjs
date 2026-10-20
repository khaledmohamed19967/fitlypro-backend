/**
 * Health reference catalog + ID-based client/nutrition profile tests.
 * Run: node scripts/test-health-reference-options.mjs
 * Requires: APP_DB_URL
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import User from '../src/modules/users/user.model.js';
import NutritionProfile from '../src/modules/nutrition-profiles/nutrition-profile.model.js';
import HealthReferenceOption from '../src/modules/health-reference/health-reference.model.js';
import healthReferenceService from '../src/modules/health-reference/health-reference.service.js';
import {
    dedupeObjectIdStrings,
    validateHealthOptionIdsForCategory,
} from '../src/modules/health-reference/health-reference.helpers.js';
import { HEALTH_REFERENCE_SEED_OPTIONS } from '../src/modules/health-reference/health-reference.seed-data.js';
import clientService from '../src/modules/clients/client.service.js';
import nutritionProfileService from '../src/modules/nutrition-profiles/nutrition-profile.service.js';
import { execSync } from 'node:child_process';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const upsertSeedOption = async (item) => {
    await HealthReferenceOption.findOneAndUpdate(
        { category: item.category, code: item.code },
        {
            $set: {
                label: item.label,
                sortOrder: item.sortOrder,
                status: 'active',
            },
            $setOnInsert: { category: item.category, code: item.code },
        },
        { upsert: true, new: true, runValidators: true }
    );
};

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    // --- Seed idempotency (in-process) ---
    const beforeCount = await HealthReferenceOption.countDocuments();
    for (const item of HEALTH_REFERENCE_SEED_OPTIONS) {
        await upsertSeedOption(item);
    }
    const afterFirst = await HealthReferenceOption.countDocuments();
    for (const item of HEALTH_REFERENCE_SEED_OPTIONS) {
        await upsertSeedOption(item);
    }
    const afterSecond = await HealthReferenceOption.countDocuments();
    if (afterFirst === afterSecond && afterFirst >= beforeCount) {
        pass('Reference catalog seed idempotency (count stable on re-upsert)');
    } else {
        fail(
            'Reference catalog seed idempotency (count stable on re-upsert)',
            `before=${beforeCount} first=${afterFirst} second=${afterSecond}`
        );
    }

    const peanut = await HealthReferenceOption.findOne({
        category: 'allergy',
        code: 'peanuts',
    });
    const shellfish = await HealthReferenceOption.findOne({
        category: 'allergy',
        code: 'shellfish',
    });
    const halal = await HealthReferenceOption.findOne({
        category: 'dietary_restriction',
        code: 'halal',
    });
    const leftKnee = await HealthReferenceOption.findOne({
        category: 'body_area',
        code: 'left_knee',
    });

    if (peanut && shellfish && halal && leftKnee) {
        pass('Seed options present (peanuts, shellfish, halal, left_knee)');
    } else {
        fail('Seed options present (peanuts, shellfish, halal, left_knee)', 'missing catalog rows');
    }

    // --- List service: category + ordering ---
    const allergies = await healthReferenceService.listHealthReferenceOptions({
        category: 'allergy',
    });
    const orders = allergies.map((o) => o.sortOrder ?? 0);
    const sorted = [...orders].sort((a, b) => a - b);
    if (
        allergies.length >= 2 &&
        allergies.every((o) => o.category === 'allergy') &&
        JSON.stringify(orders) === JSON.stringify(sorted)
    ) {
        pass('Category filter + deterministic sortOrder');
    } else {
        fail('Category filter + deterministic sortOrder', JSON.stringify(allergies.slice(0, 3)));
    }

    // --- Invalid category via service filter (simulates query validation outcome) ---
    try {
        await validateHealthOptionIdsForCategory({
            category: 'allergy',
            requestedIds: ['not-an-object-id'],
            existingIds: [],
            fieldName: 'allergyOptionIds',
        });
        fail('Malformed ObjectId rejected', 'expected throw');
    } catch (err) {
        if (err.statusCode === 400) pass('Malformed ObjectId rejected');
        else fail('Malformed ObjectId rejected', err.message);
    }

    // --- Cross-category rejection ---
    try {
        await validateHealthOptionIdsForCategory({
            category: 'allergy',
            requestedIds: [leftKnee._id.toString()],
            existingIds: [],
            fieldName: 'allergyOptionIds',
        });
        fail('Cross-category ID rejected', 'expected throw');
    } catch (err) {
        if (err.statusCode === 400) pass('Cross-category ID rejected');
        else fail('Cross-category ID rejected', err.message);
    }

    // --- Inactive option: new selection blocked ---
    const inactive = await HealthReferenceOption.create({
        category: 'allergy',
        code: `inactive_test_${suffix}`,
        label: 'Inactive Test',
        status: 'inactive',
        sortOrder: 9999,
    });
    try {
        await validateHealthOptionIdsForCategory({
            category: 'allergy',
            requestedIds: [inactive._id.toString()],
            existingIds: [],
            fieldName: 'allergyOptionIds',
        });
        fail('Inactive option blocked for new selection');
    } catch (err) {
        if (err.statusCode === 400) pass('Inactive option blocked for new selection');
        else fail('Inactive option blocked for new selection', err.message);
    }

    // --- Inactive retained when already saved ---
    await validateHealthOptionIdsForCategory({
        category: 'allergy',
        requestedIds: [inactive._id.toString()],
        existingIds: [inactive._id.toString()],
        fieldName: 'allergyOptionIds',
    });
    pass('Inactive option retained when already selected');

    // --- Duplicate IDs ---
    const dupList = [peanut._id.toString(), peanut._id.toString()];
    const deduped = dedupeObjectIdStrings(dupList);
    if (deduped.length === 1) {
        pass('Duplicate IDs deduped');
    } else {
        fail('Duplicate IDs deduped', `length=${deduped.length}`);
    }

    try {
        await validateHealthOptionIdsForCategory({
            category: 'allergy',
            requestedIds: dupList,
            existingIds: [],
            fieldName: 'allergyOptionIds',
        });
        fail('Duplicate IDs rejected at validation layer');
    } catch (err) {
        if (err.statusCode === 400) pass('Duplicate IDs rejected at validation layer');
        else fail('Duplicate IDs rejected at validation layer', err.message);
    }

    const trainerA = await User.create({
        firstName: 'Health',
        lastName: 'TrainerA',
        email: `health-trainer-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const trainerB = await User.create({
        firstName: 'Health',
        lastName: 'TrainerB',
        email: `health-trainer-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const created = await clientService.createClient(
        {
            firstName: 'Health',
            lastName: 'Client',
            email: `health-client-${suffix}@test.com`,
            password,
            primaryFitnessGoal: 'general_fitness',
            injuryAreaOptionIds: [leftKnee._id.toString()],
            injuryDetails: 'Avoid deep flexion',
            allergyOptionIds: [peanut._id.toString()],
            dietaryRestrictionOptionIds: [halal._id.toString()],
        },
        trainerA._id.toString()
    );

    if (
        created.injuryAreaOptions?.[0]?.code === 'left_knee' &&
        created.injuryDetails === 'Avoid deep flexion'
    ) {
        pass('Create client with body-area IDs + injuryDetails');
    } else {
        fail('Create client with body-area IDs + injuryDetails', JSON.stringify(created));
    }

    const profile = await NutritionProfile.findOne({ clientId: created.id });
    if (
        profile &&
        profile.allergyOptionIds.length === 1 &&
        profile.dietaryRestrictionOptionIds.length === 1
    ) {
        pass('Create client persists NutritionProfile option IDs');
    } else {
        fail('Create client persists NutritionProfile option IDs', JSON.stringify(profile));
    }

    const nutritionPublic = await nutritionProfileService.getNutritionProfile(
        created.id,
        trainerA._id.toString()
    );
    if (
        nutritionPublic?.allergyOptions?.[0]?.code === 'peanuts' &&
        nutritionPublic?.dietaryRestrictionOptions?.[0]?.code === 'halal'
    ) {
        pass('Nutrition profile read returns populated options');
    } else {
        fail('Nutrition profile read returns populated options', JSON.stringify(nutritionPublic));
    }

    try {
        await nutritionProfileService.getNutritionProfile(
            created.id,
            trainerB._id.toString()
        );
        fail('Trainer scoping denies foreign nutrition profile read');
    } catch (err) {
        if (err.statusCode === 403) pass('Trainer scoping denies foreign nutrition profile read');
        else fail('Trainer scoping denies foreign nutrition profile read', err.message);
    }

    const updated = await clientService.updateClient(
        created.id,
        { injuryAreaOptionIds: [leftKnee._id.toString()] },
        trainerA._id.toString()
    );
    if (updated.injuryAreaOptions?.length === 1) {
        pass('Update client body-area selections');
    } else {
        fail('Update client body-area selections', JSON.stringify(updated));
    }

    await nutritionProfileService.upsertNutritionProfile(
        created.id,
        {
            allergies: ['peanuts', 'custom legacy allergen'],
            allergyOptionIds: [peanut._id.toString(), shellfish._id.toString()],
        },
        trainerA._id.toString()
    );
    const afterUpsert = await nutritionProfileService.getNutritionProfile(
        created.id,
        trainerA._id.toString()
    );
    if (
        afterUpsert.allergies.includes('custom legacy allergen') &&
        afterUpsert.allergyOptions.length === 2 &&
        afterUpsert.unmappedAllergies.includes('custom legacy allergen')
    ) {
        pass('Legacy allergy strings preserved with ID selections');
    } else {
        fail(
            'Legacy allergy strings preserved with ID selections',
            JSON.stringify({
                allergies: afterUpsert.allergies,
                unmapped: afterUpsert.unmappedAllergies,
            })
        );
    }

    const unknownId = new mongoose.Types.ObjectId().toString();
    try {
        await clientService.updateClient(
            created.id,
            { injuryAreaOptionIds: [unknownId] },
            trainerA._id.toString()
        );
        fail('Unknown injury option ID rejected', 'expected throw');
    } catch (err) {
        const detail = err.errors?.[0]?.message || err.message;
        if (err.statusCode === 400 && /Unknown health reference option/.test(detail)) {
            pass('Unknown injury option ID rejected');
        } else {
            fail('Unknown injury option ID rejected', detail);
        }
    }

    try {
        await clientService.updateClient(
            created.id,
            { injuryAreaOptionIds: [peanut._id.toString()] },
            trainerA._id.toString()
        );
        fail('Cross-category injury option ID rejected', 'expected throw');
    } catch (err) {
        if (
            err.statusCode === 400 &&
            err.errors?.[0]?.message?.includes('is not a body_area reference')
        ) {
            pass('Cross-category injury option ID rejected');
        } else {
            fail(
                'Cross-category injury option ID rejected',
                err.errors?.[0]?.message || err.message
            );
        }
    }

    const inactiveBodyArea = await HealthReferenceOption.create({
        category: 'body_area',
        code: `inactive_knee_${suffix}`,
        label: 'Inactive Knee',
        status: 'inactive',
        sortOrder: 9998,
    });
    const inactiveAllergyNew = await HealthReferenceOption.create({
        category: 'allergy',
        code: `inactive_allergy_new_${suffix}`,
        label: 'Inactive Allergy New',
        status: 'inactive',
        sortOrder: 9997,
    });

    const inactiveClient = await clientService.createClient(
        {
            firstName: 'Health',
            lastName: 'Inactive',
            email: `health-client-inactive-${suffix}@test.com`,
            password,
            primaryFitnessGoal: 'general_fitness',
            additionalNotes: 'baseline',
        },
        trainerA._id.toString()
    );
    await User.updateOne(
        { _id: inactiveClient.id },
        { $set: { injuryAreaOptionIds: [inactiveBodyArea._id] } }
    );

    const afterUnrelated = await clientService.updateClient(
        inactiveClient.id,
        { additionalNotes: 'unrelated field update' },
        trainerA._id.toString()
    );
    if (
        afterUnrelated.additionalNotes === 'unrelated field update' &&
        afterUnrelated.injuryAreaOptionIds?.includes(inactiveBodyArea._id.toString())
    ) {
        pass('Unrelated client update retains previously saved inactive injury IDs');
    } else {
        fail(
            'Unrelated client update retains previously saved inactive injury IDs',
            JSON.stringify({
                notes: afterUnrelated.additionalNotes,
                ids: afterUnrelated.injuryAreaOptionIds,
            })
        );
    }

    const retainedInactive = await clientService.updateClient(
        inactiveClient.id,
        { injuryAreaOptionIds: [inactiveBodyArea._id.toString()] },
        trainerA._id.toString()
    );
    if (retainedInactive.injuryAreaOptionIds?.includes(inactiveBodyArea._id.toString())) {
        pass('Existing inactive injury selection can be retained on explicit update');
    } else {
        fail(
            'Existing inactive injury selection can be retained on explicit update',
            JSON.stringify(retainedInactive.injuryAreaOptionIds)
        );
    }

    try {
        await clientService.updateClient(
            inactiveClient.id,
            {
                injuryAreaOptionIds: [
                    inactiveBodyArea._id.toString(),
                    leftKnee._id.toString(),
                ],
            },
            trainerA._id.toString()
        );
        const mixedActive = await clientService.getClientById(
            inactiveClient.id,
            trainerA._id.toString()
        );
        if (
            mixedActive.injuryAreaOptionIds?.includes(inactiveBodyArea._id.toString()) &&
            mixedActive.injuryAreaOptionIds?.includes(leftKnee._id.toString())
        ) {
            pass('Retained inactive injury ID can be kept while adding a new active ID');
        } else {
            fail(
                'Retained inactive injury ID can be kept while adding a new active ID',
                JSON.stringify(mixedActive.injuryAreaOptionIds)
            );
        }
    } catch (err) {
        fail(
            'Retained inactive injury ID can be kept while adding a new active ID',
            err.message
        );
    }

    const extraInactiveBody = await HealthReferenceOption.create({
        category: 'body_area',
        code: `inactive_hip_${suffix}`,
        label: 'Inactive Hip',
        status: 'inactive',
        sortOrder: 9996,
    });
    try {
        await clientService.updateClient(
            inactiveClient.id,
            {
                injuryAreaOptionIds: [
                    inactiveBodyArea._id.toString(),
                    extraInactiveBody._id.toString(),
                ],
            },
            trainerA._id.toString()
        );
        fail('New inactive injury ID rejected while retaining existing inactive', 'expected throw');
    } catch (err) {
        if (
            err.statusCode === 400 &&
            /inactive and cannot be newly selected/.test(
                err.errors?.[0]?.message || err.message
            )
        ) {
            pass('New inactive injury ID rejected while retaining existing inactive');
        } else {
            fail(
                'New inactive injury ID rejected while retaining existing inactive',
                err.errors?.[0]?.message || err.message
            );
        }
    }

    await NutritionProfile.updateOne(
        { clientId: created.id },
        {
            $set: {
                allergyOptionIds: [peanut._id, inactive._id],
            },
        }
    );
    const notesOnly = await nutritionProfileService.upsertNutritionProfile(
        created.id,
        { notes: 'unrelated nutrition notes' },
        trainerA._id.toString()
    );
    if (
        notesOnly.notes === 'unrelated nutrition notes' &&
        notesOnly.allergyOptionIds.includes(inactive._id.toString())
    ) {
        pass('Unrelated nutrition-profile update retains previously saved inactive allergy IDs');
    } else {
        fail(
            'Unrelated nutrition-profile update retains previously saved inactive allergy IDs',
            JSON.stringify({
                notes: notesOnly.notes,
                ids: notesOnly.allergyOptionIds,
            })
        );
    }

    const retainInactiveAllergy = await nutritionProfileService.upsertNutritionProfile(
        created.id,
        { allergyOptionIds: [inactive._id.toString(), peanut._id.toString()] },
        trainerA._id.toString()
    );
    if (
        retainInactiveAllergy.allergyOptionIds.includes(inactive._id.toString()) &&
        retainInactiveAllergy.allergyOptionIds.includes(peanut._id.toString())
    ) {
        pass('Existing inactive allergy selection can be retained on explicit update');
    } else {
        fail(
            'Existing inactive allergy selection can be retained on explicit update',
            JSON.stringify(retainInactiveAllergy.allergyOptionIds)
        );
    }

    try {
        await nutritionProfileService.upsertNutritionProfile(
            created.id,
            {
                allergyOptionIds: [
                    inactive._id.toString(),
                    inactiveAllergyNew._id.toString(),
                ],
            },
            trainerA._id.toString()
        );
        fail('New inactive allergy ID rejected while retaining existing inactive', 'expected throw');
    } catch (err) {
        if (
            err.statusCode === 400 &&
            /inactive and cannot be newly selected/.test(
                err.errors?.[0]?.message || err.message
            )
        ) {
            pass('New inactive allergy ID rejected while retaining existing inactive');
        } else {
            fail(
                'New inactive allergy ID rejected while retaining existing inactive',
                err.errors?.[0]?.message || err.message
            );
        }
    }

    const legacyEmail = `health-client-legacy-${suffix}@test.com`;
    const legacyCreated = await clientService.createClient(
        {
            firstName: 'Health',
            lastName: 'LegacyCreate',
            email: legacyEmail,
            password,
            primaryFitnessGoal: 'general_fitness',
            injuries: 'legacy knee narrative',
        },
        trainerA._id.toString()
    );
    const legacyProfile = await NutritionProfile.findOne({ clientId: legacyCreated.id });
    if (!legacyProfile && legacyCreated.injuries === 'legacy knee narrative') {
        pass('Create client without nutrition option IDs skips NutritionProfile');
    } else {
        fail(
            'Create client without nutrition option IDs skips NutritionProfile',
            JSON.stringify({ profile: legacyProfile, injuries: legacyCreated.injuries })
        );
    }

    await NutritionProfile.create({
        clientId: legacyCreated.id,
        trainerId: trainerA._id,
        allergies: ['peanuts', 'unmatched-custom-xyz'],
        allergyOptionIds: [],
        dietaryRestrictions: [],
        dietaryRestrictionOptionIds: [],
        foodPreferences: [],
    });

    const invalidCreateEmail = `health-client-invalid-${suffix}@test.com`;
    try {
        await clientService.createClient(
            {
                firstName: 'Health',
                lastName: 'InvalidIds',
                email: invalidCreateEmail,
                password,
                primaryFitnessGoal: 'general_fitness',
                allergyOptionIds: ['not-an-object-id'],
            },
            trainerA._id.toString()
        );
        fail('Invalid nutrition option IDs fail before User create', 'expected throw');
    } catch (err) {
        const leftoverInvalid = await User.findOne({ email: invalidCreateEmail });
        if (err.statusCode === 400 && !leftoverInvalid) {
            pass('Invalid nutrition option IDs fail before User create');
        } else {
            fail(
                'Invalid nutrition option IDs fail before User create',
                JSON.stringify({
                    message: err.message,
                    leftover: Boolean(leftoverInvalid),
                })
            );
        }
    }

    const rollbackEmail = `health-client-rollback-${suffix}@test.com`;
    const origCreateProfile = nutritionProfileService.createNutritionProfileForNewClient;
    nutritionProfileService.createNutritionProfileForNewClient = async (
        clientId,
        trainerId
    ) => {
        await NutritionProfile.create({
            clientId,
            trainerId,
            allergies: ['rollback-orphan'],
            allergyOptionIds: [],
            dietaryRestrictions: [],
            dietaryRestrictionOptionIds: [],
            foodPreferences: [],
        });
        throw new Error('simulated nutrition profile failure after insert');
    };
    try {
        await clientService.createClient(
            {
                firstName: 'Health',
                lastName: 'Rollback',
                email: rollbackEmail,
                password,
                primaryFitnessGoal: 'general_fitness',
                allergyOptionIds: [peanut._id.toString()],
            },
            trainerA._id.toString()
        );
        fail('NutritionProfile create failure rolls back User', 'expected throw');
    } catch (err) {
        const leftoverUser = await User.findOne({ email: rollbackEmail });
        const leftoverProfiles = leftoverUser
            ? await NutritionProfile.countDocuments({ clientId: leftoverUser._id })
            : await NutritionProfile.countDocuments({ allergies: 'rollback-orphan' });
        if (
            /simulated nutrition profile failure after insert/.test(err.message) &&
            !leftoverUser &&
            leftoverProfiles === 0
        ) {
            pass('NutritionProfile create failure rolls back User and related profile');
        } else {
            fail(
                'NutritionProfile create failure rolls back User and related profile',
                JSON.stringify({
                    message: err.message,
                    leftoverUser: Boolean(leftoverUser),
                    leftoverProfiles,
                })
            );
        }
    } finally {
        nutritionProfileService.createNutritionProfileForNewClient = origCreateProfile;
        await User.deleteMany({ email: rollbackEmail });
        await NutritionProfile.deleteMany({ allergies: 'rollback-orphan' });
    }

    const rollbackFailEmail = `health-client-rollback-fail-${suffix}@test.com`;
    const origDelete = User.findByIdAndDelete.bind(User);
    nutritionProfileService.createNutritionProfileForNewClient = async () => {
        throw new Error('simulated nutrition profile failure');
    };
    User.findByIdAndDelete = async () => {
        throw new Error('simulated rollback failure');
    };
    try {
        await clientService.createClient(
            {
                firstName: 'Health',
                lastName: 'RollbackFail',
                email: rollbackFailEmail,
                password,
                primaryFitnessGoal: 'general_fitness',
                allergyOptionIds: [peanut._id.toString()],
            },
            trainerA._id.toString()
        );
        fail('Rollback failure is surfaced with original error', 'expected throw');
    } catch (err) {
        if (
            err.statusCode === 500 &&
            /Client creation failed/.test(err.message) &&
            /simulated nutrition profile failure/.test(err.message) &&
            /rollback failed/.test(err.message) &&
            /simulated rollback failure/.test(err.message)
        ) {
            pass('Rollback failure is surfaced with original error');
        } else {
            fail('Rollback failure is surfaced with original error', err.message);
        }
    } finally {
        User.findByIdAndDelete = origDelete;
        nutritionProfileService.createNutritionProfileForNewClient = origCreateProfile;
        const leftover = await User.findOne({ email: rollbackFailEmail });
        if (leftover) {
            await NutritionProfile.deleteMany({ clientId: leftover._id });
            await User.deleteOne({ _id: leftover._id });
        }
    }

    // --- Migration dry-run (script) ---
    const beforeDry = await NutritionProfile.findOne({ clientId: legacyCreated.id }).lean();
    try {
        const dryOut = execSync('node scripts/migrate-health-option-ids.mjs --dry-run', {
            stdio: 'pipe',
            encoding: 'utf8',
            cwd: backendRoot,
        });
        const jsonStart = dryOut.indexOf('{');
        const report = JSON.parse(jsonStart >= 0 ? dryOut.slice(jsonStart) : dryOut);
        const afterDry = await NutritionProfile.findOne({
            clientId: legacyCreated.id,
        }).lean();
        const idsUnchanged =
            JSON.stringify((beforeDry.allergyOptionIds ?? []).map(String)) ===
            JSON.stringify((afterDry.allergyOptionIds ?? []).map(String));
        const stringsPreserved =
            JSON.stringify(afterDry.allergies) === JSON.stringify(beforeDry.allergies);
        const unmatchedReported = (report.unmatched ?? []).some(
            (row) => row.value === 'unmatched-custom-xyz'
        );
        const matchedReported = (report.matched ?? []).some(
            (row) => row.value === 'peanuts' && row.field === 'allergies'
        );
        if (
            report.dryRun === true &&
            idsUnchanged &&
            stringsPreserved &&
            unmatchedReported &&
            matchedReported
        ) {
            pass('Migration dry-run writes nothing and reports unmatched/matched values');
        } else {
            fail(
                'Migration dry-run writes nothing and reports unmatched/matched values',
                JSON.stringify({
                    dryRun: report.dryRun,
                    idsUnchanged,
                    stringsPreserved,
                    unmatchedReported,
                    matchedReported,
                })
            );
        }
    } catch (err) {
        fail(
            'Migration dry-run writes nothing and reports unmatched/matched values',
            err.stderr || err.message
        );
    }

    const API = `${process.env.API_URL || 'http://localhost:8000'}/api/v1`;
    const httpRequest = async (method, path, { token, body } = {}) => {
        const headers = {};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${API}${path}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        return { status: res.status, json };
    };

    let httpAvailable = false;
    try {
        const health = await fetch(`${API}/health`);
        httpAvailable = health.ok;
    } catch {
        httpAvailable = false;
    }

    if (!httpAvailable) {
        fail(
            'HTTP integration available',
            `No API at ${API}. Start the backend (npm run dev) against the same APP_DB_URL.`
        );
    } else {
        pass('HTTP integration available');

        const unauthCatalog = await httpRequest('GET', '/health-reference-options');
        if (unauthCatalog.status === 401) {
            pass('GET /health-reference-options requires auth');
        } else {
            fail(
                'GET /health-reference-options requires auth',
                JSON.stringify({ status: unauthCatalog.status })
            );
        }

        const loginA = await httpRequest('POST', '/auth/login', {
            body: { email: trainerA.email, password },
        });
        const loginB = await httpRequest('POST', '/auth/login', {
            body: { email: trainerB.email, password },
        });
        const tokenA = loginA.json?.data?.token;
        const tokenB = loginB.json?.data?.token;
        const clientLogin = await httpRequest('POST', '/auth/login', {
            body: { email: `health-client-${suffix}@test.com`, password },
        });
        const clientToken = clientLogin.json?.data?.token;

        if (!tokenA || !tokenB) {
            fail('HTTP trainer login', JSON.stringify(loginA.json));
        } else {
            const catalog = await httpRequest('GET', '/health-reference-options?category=allergy', {
                token: tokenA,
            });
            const catalogOptions = catalog.json?.data?.options ?? [];
            const catalogShapeOk =
                catalog.status === 200 &&
                catalogOptions.length > 0 &&
                catalogOptions.every(
                    (o) => o.id && o.code && o.label && o.category === 'allergy' && o.status == null
                );
            if (catalogShapeOk) {
                pass('GET /health-reference-options returns active options by category');
            } else {
                fail(
                    'GET /health-reference-options returns active options by category',
                    JSON.stringify({ status: catalog.status, sample: catalogOptions[0] })
                );
            }

            const badCategory = await httpRequest(
                'GET',
                '/health-reference-options?category=not_a_category',
                { token: tokenA }
            );
            if (badCategory.status === 400) {
                pass('GET /health-reference-options rejects invalid category');
            } else {
                fail(
                    'GET /health-reference-options rejects invalid category',
                    JSON.stringify({ status: badCategory.status, body: badCategory.json })
                );
            }

            if (clientToken) {
                const clientCatalog = await httpRequest('GET', '/health-reference-options', {
                    token: clientToken,
                });
                if (clientCatalog.status === 403) {
                    pass('GET /health-reference-options forbids client role');
                } else {
                    fail(
                        'GET /health-reference-options forbids client role',
                        JSON.stringify({ status: clientCatalog.status })
                    );
                }
            } else {
                fail('GET /health-reference-options forbids client role', 'client login failed');
            }

            const httpCreateEmail = `health-client-http-${suffix}@test.com`;
            const httpCreate = await httpRequest('POST', '/clients', {
                token: tokenA,
                body: {
                    firstName: 'Health',
                    lastName: 'Http',
                    email: httpCreateEmail,
                    password,
                    primaryFitnessGoal: 'general_fitness',
                    injuryAreaOptionIds: [leftKnee._id.toString()],
                    injuryDetails: 'HTTP create details',
                    allergyOptionIds: [peanut._id.toString()],
                    dietaryRestrictionOptionIds: [halal._id.toString()],
                    injuries: 'legacy injuries string',
                },
            });
            const httpClient = httpCreate.json?.data;
            if (
                httpCreate.status === 201 &&
                httpClient?.injuryAreaOptions?.[0]?.code === 'left_knee' &&
                httpClient?.injuries === 'legacy injuries string' &&
                httpClient?.nutritionProfile == null
            ) {
                pass('POST /clients accepts option IDs and keeps legacy injuries');
            } else {
                fail(
                    'POST /clients accepts option IDs and keeps legacy injuries',
                    JSON.stringify({ status: httpCreate.status, body: httpCreate.json })
                );
            }

            if (httpClient?.id) {
                const httpGet = await httpRequest('GET', `/clients/${httpClient.id}`, {
                    token: tokenA,
                });
                const httpGetData = httpGet.json?.data;
                if (
                    httpGet.status === 200 &&
                    Array.isArray(httpGetData?.injuryAreaOptions) &&
                    httpGetData.injuryAreaOptions[0]?.label
                ) {
                    pass('GET /clients/:id returns populated injuryAreaOptions');
                } else {
                    fail(
                        'GET /clients/:id returns populated injuryAreaOptions',
                        JSON.stringify({ status: httpGet.status, body: httpGet.json })
                    );
                }

                const foreignGet = await httpRequest('GET', `/clients/${httpClient.id}`, {
                    token: tokenB,
                });
                if (foreignGet.status === 403) {
                    pass('GET /clients/:id forbids other trainers');
                } else {
                    fail(
                        'GET /clients/:id forbids other trainers',
                        JSON.stringify({ status: foreignGet.status })
                    );
                }

                const list = await httpRequest('GET', '/clients?limit=50', { token: tokenA });
                const listRow = (list.json?.data?.clients ?? []).find(
                    (row) => String(row.id) === String(httpClient.id)
                );
                if (
                    list.status === 200 &&
                    listRow &&
                    Array.isArray(listRow.injuryAreaOptionIds) &&
                    listRow.injuryAreaOptions === undefined
                ) {
                    pass('GET /clients list returns injuryAreaOptionIds without injuryAreaOptions');
                } else {
                    fail(
                        'GET /clients list returns injuryAreaOptionIds without injuryAreaOptions',
                        JSON.stringify({
                            status: list.status,
                            ids: listRow?.injuryAreaOptionIds,
                            options: listRow?.injuryAreaOptions,
                        })
                    );
                }

                const nutritionGet = await httpRequest(
                    'GET',
                    `/clients/${httpClient.id}/nutrition-profile`,
                    { token: tokenA }
                );
                const nutrition = nutritionGet.json?.data?.nutritionProfile;
                if (
                    nutritionGet.status === 200 &&
                    nutrition?.allergyOptions?.[0]?.code === 'peanuts' &&
                    nutrition?.dietaryRestrictionOptions?.[0]?.code === 'halal' &&
                    Array.isArray(nutrition.allergies)
                ) {
                    pass('GET /clients/:id/nutrition-profile returns populated option objects');
                } else {
                    fail(
                        'GET /clients/:id/nutrition-profile returns populated option objects',
                        JSON.stringify({ status: nutritionGet.status, body: nutritionGet.json })
                    );
                }

                const nutritionPut = await httpRequest(
                    'PUT',
                    `/clients/${httpClient.id}/nutrition-profile`,
                    {
                        token: tokenA,
                        body: {
                            allergies: ['peanuts', 'custom http allergen'],
                            allergyOptionIds: [peanut._id.toString(), shellfish._id.toString()],
                        },
                    }
                );
                const afterPut = nutritionPut.json?.data?.nutritionProfile;
                if (
                    nutritionPut.status === 200 &&
                    afterPut?.allergies?.includes('custom http allergen') &&
                    afterPut?.unmappedAllergies?.includes('custom http allergen') &&
                    afterPut?.allergyOptions?.length === 2
                ) {
                    pass('PUT /clients/:id/nutrition-profile keeps legacy strings with option IDs');
                } else {
                    fail(
                        'PUT /clients/:id/nutrition-profile keeps legacy strings with option IDs',
                        JSON.stringify({ status: nutritionPut.status, body: nutritionPut.json })
                    );
                }

                const badPut = await httpRequest('PUT', `/clients/${httpClient.id}`, {
                    token: tokenA,
                    body: { injuryAreaOptionIds: [peanut._id.toString()] },
                });
                if (badPut.status === 400) {
                    pass('PUT /clients/:id rejects cross-category injury IDs');
                } else {
                    fail(
                        'PUT /clients/:id rejects cross-category injury IDs',
                        JSON.stringify({ status: badPut.status, body: badPut.json })
                    );
                }

                await NutritionProfile.deleteMany({ clientId: httpClient.id });
                await User.deleteMany({ email: httpCreateEmail });
            }
        }
    }

    // Cleanup test-specific rows
    await HealthReferenceOption.deleteMany({
        _id: {
            $in: [
                inactive._id,
                inactiveBodyArea._id,
                inactiveAllergyNew._id,
                extraInactiveBody._id,
            ],
        },
    });
    await NutritionProfile.deleteMany({
        clientId: {
            $in: [created.id, inactiveClient.id, legacyCreated.id],
        },
    });
    await User.deleteMany({
        email: {
            $in: [
                trainerA.email,
                trainerB.email,
                `health-client-${suffix}@test.com`,
                `health-client-inactive-${suffix}@test.com`,
                invalidCreateEmail,
                legacyEmail,
                rollbackEmail,
                rollbackFailEmail,
                `health-client-http-${suffix}@test.com`,
            ],
        },
    });

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
