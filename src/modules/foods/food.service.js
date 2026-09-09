import mongoose from 'mongoose';
import { paginateCollection } from '../../utils/pagination.js';
import Food from './food.model.js';
import { ApiError } from '../../utils/ApiError.js';
import { FATSECRET_PROVIDER } from './food.constants.js';
import {
    buildFoodOwnershipFilter,
    buildFoodVisibilityFilter,
    canModifyFood,
    canReadFood,
    escapeRegex,
    normalizeNutritionPer100g,
    resolveFoodSort,
    toPublicFood,
    validateDefaultServing,
} from './food.helpers.js';
import { resolveSearchExpression } from '../../integrations/fatsecret/fatsecret.constants.js';
import { getFoodById as getFatSecretFoodById, searchFoods as searchFatSecretFoods } from '../../integrations/fatsecret/fatsecret.client.js';
import {
    extractFatSecretFoodId,
    extractFoodGetPayload,
    extractSearchFoods,
    extractSearchMeta,
    mapFatSecretFoodToFitlyFood,
    mapSearchFoodToFitlyFood,
} from '../../integrations/fatsecret/fatsecret.mapper.js';
import { validateMappedFood } from '../../integrations/fatsecret/fatsecret.validator.js';

/**
 * Food Service — catalog CRUD (Phase 2)
 */

const isValidObjectId = (id) =>
    mongoose.Types.ObjectId.isValid(id) &&
    new mongoose.Types.ObjectId(id).toString() === String(id);

const emptyToNull = (value) => (value === '' || value === undefined ? null : value);

/**
 * Build Mongo filter from validated query + trainer identity.
 *
 * @param {object} query
 * @param {string} trainerId
 */
const buildListFilter = (query, trainerId) => {
    const {
        search,
        category,
        ownership = 'all',
        status = 'active',
    } = query;

    const conditions = [buildFoodOwnershipFilter(trainerId, ownership)];

    if (status) {
        conditions.push({ status });
    }

    if (category) {
        conditions.push({ category });
    }

    if (search && String(search).trim()) {
        const regex = new RegExp(escapeRegex(String(search).trim()), 'i');
        conditions.push({
            $or: [{ name: regex }, { brand: regex }, { normalizedName: regex }],
        });
    }

    return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

/**
 * @param {object} query
 * @param {string} trainerId
 */
const getFoods = async (query, trainerId) => {
    const filter = buildListFilter(query, trainerId);
    const sort = resolveFoodSort(query.sort);

    const { docs, pagination } = await paginateCollection({
        model: Food,
        filter,
        sort,
        page: query.page,
        limit: query.limit,
    });

    return {
        foods: docs.map((food) => toPublicFood(food)),
        pagination,
    };
};

/**
 * @param {string} foodId
 * @param {string} trainerId
 */
const getFoodById = async (foodId, trainerId) => {
    if (!isValidObjectId(foodId)) {
        throw new ApiError(400, 'Invalid food ID');
    }

    const food = await Food.findOne({
        $and: [{ _id: foodId }, buildFoodVisibilityFilter(trainerId)],
    });

    if (!food || !canReadFood(food, trainerId)) {
        throw new ApiError(404, 'Food not found');
    }

    return toPublicFood(food);
};

/**
 * Lookup food by barcode in local catalog only (no external API).
 *
 * @param {string} barcode
 * @param {string} trainerId
 */
const getFoodByBarcode = async (barcode, trainerId) => {
    const normalizedBarcode = String(barcode || '').trim();
    if (!normalizedBarcode) {
        throw new ApiError(400, 'Barcode is required');
    }

    const food = await Food.findOne({
        $and: [
            buildFoodVisibilityFilter(trainerId),
            { 'source.barcode': normalizedBarcode },
        ],
    });

    if (!food || !canReadFood(food, trainerId)) {
        throw new ApiError(404, 'Food not found');
    }

    return toPublicFood(food);
};

/**
 * @param {object} body
 * @param {string} trainerId
 */
const createFood = async (body, trainerId) => {
    const servingCheck = validateDefaultServing(body.defaultServing);
    if (!servingCheck.valid) {
        throw new ApiError(400, servingCheck.message, [
            { field: 'defaultServing', message: servingCheck.message },
        ]);
    }

    const food = new Food({
        trainerId,
        ownership: {
            type: 'trainer',
            trainerId,
        },
        name: body.name.trim(),
        brand: emptyToNull(body.brand),
        category: body.category,
        status: 'active',
        nutritionPer100g: normalizeNutritionPer100g(body.nutritionPer100g),
        defaultServing: {
            quantity: body.defaultServing.quantity,
            unit: body.defaultServing.unit,
            gramWeight: body.defaultServing.gramWeight,
        },
        source: {
            type: 'manual',
            externalProvider: null,
            externalId: null,
        },
    });

    await food.save();
    return toPublicFood(food);
};

/**
 * Load food for mutation with authorization semantics:
 * - missing → 404
 * - system → 403
 * - foreign trainer → 404 (no ownership leak)
 * - own trainer → document
 *
 * @param {string} foodId
 * @param {string} trainerId
 */
const loadModifiableFood = async (foodId, trainerId) => {
    if (!isValidObjectId(foodId)) {
        throw new ApiError(400, 'Invalid food ID');
    }

    const food = await Food.findById(foodId);
    if (!food) {
        throw new ApiError(404, 'Food not found');
    }

    if (food.ownership?.type === 'system') {
        throw new ApiError(403, 'System foods cannot be modified');
    }

    if (!canModifyFood(food, trainerId)) {
        throw new ApiError(404, 'Food not found');
    }

    return food;
};

/**
 * @param {string} foodId
 * @param {object} body
 * @param {string} trainerId
 */
const updateFood = async (body, foodId, trainerId) => {
    const food = await loadModifiableFood(foodId, trainerId);

    if (body.name !== undefined) {
        food.name = body.name.trim();
    }
    if (body.brand !== undefined) {
        food.brand = emptyToNull(body.brand);
    }
    if (body.category !== undefined) {
        food.category = body.category;
    }
    if (body.nutritionPer100g !== undefined) {
        food.nutritionPer100g = normalizeNutritionPer100g({
            ...food.nutritionPer100g?.toObject?.() ?? food.nutritionPer100g,
            ...body.nutritionPer100g,
        });
    }
    if (body.defaultServing !== undefined) {
        const nextServing = {
            quantity:
                body.defaultServing.quantity ?? food.defaultServing?.quantity,
            unit: body.defaultServing.unit ?? food.defaultServing?.unit,
            gramWeight:
                body.defaultServing.gramWeight ?? food.defaultServing?.gramWeight,
        };
        const servingCheck = validateDefaultServing(nextServing);
        if (!servingCheck.valid) {
            throw new ApiError(400, servingCheck.message, [
                { field: 'defaultServing', message: servingCheck.message },
            ]);
        }
        food.defaultServing = nextServing;
    }

    await food.save();
    return toPublicFood(food);
};

/**
 * Live FatSecret search. Does not persist catalog foods.
 *
 * @param {object} query
 */
const searchExternalFoods = async (query) => {
    const { expression, isBrowseDefault } = resolveSearchExpression(query.q, query.foodType);

    const result = await searchFatSecretFoods({
        query: expression,
        pageNumber: query.fatsecretPage,
        maxResults: query.limit,
        foodType: query.foodType,
        region: query.region,
        language: query.language,
    });

    const rawFoods = extractSearchFoods(result.json);
    let foods = rawFoods.map(mapSearchFoodToFitlyFood).filter(Boolean);

    if (!result.supportsFoodType && query.foodType && query.foodType !== 'all') {
        foods = foods.filter((food) => food.type === query.foodType);
    }

    const meta = extractSearchMeta(result.json);
    const total = result.supportsFoodType ? meta.totalResults : foods.length;
    const pages = Math.ceil((result.supportsFoodType ? meta.totalResults : foods.length) / query.limit) || 0;

    return {
        foods,
        pagination: {
            page: query.page,
            limit: query.limit,
            total,
            pages,
        },
        meta: {
            provider: FATSECRET_PROVIDER,
            method: result.method,
            scope: result.scope,
            supportsFoodType: result.supportsFoodType,
            effectiveQuery: expression,
            browseDefault: isBrowseDefault,
        },
    };
};

/**
 * Persist selected FatSecret foods as system Fitly Food documents.
 * Idempotent by source.externalProvider + source.externalId.
 * Never overwrites trainer-owned foods.
 *
 * @param {string[]} externalIds
 * @param {string} trainerId
 */
const materializeExternalFoods = async (externalIds = [], trainerId) => {
    const ids = [...new Set(externalIds.map(extractFatSecretFoodId).filter(Boolean))];
    if (!ids.length) {
        throw new ApiError(400, 'At least one FatSecret food id is required');
    }

    const foods = [];

    for (const externalId of ids) {
        const existing = await Food.findOne({
            'source.externalProvider': FATSECRET_PROVIDER,
            'source.externalId': externalId,
        });

        if (existing) {
            if (existing.ownership?.type !== 'system') {
                throw new ApiError(409, `Food ${externalId} conflicts with a trainer-owned food`);
            }
            if (!canReadFood(existing, trainerId)) {
                throw new ApiError(404, 'Food not found');
            }
            foods.push(toPublicFood(existing));
            continue;
        }

        const detailJson = await getFatSecretFoodById(externalId);
        const payload = mapFatSecretFoodToFitlyFood(extractFoodGetPayload(detailJson));
        const mappedCheck = validateMappedFood(payload);
        if (!payload || !mappedCheck.valid) {
            throw new ApiError(422, `FatSecret food ${externalId} does not have usable nutrition data`);
        }

        const created = await Food.create(payload);
        foods.push(toPublicFood(created));
    }

    return { foods };
};

/**
 * Soft archive — status = archived.
 *
 * @param {string} foodId
 * @param {string} trainerId
 */
const archiveFood = async (foodId, trainerId) => {
    const food = await loadModifiableFood(foodId, trainerId);
    food.status = 'archived';
    await food.save();
    return toPublicFood(food);
};

export default {
    getFoods,
    getFoodById,
    getFoodByBarcode,
    searchExternalFoods,
    materializeExternalFoods,
    createFood,
    updateFood,
    archiveFood,
};
