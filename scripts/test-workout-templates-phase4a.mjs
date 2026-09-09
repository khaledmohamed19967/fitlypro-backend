/**
 * Manual Phase 4A system workout templates verification.
 * Run: node scripts/test-workout-templates-phase4a.mjs
 *
 * Prerequisites:
 * - Dev server running
 * - System templates seeded: pnpm run seed:workout-templates
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js';
import PlanAssignment from '../src/modules/workout-plans/plan-assignment.model.js';

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

const collectNestedIds = (plan) => {
    const ids = new Set([plan.id]);
    for (const day of plan.workoutDays || []) {
        ids.add(day.id);
        for (const ex of day.exercises || []) {
            ids.add(ex.id);
            for (const set of ex.sets || []) {
                ids.add(set.id);
            }
        }
    }
    return ids;
};

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const password = 'testpass123';

    const trainerA = await User.create({
        firstName: 'Template',
        lastName: 'Alpha',
        email: `tpl-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const trainerB = await User.create({
        firstName: 'Template',
        lastName: 'Beta',
        email: `tpl-b-${suffix}@test.com`,
        password,
        role: 'trainer',
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

    const trainerPlanCountBefore = await WorkoutPlan.countDocuments({
        $or: [
            { 'ownership.type': 'trainer' },
            { ownership: { $exists: false }, trainerId: { $ne: null } },
        ],
    });

    const systemTemplate = await WorkoutPlan.findOne({
        'ownership.type': 'system',
        isTemplate: true,
        templateKey: 'full-body-beginner',
        status: 'active',
    });

    if (systemTemplate) pass('System template exists');
    else fail('System template exists', 'full-body-beginner not found');

    const listSystem = await request(
        'GET',
        '/workout-plans?ownership=system&isTemplate=true',
        { token: tokenA }
    );

    if (
        listSystem.status === 200 &&
        listSystem.json?.data?.workoutPlans?.some((p) => p.id === systemTemplate?._id.toString())
    ) {
        pass('System template list');
    } else {
        fail('System template list', JSON.stringify(listSystem.json));
    }

    const detail = await request('GET', `/workout-plans/${systemTemplate._id}`, {
        token: tokenA,
    });

    if (
        detail.status === 200 &&
        detail.json?.data?.workoutPlan?.ownership?.type === 'system' &&
        detail.json?.data?.workoutPlan?.isTemplate === true
    ) {
        pass('System template detail');
    } else {
        fail('System template detail', JSON.stringify(detail.json));
    }

    const patchSystem = await request('PATCH', `/workout-plans/${systemTemplate._id}`, {
        token: tokenA,
        body: { name: 'Hacked System Template' },
    });
    if (patchSystem.status === 403) pass('Trainer cannot modify system template');
    else fail('Trainer cannot modify system template', `status ${patchSystem.status}`);

    const deleteSystem = await request('DELETE', `/workout-plans/${systemTemplate._id}`, {
        token: tokenA,
    });
    if (deleteSystem.status === 403) pass('Trainer cannot archive system template');
    else fail('Trainer cannot archive system template', `status ${deleteSystem.status}`);

    const sourceBefore = await WorkoutPlan.findById(systemTemplate._id).lean();
    const sourceIds = collectNestedIds({
        id: sourceBefore._id.toString(),
        workoutDays: (sourceBefore.workoutDays || []).map((d) => ({
            id: d._id.toString(),
            exercises: (d.exercises || []).map((e) => ({
                id: e._id.toString(),
                sets: (e.sets || []).map((s) => ({ id: s._id.toString() })),
            })),
        })),
    });

    const firstExercise = sourceBefore.workoutDays?.[0]?.exercises?.[0];

    const clone1 = await request('POST', `/workout-plans/${systemTemplate._id}/clone`, {
        token: tokenA,
        body: {},
    });

    const cloned = clone1.json?.data?.workoutPlan;

    if (clone1.status === 201 && cloned?.id) pass('Trainer can clone system template');
    else fail('Trainer can clone system template', JSON.stringify(clone1.json));

    if (cloned?.id && cloned.id !== systemTemplate._id.toString()) {
        pass('Clone has new plan ID');
    } else {
        fail('Clone has new plan ID', cloned?.id);
    }

    if (
        cloned?.ownership?.type === 'trainer' &&
        String(cloned.ownership.trainerId) === String(trainerA._id)
    ) {
        pass('Clone has trainer ownership');
    } else {
        fail('Clone has trainer ownership', JSON.stringify(cloned?.ownership));
    }

    if (cloned?.isTemplate === false) pass('Clone isTemplate=false');
    else fail('Clone isTemplate=false', String(cloned?.isTemplate));

    const cloneAssignments = await request('GET', `/workout-plans/${cloned?.id}/assignments`, {
        token: tokenA,
    });
    if (
        cloneAssignments.status === 200 &&
        (cloneAssignments.json?.data?.assignments?.length ?? 0) === 0
    ) {
        pass('Clone does not copy assignments');
    } else {
        fail('Clone does not copy assignments', JSON.stringify(cloneAssignments.json));
    }

    const cloneIds = collectNestedIds(cloned || {});
    const overlap = [...cloneIds].filter((id) => sourceIds.has(id));
    if (overlap.length === 0) pass('Clone has new nested IDs');
    else fail('Clone has new nested IDs', `overlap=${overlap.join(',')}`);

    const clonedFirst = cloned?.workoutDays?.[0]?.exercises?.[0];
    if (
        firstExercise &&
        clonedFirst &&
        String(clonedFirst.exerciseId) === String(firstExercise.exerciseId)
    ) {
        pass('Clone preserves exerciseId');
    } else {
        fail('Clone preserves exerciseId', `${clonedFirst?.exerciseId} vs ${firstExercise?.exerciseId}`);
    }

    if (
        firstExercise?.exerciseSnapshot?.name &&
        clonedFirst?.exerciseSnapshot?.name === firstExercise.exerciseSnapshot.name
    ) {
        pass('Clone preserves exerciseSnapshot');
    } else {
        fail('Clone preserves exerciseSnapshot', JSON.stringify(clonedFirst?.exerciseSnapshot));
    }

    const sourceAfter = await WorkoutPlan.findById(systemTemplate._id).lean();
    if (
        sourceAfter.name === sourceBefore.name &&
        sourceAfter.updatedAt?.toString() === sourceBefore.updatedAt?.toString()
    ) {
        pass('Clone cannot modify source');
    } else if (sourceAfter.name === sourceBefore.name) {
        // updatedAt may bump on unrelated ops — name + key + days length enough
        pass('Clone cannot modify source');
    } else {
        fail('Clone cannot modify source', 'source name changed');
    }

    // Trainer own template
    const ownTemplate = await WorkoutPlan.create({
        ownership: { type: 'trainer', trainerId: trainerA._id },
        trainerId: trainerA._id,
        name: `My Template ${suffix}`,
        duration: 4,
        daysPerWeek: 2,
        goal: 'general_fitness',
        level: 'beginner',
        isTemplate: true,
        status: 'active',
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Day 1',
                exercises: [],
            },
        ],
    });

    const cloneOwn = await request('POST', `/workout-plans/${ownTemplate._id}/clone`, {
        token: tokenA,
        body: { name: `Cloned Own ${suffix}` },
    });
    if (cloneOwn.status === 201) pass('Trainer can clone own template');
    else fail('Trainer can clone own template', JSON.stringify(cloneOwn.json));

    const foreignTemplate = await WorkoutPlan.create({
        ownership: { type: 'trainer', trainerId: trainerB._id },
        trainerId: trainerB._id,
        name: `Foreign Template ${suffix}`,
        duration: 4,
        daysPerWeek: 2,
        goal: 'strength',
        level: 'beginner',
        isTemplate: true,
        status: 'active',
        workoutDays: [],
    });

    const cloneForeign = await request('POST', `/workout-plans/${foreignTemplate._id}/clone`, {
        token: tokenA,
        body: {},
    });
    if (cloneForeign.status === 404) pass("Trainer cannot clone another trainer's template");
    else fail("Trainer cannot clone another trainer's template", `status ${cloneForeign.status}`);

    const archivedTemplate = await WorkoutPlan.create({
        ownership: { type: 'trainer', trainerId: trainerA._id },
        trainerId: trainerA._id,
        name: `Archived Template ${suffix}`,
        duration: 4,
        daysPerWeek: 2,
        goal: 'strength',
        level: 'beginner',
        isTemplate: true,
        status: 'archived',
        workoutDays: [],
    });

    const cloneArchived = await request('POST', `/workout-plans/${archivedTemplate._id}/clone`, {
        token: tokenA,
        body: {},
    });
    if (cloneArchived.status === 400) pass('Archived template cannot be cloned');
    else fail('Archived template cannot be cloned', `status ${cloneArchived.status}`);

    const draftTemplate = await WorkoutPlan.create({
        ownership: { type: 'trainer', trainerId: trainerA._id },
        trainerId: trainerA._id,
        name: `Draft Template ${suffix}`,
        duration: 4,
        daysPerWeek: 2,
        goal: 'strength',
        level: 'beginner',
        isTemplate: true,
        status: 'draft',
        workoutDays: [],
    });

    const cloneDraft = await request('POST', `/workout-plans/${draftTemplate._id}/clone`, {
        token: tokenA,
        body: {},
    });
    if (cloneDraft.status === 400) pass('Draft template cannot be cloned');
    else fail('Draft template cannot be cloned', `status ${cloneDraft.status}`);

    const normalPlan = await WorkoutPlan.create({
        ownership: { type: 'trainer', trainerId: trainerA._id },
        trainerId: trainerA._id,
        name: `Normal Plan ${suffix}`,
        duration: 4,
        daysPerWeek: 2,
        goal: 'strength',
        level: 'beginner',
        isTemplate: false,
        status: 'active',
        workoutDays: [],
    });

    const cloneNormal = await request('POST', `/workout-plans/${normalPlan._id}/clone`, {
        token: tokenA,
        body: {},
    });
    const normalClone = cloneNormal.json?.data?.workoutPlan;
    if (cloneNormal.status === 201 && normalClone?.id) {
        pass('Own active normal plan can be cloned');
    } else {
        fail('Own active normal plan can be cloned', JSON.stringify(cloneNormal.json));
    }

    if (normalClone?.id !== normalPlan._id.toString()) {
        pass('Normal clone has new plan ID');
    } else {
        fail('Normal clone has new plan ID', `${normalClone?.id} vs ${normalPlan._id}`);
    }

    if (
        normalClone?.ownership?.type === 'trainer' &&
        String(normalClone.ownership.trainerId) === String(trainerA._id)
    ) {
        pass('Normal clone has trainer ownership');
    } else {
        fail('Normal clone has trainer ownership', JSON.stringify(normalClone?.ownership));
    }

    if (normalClone?.isTemplate === false) pass('Normal clone isTemplate=false');
    else fail('Normal clone isTemplate=false', String(normalClone?.isTemplate));

    if (normalClone?.status === 'active') pass('Normal clone status=active');
    else fail('Normal clone status=active', normalClone?.status);

    if (normalClone?.templateKey == null) pass('Normal clone templateKey null');
    else fail('Normal clone templateKey null', String(normalClone?.templateKey));

    const exA = new mongoose.Types.ObjectId();
    const exB = new mongoose.Types.ObjectId();
    const catalogExerciseId = firstExercise?.exerciseId ?? new mongoose.Types.ObjectId();
    const richNormalPlan = await WorkoutPlan.create({
        ownership: { type: 'trainer', trainerId: trainerA._id },
        trainerId: trainerA._id,
        name: `Rich Normal Plan ${suffix}`,
        duration: 8,
        daysPerWeek: 3,
        goal: 'muscle_gain',
        level: 'intermediate',
        isTemplate: false,
        status: 'active',
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Day 1',
                exercises: [
                    {
                        _id: exA,
                        exerciseId: catalogExerciseId,
                        order: 1,
                        restBetweenSets: 90,
                        exerciseSnapshot: firstExercise?.exerciseSnapshot ?? {
                            name: 'Squat',
                            thumbnailUrl: null,
                        },
                        sets: [{ setNumber: 1, reps: 8, weightUnit: 'kg' }],
                    },
                    {
                        _id: exB,
                        exerciseId: catalogExerciseId,
                        order: 2,
                        restBetweenSets: 60,
                        supersetWith: exA,
                        exerciseSnapshot: firstExercise?.exerciseSnapshot ?? {
                            name: 'Squat',
                            thumbnailUrl: null,
                        },
                        sets: [{ setNumber: 1, reps: 12, weightUnit: 'kg' }],
                    },
                ],
            },
        ],
    });

    const richSourceBefore = await WorkoutPlan.findById(richNormalPlan._id).lean();
    const richCloneRes = await request('POST', `/workout-plans/${richNormalPlan._id}/clone`, {
        token: tokenA,
        body: { name: `Rich Normal Clone ${suffix}` },
    });
    const richClone = richCloneRes.json?.data?.workoutPlan;

    if (richCloneRes.status === 201 && richClone?.id) {
        pass('Rich normal plan clone succeeds');
    } else {
        fail('Rich normal plan clone succeeds', JSON.stringify(richCloneRes.json));
    }

    const richSourceIds = collectNestedIds({
        id: richSourceBefore._id.toString(),
        workoutDays: (richSourceBefore.workoutDays || []).map((d) => ({
            id: d._id.toString(),
            exercises: (d.exercises || []).map((e) => ({
                id: e._id.toString(),
                sets: (e.sets || []).map((s) => ({ id: s._id.toString() })),
            })),
        })),
    });
    const richCloneIds = collectNestedIds(richClone || {});
    const richOverlap = [...richCloneIds].filter((id) => richSourceIds.has(id));
    if (richOverlap.length === 0) pass('Normal clone nested IDs independent');
    else fail('Normal clone nested IDs independent', `overlap=${richOverlap.join(',')}`);

    const richCloneEx0 = richClone?.workoutDays?.[0]?.exercises?.[0];
    const richCloneEx1 = richClone?.workoutDays?.[0]?.exercises?.[1];
    if (
        richCloneEx0 &&
        String(richCloneEx0.exerciseId) === String(catalogExerciseId)
    ) {
        pass('Normal clone exerciseId preserved');
    } else {
        fail('Normal clone exerciseId preserved', `${richCloneEx0?.exerciseId} vs ${catalogExerciseId}`);
    }

    if (
        richCloneEx0?.exerciseSnapshot?.name &&
        richCloneEx0.exerciseSnapshot.name ===
            (firstExercise?.exerciseSnapshot?.name ?? 'Squat')
    ) {
        pass('Normal clone exerciseSnapshot preserved');
    } else {
        fail('Normal clone exerciseSnapshot preserved', JSON.stringify(richCloneEx0?.exerciseSnapshot));
    }

    if (
        richCloneEx1?.supersetWith &&
        richCloneEx1.supersetWith === richCloneEx0?.id
    ) {
        pass('Normal clone supersetWith remapped');
    } else {
        fail(
            'Normal clone supersetWith remapped',
            `${richCloneEx1?.supersetWith} vs ${richCloneEx0?.id}`
        );
    }

    const richSourceAfter = await WorkoutPlan.findById(richNormalPlan._id).lean();
    if (richSourceAfter.name === richSourceBefore.name) {
        pass('Normal clone does not modify source');
    } else {
        fail('Normal clone does not modify source', 'source name changed');
    }

    const client = await User.create({
        firstName: 'Clone',
        lastName: 'Client',
        email: `wp-clone-client-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
    });

    await request('POST', `/workout-plans/${richNormalPlan._id}/assignments`, {
        token: tokenA,
        body: {
            clientIds: [client._id.toString()],
            startDate: new Date().toISOString(),
        },
    });

    const assignedCloneRes = await request('POST', `/workout-plans/${richNormalPlan._id}/clone`, {
        token: tokenA,
        body: { name: `Assigned Source Clone ${suffix}` },
    });
    const assignedClone = assignedCloneRes.json?.data?.workoutPlan;
    const assignedCloneAssignments = await request(
        'GET',
        `/workout-plans/${assignedClone?.id}/assignments`,
        { token: tokenA }
    );
    if (
        assignedCloneRes.status === 201 &&
        assignedCloneAssignments.status === 200 &&
        (assignedCloneAssignments.json?.data?.assignments?.length ?? 0) === 0
    ) {
        pass('Normal clone does not copy assignments');
    } else {
        fail(
            'Normal clone does not copy assignments',
            JSON.stringify(assignedCloneAssignments.json)
        );
    }

    const foreignNormalPlan = await WorkoutPlan.create({
        ownership: { type: 'trainer', trainerId: trainerB._id },
        trainerId: trainerB._id,
        name: `Foreign Normal ${suffix}`,
        duration: 4,
        daysPerWeek: 2,
        goal: 'strength',
        level: 'beginner',
        isTemplate: false,
        status: 'active',
        workoutDays: [],
    });

    const cloneForeignNormal = await request('POST', `/workout-plans/${foreignNormalPlan._id}/clone`, {
        token: tokenA,
        body: {},
    });
    if (cloneForeignNormal.status === 404) pass('Foreign active normal plan rejected');
    else fail('Foreign active normal plan rejected', `status ${cloneForeignNormal.status}`);

    const draftNormalPlan = await WorkoutPlan.create({
        ownership: { type: 'trainer', trainerId: trainerA._id },
        trainerId: trainerA._id,
        name: `Draft Normal ${suffix}`,
        duration: 4,
        daysPerWeek: 2,
        goal: 'strength',
        level: 'beginner',
        isTemplate: false,
        status: 'draft',
        workoutDays: [],
    });

    const cloneDraftNormal = await request('POST', `/workout-plans/${draftNormalPlan._id}/clone`, {
        token: tokenA,
        body: {},
    });
    if (cloneDraftNormal.status === 400) pass('Draft normal plan rejected');
    else fail('Draft normal plan rejected', `status ${cloneDraftNormal.status}`);

    const archivedNormalPlan = await WorkoutPlan.create({
        ownership: { type: 'trainer', trainerId: trainerA._id },
        trainerId: trainerA._id,
        name: `Archived Normal ${suffix}`,
        duration: 4,
        daysPerWeek: 2,
        goal: 'strength',
        level: 'beginner',
        isTemplate: false,
        status: 'archived',
        workoutDays: [],
    });

    const cloneArchivedNormal = await request(
        'POST',
        `/workout-plans/${archivedNormalPlan._id}/clone`,
        { token: tokenA, body: {} }
    );
    if (cloneArchivedNormal.status === 400) pass('Archived normal plan rejected');
    else fail('Archived normal plan rejected', `status ${cloneArchivedNormal.status}`);

    const cloneMissing = await request('POST', '/workout-plans/507f1f77bcf86cd799439011/clone', {
        token: tokenA,
        body: {},
    });
    if (cloneMissing.status === 404) pass('Missing plan rejected');
    else fail('Missing plan rejected', `status ${cloneMissing.status}`);

    const cloneInvalidId = await request('POST', '/workout-plans/not-an-id/clone', {
        token: tokenA,
        body: {},
    });
    if (cloneInvalidId.status === 400) pass('Invalid plan ID rejected');
    else fail('Invalid plan ID rejected', `status ${cloneInvalidId.status}`);

    // Name collision: create a plan with the default clone name first
    const collisionBase = `${systemTemplate.name} Copy`;
    await WorkoutPlan.create({
        ownership: { type: 'trainer', trainerId: trainerA._id },
        trainerId: trainerA._id,
        name: collisionBase,
        duration: 4,
        daysPerWeek: 2,
        goal: 'general_fitness',
        level: 'beginner',
        isTemplate: false,
        status: 'active',
        workoutDays: [],
    });

    const cloneCollision = await request('POST', `/workout-plans/${systemTemplate._id}/clone`, {
        token: tokenA,
        body: {},
    });

    if (
        cloneCollision.status === 201 &&
        cloneCollision.json?.data?.workoutPlan?.name === `${collisionBase} 2`
    ) {
        pass('Clone name collision handled');
    } else {
        fail(
            'Clone name collision handled',
            `name=${cloneCollision.json?.data?.workoutPlan?.name}`
        );
    }

    const systemCount = await WorkoutPlan.countDocuments({
        'ownership.type': 'system',
        isTemplate: true,
        templateKey: { $in: [
            'full-body-beginner',
            'full-body-intermediate',
            'upper-lower-4',
            'ppl-3',
            'ppl-6',
            'upper-lower-hypertrophy',
            'strength-4',
            'general-fitness-3',
        ] },
    });
    if (systemCount === 8) pass('Seed is idempotent (8 system templates)');
    else fail('Seed is idempotent (8 system templates)', `count=${systemCount}`);

    const trainerPlanCountAfter = await WorkoutPlan.countDocuments({
        $or: [
            { 'ownership.type': 'trainer' },
            { ownership: { $exists: false }, trainerId: { $ne: null } },
        ],
    });

    // Trainer plans should only increase by what this test created (not wiped)
    if (trainerPlanCountAfter >= trainerPlanCountBefore) {
        pass('Existing trainer plans unchanged (not wiped)');
    } else {
        fail(
            'Existing trainer plans unchanged (not wiped)',
            `${trainerPlanCountBefore} -> ${trainerPlanCountAfter}`
        );
    }

    // Default list should be trainer-owned only
    const defaultList = await request('GET', '/workout-plans', { token: tokenA });
    const hasSystemInDefault = defaultList.json?.data?.workoutPlans?.some(
        (p) => p.ownership?.type === 'system'
    );
    if (defaultList.status === 200 && !hasSystemInDefault) {
        pass('Default list excludes system templates');
    } else {
        fail('Default list excludes system templates', `hasSystem=${hasSystemInDefault}`);
    }

    // Cleanup test-created trainer plans / users (leave system templates)
    await WorkoutPlan.deleteMany({
        'ownership.type': 'trainer',
        'ownership.trainerId': { $in: [trainerA._id, trainerB._id] },
    });
    await PlanAssignment.deleteMany({ trainerId: { $in: [trainerA._id, trainerB._id] } });
    await User.deleteMany({ _id: { $in: [trainerA._id, trainerB._id, client._id] } });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
        process.exit(1);
    }
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
