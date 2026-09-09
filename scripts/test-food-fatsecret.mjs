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
    DETAIL_EGG_PIECE,
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
    if (servings?.nutritionPer100g.calories === 165 && servings.defaultServing.gramWeight === 100) {
        pass('serving mapping (100g)');
    } else {
        fail('serving mapping (100g)', JSON.stringify(servings));
    }

    const egg = mapFatSecretFoodToFitlyFood(DETAIL_EGG_PIECE.food);
    if (egg?.defaultServing.unit === 'piece' && egg.defaultServing.gramWeight === 50) {
        pass('serving mapping (piece with grams)');
    } else {
        fail('serving mapping (piece with grams)', JSON.stringify(egg?.defaultServing));
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
    const created = await Food.create(mapped);
    const snapshot = buildFoodSnapshot(created);
    if (snapshot?.nutritionPer100g?.calories === 165) {
        pass('NutritionPlan snapshot compatible with materialized FatSecret food');
    } else {
        fail('NutritionPlan snapshot compatible with materialized FatSecret food', JSON.stringify(snapshot));
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
                            ],
                        },
                    ],
                },
            ],
        },
    });

    const item = plan.json?.data?.nutritionPlan?.nutritionDays?.[0]?.meals?.[0]?.foodItems?.[0];
    if (plan.status === 201 && item?.foodSnapshot?.nutritionPer100g?.calories === 165) {
        pass('NutritionPlan foodSnapshot rebuild from FatSecret food');
    } else {
        fail('NutritionPlan foodSnapshot rebuild from FatSecret food', JSON.stringify(plan.json));
    }

    await NutritionPlan.deleteMany({ trainerId: trainer._id });
    await created.deleteOne();
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
