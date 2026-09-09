import mongoose from 'mongoose';
import NutritionPlan from '../nutrition-plans/nutrition-plan.model.js';
import NutritionPlanAssignment from './nutrition-plan-assignment.model.js';
import User from '../users/user.model.js';
import { ApiError } from '../../utils/ApiError.js';
import {
    canModifyNutritionPlan,
    isSystemNutritionPlan,
} from '../nutrition-plans/nutrition-plan.helpers.js';
import { loadAccessibleClientDocument } from '../nutrition-profiles/nutrition-profile.helpers.js';
import { mapNutritionAssignmentToPublic } from './nutrition-plan-assignment.helpers.js';
import { CANCELLABLE_ASSIGNMENT_STATUSES } from './nutrition-plan-assignment.constants.js';

/**
 * Nutrition Plan Assignment Service (Phase 6)
 */

const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

const emptyToNull = (value) => (value === '' || value === undefined ? null : value);

/**
 * Load trainer-owned plan for assignment listing (not system templates).
 *
 * @param {string} planId
 * @param {string} trainerId
 */
const loadOwnedTrainerPlan = async (planId, trainerId) => {
    if (!isValidObjectId(planId)) {
        throw new ApiError(400, 'Invalid nutrition plan ID');
    }

    const plan = await NutritionPlan.findById(planId);

    if (!plan) {
        throw new ApiError(404, 'Nutrition plan not found');
    }

    if (isSystemNutritionPlan(plan)) {
        throw new ApiError(403, 'System nutrition templates cannot be modified');
    }

    if (!canModifyNutritionPlan(plan, trainerId)) {
        throw new ApiError(404, 'Nutrition plan not found');
    }

    return plan;
};

/**
 * Load plan eligible for new assignments.
 *
 * @param {string} planId
 * @param {string} trainerId
 */
const loadAssignablePlan = async (planId, trainerId) => {
    if (!isValidObjectId(planId)) {
        throw new ApiError(400, 'Invalid nutrition plan ID');
    }

    const plan = await NutritionPlan.findById(planId);

    if (!plan) {
        throw new ApiError(404, 'Nutrition plan not found');
    }

    if (isSystemNutritionPlan(plan)) {
        throw new ApiError(400, 'System nutrition templates cannot be assigned');
    }

    if (!canModifyNutritionPlan(plan, trainerId)) {
        throw new ApiError(404, 'Nutrition plan not found');
    }

    if (plan.status === 'archived') {
        throw new ApiError(400, 'Cannot assign an archived nutrition plan');
    }

    if (plan.status === 'draft') {
        throw new ApiError(400, 'Cannot assign a draft nutrition plan');
    }

    return plan;
};

/**
 * Map Mongo duplicate-key races on active assignments to domain 409.
 *
 * @param {unknown} err
 */
const throwIfDuplicateActiveAssignment = (err) => {
    if (err?.code === 11000) {
        throw new ApiError(409, 'Client already has an active nutrition plan assignment', [
            {
                field: 'clientIds',
                message: 'Client already has an active nutrition plan assignment',
            },
        ]);
    }
};

/**
 * @param {string} clientId
 * @param {string} trainerId
 */
const verifyTrainerClient = async (clientId, trainerId) => {
    if (!isValidObjectId(clientId)) {
        throw new ApiError(400, 'Invalid client ID', [
            { field: 'clientIds', message: 'Must be a valid ObjectId' },
        ]);
    }

    const client = await User.findOne({
        _id: clientId,
        role: 'client',
        trainer: trainerId,
    });

    if (!client) {
        throw new ApiError(400, 'Client is not accessible', [
            {
                field: 'clientIds',
                message: 'Client not found or not assigned to you',
            },
        ]);
    }

    return client;
};

/**
 * @param {string|null|undefined} planVersionId
 */
const rejectPlanVersionReference = (planVersionId) => {
    if (planVersionId) {
        throw new ApiError(400, 'Plan versions are not supported yet', [
            { field: 'planVersionId', message: 'Plan version pinning is not available' },
        ]);
    }
};

/**
 * Product rule: one client may have only one active Nutrition Plan at a time
 * (across all plans for this trainer).
 *
 * @param {string} planId
 * @param {object} body
 * @param {string} trainerId
 */
const createAssignments = async (planId, body, trainerId) => {
    await loadAssignablePlan(planId, trainerId);
    rejectPlanVersionReference(body.planVersionId);

    const clients = [];
    for (const clientId of body.clientIds) {
        clients.push(await verifyTrainerClient(clientId, trainerId));
    }

    const conflictClientIds = [];

    for (const clientId of body.clientIds) {
        const existing = await NutritionPlanAssignment.findOne({
            clientId,
            trainerId,
            status: 'active',
        }).select('_id planId');

        if (existing) {
            conflictClientIds.push(clientId);
        }
    }

    if (conflictClientIds.length > 0) {
        throw new ApiError(409, 'Client already has an active nutrition plan assignment', [
            {
                field: 'clientIds',
                message: `Client already has an active nutrition plan assignment: ${conflictClientIds.join(', ')}`,
            },
        ]);
    }

    const assignments = [];

    try {
        for (let index = 0; index < body.clientIds.length; index += 1) {
            const clientId = body.clientIds[index];
            const client = clients[index];

            const assignment = await NutritionPlanAssignment.create({
                trainerId,
                planId,
                planVersionId: null,
                clientId,
                startDate: body.startDate,
                endDate: body.endDate || null,
                status: 'active',
                notes: emptyToNull(body.notes),
            });

            assignments.push(mapNutritionAssignmentToPublic(assignment, client));
        }
    } catch (err) {
        throwIfDuplicateActiveAssignment(err);
        throw err;
    }

    return assignments;
};

/**
 * @param {string} planId
 * @param {string} trainerId
 */
const getAssignments = async (planId, trainerId) => {
    await loadOwnedTrainerPlan(planId, trainerId);

    const assignments = await NutritionPlanAssignment.find({ planId, trainerId })
        .sort({ startDate: -1 })
        .populate('clientId');

    return assignments.map((assignment) =>
        mapNutritionAssignmentToPublic(assignment, assignment.clientId)
    );
};

/**
 * Client Details → Nutrition tab: the client's single active assignment.
 * Does not sort/limit among multiples — multiple actives are a data-integrity error.
 *
 * @param {string} clientId
 * @param {string} trainerId
 * @returns {Promise<object|null>}
 */
const getActiveAssignmentByClient = async (clientId, trainerId) => {
    await loadAccessibleClientDocument(clientId, trainerId);

    const assignments = await NutritionPlanAssignment.find({
        clientId,
        trainerId,
        status: 'active',
    }).populate({ path: 'planId', select: 'name' });

    if (assignments.length === 0) {
        return null;
    }

    if (assignments.length > 1) {
        const ids = assignments.map((a) => a._id?.toString?.() ?? String(a._id)).join(', ');
        console.error(
            `[nutrition-plan-assignment] Data integrity conflict: trainer=${trainerId} client=${clientId} has ${assignments.length} active assignments (${ids}). Product rule allows only one active Nutrition Plan per client.`
        );
        throw new ApiError(
            500,
            'Data integrity conflict: multiple active nutrition plan assignments for this client'
        );
    }

    return mapNutritionAssignmentToPublic(assignments[0]);
};

/**
 * "Remove from Client" — cancel an active assignment.
 * Only active → cancelled; the document and all other fields are preserved.
 *
 * @param {string} planId
 * @param {string} assignmentId
 * @param {string} trainerId
 * @returns {Promise<object>}
 */
const cancelAssignment = async (planId, assignmentId, trainerId) => {
    await loadOwnedTrainerPlan(planId, trainerId);

    if (!isValidObjectId(assignmentId)) {
        throw new ApiError(400, 'Invalid assignment ID');
    }

    const assignment = await NutritionPlanAssignment.findOne({
        _id: assignmentId,
        planId,
        trainerId,
    });

    if (!assignment) {
        throw new ApiError(404, 'Nutrition plan assignment not found');
    }

    if (!CANCELLABLE_ASSIGNMENT_STATUSES.includes(assignment.status)) {
        throw new ApiError(
            409,
            `Only active assignments can be cancelled (current status: ${assignment.status})`
        );
    }

    assignment.status = 'cancelled';
    await assignment.save();

    await assignment.populate({ path: 'planId', select: 'name' });

    return mapNutritionAssignmentToPublic(assignment);
};

export default {
    createAssignments,
    getAssignments,
    getActiveAssignmentByClient,
    cancelAssignment,
};
