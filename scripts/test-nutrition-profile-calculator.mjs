/**
 * Nutrition Profile + Calculator API integration tests.
 * Run: node scripts/test-nutrition-profile-calculator.mjs
 * Requires: API server running + APP_DB_URL
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import NutritionProfile from '../src/modules/nutrition-profiles/nutrition-profile.model.js';
import NutritionRecommendation from '../src/modules/nutrition-calculator/nutrition-recommendation.model.js';

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

async function request(method, path, { token, body } = {}) {
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
}

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Nutri',
        lastName: 'Alpha',
        email: `nutri-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const trainerB = await User.create({
        firstName: 'Nutri',
        lastName: 'Beta',
        email: `nutri-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 30);

    const clientA = await User.create({
        firstName: 'Client',
        lastName: 'One',
        email: `nutri-client-a-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
        gender: 'male',
        dateOfBirth: dob,
        height: 180,
        currentWeight: 80,
    });

    const clientB = await User.create({
        firstName: 'Client',
        lastName: 'Two',
        email: `nutri-client-b-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerB._id,
        gender: 'female',
        dateOfBirth: dob,
        height: 165,
        currentWeight: 65,
    });

    const incompleteClient = await User.create({
        firstName: 'Client',
        lastName: 'Incomplete',
        email: `nutri-client-inc-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
        gender: 'male',
        // missing height, weight, DOB
    });

    const loginA = await request('POST', '/auth/login', {
        body: { email: trainerA.email, password },
    });
    const loginB = await request('POST', '/auth/login', {
        body: { email: trainerB.email, password },
    });
    const tokenA = loginA.json?.data?.token;
    const tokenB = loginB.json?.data?.token;

    if (!tokenA || !tokenB) {
        throw new Error('Failed to login test trainers');
    }

    const clientId = clientA._id.toString();

    // --- Profile ---
    const getEmpty = await request('GET', `/clients/${clientId}/nutrition-profile`, {
        token: tokenA,
    });
    if (getEmpty.status === 200 && getEmpty.json?.data?.nutritionProfile == null) {
        pass('Read profile — empty returns null');
    } else {
        fail('Read profile — empty returns null', JSON.stringify(getEmpty.json));
    }

    const createProfile = await request('PUT', `/clients/${clientId}/nutrition-profile`, {
        token: tokenA,
        body: {
            activityLevel: 'moderately_active',
            allergies: ['peanuts'],
            dietaryRestrictions: ['halal'],
            foodPreferences: ['high protein'],
            notes: 'Prefers whole foods',
        },
    });
    const profile = createProfile.json?.data?.nutritionProfile;
    if (
        createProfile.status === 200 &&
        profile?.activityLevel === 'moderately_active' &&
        profile?.allergies?.includes('peanuts')
    ) {
        pass('Create nutrition profile');
    } else {
        fail('Create nutrition profile', JSON.stringify(createProfile.json));
    }

    const updateProfile = await request('PUT', `/clients/${clientId}/nutrition-profile`, {
        token: tokenA,
        body: { activityLevel: 'very_active', allergies: ['peanuts', 'shellfish'] },
    });
    if (
        updateProfile.status === 200 &&
        updateProfile.json?.data?.nutritionProfile?.activityLevel === 'very_active' &&
        updateProfile.json?.data?.nutritionProfile?.allergies?.length === 2
    ) {
        pass('Update nutrition profile');
    } else {
        fail('Update nutrition profile', JSON.stringify(updateProfile.json));
    }

    const profileCount = await NutritionProfile.countDocuments({ clientId: clientA._id });
    if (profileCount === 1) pass('No duplicate profile for same client');
    else fail('No duplicate profile for same client', `count=${profileCount}`);

    const forbiddenBody = await request('PUT', `/clients/${clientId}/nutrition-profile`, {
        token: tokenA,
        body: { heightCm: 170, currentWeight: 70 },
    });
    // stripUnknown removes forbidden fields → empty payload → 400
    if (forbiddenBody.status === 400) {
        pass('Profile rejects body-metric fields (no duplicate SoT)');
    } else {
        fail('Profile rejects body-metric fields (no duplicate SoT)', JSON.stringify(forbiddenBody.json));
    }

    const foreignProfile = await request(
        'GET',
        `/clients/${clientB._id}/nutrition-profile`,
        { token: tokenA }
    );
    if (foreignProfile.status === 403) pass('Foreign client profile denied');
    else fail('Foreign client profile denied', `status ${foreignProfile.status}`);

    // --- Calculate ---
    const calc = await request(
        'POST',
        `/clients/${clientId}/nutrition-calculator/calculate`,
        {
            token: tokenA,
            body: { goal: 'muscle_gain' },
        }
    );
    const rec = calc.json?.data?.recommendation;
    if (
        calc.status === 200 &&
        rec?.results?.bmr === 1780 &&
        calc.json?.data?.sources?.weightKg === 'client.currentWeight' &&
        calc.json?.data?.sources?.heightCm === 'client.height'
    ) {
        pass('Calculate uses client height/weight source of truth');
    } else {
        fail('Calculate uses client height/weight source of truth', JSON.stringify(calc.json));
    }

    if (rec?.inputs?.activityLevel === 'very_active') {
        pass('Calculate uses profile activityLevel');
    } else {
        fail('Calculate uses profile activityLevel', rec?.inputs?.activityLevel);
    }

    const calcMissing = await request(
        'POST',
        `/clients/${incompleteClient._id}/nutrition-calculator/calculate`,
        {
            token: tokenA,
            body: { goal: 'maintenance', activityLevel: 'sedentary', age: 30 },
        }
    );
    if (calcMissing.status === 400) pass('Missing client measurements rejected');
    else fail('Missing client measurements rejected', JSON.stringify(calcMissing.json));

    const calcBadGoal = await request(
        'POST',
        `/clients/${clientId}/nutrition-calculator/calculate`,
        {
            token: tokenA,
            body: { goal: 'not_a_goal' },
        }
    );
    if (calcBadGoal.status === 400) pass('Invalid goal rejected via API');
    else fail('Invalid goal rejected via API', `status ${calcBadGoal.status}`);

    const calcForeign = await request(
        'POST',
        `/clients/${clientB._id}/nutrition-calculator/calculate`,
        {
            token: tokenA,
            body: { goal: 'maintenance' },
        }
    );
    if (calcForeign.status === 403) pass('Foreign client calculate denied');
    else fail('Foreign client calculate denied', `status ${calcForeign.status}`);

    // --- Snapshot ---
    const saveRec = await request(
        'POST',
        `/clients/${clientId}/nutrition-recommendations`,
        {
            token: tokenA,
            body: {
                goal: 'weight_loss',
                status: 'approved',
                finalCalories: 2100,
                notes: 'Coach adjusted slightly',
            },
        }
    );
    const saved = saveRec.json?.data?.nutritionRecommendation;
    if (
        saveRec.status === 201 &&
        saved?.status === 'approved' &&
        saved?.inputs?.weightKg === 80 &&
        saved?.inputs?.heightCm === 180 &&
        saved?.results?.recommendedCalories > 0 &&
        saved?.finalCalories === 2100
    ) {
        pass('Save recommendation snapshot preserves inputs/outputs');
    } else {
        fail('Save recommendation snapshot preserves inputs/outputs', JSON.stringify(saveRec.json));
    }

    const listRec = await request(
        'GET',
        `/clients/${clientId}/nutrition-recommendations`,
        { token: tokenA }
    );
    if (
        listRec.status === 200 &&
        (listRec.json?.data?.nutritionRecommendations?.length ?? 0) >= 1
    ) {
        pass('List recommendation snapshots');
    } else {
        fail('List recommendation snapshots', JSON.stringify(listRec.json));
    }

    const getRec = await request(
        'GET',
        `/clients/${clientId}/nutrition-recommendations/${saved.id}`,
        { token: tokenA }
    );
    if (getRec.status === 200 && getRec.json?.data?.nutritionRecommendation?.id === saved.id) {
        pass('Get recommendation by id');
    } else {
        fail('Get recommendation by id', JSON.stringify(getRec.json));
    }

    const patchRec = await request(
        'PATCH',
        `/clients/${clientId}/nutrition-recommendations/${saved.id}`,
        {
            token: tokenA,
            body: {
                finalMacros: { proteinG: 160, carbsG: 180, fatG: 60 },
            },
        }
    );
    if (
        patchRec.status === 200 &&
        patchRec.json?.data?.nutritionRecommendation?.finalMacros?.proteinG === 160
    ) {
        pass('Update recommendation coach overrides');
    } else {
        fail('Update recommendation coach overrides', JSON.stringify(patchRec.json));
    }

    // --- Plan Prefill ---
    const prefill = await request(
        'GET',
        `/clients/${clientId}/nutrition-recommendations/${saved.id}/plan-prefill`,
        { token: tokenA }
    );
    const pf = prefill.json?.data?.planPrefill;
    if (
        prefill.status === 200 &&
        pf?.goal === 'weight_loss' &&
        pf?.macroTargets?.calories === 2100 &&
        pf?.macroTargets?.protein === 160 &&
        pf?.macroTargets?.carbs === 180 &&
        pf?.macroTargets?.fat === 60 &&
        pf?.source?.usedFinalCalories === true &&
        pf?.source?.usedFinalMacros === true
    ) {
        pass('Approved recommendation plan-prefill (finals preferred)');
    } else {
        fail('Approved recommendation plan-prefill (finals preferred)', JSON.stringify(prefill.json));
    }

    const calcOnlyRec = await request(
        'POST',
        `/clients/${clientId}/nutrition-recommendations`,
        {
            token: tokenA,
            body: { goal: 'maintenance', status: 'calculated' },
        }
    );
    const calcOnlyId = calcOnlyRec.json?.data?.nutritionRecommendation?.id;
    const prefillDraft = await request(
        'GET',
        `/clients/${clientId}/nutrition-recommendations/${calcOnlyId}/plan-prefill`,
        { token: tokenA }
    );
    if (prefillDraft.status === 400) {
        pass('Unapproved recommendation plan-prefill rejected');
    } else {
        fail('Unapproved recommendation plan-prefill rejected', JSON.stringify(prefillDraft.json));
    }

    const prefillForeignClient = await request(
        'GET',
        `/clients/${clientB._id}/nutrition-recommendations/${saved.id}/plan-prefill`,
        { token: tokenA }
    );
    if (prefillForeignClient.status === 403 || prefillForeignClient.status === 404) {
        pass('Plan-prefill rejects other-client / unauthorized access');
    } else {
        fail(
            'Plan-prefill rejects other-client / unauthorized access',
            `status ${prefillForeignClient.status}`
        );
    }

    const prefillWrongOwner = await request(
        'GET',
        `/clients/${clientId}/nutrition-recommendations/${saved.id}/plan-prefill`,
        { token: tokenB }
    );
    if (prefillWrongOwner.status === 403) {
        pass('Plan-prefill unauthorized trainer rejected');
    } else {
        fail('Plan-prefill unauthorized trainer rejected', `status ${prefillWrongOwner.status}`);
    }

    // Snapshot independence: create plan from prefill, then change recommendation
    const createPlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: {
            name: `Prefill Plan ${suffix}`,
            goal: pf.goal,
            duration: 8,
            daysCount: 7,
            macroTargets: pf.macroTargets,
            status: 'active',
        },
    });
    const planId = createPlan.json?.data?.nutritionPlan?.id;
    const planCalories = createPlan.json?.data?.nutritionPlan?.macroTargets?.calories;
    if (createPlan.status === 201 && planCalories === 2100) {
        pass('Create nutrition plan from prefill values');
    } else {
        fail('Create nutrition plan from prefill values', JSON.stringify(createPlan.json));
    }

    await request(
        'PATCH',
        `/clients/${clientId}/nutrition-recommendations/${saved.id}`,
        {
            token: tokenA,
            body: { finalCalories: 3100 },
        }
    );

    const planAfter = await request('GET', `/nutrition-plans/${planId}`, { token: tokenA });
    if (
        planAfter.status === 200 &&
        planAfter.json?.data?.nutritionPlan?.macroTargets?.calories === 2100
    ) {
        pass('Changing recommendation does not modify existing plan');
    } else {
        fail(
            'Changing recommendation does not modify existing plan',
            JSON.stringify(planAfter.json?.data?.nutritionPlan?.macroTargets)
        );
    }

    // Backward compat: create plan without recommendation
    const plainPlan = await request('POST', '/nutrition-plans', {
        token: tokenA,
        body: {
            name: `Plain Plan ${suffix}`,
            goal: 'maintenance',
            duration: 4,
            daysCount: 7,
            macroTargets: { calories: 2200, protein: 150, carbs: 220, fat: 70 },
        },
    });
    if (plainPlan.status === 201) pass('Nutrition plan create without recommendation still works');
    else fail('Nutrition plan create without recommendation still works', JSON.stringify(plainPlan.json));

    // Cleanup
    if (planId) {
        await request('DELETE', `/nutrition-plans/${planId}`, { token: tokenA });
    }
    const plainId = plainPlan.json?.data?.nutritionPlan?.id;
    if (plainId) {
        await request('DELETE', `/nutrition-plans/${plainId}`, { token: tokenA });
    }

    await NutritionRecommendation.deleteMany({
        clientId: { $in: [clientA._id, clientB._id, incompleteClient._id] },
    });
    await NutritionProfile.deleteMany({
        clientId: { $in: [clientA._id, clientB._id, incompleteClient._id] },
    });
    await User.deleteMany({
        _id: {
            $in: [
                trainerA._id,
                trainerB._id,
                clientA._id,
                clientB._id,
                incompleteClient._id,
            ],
        },
    });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exit(1);
}

main().catch(async (err) => {
    console.error(err);
    try {
        await mongoose.disconnect();
    } catch {
        // ignore
    }
    process.exit(1);
});
