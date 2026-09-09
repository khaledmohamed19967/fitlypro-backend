/**
 * List pagination correctness tests.
 * Run: node scripts/test-list-pagination.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../src/modules/users/user.model.js';
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import {
    buildPaginationMeta,
    paginateCollection,
} from '../src/utils/pagination.js';
import {
    buildWorkoutPlanListFilter,
} from '../src/modules/workout-plans/workout-plan.helpers.js';
import {
    buildNutritionPlanListFilter,
    buildNutritionPlanSummaryFilters,
} from '../src/modules/nutrition-plans/nutrition-plan.helpers.js';

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

function runUnitTests() {
    const empty = buildPaginationMeta(1, 10, 0);
    if (empty.total === 0 && empty.pages === 0) {
        pass('buildPaginationMeta empty total');
    } else {
        fail('buildPaginationMeta empty total', JSON.stringify(empty));
    }

    const paged = buildPaginationMeta(2, 10, 127);
    if (paged.total === 127 && paged.pages === 13 && paged.page === 2) {
        pass('buildPaginationMeta totalPages');
    } else {
        fail('buildPaginationMeta totalPages', JSON.stringify(paged));
    }
}

async function main() {
    runUnitTests();

    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const email = `pagination-trainer-${suffix}@test.com`;
    const password = 'testpass123';

    const trainer = await User.create({
        firstName: 'Pagination',
        lastName: 'Tester',
        email,
        password,
        role: 'trainer',
    });

    const login = await request('POST', '/auth/login', {
        body: { email, password },
    });
    const token = login.json?.data?.token;
    if (!token) {
        throw new Error('Failed to login pagination test trainer');
    }

    const statuses = ['draft', 'active', 'archived'];
    for (let i = 0; i < statuses.length; i += 1) {
        await WorkoutPlan.create({
            trainerId: trainer._id,
            ownership: { type: 'trainer', trainerId: trainer._id },
            name: `Pagination Plan ${statuses[i]} ${suffix}-${i}`,
            duration: 4,
            daysPerWeek: 3,
            goal: 'muscle_gain',
            level: 'intermediate',
            isTemplate: false,
            status: statuses[i],
            workoutDays: [],
        });
    }

    const allRes = await request('GET', '/workout-plans?page=1&limit=2', { token });
    const allPag = allRes.json?.data?.pagination;
    const allItems = allRes.json?.data?.workoutPlans ?? [];
    if (
        allRes.status === 200 &&
        allPag?.total === 3 &&
        allPag?.pages === 2 &&
        allItems.length === 2
    ) {
        pass('workout list all statuses total independent of page size');
    } else {
        fail('workout list all statuses total', JSON.stringify({ allPag, count: allItems.length }));
    }

    const page2 = await request('GET', '/workout-plans?page=2&limit=2', { token });
    const page2Pag = page2.json?.data?.pagination;
    if (page2.status === 200 && page2Pag?.total === 3 && page2Pag?.page === 2) {
        pass('workout list page 2 keeps same total');
    } else {
        fail('workout list page 2 keeps same total', JSON.stringify(page2Pag));
    }

    const activeRes = await request('GET', '/workout-plans?status=active&limit=10', { token });
    const activePag = activeRes.json?.data?.pagination;
    if (activeRes.status === 200 && activePag?.total === 1) {
        pass('workout list status filter total');
    } else {
        fail('workout list status filter total', JSON.stringify(activePag));
    }

    const summaryRes = await request('GET', '/workout-plans/summary', { token });
    const summary = summaryRes.json?.data;
    if (
        summaryRes.status === 200 &&
        summary?.all === 3 &&
        summary?.draft === 1 &&
        summary?.active === 1 &&
        summary?.archived === 1
    ) {
        pass('workout summary endpoint');
    } else {
        fail('workout summary endpoint', JSON.stringify(summaryRes.json));
    }

    await NutritionPlan.create({
        trainerId: trainer._id,
        ownership: { type: 'trainer', trainerId: trainer._id },
        name: `My Active Plan ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        isTemplate: false,
        status: 'active',
        nutritionDays: [],
    });

    await NutritionPlan.create({
        trainerId: trainer._id,
        ownership: { type: 'trainer', trainerId: trainer._id },
        name: `Archived Plan ${suffix}`,
        goal: 'maintenance',
        duration: 4,
        daysCount: 7,
        macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
        isTemplate: false,
        status: 'archived',
        nutritionDays: [],
    });

    const myPlansRes = await request(
        'GET',
        '/nutrition-plans?ownership=trainer&status=active&limit=1',
        { token }
    );
    const myPlansPag = myPlansRes.json?.data?.pagination;
    if (myPlansRes.status === 200 && myPlansPag?.total === 1 && myPlansPag?.pages === 1) {
        pass('nutrition list filtered total with limit=1');
    } else {
        fail('nutrition list filtered total with limit=1', JSON.stringify(myPlansPag));
    }

    const nutritionSummary = await request('GET', '/nutrition-plans/summary', { token });
    const nutritionCounts = nutritionSummary.json?.data;
    if (
        nutritionSummary.status === 200 &&
        nutritionCounts?.['my-plans'] === 1 &&
        nutritionCounts?.archived === 1
    ) {
        pass('nutrition summary endpoint');
    } else {
        fail('nutrition summary endpoint', JSON.stringify(nutritionSummary.json));
    }

    const filter = buildWorkoutPlanListFilter({ status: 'active' }, trainer._id);
    const { pagination: utilPag } = await paginateCollection({
        model: WorkoutPlan,
        filter,
        sort: { createdAt: -1 },
        page: 1,
        limit: 1,
    });
    if (utilPag.total === 1 && utilPag.pages === 1) {
        pass('paginateCollection uses countDocuments filter');
    } else {
        fail('paginateCollection uses countDocuments filter', JSON.stringify(utilPag));
    }

    const nutritionFilters = buildNutritionPlanSummaryFilters({}, trainer._id);
    const nutritionFilterKeys = Object.keys(nutritionFilters);
    if (nutritionFilterKeys.length === 3) {
        pass('nutrition summary filters built once');
    } else {
        fail('nutrition summary filters built once', nutritionFilterKeys.join(','));
    }

    const emptyRes = await request('GET', '/workout-plans?search=zzzz-no-match-zzzz', { token });
    const emptyPag = emptyRes.json?.data?.pagination;
    if (emptyRes.status === 200 && emptyPag?.total === 0 && emptyPag?.pages === 0) {
        pass('empty search returns total=0 pages=0');
    } else {
        fail('empty search returns total=0 pages=0', JSON.stringify(emptyPag));
    }

    await WorkoutPlan.deleteMany({ trainerId: trainer._id });
    await NutritionPlan.deleteMany({ trainerId: trainer._id });
    await User.deleteOne({ _id: trainer._id });
    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
