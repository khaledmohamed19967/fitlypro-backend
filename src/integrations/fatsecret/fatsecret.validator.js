import { FOOD_CATEGORIES } from '../../modules/foods/food.constants.js';
import { FATSECRET_FOOD_TYPES } from './fatsecret.constants.js';

export const validateSearchQuery = (query = {}) => {
    const errors = [];
    const q = String(query.q ?? query.search ?? '').trim();

    if (q.length > 100) {
        errors.push({ field: 'q', message: 'Search query cannot exceed 100 characters' });
    }

    const foodType = String(query.foodType ?? query.food_type ?? 'generic').trim().toLowerCase();
    if (foodType && !FATSECRET_FOOD_TYPES.includes(foodType)) {
        errors.push({ field: 'foodType', message: 'foodType must be generic, brand, or all' });
    }

    const pageRaw = query.page;
    const page = pageRaw == null || pageRaw === '' ? 1 : Number(pageRaw);
    if (!Number.isInteger(page) || page < 0) {
        errors.push({ field: 'page', message: 'page must be a non-negative integer' });
    }

    const limitRaw = query.limit;
    const limit = limitRaw == null || limitRaw === '' ? 20 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        errors.push({ field: 'limit', message: 'limit must be between 1 and 50' });
    }

    const region = String(query.region || 'US').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(region)) {
        errors.push({ field: 'region', message: 'region must be a 2-letter country code' });
    }

    const language = String(query.language || 'en').trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(language)) {
        errors.push({ field: 'language', message: 'language must be a 2-letter language code' });
    }

    return {
        valid: errors.length === 0,
        errors,
        value: {
            q,
            foodType: foodType || 'generic',
            page: page < 1 ? 1 : page,
            fatsecretPage: page < 1 ? 0 : page - 1,
            limit,
            region,
            language,
        },
    };
};

export const validateMappedFood = (food) => {
    const errors = [];
    if (!food?.name || String(food.name).trim().length < 2) {
        errors.push('missing name');
    }
    if (!food?.source?.externalId) {
        errors.push('missing external id');
    }
    const nutrition = food?.nutritionPer100g;
    if (!nutrition) {
        errors.push('missing nutrition');
    } else {
        ['calories', 'protein', 'carbs', 'fat'].forEach((field) => {
            if (nutrition[field] == null || !Number.isFinite(Number(nutrition[field])) || Number(nutrition[field]) < 0) {
                errors.push(`invalid ${field}`);
            }
        });
    }
    if (food?.category && !FOOD_CATEGORIES.includes(food.category)) {
        errors.push('invalid category');
    }
    return { valid: errors.length === 0, errors };
};

export default {
    validateSearchQuery,
    validateMappedFood,
};
