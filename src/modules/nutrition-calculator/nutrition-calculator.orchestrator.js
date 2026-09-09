/**
 * Nutrition Calculator orchestration — resolves Client + Profile inputs,
 * runs pure calculator, optionally persists recommendation snapshots.
 */

import NutritionProfile from '../nutrition-profiles/nutrition-profile.model.js';
import NutritionRecommendation from './nutrition-recommendation.model.js';
import { calculateNutritionRecommendation } from './nutrition-calculator.service.js';
import { mapNutritionRecommendationToPublic } from './nutrition-recommendation.helpers.js';
import { mapRecommendationToPlanPrefill } from './nutrition-recommendation-plan-prefill.js';
import {
    loadAccessibleClientDocument,
    resolveCalculatorSex,
    resolveHeightCm,
    resolveWeightKg,
    isValidObjectId,
} from '../nutrition-profiles/nutrition-profile.helpers.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Build calculator input from Client (source of truth) + Profile + request overrides.
 *
 * @param {import('mongoose').Document} client
 * @param {object|null} profile
 * @param {object} body
 */
const buildCalculatorInput = (client, profile, body = {}) => {
    const activityLevel = body.activityLevel ?? profile?.activityLevel ?? null;
    if (!activityLevel) {
        throw new ApiError(
            400,
            'Activity level is required — set it on the nutrition profile or pass activityLevel in the request'
        );
    }

    const dateOfBirth = body.dateOfBirth ?? client.dateOfBirth ?? null;
    const sex = resolveCalculatorSex(client, body.sex);

    return {
        sex,
        dateOfBirth,
        age: dateOfBirth ? undefined : body.age,
        heightCm: resolveHeightCm(client, body.heightCm),
        weightKg: resolveWeightKg(client, body.weightKg),
        activityLevel,
        goal: body.goal,
    };
};

/**
 * @param {string} clientId
 * @param {object} body
 * @param {string} trainerId
 */
const calculateForClient = async (clientId, body, trainerId) => {
    const client = await loadAccessibleClientDocument(clientId, trainerId);
    const profile = await NutritionProfile.findOne({ clientId: client._id });

    const input = buildCalculatorInput(client, profile, body);
    const recommendation = calculateNutritionRecommendation(input);

    return {
        recommendation,
        sources: {
            heightCm: 'client.height',
            weightKg: 'client.currentWeight',
            dateOfBirth: client.dateOfBirth ? 'client.dateOfBirth' : 'request',
            sex: body.sex ? 'request.sex' : 'client.gender',
            activityLevel: body.activityLevel
                ? 'request.activityLevel'
                : 'nutritionProfile.activityLevel',
        },
    };
};

/**
 * Recalculate and persist a recommendation snapshot (approved by default).
 *
 * @param {string} clientId
 * @param {object} body
 * @param {string} trainerId
 */
const createRecommendation = async (clientId, body, trainerId) => {
    const { recommendation } = await calculateForClient(clientId, body, trainerId);
    const { inputs, results, calculatedAt } = recommendation;

    const doc = await NutritionRecommendation.create({
        clientId,
        trainerId,
        calculatedAt: new Date(calculatedAt),
        status: body.status ?? 'approved',
        sex: inputs.sex,
        age: inputs.age,
        dateOfBirth: inputs.dateOfBirth ? new Date(inputs.dateOfBirth) : null,
        heightCm: inputs.heightCm,
        weightKg: inputs.weightKg,
        activityLevel: inputs.activityLevel,
        goal: inputs.goal,
        bmr: results.bmr,
        activityFactor: results.activityFactor,
        maintenanceCalories: results.maintenanceCalories,
        calorieAdjustment: results.calorieAdjustment,
        recommendedCalories: results.recommendedCalories,
        recommendedMacros: results.recommendedMacros,
        finalCalories: body.finalCalories ?? null,
        finalMacros: body.finalMacros ?? null,
        notes: body.notes === '' || body.notes == null ? null : body.notes,
        macroMethodology: results.macroMethodology,
    });

    return mapNutritionRecommendationToPublic(doc);
};

/**
 * @param {string} clientId
 * @param {string} trainerId
 * @param {{ limit?: number }} [options]
 */
const listRecommendations = async (clientId, trainerId, options = {}) => {
    await loadAccessibleClientDocument(clientId, trainerId);
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);

    const docs = await NutritionRecommendation.find({ clientId, trainerId })
        .sort({ calculatedAt: -1 })
        .limit(limit);

    return docs.map(mapNutritionRecommendationToPublic);
};

/**
 * @param {string} clientId
 * @param {string} recommendationId
 * @param {string} trainerId
 */
const getRecommendationById = async (clientId, recommendationId, trainerId) => {
    await loadAccessibleClientDocument(clientId, trainerId);

    if (!isValidObjectId(recommendationId)) {
        throw new ApiError(400, 'Invalid recommendation ID');
    }

    const doc = await NutritionRecommendation.findOne({
        _id: recommendationId,
        clientId,
        trainerId,
    });

    if (!doc) {
        throw new ApiError(404, 'Nutrition recommendation not found');
    }

    return mapNutritionRecommendationToPublic(doc);
};

/**
 * Builder-friendly prefill values from an approved recommendation.
 * Does not create or link a Nutrition Plan.
 *
 * @param {string} clientId
 * @param {string} recommendationId
 * @param {string} trainerId
 */
const getPlanPrefill = async (clientId, recommendationId, trainerId) => {
    await loadAccessibleClientDocument(clientId, trainerId);

    if (!isValidObjectId(recommendationId)) {
        throw new ApiError(400, 'Invalid recommendation ID');
    }

    const doc = await NutritionRecommendation.findOne({
        _id: recommendationId,
        clientId,
        trainerId,
    });

    if (!doc) {
        throw new ApiError(404, 'Nutrition recommendation not found');
    }

    return mapRecommendationToPlanPrefill(doc);
};

/**
 * @param {string} clientId
 * @param {string} recommendationId
 * @param {object} body
 * @param {string} trainerId
 */
const updateRecommendation = async (clientId, recommendationId, body, trainerId) => {
    await loadAccessibleClientDocument(clientId, trainerId);

    if (!isValidObjectId(recommendationId)) {
        throw new ApiError(400, 'Invalid recommendation ID');
    }

    const doc = await NutritionRecommendation.findOne({
        _id: recommendationId,
        clientId,
        trainerId,
    });

    if (!doc) {
        throw new ApiError(404, 'Nutrition recommendation not found');
    }

    if (body.status !== undefined) doc.status = body.status;
    if (body.finalCalories !== undefined) doc.finalCalories = body.finalCalories;
    if (body.finalMacros !== undefined) doc.finalMacros = body.finalMacros;
    if (body.notes !== undefined) {
        doc.notes = body.notes === '' || body.notes == null ? null : body.notes;
    }

    await doc.save();
    return mapNutritionRecommendationToPublic(doc);
};

export default {
    calculateForClient,
    createRecommendation,
    listRecommendations,
    getRecommendationById,
    getPlanPrefill,
    updateRecommendation,
};
