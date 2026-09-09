import Joi from 'joi';
import { SERVING_UNITS } from '../foods/food.constants.js';
import {
    NUTRITION_GOALS,
    NUTRITION_PLAN_STATUSES,
    MEAL_TYPES,
    OWNERSHIP_FILTERS,
    NUTRITION_PLAN_SORT_OPTIONS,
    MAX_NUTRITION_DAYS,
    MAX_WEEKLY_NUTRITION_DAYS,
    MAX_MEALS_PER_DAY,
    MAX_FOOD_ITEMS_PER_MEAL,
    SCHEDULE_MODES,
    DEFAULT_SCHEDULE_MODE,
} from './nutrition-plan.constants.js';
import {
    validateUniqueDayNumbers,
    validateUniqueMealOrders,
    validateUniqueFoodItemOrders,
    validateScheduleModeConstraints,
} from './nutrition-plan.helpers.js';

/**
 * Nutrition Plan validation schemas (Joi)
 * Body schemas are intended for use with existing `validate()` middleware.
 */

const objectIdSchema = Joi.string()
    .hex()
    .length(24)
    .messages({
        'string.hex': 'Must be a valid ObjectId',
        'string.length': 'Must be a valid ObjectId',
    });

const forbiddenServerFields = {
    trainerId: Joi.forbidden(),
    clientId: Joi.forbidden(),
    startDate: Joi.forbidden(),
    endDate: Joi.forbidden(),
    createdAt: Joi.forbidden(),
    updatedAt: Joi.forbidden(),
    ownership: Joi.forbidden(),
    templateKey: Joi.forbidden(),
    totalMeals: Joi.forbidden(),
    totalFoodItems: Joi.forbidden(),
    avgDailyCalories: Joi.forbidden(),
    computedMacros: Joi.forbidden(),
    dailyTotals: Joi.forbidden(),
    mealTotals: Joi.forbidden(),
    itemMacros: Joi.forbidden(),
};

const macroTargetsSchema = Joi.object({
    calories: Joi.number().greater(0).required().messages({
        'any.required': 'Target calories is required',
        'number.greater': 'Target calories must be greater than 0',
    }),
    protein: Joi.number().min(0).required().messages({
        'any.required': 'Target protein is required',
        'number.min': 'Target protein cannot be negative',
    }),
    carbs: Joi.number().min(0).required().messages({
        'any.required': 'Target carbs is required',
        'number.min': 'Target carbs cannot be negative',
    }),
    fat: Joi.number().min(0).required().messages({
        'any.required': 'Target fat is required',
        'number.min': 'Target fat cannot be negative',
    }),
});

const planFoodItemSchema = Joi.object({
    _id: objectIdSchema.optional(),
    foodId: objectIdSchema.required().messages({
        'any.required': 'Food ID is required',
    }),
    order: Joi.number().integer().min(1).required().messages({
        'any.required': 'Food item order is required',
        'number.min': 'Food item order must be at least 1',
    }),
    quantity: Joi.number().greater(0).required().messages({
        'any.required': 'Quantity is required',
        'number.greater': 'Quantity must be greater than 0',
    }),
    unit: Joi.string()
        .valid(...SERVING_UNITS)
        .required()
        .messages({
            'any.required': 'Unit is required',
            'any.only': 'Unit must be g, kg, ml, l, piece, or serving',
        }),
    notes: Joi.string().trim().max(200).optional().allow('', null),
    foodSnapshot: Joi.forbidden(),
});

const planFoodItemArraySchema = Joi.array()
    .items(planFoodItemSchema)
    .max(MAX_FOOD_ITEMS_PER_MEAL)
    .custom((foodItems, helpers) => {
        const result = validateUniqueFoodItemOrders(foodItems);
        if (!result.valid) {
            return helpers.error('foodItems.uniqueOrders');
        }
        return foodItems;
    })
    .messages({
        'foodItems.uniqueOrders': 'Food item order values must be unique within each meal',
    })
    .default([]);

const mealSchema = Joi.object({
    _id: objectIdSchema.optional(),
    order: Joi.number().integer().min(1).required().messages({
        'any.required': 'Meal order is required',
        'number.min': 'Meal order must be at least 1',
    }),
    name: Joi.string().trim().min(1).max(120).required().messages({
        'any.required': 'Meal name is required',
        'string.min': 'Meal name is required',
        'string.max': 'Meal name cannot exceed 120 characters',
    }),
    mealType: Joi.string()
        .valid(...MEAL_TYPES)
        .optional()
        .allow(null),
    suggestedTime: Joi.string()
        .trim()
        .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional()
        .allow('', null)
        .messages({
            'string.pattern.base': 'Suggested time must be in HH:mm 24-hour format',
        }),
    notes: Joi.string().trim().max(500).optional().allow('', null),
    foodItems: planFoodItemArraySchema,
});

const mealArraySchema = Joi.array()
    .items(mealSchema)
    .max(MAX_MEALS_PER_DAY)
    .custom((meals, helpers) => {
        const result = validateUniqueMealOrders(meals);
        if (!result.valid) {
            return helpers.error('meals.uniqueOrders');
        }
        return meals;
    })
    .messages({
        'meals.uniqueOrders': 'Meal order values must be unique within each day',
    })
    .default([]);

const nutritionDaySchema = Joi.object({
    _id: objectIdSchema.optional(),
    dayNumber: Joi.number()
        .integer()
        .min(1)
        .max(MAX_NUTRITION_DAYS)
        .required()
        .messages({
            'any.required': 'Day number is required',
            'number.min': `Day number must be between 1 and ${MAX_NUTRITION_DAYS}`,
            'number.max': `Day number must be between 1 and ${MAX_NUTRITION_DAYS}`,
        }),
    name: Joi.string().trim().max(120).optional().allow('', null),
    notes: Joi.string().trim().max(500).optional().allow('', null),
    meals: mealArraySchema,
});

const nutritionDaysSchema = Joi.array()
    .items(nutritionDaySchema)
    .max(MAX_NUTRITION_DAYS)
    .custom((days, helpers) => {
        const result = validateUniqueDayNumbers(days);
        if (!result.valid) {
            return helpers.error('nutritionDays.uniqueDayNumbers');
        }
        return days;
    })
    .messages({
        'nutritionDays.uniqueDayNumbers': 'Day numbers must be unique within a plan',
    })
    .default([]);

const nutritionPlanContentFields = {
    name: Joi.string().trim().min(2).max(120).messages({
        'string.min': 'Name must be at least 2 characters',
        'string.max': 'Name cannot exceed 120 characters',
    }),
    description: Joi.string().trim().max(2000).optional().allow('', null),
    icon: Joi.string().trim().max(64).optional().allow('', null),
    goal: Joi.string()
        .valid(...NUTRITION_GOALS)
        .messages({
            'any.only': 'Goal must be a valid nutrition goal',
        }),
    duration: Joi.number().integer().min(1).messages({
        'number.min': 'Duration must be at least 1 week',
    }),
    daysCount: Joi.number()
        .integer()
        .min(1)
        .max(MAX_NUTRITION_DAYS)
        .messages({
            'number.min': `Days count must be between 1 and ${MAX_NUTRITION_DAYS}`,
            'number.max': `Days count must be between 1 and ${MAX_NUTRITION_DAYS}`,
        }),
    scheduleMode: Joi.string()
        .valid(...SCHEDULE_MODES)
        .messages({
            'any.only': 'Schedule mode must be daily or weekly',
        }),
    macroTargets: macroTargetsSchema,
    nutritionDays: nutritionDaysSchema,
    isTemplate: Joi.boolean(),
    status: Joi.string()
        .valid('draft', 'active')
        .messages({
            'any.only': 'Status must be draft or active',
        }),
    notes: Joi.string().trim().max(500).optional().allow('', null),
};

/**
 * Create nutrition plan — trainer-controlled fields only.
 */
export const validateCreateNutritionPlan = Joi.object({
    name: nutritionPlanContentFields.name.required().messages({
        'any.required': 'Name is required',
    }),
    description: nutritionPlanContentFields.description,
    icon: nutritionPlanContentFields.icon,
    goal: nutritionPlanContentFields.goal.required().messages({
        'any.required': 'Goal is required',
    }),
    duration: nutritionPlanContentFields.duration.required().messages({
        'any.required': 'Duration is required',
    }),
    daysCount: nutritionPlanContentFields.daysCount.required().messages({
        'any.required': 'Days count is required',
    }),
    scheduleMode: nutritionPlanContentFields.scheduleMode.default(DEFAULT_SCHEDULE_MODE),
    macroTargets: nutritionPlanContentFields.macroTargets.required().messages({
        'any.required': 'Macro targets are required',
    }),
    nutritionDays: nutritionPlanContentFields.nutritionDays,
    isTemplate: nutritionPlanContentFields.isTemplate.default(false),
    status: nutritionPlanContentFields.status.optional(),
    notes: nutritionPlanContentFields.notes,
    _id: Joi.forbidden(),
    ...forbiddenServerFields,
}).custom((value, helpers) => {
    const scheduleMode = value.scheduleMode ?? DEFAULT_SCHEDULE_MODE;
    const nutritionDays = value.nutritionDays ?? [];
    const result = validateScheduleModeConstraints(scheduleMode, nutritionDays, { legacy: false });
    if (!result.valid) {
        return helpers.error('any.custom', { message: result.message });
    }
    return value;
});

/**
 * Update nutrition plan — partial metadata or full nested replace when nutritionDays present.
 */
export const validateUpdateNutritionPlan = Joi.object({
    name: nutritionPlanContentFields.name.optional(),
    description: nutritionPlanContentFields.description,
    icon: nutritionPlanContentFields.icon,
    goal: nutritionPlanContentFields.goal.optional(),
    duration: nutritionPlanContentFields.duration.optional(),
    daysCount: nutritionPlanContentFields.daysCount.optional(),
    scheduleMode: nutritionPlanContentFields.scheduleMode.optional(),
    macroTargets: macroTargetsSchema.optional(),
    nutritionDays: nutritionDaysSchema.optional(),
    isTemplate: nutritionPlanContentFields.isTemplate.optional(),
    status: nutritionPlanContentFields.status.optional(),
    notes: nutritionPlanContentFields.notes,
    _id: Joi.forbidden(),
    ...forbiddenServerFields,
}).min(1).custom((value, helpers) => {
    if (value.nutritionDays === undefined && value.scheduleMode === undefined) {
        return value;
    }

    const scheduleMode = value.scheduleMode ?? DEFAULT_SCHEDULE_MODE;
    const nutritionDays = value.nutritionDays ?? [];
    const legacy = value.scheduleMode === undefined && value.nutritionDays !== undefined;

    if (value.nutritionDays !== undefined) {
        const result = validateScheduleModeConstraints(scheduleMode, nutritionDays, {
            legacy,
        });
        if (!result.valid) {
            return helpers.error('any.custom', { message: result.message });
        }
    }

    if (value.scheduleMode === 'daily' && value.nutritionDays === undefined) {
        return value;
    }

    return value;
});

/**
 * Clone template — optional name override only.
 */
export const validateCloneNutritionPlan = Joi.object({
    name: Joi.string().trim().min(2).max(120).optional(),
    trainerId: Joi.forbidden(),
    ownership: Joi.forbidden(),
    templateKey: Joi.forbidden(),
    clientId: Joi.forbidden(),
    status: Joi.forbidden(),
    isTemplate: Joi.forbidden(),
    nutritionDays: Joi.forbidden(),
    foodSnapshot: Joi.forbidden(),
    createdAt: Joi.forbidden(),
    updatedAt: Joi.forbidden(),
});

/**
 * List/search query schema (Phase 4 will wire this).
 */
export const validateNutritionPlanQuery = Joi.object({
    search: Joi.string().trim().max(100).optional().allow(''),
    status: Joi.string()
        .valid(...NUTRITION_PLAN_STATUSES)
        .optional(),
    ownership: Joi.string()
        .valid(...OWNERSHIP_FILTERS)
        .default('trainer'),
    isTemplate: Joi.boolean().truthy('true').falsy('false').optional(),
    goal: Joi.string()
        .valid(...NUTRITION_GOALS)
        .optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(24),
    sort: Joi.string()
        .valid(...NUTRITION_PLAN_SORT_OPTIONS)
        .default('newest'),
});

/**
 * Nutrition plan tab counts — same shared filters as list except ownership/status/isTemplate/page/limit.
 */
export const validateNutritionPlanSummaryQuery = Joi.object({
    search: Joi.string().trim().max(100).optional().allow(''),
    goal: Joi.string()
        .valid(...NUTRITION_GOALS)
        .optional(),
    sort: Joi.string()
        .valid(...NUTRITION_PLAN_SORT_OPTIONS)
        .default('newest'),
});
