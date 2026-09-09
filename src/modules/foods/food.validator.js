import Joi from 'joi';
import {
    FOOD_CATEGORIES,
    FOOD_STATUSES,
    OWNERSHIP_FILTERS,
    SERVING_UNITS,
    FOOD_SORT_OPTIONS,
} from './food.constants.js';
import { validateDefaultServing } from './food.helpers.js';

/**
 * Food validation schemas (Joi)
 */

const forbiddenServerFields = {
    ownership: Joi.forbidden(),
    trainerId: Joi.forbidden(),
    source: Joi.forbidden(),
    status: Joi.forbidden(),
    _id: Joi.forbidden(),
    createdAt: Joi.forbidden(),
    updatedAt: Joi.forbidden(),
};

const nutritionPer100gSchema = Joi.object({
    calories: Joi.number().min(0).required().messages({
        'number.min': 'Calories cannot be negative',
        'any.required': 'Calories is required',
    }),
    protein: Joi.number().min(0).required().messages({
        'number.min': 'Protein cannot be negative',
        'any.required': 'Protein is required',
    }),
    carbs: Joi.number().min(0).required().messages({
        'number.min': 'Carbs cannot be negative',
        'any.required': 'Carbs is required',
    }),
    fat: Joi.number().min(0).required().messages({
        'number.min': 'Fat cannot be negative',
        'any.required': 'Fat is required',
    }),
    fiber: Joi.number().min(0).optional().allow(null),
    sugar: Joi.number().min(0).optional().allow(null),
    sodium: Joi.number().min(0).optional().allow(null),
});

const defaultServingSchema = Joi.object({
    quantity: Joi.number().greater(0).required().messages({
        'number.greater': 'Default serving quantity must be greater than 0',
        'any.required': 'Default serving quantity is required',
    }),
    unit: Joi.string()
        .valid(...SERVING_UNITS)
        .required()
        .messages({
            'any.only': 'Default serving unit must be g, kg, ml, l, piece, or serving',
            'any.required': 'Default serving unit is required',
        }),
    gramWeight: Joi.number().greater(0).required().messages({
        'number.greater': 'Gram weight must be greater than 0',
        'any.required': 'Gram weight is required',
    }),
}).custom((value, helpers) => {
    const result = validateDefaultServing(value);
    if (!result.valid) {
        return helpers.error('defaultServing.invalid');
    }
    return value;
}).messages({
    'defaultServing.invalid': 'Gram weight is required for piece/serving default serving units',
});

const foodContentFields = {
    name: Joi.string().trim().min(2).max(120).messages({
        'string.min': 'Name must be at least 2 characters',
        'string.max': 'Name cannot exceed 120 characters',
    }),
    brand: Joi.string().trim().max(120).optional().allow('', null),
    category: Joi.string()
        .valid(...FOOD_CATEGORIES)
        .messages({
            'any.only': 'Category must be a valid food category',
        }),
    nutritionPer100g: nutritionPer100gSchema,
    defaultServing: defaultServingSchema,
};

/**
 * Create food — trainer-controlled fields only.
 */
export const validateCreateFood = Joi.object({
    name: foodContentFields.name.required().messages({
        'any.required': 'Name is required',
    }),
    brand: foodContentFields.brand,
    category: foodContentFields.category.required().messages({
        'any.required': 'Category is required',
    }),
    nutritionPer100g: foodContentFields.nutritionPer100g.required().messages({
        'any.required': 'Nutrition per 100g is required',
    }),
    defaultServing: foodContentFields.defaultServing.required().messages({
        'any.required': 'Default serving is required',
    }),
    ...forbiddenServerFields,
});

/**
 * Update food — partial content fields.
 */
export const validateUpdateFood = Joi.object({
    name: foodContentFields.name.optional(),
    brand: foodContentFields.brand,
    category: foodContentFields.category.optional(),
    nutritionPer100g: nutritionPer100gSchema.optional(),
    defaultServing: defaultServingSchema.optional(),
    ...forbiddenServerFields,
}).min(1);

/**
 * List/search query schema.
 */
export const validateFoodQuery = Joi.object({
    search: Joi.string().trim().max(100).optional().allow(''),
    category: Joi.string()
        .valid(...FOOD_CATEGORIES)
        .optional(),
    ownership: Joi.string()
        .valid(...OWNERSHIP_FILTERS)
        .default('all'),
    status: Joi.string()
        .valid(...FOOD_STATUSES)
        .default('active'),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(24),
    sort: Joi.string()
        .valid(...FOOD_SORT_OPTIONS)
        .default('newest'),
});

/**
 * Live FatSecret search query.
 * page is 1-based to match GET /foods; FatSecret page_number is derived as page-1.
 */
export const validateFoodSearchQuery = Joi.object({
    q: Joi.string().trim().max(100).optional().allow(''),
    search: Joi.string().trim().max(100).optional().allow(''),
    foodType: Joi.string().valid('generic', 'brand', 'all').default('generic'),
    region: Joi.string().trim().uppercase().length(2).default('US'),
    language: Joi.string().trim().lowercase().length(2).default('en'),
    page: Joi.number().integer().min(0).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
});
