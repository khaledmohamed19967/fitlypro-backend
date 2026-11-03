/**
 * Workout plan list assignedClientsCount.
 * Run: node scripts/test-workout-plans-list-assigned-count.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import WorkoutPlan from '../src/modules/workout-plans/workout-plan.model.js';
import PlanAssignment from '../src/modules/workout-plans/plan-assignment.model.js';
import workoutPlanService from '../src/modules/workout-plans/workout-plan.service.js';

const results = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};

const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

function findPlan(list, id) {
    return list.find((row) => String(row.id) === String(id));
}

async function createTrainer(suffix, label) {
    return User.create({
        firstName: 'Trainer',
        lastName: `T${label}`,
        email: `wp-count-${label}-${suffix}@test.com`,
        password: 'testpass123',
        role: 'trainer',
    });
}

async function createClient(trainerId, suffix, label) {
    return User.create({
        firstName: 'Client',
        lastName: `C${label}`,
        email: `wp-count-client-${label}-${suffix}@test.com`,
        password: 'testpass123',
        role: 'client',
        trainer: trainerId,
    });
}

async function createPlan(trainerId, name, overrides = {}) {
    return WorkoutPlan.create({
        trainerId,
        ownership: { type: 'trainer', trainerId },
        name,
        duration: 8,
        daysPerWeek: 3,
        goal: 'muscle_gain',
        level: 'intermediate',
        isTemplate: false,
        status: 'active',
        workoutDays: overrides.workoutDays ?? [],
        ...overrides,
    });
}

async function assign({ trainerId, planId, clientId, status = 'active' }) {
    return PlanAssignment.create({
        trainerId,
        planId,
        clientId,
        startDate: new Date(),
        status,
    });
}

function assertNumericFieldOnEveryItem(plans) {
    return plans.every(
        (row) =>
            row &&
            typeof row.assignedClientsCount === 'number' &&
            Number.isFinite(row.assignedClientsCount)
    );
}

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const suffix = Date.now();
    const trainerA = await createTrainer(suffix, 'a');
    const trainerB = await createTrainer(suffix, 'b');
    const trainerAId = trainerA._id.toString();

    const client1 = await createClient(trainerA._id, suffix, 'one');
    const client2 = await createClient(trainerA._id, suffix, 'two');
    const client3 = await createClient(trainerA._id, suffix, 'three');
    const client4 = await createClient(trainerA._id, suffix, 'four');
    const clientB = await createClient(trainerB._id, suffix, 'b');

    const planZero = await createPlan(trainerA._id, `Zero Plan ${suffix}`);
    const planOne = await createPlan(trainerA._id, `One Client Plan ${suffix}`);
    const planThree = await createPlan(trainerA._id, `Three Client Plan ${suffix}`);
    const planAlpha = await createPlan(trainerA._id, `Alpha Plan ${suffix}`);
    const planBeta = await createPlan(trainerA._id, `Beta Plan ${suffix}`);
    const planArchived = await createPlan(trainerA._id, `Archived Plan ${suffix}`, {
        status: 'archived',
    });
    const planExercisesHigh = await createPlan(trainerA._id, `Heavy Exercises ${suffix}`, {
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Day 1',
                exercises: [
                    {
                        exerciseId: new mongoose.Types.ObjectId(),
                        order: 1,
                        restBetweenSets: 60,
                        sets: [],
                    },
                    {
                        exerciseId: new mongoose.Types.ObjectId(),
                        order: 2,
                        restBetweenSets: 60,
                        sets: [],
                    },
                    {
                        exerciseId: new mongoose.Types.ObjectId(),
                        order: 3,
                        restBetweenSets: 60,
                        sets: [],
                    },
                ],
            },
        ],
    });
    await createPlan(trainerA._id, `Light Exercises ${suffix}`, {
        workoutDays: [
            {
                dayNumber: 1,
                name: 'Day 1',
                exercises: [
                    {
                        exerciseId: new mongoose.Types.ObjectId(),
                        order: 1,
                        restBetweenSets: 60,
                        sets: [],
                    },
                ],
            },
        ],
    });

    const systemTemplate =
        (await WorkoutPlan.findOne({ 'ownership.type': 'system', isTemplate: true })) ??
        (await WorkoutPlan.create({
            trainerId: null,
            ownership: { type: 'system' },
            templateKey: `wp-count-system-${suffix}`,
            name: `System Template ${suffix}`,
            duration: 4,
            daysPerWeek: 3,
            goal: 'general_fitness',
            level: 'beginner',
            isTemplate: true,
            status: 'active',
            workoutDays: [],
        }));

    await assign({ trainerId: trainerA._id, planId: planOne._id, clientId: client1._id });

    await assign({ trainerId: trainerA._id, planId: planThree._id, clientId: client1._id });
    await assign({ trainerId: trainerA._id, planId: planThree._id, clientId: client2._id });
    await assign({ trainerId: trainerA._id, planId: planThree._id, clientId: client3._id });

    await assign({
        trainerId: trainerA._id,
        planId: planThree._id,
        clientId: client4._id,
        status: 'cancelled',
    });
    await assign({
        trainerId: trainerA._id,
        planId: planThree._id,
        clientId: client4._id,
        status: 'paused',
    });
    await assign({
        trainerId: trainerA._id,
        planId: planThree._id,
        clientId: client4._id,
        status: 'completed',
    });

    await assign({ trainerId: trainerA._id, planId: planAlpha._id, clientId: client1._id });
    await assign({ trainerId: trainerA._id, planId: planBeta._id, clientId: client2._id });

    await assign({ trainerId: trainerA._id, planId: planArchived._id, clientId: client3._id });

    const planB = await createPlan(trainerB._id, `Trainer B Plan ${suffix}`);
    await assign({ trainerId: trainerB._id, planId: planB._id, clientId: clientB._id });

    const cloned = await workoutPlanService.cloneWorkoutPlan(
        planThree._id.toString(),
        trainerAId,
        { name: `Clone Of Three ${suffix}` }
    );

    const listNormal = await workoutPlanService.getWorkoutPlans(
        { ownership: 'trainer', page: 1, limit: 50, sort: 'newest' },
        trainerAId
    );

    if (assertNumericFieldOnEveryItem(listNormal.workoutPlans)) {
        pass('Listing includes numeric assignedClientsCount on every item (normal path)');
    } else {
        fail(
            'Listing includes numeric assignedClientsCount on every item (normal path)',
            JSON.stringify(listNormal.workoutPlans.slice(0, 2))
        );
    }

    if (findPlan(listNormal.workoutPlans, planZero._id)?.assignedClientsCount === 0) {
        pass('Zero assignments → assignedClientsCount 0');
    } else {
        fail('Zero assignments', JSON.stringify(findPlan(listNormal.workoutPlans, planZero._id)));
    }

    if (findPlan(listNormal.workoutPlans, planOne._id)?.assignedClientsCount === 1) {
        pass('One active assignment → count 1');
    } else {
        fail('One active assignment', JSON.stringify(findPlan(listNormal.workoutPlans, planOne._id)));
    }

    if (findPlan(listNormal.workoutPlans, planThree._id)?.assignedClientsCount === 3) {
        pass('Three active assignments → count 3');
    } else {
        fail(
            'Three active assignments',
            JSON.stringify(findPlan(listNormal.workoutPlans, planThree._id))
        );
    }

    if (
        findPlan(listNormal.workoutPlans, planAlpha._id)?.assignedClientsCount === 1 &&
        findPlan(listNormal.workoutPlans, planBeta._id)?.assignedClientsCount === 1
    ) {
        pass('Multiple plans with independent counts');
    } else {
        fail('Multiple plans', JSON.stringify({ alpha: planAlpha._id, beta: planBeta._id }));
    }

    if (
        findPlan(listNormal.workoutPlans, planAlpha._id)?.assignedClientsCount === 1 &&
        findPlan(listNormal.workoutPlans, planBeta._id)?.assignedClientsCount === 1 &&
        findPlan(listNormal.workoutPlans, planThree._id)?.assignedClientsCount === 3
    ) {
        pass('Same client on different plans counted on each plan');
    } else {
        fail('Same client different plans', 'counts mismatch');
    }

    if (findPlan(listNormal.workoutPlans, planArchived._id)?.assignedClientsCount === 1) {
        pass('Archived plan with active assignment → count 1');
    } else {
        fail(
            'Archived plan count',
            JSON.stringify(findPlan(listNormal.workoutPlans, planArchived._id))
        );
    }

    if (findPlan(listNormal.workoutPlans, cloned.id)?.assignedClientsCount === 0) {
        pass('Cloned plan starts with assignedClientsCount 0');
    } else {
        fail('Cloned plan', JSON.stringify(findPlan(listNormal.workoutPlans, cloned.id)));
    }

    const listB = await workoutPlanService.getWorkoutPlans(
        { ownership: 'trainer', page: 1, limit: 50 },
        trainerB._id.toString()
    );
    const rowB = findPlan(listB.workoutPlans, planB._id);
    const leakedA = listB.workoutPlans.some(
        (row) => String(row.id) === String(planThree._id) && row.assignedClientsCount > 0
    );
    if (rowB?.assignedClientsCount === 1 && !leakedA) {
        pass('Foreign trainer isolation');
    } else {
        fail('Foreign trainer isolation', JSON.stringify({ rowB, leakedA }));
    }

    const listSystem = await workoutPlanService.getWorkoutPlans(
        { ownership: 'system', page: 1, limit: 50 },
        trainerAId
    );
    const systemRow = findPlan(listSystem.workoutPlans, systemTemplate._id);
    if (systemRow?.assignedClientsCount === 0) {
        pass('System template assignedClientsCount is 0');
    } else {
        fail('System template', JSON.stringify(systemRow));
    }

    const listExerciseSort = await workoutPlanService.getWorkoutPlans(
        { ownership: 'trainer', page: 1, limit: 50, sort: 'exercises-high' },
        trainerAId
    );
    const heavyRow = findPlan(listExerciseSort.workoutPlans, planExercisesHigh._id);
    if (
        assertNumericFieldOnEveryItem(listExerciseSort.workoutPlans) &&
        heavyRow?.assignedClientsCount === 0
    ) {
        pass('Exercise-count aggregation path includes assignedClientsCount');
    } else {
        fail('Exercise-count path', JSON.stringify(heavyRow));
    }

    if (
        listNormal.pagination?.page === 1 &&
        typeof listNormal.pagination?.total === 'number' &&
        findPlan(listNormal.workoutPlans, planZero._id)?.name
    ) {
        pass('Existing listing pagination and fields preserved');
    } else {
        fail('Listing regression', JSON.stringify(listNormal.pagination));
    }

    let aggregateCallCount = 0;
    const originalAggregate = PlanAssignment.aggregate.bind(PlanAssignment);
    PlanAssignment.aggregate = function countAggregate(...args) {
        aggregateCallCount += 1;
        return originalAggregate(...args);
    };

    await workoutPlanService.getWorkoutPlans(
        { ownership: 'trainer', page: 1, limit: 5, sort: 'newest' },
        trainerAId
    );

    PlanAssignment.aggregate = originalAggregate;

    if (aggregateCallCount === 1) {
        pass('List performs single assignment aggregation per request (no N+1)');
    } else {
        fail('Aggregation call count', String(aggregateCallCount));
    }

    await PlanAssignment.deleteMany({
        trainerId: { $in: [trainerA._id, trainerB._id] },
    });
    await WorkoutPlan.deleteMany({
        $or: [
            { trainerId: { $in: [trainerA._id, trainerB._id] } },
            { templateKey: `wp-count-system-${suffix}` },
            { _id: cloned.id },
        ],
    });
    await User.deleteMany({ _id: { $in: [trainerA._id, trainerB._id, client1._id, client2._id, client3._id, client4._id, clientB._id] } });
    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    console.log('\n---');
    console.log(
        `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
    );

    if (failed.length) {
        process.exit(1);
    }

    console.log('\nExample list item fields:');
    console.log(
        JSON.stringify(
            {
                id: planThree._id.toString(),
                name: planThree.name,
                assignedClientsCount: 3,
            },
            null,
            2
        )
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
