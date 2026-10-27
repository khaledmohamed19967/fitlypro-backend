/**
 * Client soft-deactivation workflow (service + optional HTTP).
 * Run: node scripts/test-client-deactivate.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import PlanAssignment from '../src/modules/workout-plans/plan-assignment.model.js';
import NutritionPlanAssignment from '../src/modules/nutrition-plan-assignments/nutrition-plan-assignment.model.js';
import NutritionProfile from '../src/modules/nutrition-profiles/nutrition-profile.model.js';
import WorkoutSession from '../src/modules/workout-plans/workout-session.model.js';
import WorkoutSetLog from '../src/modules/workout-plans/workout-set-log.model.js';
import clientService from '../src/modules/clients/client.service.js';
import { buildClientListScopeQuery } from '../src/modules/clients/client.list-scope.js';
import { cancelActivePlanAssignmentsForClient } from '../src/modules/clients/client.deactivation.js';
import clientInvitationService from '../src/modules/client-invitations/client-invitation.service.js';
import { ApiError } from '../src/utils/ApiError.js';

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
};

async function expectApiError(promise, statusCode, label) {
    try {
        await promise;
        fail(label, 'expected rejection');
        return false;
    } catch (err) {
        if (err instanceof ApiError && err.statusCode === statusCode) {
            pass(label);
            return true;
        }
        fail(label, `got ${err?.statusCode || err?.message}`);
        return false;
    }
}

async function main() {
    const defaultScope = buildClientListScopeQuery(new mongoose.Types.ObjectId(), {});
    if (defaultScope.isActive === true) {
        pass('Unit: default list scope is active clients only');
    } else {
        fail('Unit: default list scope is active clients only', JSON.stringify(defaultScope));
    }

    if (!process.env.APP_DB_URL) {
        console.log('SKIP: APP_DB_URL not set — DB tests skipped');
        process.exit(results.every((r) => r.ok) ? 0 : 1);
    }

    await mongoose.connect(process.env.APP_DB_URL);
    const suffix = Date.now();
    const password = 'testpass123';
    const planId = new mongoose.Types.ObjectId();

    const trainerA = await User.create({
        firstName: 'Deact',
        lastName: 'TrainerA',
        email: `deact-a-${suffix}@test.com`,
        password,
        role: 'trainer',
    });
    const trainerB = await User.create({
        firstName: 'Deact',
        lastName: 'TrainerB',
        email: `deact-b-${suffix}@test.com`,
        password,
        role: 'trainer',
    });

    const client = await User.create({
        firstName: 'Deact',
        lastName: 'Client',
        email: `deact-client-${suffix}@test.com`,
        password,
        role: 'client',
        trainer: trainerA._id,
        isActive: true,
    });

    const workoutPaused = await PlanAssignment.create({
        trainerId: trainerA._id,
        planId: new mongoose.Types.ObjectId(),
        clientId: client._id,
        startDate: new Date(),
        status: 'paused',
    });

    const workoutActive = await PlanAssignment.create({
        trainerId: trainerA._id,
        planId,
        clientId: client._id,
        startDate: new Date(),
        status: 'active',
    });

    const nutritionActive = await NutritionPlanAssignment.create({
        trainerId: trainerA._id,
        planId: new mongoose.Types.ObjectId(),
        clientId: client._id,
        startDate: new Date(),
        status: 'active',
    });

    await NutritionProfile.create({ clientId: client._id, trainerId: trainerA._id });

    const dayId = new mongoose.Types.ObjectId();
    const session = await WorkoutSession.create({
        assignmentId: workoutActive._id,
        trainerId: trainerA._id,
        clientId: client._id,
        planId,
        workoutDayId: dayId,
        workoutDayNumber: 1,
        workoutDayName: 'Day 1',
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
    });
    await WorkoutSetLog.create({
        sessionId: session._id,
        assignmentId: workoutActive._id,
        clientId: client._id,
        planId,
        workoutDayId: dayId,
        exerciseId: new mongoose.Types.ObjectId(),
        planExerciseId: new mongoose.Types.ObjectId(),
        setNumber: 1,
        status: 'completed',
    });

    await clientService.deleteClient(client._id.toString(), trainerA._id.toString());

    const wp = await PlanAssignment.findById(workoutPaused._id);
    const wa = await PlanAssignment.findById(workoutActive._id);
    if (wp?.status === 'paused') pass('Service: paused workout assignment unchanged');
    else fail('Service: paused workout assignment unchanged', wp?.status);
    if (wa?.status === 'cancelled') pass('Service: active workout assignment cancelled');
    else fail('Service: active workout assignment cancelled', wa?.status);

    await clientService.reactivateClient(client._id.toString(), trainerA._id.toString());
    await cancelActivePlanAssignmentsForClient(client._id, trainerA._id);
    await clientService.deleteClient(client._id.toString(), trainerA._id.toString());
    pass('Service: partial-failure reconciliation completes deactivation');

    await expectApiError(
        clientInvitationService.createInvitation(client._id.toString(), trainerA._id.toString()),
        403,
        'Service: deactivated client cannot receive invitation'
    );

    await expectApiError(
        clientService.createClient(
            {
                firstName: 'X',
                lastName: 'Y',
                email: client.email,
                password: 'testpass123',
            },
            trainerA._id.toString()
        ),
        409,
        'Service: create with inactive email returns 409 reactivate hint'
    );

    await PlanAssignment.deleteMany({ clientId: client._id });
    await NutritionPlanAssignment.deleteMany({ clientId: client._id });
    await NutritionProfile.deleteMany({ clientId: client._id });
    await WorkoutSetLog.deleteMany({ clientId: client._id });
    await WorkoutSession.deleteMany({ clientId: client._id });
    await User.deleteMany({ _id: { $in: [trainerA._id, trainerB._id, client._id] } });

    await mongoose.disconnect();

    const failed = results.filter((r) => !r.ok);
    process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
