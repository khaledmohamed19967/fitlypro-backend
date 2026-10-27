/**
 * Legacy health string + option-id regression (service layer).
 * Run: node scripts/test-client-legacy-health-regression.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import NutritionProfile from '../src/modules/nutrition-profiles/nutrition-profile.model.js';
import HealthReferenceOption from '../src/modules/health-reference/health-reference.model.js';
import clientService from '../src/modules/clients/client.service.js';
import nutritionProfileService from '../src/modules/nutrition-profiles/nutrition-profile.service.js';

const results = [];
const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

async function main() {
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const password = 'testpass123';

    const trainer = await User.create({
        firstName: 'Legacy',
        lastName: 'Trainer',
        email: `legacy-tr-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const milk = await HealthReferenceOption.findOne({
        category: 'allergy',
        code: 'milk',
        status: 'active',
    });
    const neck = await HealthReferenceOption.findOne({
        category: 'body_area',
        code: 'neck',
        status: 'active',
    });
    if (!milk || !neck) {
        throw new Error('Seed health reference (milk, neck) required');
    }

    const created = await clientService.createClient(
        {
            firstName: 'Legacy',
            lastName: 'Client',
            email: `legacy-client-${suffix}@test.com`,
            password,
            primaryFitnessGoal: 'general_fitness',
        },
        trainer._id.toString()
    );

    await User.updateOne(
        { _id: created.id },
        {
            $set: {
                injuries: 'Neck, Shoulder, Upper back',
                injuryAreaOptionIds: [],
                injuryDetails: null,
            },
        }
    );

    await NutritionProfile.create({
        clientId: created.id,
        trainerId: trainer._id,
        allergies: ['Milk', 'Eggs', 'Peanuts'],
        allergyOptionIds: [],
        dietaryRestrictions: [],
        dietaryRestrictionOptionIds: [],
        foodPreferences: [],
    });

    const phoneOnly = await clientService.updateClient(
        created.id,
        { phone: '5551234567' },
        trainer._id.toString()
    );
    const npAfterPhone = await nutritionProfileService.getNutritionProfile(
        created.id,
        trainer._id.toString()
    );
    const userAfterPhone = await User.findById(created.id).lean();
    if (
        phoneOnly.phone === '5551234567' &&
        npAfterPhone?.allergies?.length === 3 &&
        userAfterPhone.injuries?.includes('Neck')
    ) {
        pass('1. Phone-only update preserves legacy injuries and allergies');
    } else {
        fail('1. Phone-only update preserves legacy injuries and allergies', JSON.stringify({
            phone: phoneOnly.phone,
            allergies: npAfterPhone?.allergies,
            injuries: userAfterPhone?.injuries,
        }));
    }

    await clientService.updateClient(
        created.id,
        {
            allergyOptionIds: [milk._id.toString()],
            allergies: [],
        },
        trainer._id.toString()
    );
    const npSynced = await nutritionProfileService.getNutritionProfile(
        created.id,
        trainer._id.toString()
    );
    if (
        npSynced?.allergyOptionIds?.length === 1 &&
        npSynced.allergies?.length === 0
    ) {
        pass('2. Option ids + empty allergies array clears legacy allergy strings');
    } else {
        fail('2. Option ids + empty allergies array clears legacy allergy strings', JSON.stringify(npSynced));
    }

    await clientService.updateClient(
        created.id,
        {
            injuryAreaOptionIds: [neck._id.toString()],
            injuryDetails: 'Shoulder',
            injuries: null,
        },
        trainer._id.toString()
    );
    const afterInjury = await clientService.getClientById(
        created.id,
        trainer._id.toString()
    );
    const userAfterInjury = await User.findById(created.id).lean();
    if (
        afterInjury.injuryAreaOptionIds?.includes(neck._id.toString()) &&
        afterInjury.injuryDetails === 'Shoulder' &&
        (userAfterInjury.injuries == null || userAfterInjury.injuries === '')
    ) {
        pass('3. Injury ids + details persist; legacy injuries string cleared');
    } else {
        fail('3. Injury ids + details persist; legacy injuries string cleared', JSON.stringify({
            ids: afterInjury.injuryAreaOptionIds,
            details: afterInjury.injuryDetails,
            injuries: userAfterInjury.injuries,
        }));
    }

    await User.deleteOne({ _id: trainer._id });
    await User.deleteOne({ _id: created.id });
    await NutritionProfile.deleteMany({ clientId: created.id });

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(
        `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
    );
    await mongoose.disconnect();
    process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
