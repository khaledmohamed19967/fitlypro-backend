import foodService from './food.service.js';
import { validateFoodQuery, validateFoodSearchQuery } from './food.validator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Food Controller — catalog CRUD (Phase 2)
 */

/**
 * @desc    List foods (system + current trainer)
 * @route   GET /api/v1/foods
 * @access  Private (Trainer / Admin)
 */
export const getFoods = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;

    const { error, value } = validateFoodQuery.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
    });

    if (error) {
        const errors = error.details.map((detail) => ({
            field: detail.path.join('.'),
            message: detail.message,
        }));
        throw new ApiError(400, 'Validation failed', errors);
    }

    const result = await foodService.getFoods(value, trainerId);

    res.status(200).json(new ApiResponse(200, result, 'Foods retrieved successfully'));
});

/**
 * @desc    Create trainer-owned custom food
 * @route   POST /api/v1/foods
 * @access  Private (Trainer / Admin)
 */
export const createFood = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const food = await foodService.createFood(req.body, trainerId);

    res.status(201).json(new ApiResponse(201, food, 'Food created successfully'));
});

/**
 * @desc    Get food by ID
 * @route   GET /api/v1/foods/:id
 * @access  Private (Trainer / Admin)
 */
export const getFoodById = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const food = await foodService.getFoodById(req.params.id, trainerId);

    res.status(200).json(new ApiResponse(200, food, 'Food retrieved successfully'));
});

/**
 * @desc    Get food by barcode (local catalog only)
 * @route   GET /api/v1/foods/barcode/:barcode
 * @access  Private (Trainer / Admin)
 */
export const getFoodByBarcode = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const food = await foodService.getFoodByBarcode(req.params.barcode, trainerId);

    res.status(200).json(new ApiResponse(200, food, 'Food retrieved successfully'));
});

/**
 * @desc    Live FatSecret food search (not persisted)
 * @route   GET /api/v1/foods/search
 * @access  Private (Trainer / Admin)
 */
export const searchExternalFoods = asyncHandler(async (req, res) => {
    const { error, value } = validateFoodSearchQuery.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
    });

    if (error) {
        const errors = error.details.map((detail) => ({
            field: detail.path.join('.'),
            message: detail.message,
        }));
        throw new ApiError(400, 'Validation failed', errors);
    }

    const rawPage = value.page;
    const result = await foodService.searchExternalFoods({
        q: value.q || value.search || '',
        foodType: value.foodType,
        region: value.region,
        language: value.language,
        page: rawPage < 1 ? 1 : rawPage,
        fatsecretPage: rawPage < 1 ? 0 : rawPage - 1,
        limit: value.limit,
    });
    res.status(200).json(new ApiResponse(200, result, 'Foods retrieved successfully'));
});

/**
 * @desc    Materialize selected FatSecret foods into Fitly Food collection
 * @route   POST /api/v1/foods/from-external
 * @access  Private (Trainer / Admin)
 */
export const materializeExternalFoods = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const ids = [
        ...(Array.isArray(req.body?.externalIds) ? req.body.externalIds : []),
        ...(Array.isArray(req.body?.foods)
            ? req.body.foods.map((item) => item?.externalId || item?.id)
            : []),
        req.body?.externalId,
        req.body?.id,
    ].filter(Boolean);

    const result = await foodService.materializeExternalFoods(ids, trainerId);
    res.status(200).json(new ApiResponse(200, result, 'Foods ready'));
});

/**
 * @desc    Update trainer-owned food
 * @route   PATCH /api/v1/foods/:id
 * @access  Private (Trainer / Admin — own foods only)
 */
export const updateFood = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const food = await foodService.updateFood(req.body, req.params.id, trainerId);

    res.status(200).json(new ApiResponse(200, food, 'Food updated successfully'));
});

/**
 * @desc    Archive trainer-owned food (soft delete)
 * @route   DELETE /api/v1/foods/:id
 * @access  Private (Trainer / Admin — own foods only)
 */
export const archiveFood = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const food = await foodService.archiveFood(req.params.id, trainerId);

    res.status(200).json(new ApiResponse(200, food, 'Food archived successfully'));
});
