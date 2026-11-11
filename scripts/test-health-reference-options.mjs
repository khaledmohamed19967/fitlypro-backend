/**
 * Health reference catalog + ID-based client/nutrition profile tests.
 * Run: node scripts/test-health-reference-options.mjs
 * Requires: APP_DB_URL
 */
import 'dotenv/config';
import mongoose from 'mongoose';
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

    // --- Migration dry-run (script) ---
    try {
        execSync('node scripts/migrate-health-option-ids.mjs --dry-run', {
            stdio: 'pipe',
            encoding: 'utf8',
        });
        pass('Migration script dry-run executes');
    } catch (err) {
        fail('Migration script dry-run executes', err.stderr || err.message);
    }

    // Cleanup test-specific inactive row
    await HealthReferenceOption.deleteOne({ _id: inactive._id });
    await NutritionProfile.deleteMany({ clientId: created.id });
    await User.deleteMany({
        email: {
            $in: [
                trainerA.email,
                trainerB.email,
                `health-client-${suffix}@test.com`,
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
