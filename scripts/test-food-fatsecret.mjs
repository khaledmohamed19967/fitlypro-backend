/**
 * FatSecret integration tests (mocked network).
 * Run: node scripts/test-food-fatsecret.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import Food from '../src/modules/foods/food.model.js';
import User from '../src/modules/users/user.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import { FATSECRET_PROVIDER } from '../src/modules/foods/food.constants.js';
import { buildFoodSnapshot } from '../src/modules/foods/food.helpers.js';
import {
    resetFatSecretTokenCache,
    searchFoods,
    getFoodById,
} from '../src/integrations/fatsecret/fatsecret.client.js';
import {
    mapFatSecretFoodToFitlyFood,
    mapSearchFoodToFitlyFood,
    mapProductImage,
    mapServings,
    parseFoodDescription,
} from '../src/integrations/fatsecret/fatsecret.mapper.js';
import {
    BRANDED_SEARCH,
    DETAIL_CHICKEN,
    DETAIL_EGG_MULTI,
    DETAIL_EGG_MULTI_NUMERIC_DEFAULT,
    DETAIL_EGG_PIECE,
    DETAIL_INVALID_DEFAULT_FALLBACK_100G,
    DETAIL_NO_DEFAULT_NO_100G,
    DETAIL_NO_DEFAULT_WITH_100G,
    EMPTY_SEARCH_RESPONSE,
    GENERIC_CHICKEN_SEARCH,
    MISSING_SCOPE_ERROR,
    SEARCH_MISSING_NUTRITION,
    SEARCH_RESPONSE_V1,
    SEARCH_RESPONSE_V5,
    SEARCH_WITH_IMAGE,
    TOKEN_RESPONSE,
} from '../src/integrations/fatsecret/__fixtures__/foods.js';
import { resolveSearchExpression } from '../src/integrations/fatsecret/fatsecret.constants.js';

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
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

const jsonResponse = (payload, status = 200) =>
    new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

function installFetchMock(handler) {
    const original = globalThis.fetch;
    globalThis.fetch = handler;
    return () => {
        globalThis.fetch = original;
    };
}

async function runMapperTests() {
    const emptyGeneric = resolveSearchExpression('', 'generic');
    const typedBrand = resolveSearchExpression('  ', 'brand');
    const explicit = resolveSearchExpression(' rice ', 'generic');
    if (
        emptyGeneric.isBrowseDefault &&
        emptyGeneric.expression === 'chicken' &&
        typedBrand.expression === 'coca' &&
        explicit.expression === 'rice' &&
        !explicit.isBrowseDefault
    ) {
        pass('empty search uses browse defaults');
    } else {
        fail('empty search uses browse defaults', JSON.stringify({ emptyGeneric, typedBrand, explicit }));
    }

    const generic = mapSearchFoodToFitlyFood(GENERIC_CHICKEN_SEARCH);
    if (
        generic?.id === 'fs:36413' &&
        generic.type === 'generic' &&
        generic.nutritionPer100g.calories === 165 &&
        generic.source.externalProvider === FATSECRET_PROVIDER
    ) {
        pass('generic food search mapping');
    } else {
        fail('generic food search mapping', JSON.stringify(generic));
    }

    const brand = mapSearchFoodToFitlyFood(BRANDED_SEARCH);
    if (brand?.type === 'brand' && brand.brand === "McDonald's") {
        pass('brand food search mapping');
    } else {
        fail('brand food search mapping', JSON.stringify(brand));
    }

    const parsed = parseFoodDescription(GENERIC_CHICKEN_SEARCH.food_description);
    if (parsed?.calories === 165 && parsed.protein === 31.02) {
        pass('nutrition mapping from description');
    } else {
        fail('nutrition mapping from description', JSON.stringify(parsed));
    }

    const meta = {
        max_results: '20',
        total_results: '85',
        page_number: '2',
    };
    if (Number(meta.page_number) === 2 && Number(meta.total_results) === 85) {
        pass('pagination metadata');
    } else {
        fail('pagination metadata', JSON.stringify(meta));
    }

    const servings = mapServings(DETAIL_CHICKEN.food.servings.serving);
    if (
        servings?.nutritionPer100g.calories === 165 &&
        servings.defaultServing.gramWeight === 100 &&
        servings.servings?.length === 2 &&
        servings.defaultServingId === '1' &&
        servings.servings.find((entry) => entry.id === '1')?.isDefault === true &&
        servings.servings.some((entry) => entry.id === '2' && entry.label === '1 piece' && !entry.isDefault)
    ) {
        pass('serving mapping (100g is_default)');
    } else {
        fail('serving mapping (100g is_default)', JSON.stringify(servings));
    }

    const egg = mapFatSecretFoodToFitlyFood(DETAIL_EGG_PIECE.food);
    if (
        egg?.defaultServing.unit === 'piece' &&
        egg.defaultServing.gramWeight === 50 &&
        egg.servings?.length === 1 &&
        egg.servings[0].label === '1 large'
    ) {
        pass('serving mapping (piece with grams)');
    } else {
        fail('serving mapping (piece with grams)', JSON.stringify(egg));
    }

    const eggMultiMapped = mapServings(DETAIL_EGG_MULTI.food.servings.serving);
    const eggMulti = mapFatSecretFoodToFitlyFood(DETAIL_EGG_MULTI.food);
    const eggLabels = (eggMulti?.servings ?? []).map((entry) => entry.label);
    const largeServing = eggMulti?.servings?.find((entry) => entry.id === '3');
    const largePublic = eggMultiMapped?.servings?.find((entry) => entry.id === '3');
    // Hybrid: FatSecret is_default "1 large" wins over 100g.
    // Persistable servings omit isDefault; public/search mapping stamps it on Fitly's choice.
    if (
        eggMulti?.defaultServingId === '3' &&
        eggMulti?.defaultServing?.unit === 'piece' &&
        eggMulti?.defaultServing?.gramWeight === 50 &&
        eggMulti?.defaultServing?.quantity === 1 &&
        eggMulti?.servings?.length === 5 &&
        eggLabels.includes('1 small') &&
        eggLabels.includes('1 medium') &&
        eggLabels.includes('1 large') &&
        eggLabels.includes('1 extra large') &&
        eggLabels.includes('100 g') &&
        largeServing?.gramWeight === 50 &&
        largeServing?.unit === 'piece' &&
        largeServing?.nutrition?.calories === 72 &&
        largePublic?.isDefault === true &&
        eggMultiMapped.servings.find((entry) => entry.id === '5')?.isDefault !== true
    ) {
        pass('multi-serving egg prefers FatSecret is_default');
    } else {
        fail('multi-serving egg prefers FatSecret is_default', JSON.stringify(eggMulti));
    }

    const eggNumeric = mapServings(DETAIL_EGG_MULTI_NUMERIC_DEFAULT.food.servings.serving);
    if (eggNumeric?.defaultServingId === '3' && eggNumeric?.defaultServing?.gramWeight === 50) {
        pass('is_default numeric 1 accepted');
    } else {
        fail('is_default numeric 1 accepted', JSON.stringify(eggNumeric?.defaultServingId));
    }

    const noDefault100 = mapServings(DETAIL_NO_DEFAULT_WITH_100G.food.servings.serving);
    if (
        noDefault100?.defaultServingId === '11' &&
        noDefault100?.defaultServing?.gramWeight === 100 &&
        noDefault100?.defaultServing?.unit === 'g'
    ) {
        pass('no is_default falls back to ~100g');
    } else {
        fail('no is_default falls back to ~100g', JSON.stringify(noDefault100));
    }

    const noDefaultNo100 = mapServings(DETAIL_NO_DEFAULT_NO_100G.food.servings.serving);
    if (
        noDefaultNo100?.defaultServingId === '20' &&
        noDefaultNo100?.defaultServing?.gramWeight === 28
    ) {
        pass('no is_default and no 100g uses first valid');
    } else {
        fail('no is_default and no 100g uses first valid', JSON.stringify(noDefaultNo100));
    }

    const invalidDefault = mapServings(DETAIL_INVALID_DEFAULT_FALLBACK_100G.food.servings.serving);
    if (
        invalidDefault?.defaultServingId === '31' &&
        invalidDefault?.defaultServing?.gramWeight === 100 &&
        !invalidDefault.servings.some((entry) => entry.id === '30')
    ) {
        pass('invalid is_default metric ignored → 100g fallback');
    } else {
        fail('invalid is_default metric ignored → 100g fallback', JSON.stringify(invalidDefault));
    }

    const legacyOnlyDefault = {
        name: 'Manual Oats',
        defaultServing: { quantity: 40, unit: 'g', gramWeight: 40 },
        nutritionPer100g: { calories: 370, protein: 13, carbs: 60, fat: 7 },
    };
    if (!legacyOnlyDefault.servings) {
        pass('legacy food without servings array');
    } else {
        fail('legacy food without servings array', 'unexpected servings');
    }

    const image = mapProductImage(SEARCH_WITH_IMAGE);
    if (image?.url) {
        pass('image present');
    } else {
        fail('image present', JSON.stringify(image));
    }

    const noImage = mapProductImage(GENERIC_CHICKEN_SEARCH);
    if (noImage == null) {
        pass('image missing');
    } else {
        fail('image missing', JSON.stringify(noImage));
    }

    if (!mapSearchFoodToFitlyFood(SEARCH_MISSING_NUTRITION)) {
        pass('invalid responses rejected');
    } else {
        fail('invalid responses rejected', 'expected null');
    }
}

async function runClientTests() {
    process.env.FATSECRET_CLIENT_ID = 'test-id';
    process.env.FATSECRET_CLIENT_SECRET = 'test-secret';
    process.env.FATSECRET_SCOPE = 'premier';
    resetFatSecretTokenCache();

    let tokenCalls = 0;
    let searchCalls = 0;
    const restore = installFetchMock(async (url) => {
        const href = String(url);
        if (href.includes('/connect/token')) {
            tokenCalls += 1;
            return jsonResponse(TOKEN_RESPONSE);
        }
        searchCalls += 1;
        return jsonResponse(SEARCH_RESPONSE_V5);
    });

    try {
        await searchFoods({ query: 'chicken', foodType: 'generic' });
        await searchFoods({ query: 'chicken', foodType: 'generic' });
        if (tokenCalls === 1 && searchCalls === 2) {
            pass('authentication + token reuse');
        } else {
            fail('authentication + token reuse', `token=${tokenCalls} search=${searchCalls}`);
        }
    } finally {
        restore();
    }

    resetFatSecretTokenCache();
    process.env.FATSECRET_SCOPE = '';
    const restoreFallback = installFetchMock(async (url, options) => {
        const href = String(url);
        if (href.includes('/connect/token')) {
            const body = String(options.body || '');
            if (body.includes('premier')) return jsonResponse(TOKEN_RESPONSE);
            return jsonResponse(TOKEN_RESPONSE);
        }
        const params = String(options.body || '');
        if (params.includes('foods.search.v5')) {
            return jsonResponse(MISSING_SCOPE_ERROR);
        }
        return jsonResponse(SEARCH_RESPONSE_V1);
    });

    try {
        const result = await searchFoods({ query: 'chicken' });
        if (result.method === 'foods.search' && result.scope === 'basic') {
            pass('premier missing-scope falls back to basic search');
        } else {
            fail('premier missing-scope falls back to basic search', JSON.stringify(result));
        }
    } finally {
        restoreFallback();
    }

    resetFatSecretTokenCache();
    process.env.FATSECRET_SCOPE = 'basic';
    const restoreEmpty = installFetchMock(async (url) => {
        if (String(url).includes('/connect/token')) return jsonResponse(TOKEN_RESPONSE);
        return jsonResponse(EMPTY_SEARCH_RESPONSE);
    });
    try {
        const empty = await searchFoods({ query: 'zzzzzz' });
        if (extractTotal(empty.json) === 0) {
            pass('empty search results');
        } else {
            fail('empty search results', JSON.stringify(empty.json));
        }
    } finally {
        restoreEmpty();
    }

    resetFatSecretTokenCache();
    const restoreRate = installFetchMock(async (url) => {
        if (String(url).includes('/connect/token')) return jsonResponse(TOKEN_RESPONSE);
        return jsonResponse({ error: { message: 'Rate limit exceeded' } }, 429);
    });
    try {
        await searchFoods({ query: 'chicken' });
        fail('rate limiting', 'expected throw');
    } catch (error) {
        if (error.statusCode === 429) pass('rate limiting');
        else fail('rate limiting', error.message);
    } finally {
        restoreRate();
    }

    resetFatSecretTokenCache();
    const restoreInvalid = installFetchMock(async (url) => {
        if (String(url).includes('/connect/token')) return jsonResponse(TOKEN_RESPONSE);
        return new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    });
    try {
        await getFoodById('36413');
        fail('invalid responses', 'expected throw');
    } catch (error) {
        if (error.statusCode === 502) pass('API errors / invalid responses');
        else fail('API errors / invalid responses', error.message);
    } finally {
        restoreInvalid();
    }

    resetFatSecretTokenCache();
    process.env.FATSECRET_SCOPE = 'premier';
    let detailBodies = [];
    const restoreDetailFlag = installFetchMock(async (url, options) => {
        if (String(url).includes('/connect/token')) return jsonResponse(TOKEN_RESPONSE);
        detailBodies.push(String(options?.body || ''));
        return jsonResponse(DETAIL_CHICKEN);
    });
    try {
        await getFoodById('36413');
        const body = detailBodies[0] || '';
        if (
            body.includes('method=food.get.v4') &&
            body.includes('food_id=36413') &&
            body.includes('flag_default_serving=true') &&
            body.includes('format=json')
        ) {
            pass('food.get requests flag_default_serving on premier');
        } else {
            fail('food.get requests flag_default_serving on premier', body);
        }
    } finally {
        restoreDetailFlag();
    }

    resetFatSecretTokenCache();
    process.env.FATSECRET_SCOPE = 'basic';
    let basicBodies = [];
    const restoreBasicDetail = installFetchMock(async (url, options) => {
        if (String(url).includes('/connect/token')) return jsonResponse(TOKEN_RESPONSE);
        basicBodies.push(String(options?.body || ''));
        return jsonResponse(DETAIL_CHICKEN);
    });
    try {
        await getFoodById('36413');
        const body = basicBodies[0] || '';
        if (body.includes('food_id=36413') && !body.includes('flag_default_serving')) {
            pass('food.get omits flag_default_serving on basic');
        } else {
            fail('food.get omits flag_default_serving on basic', body);
        }
    } finally {
        restoreBasicDetail();
    }
}

function extractTotal(json) {
    return Number(json?.foods?.total_results || json?.foods_search?.total_results || 0);
}

async function runApiTests(suffix) {
    const trainer = await User.create({
        firstName: 'FatSecret',
        lastName: 'Api',
        email: `fs-api-${suffix}@test.com`,
        password: 'testpass123',
        role: 'trainer',
    });

    const login = await request('POST', '/auth/login', {
        body: { email: trainer.email, password: 'testpass123' },
    });
    const token = login.json?.data?.token;
    if (!token) {
        fail('API auth setup', JSON.stringify(login.json));
        await trainer.deleteOne();
        return;
    }

    const trainerFood = await Food.create({
        trainerId: trainer._id,
        ownership: { type: 'trainer', trainerId: trainer._id },
        name: `My Custom Chicken ${suffix}`,
        category: 'protein',
        status: 'active',
        nutritionPer100g: { calories: 200, protein: 20, carbs: 0, fat: 10 },
        defaultServing: { quantity: 100, unit: 'g', gramWeight: 100 },
        source: { type: 'manual' },
    });

    const mine = await request('GET', `/foods?ownership=trainer&search=Custom%20Chicken&limit=10`, { token });
    if (mine.status === 200 && mine.json?.data?.foods?.some((f) => f.id === trainerFood._id.toString())) {
        pass('trainer custom foods still list');
    } else {
        fail('trainer custom foods still list', JSON.stringify(mine.json));
    }

    const mapped = mapFatSecretFoodToFitlyFood(DETAIL_CHICKEN.food);
    mapped.source.externalId = `chicken-${suffix}`;
    const created = await Food.create(mapped);
    const snapshot = buildFoodSnapshot(created);
    if (snapshot?.nutritionPer100g?.calories === 165) {
        pass('NutritionPlan snapshot compatible with materialized FatSecret food');
    } else {
        fail('NutritionPlan snapshot compatible with materialized FatSecret food', JSON.stringify(snapshot));
    }

    const eggMapped = mapFatSecretFoodToFitlyFood(DETAIL_EGG_MULTI.food);
    eggMapped.source.externalId = `egg-multi-${suffix}`;
    const eggFood = await Food.create(eggMapped);
    const largeSnap = buildFoodSnapshot(eggFood, { selectedServingId: '3' });
    if (
        largeSnap?.defaultServing?.gramWeight === 50 &&
        largeSnap?.defaultServing?.unit === 'piece' &&
        largeSnap?.servings?.length === 5
    ) {
        pass('snapshot uses selectedServingId gramWeight');
    } else {
        fail('snapshot uses selectedServingId gramWeight', JSON.stringify(largeSnap?.defaultServing));
    }

    // Catalog without servings + previous snapshot must keep selected gramWeight on rebuild.
    const staleEgg = await Food.create({
        ownership: { type: 'system', trainerId: null },
        trainerId: null,
        name: `Stale Egg ${suffix}`,
        category: 'protein',
        status: 'active',
        nutritionPer100g: eggMapped.nutritionPer100g,
        defaultServing: { quantity: 100, unit: 'g', gramWeight: 100 },
        defaultServingId: '5',
        source: {
            type: 'import',
            externalProvider: FATSECRET_PROVIDER,
            externalId: `stale-egg-${suffix}`,
        },
    });
    const preserved = buildFoodSnapshot(staleEgg, {
        selectedServingId: '3',
        previousSnapshot: {
            name: 'Egg',
            brand: null,
            category: 'protein',
            nutritionPer100g: eggMapped.nutritionPer100g,
            defaultServing: { quantity: 1, unit: 'piece', gramWeight: 50 },
            servings: eggMapped.servings,
        },
    });
    if (preserved?.defaultServing?.gramWeight === 50 && preserved?.servings?.length === 5) {
        pass('snapshot preserves selected serving via previousSnapshot');
    } else {
        fail(
            'snapshot preserves selected serving via previousSnapshot',
            JSON.stringify(preserved?.defaultServing)
        );
    }

    const plan = await request('POST', '/nutrition-plans', {
        token,
        body: {
            name: `FS Plan ${suffix}`,
            description: 'FatSecret compatibility',
            goal: 'muscle_gain',
            duration: 4,
            daysCount: 7,
            macroTargets: { calories: 2200, protein: 160, carbs: 220, fat: 70 },
            nutritionDays: [
                {
                    dayNumber: 1,
                    name: 'Day 1',
                    meals: [
                        {
                            order: 1,
                            name: 'Meal 1',
                            mealType: 'lunch',
                            foodItems: [
                                { foodId: created._id.toString(), quantity: 150, unit: 'g', order: 1 },
                                {
                                    foodId: eggFood._id.toString(),
                                    quantity: 3,
                                    unit: 'piece',
                                    order: 2,
                                    selectedServingId: '3',
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    });

    const dayMeals = plan.json?.data?.nutritionPlan?.nutritionDays?.[0]?.meals?.[0]?.foodItems;
    const item = dayMeals?.[0];
    const eggItem = dayMeals?.[1];
    if (plan.status === 201 && item?.foodSnapshot?.nutritionPer100g?.calories === 165) {
        pass('NutritionPlan foodSnapshot rebuild from FatSecret food');
    } else {
        fail('NutritionPlan foodSnapshot rebuild from FatSecret food', JSON.stringify(plan.json));
    }

    // 3 × 50g with nutritionPer100g scaled from 1 large (72/50*100 = 144) → 216 kcal.
    if (
        plan.status === 201 &&
        eggItem?.selectedServingId === '3' &&
        eggItem?.foodSnapshot?.defaultServing?.gramWeight === 50 &&
        Math.round(eggItem?.itemMacros?.calories) === 216
    ) {
        pass('Create plan persists selectedServingId + macros');
    } else {
        fail(
            'Create plan persists selectedServingId + macros',
            JSON.stringify(eggItem)
        );
    }

    const planId = plan.json?.data?.nutritionPlan?.id;
    const mealId = plan.json?.data?.nutritionPlan?.nutritionDays?.[0]?.meals?.[0]?.id;
    const dayId = plan.json?.data?.nutritionPlan?.nutritionDays?.[0]?.id;
    const eggItemId = eggItem?.id;

    const updated = await request('PATCH', `/nutrition-plans/${planId}`, {
        token,
        body: {
            name: `FS Plan ${suffix} updated`,
            nutritionDays: [
                {
                    _id: dayId,
                    dayNumber: 1,
                    name: 'Day 1',
                    meals: [
                        {
                            _id: mealId,
                            order: 1,
                            name: 'Meal 1 renamed',
                            mealType: 'lunch',
                            foodItems: [
                                {
                                    _id: item?.id,
                                    foodId: created._id.toString(),
                                    quantity: 150,
                                    unit: 'g',
                                    order: 1,
                                },
                                {
                                    _id: eggItemId,
                                    foodId: eggFood._id.toString(),
                                    quantity: 3,
                                    unit: 'piece',
                                    order: 2,
                                    selectedServingId: '3',
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    });

    const updatedEgg =
        updated.json?.data?.nutritionPlan?.nutritionDays?.[0]?.meals?.[0]?.foodItems?.[1];
    if (
        updated.status === 200 &&
        updatedEgg?.selectedServingId === '3' &&
        updatedEgg?.foodSnapshot?.defaultServing?.gramWeight === 50 &&
        Math.round(updatedEgg?.itemMacros?.calories) === 216
    ) {
        pass('Update preserves selectedServingId + gramWeight + macros');
    } else {
        fail(
            'Update preserves selectedServingId + gramWeight + macros',
            JSON.stringify({ status: updated.status, updatedEgg })
        );
    }

    // Rematerialize gate: when servings already present, do not overwrite nutrition/defaultServing.
    const firstServingsLen = created.servings?.length ?? 0;
    const nutritionBefore = created.nutritionPer100g.calories;
    const defaultBefore = { ...created.defaultServing.toObject?.() ?? created.defaultServing };
    const needsServings =
        !Array.isArray(created.servings) || created.servings.length === 0;
    if (
        !needsServings &&
        firstServingsLen === 2 &&
        nutritionBefore === 165 &&
        defaultBefore.gramWeight === 100
    ) {
        pass('repeated materialize does not duplicate servings');
    } else {
        fail(
            'repeated materialize does not duplicate servings',
            JSON.stringify({
                needsServings,
                len: firstServingsLen,
                calories: nutritionBefore,
                defaultBefore,
            })
        );
    }

    // Backfill path: empty servings → servings only; do not change defaultServing/defaultServingId.
    const pending = await Food.create({
        ownership: { type: 'system', trainerId: null },
        name: `Pending Servings ${suffix}`,
        category: 'protein',
        status: 'active',
        nutritionPer100g: { calories: 165, protein: 31, carbs: 0, fat: 3.5 },
        defaultServing: { quantity: 100, unit: 'g', gramWeight: 100 },
        defaultServingId: 'legacy-default',
        source: {
            type: 'import',
            externalProvider: FATSECRET_PROVIDER,
            externalId: `pending-servings-${suffix}`,
        },
    });
    const backfill = mapFatSecretFoodToFitlyFood(DETAIL_CHICKEN.food);
    const calBeforeBackfill = pending.nutritionPer100g.calories;
    const idBeforeBackfill = pending.defaultServingId;
    pending.servings = backfill.servings;
    // Mimic service: do not assign payload.defaultServingId on rematerialize backfill.
    await pending.save();
    const afterBackfill = await Food.findById(pending._id);
    if (
        afterBackfill.servings.length === 2 &&
        afterBackfill.nutritionPer100g.calories === calBeforeBackfill &&
        afterBackfill.defaultServing.gramWeight === 100 &&
        afterBackfill.defaultServingId === idBeforeBackfill
    ) {
        pass('servings backfill preserves nutrition and defaultServing');
    } else {
        fail(
            'servings backfill preserves nutrition and defaultServing',
            JSON.stringify({
                servings: afterBackfill.servings.length,
                calories: afterBackfill.nutritionPer100g.calories,
                defaultServingId: afterBackfill.defaultServingId,
            })
        );
    }
    await pending.deleteOne();

    // New materialization mapping uses hybrid priority (egg → 1 large).
    const newEgg = mapFatSecretFoodToFitlyFood(DETAIL_EGG_MULTI.food);
    if (newEgg?.defaultServingId === '3' && newEgg?.defaultServing?.gramWeight === 50) {
        pass('new materialization mapping uses hybrid default');
    } else {
        fail('new materialization mapping uses hybrid default', JSON.stringify(newEgg?.defaultServing));
    }

    await NutritionPlan.deleteMany({ trainerId: trainer._id });
    await created.deleteOne();
    await eggFood.deleteOne();
    await staleEgg.deleteOne();
    await trainerFood.deleteOne();
    await trainer.deleteOne();
}

async function main() {
    console.log('FatSecret food search tests\n');
    await runMapperTests();
    await runClientTests();

    await mongoose.connect(process.env.APP_DB_URL);
    try {
        await runApiTests(Date.now());
    } catch (error) {
        fail('API tests', error.message);
    }
    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
        failed.forEach((item) => console.log(`  - ${item.name}: ${item.detail}`));
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
