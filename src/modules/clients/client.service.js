import mongoose from 'mongoose';
import User from '../users/user.model.js';
import { ApiError } from '../../utils/ApiError.js';
import { applyCoachingPackageEndDate } from './client.package-dates.js';
import { resolveSubscriptionNeedsAttention } from './client.subscription-attention.js';
import { buildClientListScopeQuery } from './client.list-scope.js';
import { buildClientListSummary } from './client.list-summary.js';
import workoutPlanService from '../workout-plans/workout-plan.service.js';
import {
    enrichClientPublicProfileWithInjuryAreas,
    validateHealthOptionIdsForCategory,
} from '../health-reference/health-reference.helpers.js';
import NutritionProfile from '../nutrition-profiles/nutrition-profile.model.js';
import nutritionProfileService from '../nutrition-profiles/nutrition-profile.service.js';
import { loadClientForCoachMutation } from './client.access.js';
import { completeClientDeactivation } from './client.deactivation.js';
import {
    CLIENT_FULL_UPDATE_FIELDS,
    CLIENT_NUTRITION_PROFILE_UPDATE_FIELDS,
    CLIENT_PLAN_UPDATE_FIELDS,
    pickAllowedUpdateFields,
} from './client.update-allowlist.js';

/**
 * Client Service
 * Business logic for client operations (using User model only)
 */

// =========================================================================
// Service Methods
// =========================================================================

const mapInjuryAreaIdsToObjectIds = (idStrings) =>
    (idStrings ?? []).map((id) => new mongoose.Types.ObjectId(id));

const normalizeOptionalStringField = (value) => {
    if (value === '' || value == null) {
        return value === '' ? undefined : null;
    }
    return value;
};

const buildClientResponse = async (client, clientId, trainerId) => {
    await client.populate('trainer', 'firstName lastName email');
    const profile = client.getPublicProfile();
    const withInjuries = await enrichClientPublicProfileWithInjuryAreas(profile);
    return enrichClientWithNutritionRestrictionIds(
        withInjuries,
        clientId ?? client._id?.toString(),
        trainerId
    );
};

/**
 * Attach nutrition restriction option IDs (canonical store: NutritionProfile).
 * Does not duplicate legacy string lists on the client DTO.
 */
const enrichClientWithNutritionRestrictionIds = async (
    publicProfile,
    clientId,
    trainerId
) => {
    if (!clientId || !trainerId) {
        return publicProfile;
    }

    try {
        const nutrition = await nutritionProfileService.getNutritionProfile(
            clientId,
            trainerId
        );
        if (!nutrition) {
            return publicProfile;
        }

        return {
            ...publicProfile,
            allergyOptionIds: nutrition.allergyOptionIds ?? [],
            dietaryRestrictionOptionIds:
                nutrition.dietaryRestrictionOptionIds ?? [],
        };
    } catch {
        return publicProfile;
    }
};

/**
 * Apply allowlisted User fields; does not save.
 *
 * @param {import('mongoose').Document} client
 * @param {Record<string, unknown>} patch
 * @param {readonly string[]} allowedKeys
 */
const applyAllowlistedUserUpdates = (client, patch, allowedKeys) => {
    const userPatch = pickAllowedUpdateFields(patch, allowedKeys);

    for (const [key, value] of Object.entries(userPatch)) {
        if (key === 'phone' || key === 'additionalNotes' || key === 'medicalConditions' || key === 'injuries') {
            const normalized = normalizeOptionalStringField(value);
            if (normalized === undefined) {
                client[key] = undefined;
            } else {
                client[key] = normalized;
            }
            continue;
        }
        client[key] = value;
    }

    if (
        userPatch.startDate !== undefined ||
        userPatch.packageDuration !== undefined ||
        userPatch.endDate !== undefined
    ) {
        applyCoachingPackageEndDate(client);
    }
};

const applyInjuryUpdates = async (client, { injuryAreaOptionIds, injuryDetails }) => {
    if (injuryAreaOptionIds !== undefined) {
        const validated = await validateHealthOptionIdsForCategory({
            category: 'body_area',
            requestedIds: injuryAreaOptionIds,
            existingIds: (client.injuryAreaOptionIds ?? []).map((id) => id.toString()),
            fieldName: 'injuryAreaOptionIds',
        });
        client.injuryAreaOptionIds = mapInjuryAreaIdsToObjectIds(validated ?? []);
    }

    if (injuryDetails !== undefined) {
        client.injuryDetails =
            injuryDetails === '' || injuryDetails == null
                ? null
                : String(injuryDetails).trim();
    }
};

const applyNutritionRestrictionUpdates = async (
    clientId,
    trainerId,
    updateData
) => {
    const nutritionPatch = pickAllowedUpdateFields(
        updateData,
        CLIENT_NUTRITION_PROFILE_UPDATE_FIELDS
    );
    if (Object.keys(nutritionPatch).length === 0) {
        return;
    }

    await nutritionProfileService.upsertNutritionProfile(
        clientId,
        nutritionPatch,
        trainerId
    );
};

/**
 * Create a new client (creates User with role='client' and fitness data)
 */
const createClient = async (clientData, trainerId) => {
    const {
        allergyOptionIds,
        dietaryRestrictionOptionIds,
        injuryAreaOptionIds,
        injuryDetails,
        ...restClientData
    } = clientData;

    // 1. Check if user with this email already exists
    const existingUser = await User.findByEmail(restClientData.email);
    if (existingUser) {
        if (
            existingUser.role === 'client' &&
            !existingUser.isActive &&
            existingUser.trainer?.toString() === String(trainerId)
        ) {
            throw new ApiError(
                409,
                'This client was deactivated. Reactivate them instead of creating a duplicate account.',
                [
                    {
                        field: 'email',
                        message:
                            'A deactivated client with this email already exists on your roster.',
                        code: 'CLIENT_INACTIVE_REACTIVATE',
                    },
                ]
            );
        }
        throw new ApiError(400, 'User with this email already exists');
    }

    // 2. Verify trainer exists and has trainer role
    const trainer = await User.findById(trainerId);
    if (!trainer) {
        throw new ApiError(404, 'Trainer not found');
    }
    if (trainer.role !== 'trainer') {
        throw new ApiError(403, 'Only trainers can add clients');
    }

    const validatedInjuryAreaIds = await validateHealthOptionIdsForCategory({
        category: 'body_area',
        requestedIds: injuryAreaOptionIds,
        existingIds: [],
        fieldName: 'injuryAreaOptionIds',
    });

    const nutritionCreateBody = {};
    if (allergyOptionIds !== undefined) {
        nutritionCreateBody.allergyOptionIds = allergyOptionIds;
    }
    if (dietaryRestrictionOptionIds !== undefined) {
        nutritionCreateBody.dietaryRestrictionOptionIds = dietaryRestrictionOptionIds;
    }

    if (nutritionCreateBody.allergyOptionIds !== undefined) {
        await validateHealthOptionIdsForCategory({
            category: 'allergy',
            requestedIds: nutritionCreateBody.allergyOptionIds,
            existingIds: [],
            fieldName: 'allergyOptionIds',
        });
    }
    if (nutritionCreateBody.dietaryRestrictionOptionIds !== undefined) {
        await validateHealthOptionIdsForCategory({
            category: 'dietary_restriction',
            requestedIds: nutritionCreateBody.dietaryRestrictionOptionIds,
            existingIds: [],
            fieldName: 'dietaryRestrictionOptionIds',
        });
    }

    // 3. Create User with client role and all fitness data
    const userData = {
        // Personal information
        firstName: restClientData.firstName,
        lastName: restClientData.lastName,
        email: restClientData.email,
        password: restClientData.password,
        phone: restClientData.phone,
        dateOfBirth: restClientData.dateOfBirth,
        gender: restClientData.gender,
        role: 'client',
        trainer: trainerId,

        // Fitness information (optional)
        primaryFitnessGoal: restClientData.primaryFitnessGoal,
        currentWeight: restClientData.currentWeight,
        targetWeight: restClientData.targetWeight,
        height: restClientData.height,
        experienceLevel: restClientData.experienceLevel,

        // Program details (optional)
        programType: restClientData.programType,
        sessionsPerWeek: restClientData.sessionsPerWeek,
        startDate: restClientData.startDate,
        packageDuration: restClientData.packageDuration,
        endDate: restClientData.endDate,

        // Additional information (optional)
        additionalNotes: restClientData.additionalNotes,
        medicalConditions: restClientData.medicalConditions,
        injuries: restClientData.injuries,
        injuryAreaOptionIds:
            validatedInjuryAreaIds !== undefined
                ? mapInjuryAreaIdsToObjectIds(validatedInjuryAreaIds)
                : undefined,
        injuryDetails:
            injuryDetails === '' || injuryDetails == null
                ? null
                : injuryDetails,
    };

    if (userData.injuryAreaOptionIds === undefined) {
        delete userData.injuryAreaOptionIds;
    }

    applyCoachingPackageEndDate(userData);

    let client;
    try {
        client = await User.create(userData);

        if (Object.keys(nutritionCreateBody).length > 0) {
            await nutritionProfileService.createNutritionProfileForNewClient(
                client._id.toString(),
                trainerId,
                nutritionCreateBody
            );
        }
    } catch (err) {
        if (client?._id) {
            try {
                await NutritionProfile.deleteMany({ clientId: client._id });
                await User.findByIdAndDelete(client._id);
            } catch (rollbackErr) {
                const original = err?.message || String(err);
                const rollback = rollbackErr?.message || String(rollbackErr);
                throw new ApiError(
                    500,
                    `Client creation failed (${original}) and rollback failed (${rollback})`
                );
            }
        }
        throw err;
    }

    // Populate trainer info and return
    await client.populate('trainer', 'firstName lastName email');
    const profile = client.getPublicProfile();
    return enrichClientPublicProfileWithInjuryAreas(profile);
};

/**
 * GET /clients list payload: paginated or search rows + roster summary (same scope).
 */
const listTrainerClients = async (
    trainerId,
    { page = 1, limit = 10, search, status, packageDuration } = {}
) => {
    const scopeQuery = buildClientListScopeQuery(trainerId, {
        search,
        status,
        packageDuration,
    });

    const summaryPromise = buildClientListSummary(scopeQuery);

    if (search && String(search).trim()) {
        const clients = await User.find(scopeQuery)
            .populate('trainer', 'firstName lastName email')
            .sort({ createdAt: -1 });

        const enriched = await enrichClientListRows(
            trainerId,
            clients.map((client) => client.getPublicProfile())
        );

        const summary = await summaryPromise;

        return {
            clients: enriched,
            pagination: {
                page: 1,
                limit: enriched.length,
                total: enriched.length,
                pages: enriched.length > 0 ? 1 : 0,
            },
            summary,
        };
    }

    const listResult = await getClientsByTrainer(
        trainerId,
        scopeQuery,
        { page, limit }
    );
    const summary = await summaryPromise;

    return {
        ...listResult,
        summary,
    };
};

/**
 * Paginated clients for a pre-built scope query (trainer roster slice).
 */
const getClientsByTrainer = async (trainerId, scopeQuery, pagination = {}) => {
    const { page = 1, limit = 10 } = pagination;
    const skip = (page - 1) * limit;

    const total = await User.countDocuments(scopeQuery);

    const clients = await User.find(scopeQuery)
        .populate('trainer', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    return {
        clients: await enrichClientListRows(
            trainerId,
            clients.map((client) => client.getPublicProfile())
        ),
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit) || 0,
        },
    };
};

/**
 * Get client by ID
 */
const getClientById = async (clientId, trainerId = null) => {
    const client = await User.findOne({
        _id: clientId,
        role: 'client',
    }).populate('trainer', 'firstName lastName email');

    if (!client) {
        throw new ApiError(404, 'Client not found');
    }

    // If trainerId is provided, verify the client belongs to this trainer
    if (
        trainerId &&
        client.trainer &&
        client.trainer._id.toString() !== trainerId.toString()
    ) {
        throw new ApiError(403, 'You do not have access to this client');
    }

    const profile = client.getPublicProfile();
    const withInjuries = await enrichClientPublicProfileWithInjuryAreas(profile);
    return enrichClientWithNutritionRestrictionIds(
        withInjuries,
        clientId,
        trainerId
    );
};

/**
 * Update client profile (personal, fitness, health, package, allergies/dietary restrictions).
 */
const updateClient = async (clientId, updateData, trainerId = null) => {
    const client = await loadClientForCoachMutation(clientId, trainerId);

    await applyInjuryUpdates(client, updateData);
    applyAllowlistedUserUpdates(client, updateData, CLIENT_FULL_UPDATE_FIELDS);
    await client.save();

    await applyNutritionRestrictionUpdates(
        clientId,
        trainerId,
        updateData
    );

    return buildClientResponse(client, clientId, trainerId);
};

/**
 * Update coaching package / fitness fields only (BFF PUT /clients/:id/plan).
 */
const updateClientPlan = async (clientId, updateData, trainerId = null) => {
    const client = await loadClientForCoachMutation(clientId, trainerId);

    applyAllowlistedUserUpdates(client, updateData, CLIENT_PLAN_UPDATE_FIELDS);
    await client.save();

    return buildClientResponse(client, clientId, trainerId);
};

/**
 * Delete client (soft delete - deactivate)
 */
const deleteClient = async (clientId, trainerId = null) => {
    const client = await loadClientForCoachMutation(clientId, trainerId);

    try {
        await completeClientDeactivation(
            client._id,
            trainerId,
            Boolean(client.isActive)
        );
    } catch (err) {
        const detail = err?.message || String(err);
        throw new ApiError(500, 'Failed to deactivate client', [
            { field: 'clientId', message: detail },
        ]);
    }

    const refreshed = await User.findById(client._id);
    if (!refreshed || refreshed.isActive) {
        throw new ApiError(500, 'Failed to deactivate client', [
            {
                field: 'clientId',
                message:
                    'Deactivation did not complete. Retry the request; cancelled assignments are not restored automatically.',
            },
        ]);
    }

    return refreshed.getPublicProfile();
};

/**
 * Reactivate a previously deactivated client (same user document; no assignment restore).
 */
const reactivateClient = async (clientId, trainerId) => {
    const client = await loadClientForCoachMutation(clientId, trainerId);

    if (client.isActive) {
        const profile = client.getPublicProfile();
        return enrichClientPublicProfileWithInjuryAreas(profile);
    }

    client.isActive = true;
    await client.save();

    await client.populate('trainer', 'firstName lastName email');
    const profile = client.getPublicProfile();
    return enrichClientPublicProfileWithInjuryAreas(profile);
};

/**
 * Add progress note to client
 */
const addProgressNote = async (clientId, noteData, trainerId = null) => {
    const client = await User.findOne({
        _id: clientId,
        role: 'client',
    });

    if (!client) {
        throw new ApiError(404, 'Client not found');
    }

    // Verify trainer has access
    if (trainerId && client.trainer?.toString() !== trainerId.toString()) {
        throw new ApiError(403, 'You do not have access to this client');
    }

    // Add progress note using the User model's method
    await client.addProgressNote(
        noteData.weight,
        noteData.notes,
        trainerId
    );

    await client.populate('trainer', 'firstName lastName email');
    return client.getPublicProfile();
};

/**
 * Get client statistics for a trainer
 */
const getTrainerStats = async (trainerId) => {
    const stats = await User.aggregate([
        {
            $match: {
                role: 'client',
                trainer: trainerId,
            },
        },
        {
            $group: {
                _id: null,
                totalClients: { $sum: 1 },
                activeClients: {
                    $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] },
                },
                inactiveClients: {
                    $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] },
                },
            },
        },
    ]);

    return (
        stats[0] || {
            totalClients: 0,
            activeClients: 0,
            inactiveClients: 0,
        }
    );
};

/**
 * Workout assignment bulk lookup + subscription needsAttention (no extra DB reads).
 */
const enrichClientListRows = async (trainerId, profiles) => {
    const withWorkout = await attachWorkoutPlanAssignments(trainerId, profiles);
    return attachSubscriptionNeedsAttention(withWorkout);
};

const attachSubscriptionNeedsAttention = (profiles) => {
    if (!Array.isArray(profiles)) {
        return profiles;
    }
    return profiles.map((client) => ({
        ...client,
        needsAttention: resolveSubscriptionNeedsAttention({
            startDate: client.startDate,
            packageDuration: client.packageDuration,
            endDate: client.endDate,
            isActive: client.isActive,
        }),
    }));
};

/**
 * Attach the current workout assignment (or null) using the same DTO as
 * GET /clients/:id/workout-plan-assignment. One batch lookup per list/search.
 */
const attachWorkoutPlanAssignments = async (trainerId, profiles) => {
    if (!Array.isArray(profiles) || profiles.length === 0) {
        return profiles;
    }

    const assignments = await workoutPlanService.getActiveAssignmentsForClients(
        trainerId,
        profiles.map((client) => client.id)
    );

    return profiles.map((client) => ({
        ...client,
        workoutPlanAssignment:
            assignments.get(String(client.id)) ?? null,
    }));
};

export default {
    createClient,
    listTrainerClients,
    getClientsByTrainer,
    getClientById,
    updateClient,
    updateClientPlan,
    deleteClient,
    reactivateClient,
    addProgressNote,
    getTrainerStats,
};
