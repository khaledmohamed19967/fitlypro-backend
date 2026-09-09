import mongoose from 'mongoose';
import { SERVING_UNITS } from '../foods/food.constants.js';
import {
    NUTRITION_GOALS,
    NUTRITION_PLAN_STATUSES,
    MEAL_TYPES,
    OWNERSHIP_TYPES,
    DEFAULT_NUTRITION_PLAN_ICON,
    MAX_NUTRITION_DAYS,
    MAX_WEEKLY_NUTRITION_DAYS,
    MAX_MEALS_PER_DAY,
    MAX_FOOD_ITEMS_PER_MEAL,
    SCHEDULE_MODES,
    DEFAULT_SCHEDULE_MODE,
} from './nutrition-plan.constants.js';

const ownershipSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            required: [true, 'Ownership type is required'],
            enum: {
                values: OWNERSHIP_TYPES,
                message: 'Ownership type must be system or trainer',
            },
        },
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { _id: false }
);

const macroTargetsSchema = new mongoose.Schema(
    {
        calories: {
            type: Number,
            required: [true, 'Target calories is required'],
            min: [1, 'Target calories must be greater than 0'],
        },
        protein: {
            type: Number,
            required: [true, 'Target protein is required'],
            min: [0, 'Target protein cannot be negative'],
        },
        carbs: {
            type: Number,
            required: [true, 'Target carbs is required'],
            min: [0, 'Target carbs cannot be negative'],
        },
        fat: {
            type: Number,
            required: [true, 'Target fat is required'],
            min: [0, 'Target fat cannot be negative'],
        },
    },
    { _id: false }
);

const nutritionPer100gSnapshotSchema = new mongoose.Schema(
    {
        calories: { type: Number, min: 0, required: true },
        protein: { type: Number, min: 0, required: true },
        carbs: { type: Number, min: 0, required: true },
        fat: { type: Number, min: 0, required: true },
        fiber: { type: Number, min: 0, default: null },
        sugar: { type: Number, min: 0, default: null },
        sodium: { type: Number, min: 0, default: null },
    },
    { _id: false }
);

const defaultServingSnapshotSchema = new mongoose.Schema(
    {
        quantity: { type: Number, required: true, min: [0, 'Quantity must be positive'] },
        unit: {
            type: String,
            required: true,
            enum: { values: SERVING_UNITS, message: 'Invalid serving unit' },
        },
        gramWeight: { type: Number, required: true, min: [0, 'Gram weight must be positive'] },
    },
    { _id: false }
);

export const foodSnapshotSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Food snapshot name is required'],
            trim: true,
            maxlength: [120, 'Food snapshot name cannot exceed 120 characters'],
        },
        brand: {
            type: String,
            trim: true,
            maxlength: [120, 'Food snapshot brand cannot exceed 120 characters'],
            default: null,
        },
        category: {
            type: String,
            required: [true, 'Food snapshot category is required'],
            trim: true,
        },
        nutritionPer100g: {
            type: nutritionPer100gSnapshotSchema,
            required: [true, 'Food snapshot nutrition is required'],
        },
        defaultServing: {
            type: defaultServingSnapshotSchema,
            required: [true, 'Food snapshot default serving is required'],
        },
    },
    { _id: false }
);

export const planFoodItemSchema = new mongoose.Schema(
    {
        foodId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Food',
            required: [true, 'Food ID is required'],
        },
        order: {
            type: Number,
            required: [true, 'Food item order is required'],
            min: [1, 'Food item order must be at least 1'],
        },
        quantity: {
            type: Number,
            required: [true, 'Quantity is required'],
            min: [0, 'Quantity must be greater than 0'],
        },
        unit: {
            type: String,
            required: [true, 'Unit is required'],
            enum: {
                values: SERVING_UNITS,
                message: 'Unit must be g, kg, ml, l, piece, or serving',
            },
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [200, 'Food item notes cannot exceed 200 characters'],
            default: null,
        },
        foodSnapshot: {
            type: foodSnapshotSchema,
            required: [true, 'Food snapshot is required'],
        },
    },
    { _id: true }
);

export const mealSchema = new mongoose.Schema(
    {
        order: {
            type: Number,
            required: [true, 'Meal order is required'],
            min: [1, 'Meal order must be at least 1'],
        },
        name: {
            type: String,
            required: [true, 'Meal name is required'],
            trim: true,
            minlength: [1, 'Meal name is required'],
            maxlength: [120, 'Meal name cannot exceed 120 characters'],
        },
        mealType: {
            type: String,
            enum: {
                values: MEAL_TYPES,
                message: 'Invalid meal type',
            },
            default: null,
        },
        suggestedTime: {
            type: String,
            trim: true,
            maxlength: [5, 'Suggested time cannot exceed 5 characters'],
            default: null,
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [500, 'Meal notes cannot exceed 500 characters'],
            default: null,
        },
        foodItems: {
            type: [planFoodItemSchema],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= MAX_FOOD_ITEMS_PER_MEAL;
                },
                message: `Food items cannot exceed ${MAX_FOOD_ITEMS_PER_MEAL} items per meal`,
            },
        },
    },
    { _id: true }
);

export const nutritionDaySchema = new mongoose.Schema(
    {
        dayNumber: {
            type: Number,
            required: [true, 'Day number is required'],
            min: [1, `Day number must be between 1 and ${MAX_NUTRITION_DAYS}`],
            max: [MAX_NUTRITION_DAYS, `Day number must be between 1 and ${MAX_NUTRITION_DAYS}`],
        },
        name: {
            type: String,
            trim: true,
            maxlength: [120, 'Day name cannot exceed 120 characters'],
            default: null,
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [500, 'Day notes cannot exceed 500 characters'],
            default: null,
        },
        meals: {
            type: [mealSchema],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= MAX_MEALS_PER_DAY;
                },
                message: `Meals cannot exceed ${MAX_MEALS_PER_DAY} items per day`,
            },
        },
    },
    { _id: true }
);

const nutritionPlanSchema = new mongoose.Schema(
    {
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        ownership: {
            type: ownershipSchema,
            required: [true, 'Ownership is required'],
        },
        templateKey: {
            type: String,
            trim: true,
            lowercase: true,
            maxlength: [64, 'Template key cannot exceed 64 characters'],
            default: null,
        },
        icon: {
            type: String,
            trim: true,
            default: DEFAULT_NUTRITION_PLAN_ICON,
        },
        name: {
            type: String,
            required: [true, 'Plan name is required'],
            trim: true,
            minlength: [2, 'Plan name must be at least 2 characters'],
            maxlength: [120, 'Plan name cannot exceed 120 characters'],
        },
        description: {
            type: String,
            trim: true,
            maxlength: [2000, 'Description cannot exceed 2000 characters'],
            default: null,
        },
        goal: {
            type: String,
            required: [true, 'Goal is required'],
            enum: {
                values: NUTRITION_GOALS,
                message: 'Invalid nutrition goal',
            },
        },
        duration: {
            type: Number,
            required: [true, 'Duration is required'],
            min: [1, 'Duration must be at least 1 week'],
        },
        daysCount: {
            type: Number,
            required: [true, 'Days count is required'],
            min: [1, `Days count must be between 1 and ${MAX_NUTRITION_DAYS}`],
            max: [MAX_NUTRITION_DAYS, `Days count must be between 1 and ${MAX_NUTRITION_DAYS}`],
        },
        scheduleMode: {
            type: String,
            enum: {
                values: SCHEDULE_MODES,
                message: 'Schedule mode must be daily or weekly',
            },
            default: DEFAULT_SCHEDULE_MODE,
        },
        macroTargets: {
            type: macroTargetsSchema,
            required: [true, 'Macro targets are required'],
        },
        nutritionDays: {
            type: [nutritionDaySchema],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= MAX_NUTRITION_DAYS;
                },
                message: `Nutrition days cannot exceed ${MAX_NUTRITION_DAYS} items`,
            },
        },
        isTemplate: {
            type: Boolean,
            required: [true, 'isTemplate is required'],
            default: false,
        },
        status: {
            type: String,
            required: [true, 'Status is required'],
            enum: {
                values: NUTRITION_PLAN_STATUSES,
                message: 'Status must be draft, active, or archived',
            },
            default: 'active',
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [500, 'Plan notes cannot exceed 500 characters'],
            default: null,
        },
        totalMeals: {
            type: Number,
            min: [0, 'Total meals cannot be negative'],
            default: 0,
        },
        totalFoodItems: {
            type: Number,
            min: [0, 'Total food items cannot be negative'],
            default: 0,
        },
        avgDailyCalories: {
            type: Number,
            min: [0, 'Average daily calories cannot be negative'],
            default: 0,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

nutritionPlanSchema.pre('validate', function syncOwnershipFields() {
    if ((!this.ownership || !this.ownership.type) && this.trainerId) {
        this.ownership = {
            type: 'trainer',
            trainerId: this.trainerId,
        };
        return;
    }

    const ownership = this.ownership;
    if (!ownership || !ownership.type) {
        this.invalidate('ownership.type', 'Ownership type is required');
        return;
    }

    if (ownership.type === 'system') {
        if (ownership.trainerId != null) {
            this.invalidate('ownership.trainerId', 'System plans must have null ownership.trainerId');
            return;
        }
        this.trainerId = null;
        return;
    }

    if (ownership.type === 'trainer') {
        if (ownership.trainerId == null && this.trainerId != null) {
            ownership.trainerId = this.trainerId;
        }
        if (ownership.trainerId == null) {
            this.invalidate('ownership.trainerId', 'Trainer plans require ownership.trainerId');
            return;
        }
        this.trainerId = ownership.trainerId;
        if (this.templateKey) {
            this.invalidate('templateKey', 'Trainer plans cannot have a templateKey');
        }
    }
});

nutritionPlanSchema.pre('validate', function validateUniqueDayNumbers() {
    const days = this.nutritionDays;
    if (!Array.isArray(days) || days.length === 0) {
        return;
    }

    const seen = new Set();
    for (const day of days) {
        if (day?.dayNumber == null) continue;
        if (seen.has(day.dayNumber)) {
            this.invalidate('nutritionDays', 'Day numbers must be unique within a plan');
            return;
        }
        seen.add(day.dayNumber);
    }
});

nutritionPlanSchema.pre('validate', function validateMealOrders() {
    const days = this.nutritionDays;
    if (!Array.isArray(days)) {
        return;
    }

    for (const day of days) {
        const meals = day?.meals;
        if (!Array.isArray(meals) || meals.length === 0) {
            continue;
        }

        const seen = new Set();
        for (const meal of meals) {
            if (meal?.order == null) continue;
            if (seen.has(meal.order)) {
                this.invalidate('nutritionDays', 'Meal order values must be unique within each day');
                return;
            }
            seen.add(meal.order);
        }
    }
});

nutritionPlanSchema.pre('validate', function validateFoodItemOrders() {
    const days = this.nutritionDays;
    if (!Array.isArray(days)) {
        return;
    }

    for (const day of days) {
        const meals = day?.meals;
        if (!Array.isArray(meals)) {
            continue;
        }

        for (const meal of meals) {
            const foodItems = meal?.foodItems;
            if (!Array.isArray(foodItems) || foodItems.length === 0) {
                continue;
            }

            const seen = new Set();
            for (const item of foodItems) {
                if (item?.order == null) continue;
                if (seen.has(item.order)) {
                    this.invalidate(
                        'nutritionDays',
                        'Food item order values must be unique within each meal'
                    );
                    return;
                }
                seen.add(item.order);
            }
        }
    }
});

nutritionPlanSchema.index({ trainerId: 1, status: 1, createdAt: -1 });
nutritionPlanSchema.index({ 'ownership.type': 1, 'ownership.trainerId': 1, status: 1, createdAt: -1 });
nutritionPlanSchema.index({ 'ownership.type': 1, isTemplate: 1, status: 1 });

nutritionPlanSchema.index(
    { templateKey: 1 },
    {
        unique: true,
        partialFilterExpression: {
            'ownership.type': 'system',
            isTemplate: true,
            templateKey: { $type: 'string' },
        },
    }
);

const NutritionPlan = mongoose.model('NutritionPlan', nutritionPlanSchema);

export default NutritionPlan;
