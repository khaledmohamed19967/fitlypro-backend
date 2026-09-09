import { FATSECRET_PROVIDER } from '../../modules/foods/food.constants.js';

const DEFAULT_SERVING = Object.freeze({
    quantity: 100,
    unit: 'g',
    gramWeight: 100,
});

const CATEGORY_KEYWORD_RULES = [
    { category: 'protein', patterns: [/chicken/i, /beef/i, /turkey/i, /fish/i, /salmon/i, /tuna/i, /egg/i, /shrimp/i, /pork/i, /lamb/i] },
    { category: 'grains', patterns: [/rice/i, /oat/i, /pasta/i, /bread/i, /cereal/i, /potato/i, /wheat/i] },
    { category: 'dairy', patterns: [/milk/i, /yogurt/i, /cheese/i, /cottage/i, /cream/i] },
    { category: 'fruits', patterns: [/banana/i, /apple/i, /orange/i, /strawber/i, /blueberr/i, /fruit/i] },
    { category: 'vegetables', patterns: [/broccoli/i, /spinach/i, /carrot/i, /tomato/i, /cucumber/i, /vegetable/i] },
    { category: 'legumes', patterns: [/lentil/i, /bean/i, /chickpea/i] },
    { category: 'nuts_seeds', patterns: [/almond/i, /peanut/i, /walnut/i] },
    { category: 'fats', patterns: [/olive oil/i, /avocado/i, /oil/i] },
    { category: 'beverages', patterns: [/juice/i, /coffee/i, /tea/i, /soda/i] },
];

export const toArray = (value) => {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
};

export const toFiniteNumber = (value) => {
    if (value == null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

export const extractFatSecretFoodId = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const prefixed = raw.match(/^fs:(.+)$/i);
    return (prefixed ? prefixed[1] : raw).trim() || null;
};

export const mapFitlyCategory = (name = '', foodType = 'Generic') => {
    const haystack = String(name);
    for (const rule of CATEGORY_KEYWORD_RULES) {
        if (rule.patterns.some((pattern) => pattern.test(haystack))) {
            return rule.category;
        }
    }
    if (/brand/i.test(foodType)) {
        return 'prepared_meals';
    }
    return 'other';
};

export const mapProductImage = (food = {}) => {
    const images = toArray(food.food_images?.food_image ?? food.food_image);
    const first = images.find((image) => image?.image_url) || null;
    if (!first?.image_url) {
        return null;
    }

    return {
        url: first.image_url,
        thumbnailUrl: first.image_url,
    };
};

/**
 * Parse FatSecret v1 food_description summaries.
 * Example: "Per 100g - Calories: 22kcal | Fat: 0.34g | Carbs: 3.28g | Protein: 3.09g"
 *
 * @param {string} description
 * @returns {{ basis: string, calories: number, protein: number, carbs: number, fat: number }|null}
 */
export const parseFoodDescription = (description) => {
    const text = String(description || '');
    const match = text.match(
        /Per\s+(.+?)\s*-\s*Calories:\s*([\d.]+)\s*kcal\s*\|\s*Fat:\s*([\d.]+)\s*g\s*\|\s*Carbs:\s*([\d.]+)\s*g\s*\|\s*Protein:\s*([\d.]+)\s*g/i
    );

    if (!match) {
        return null;
    }

    return {
        basis: match[1].trim(),
        calories: Number(match[2]),
        fat: Number(match[3]),
        carbs: Number(match[4]),
        protein: Number(match[5]),
    };
};

const scaleNutritionTo100g = (nutrition, grams) => {
    if (!nutrition || grams == null || grams <= 0) {
        return null;
    }

    const factor = 100 / grams;
    return {
        calories: Math.round(nutrition.calories * factor * 10) / 10,
        protein: Math.round(nutrition.protein * factor * 100) / 100,
        carbs: Math.round(nutrition.carbs * factor * 100) / 100,
        fat: Math.round(nutrition.fat * factor * 100) / 100,
        ...(nutrition.fiber != null
            ? { fiber: Math.round(nutrition.fiber * factor * 100) / 100 }
            : {}),
        ...(nutrition.sugar != null
            ? { sugar: Math.round(nutrition.sugar * factor * 100) / 100 }
            : {}),
        ...(nutrition.sodium != null
            ? { sodium: Math.round(nutrition.sodium * factor * 100) / 100 }
            : {}),
    };
};

const servingNutrition = (serving = {}) => ({
    calories: toFiniteNumber(serving.calories) ?? 0,
    protein: toFiniteNumber(serving.protein) ?? 0,
    carbs: toFiniteNumber(serving.carbohydrate) ?? 0,
    fat: toFiniteNumber(serving.fat) ?? 0,
    ...(toFiniteNumber(serving.fiber) != null ? { fiber: toFiniteNumber(serving.fiber) } : {}),
    ...(toFiniteNumber(serving.sugar) != null ? { sugar: toFiniteNumber(serving.sugar) } : {}),
    ...(toFiniteNumber(serving.sodium) != null ? { sodium: toFiniteNumber(serving.sodium) } : {}),
});

const metricGrams = (serving = {}) => {
    const amount = toFiniteNumber(serving.metric_serving_amount);
    const unit = String(serving.metric_serving_unit || '').toLowerCase();
    if (amount == null || amount <= 0) {
        return null;
    }
    if (unit === 'g' || unit === 'ml') {
        return amount;
    }
    if (unit === 'oz') {
        return amount * 28.3495;
    }
    return null;
};

/**
 * Map FatSecret servings into Fitly nutritionPer100g + defaultServing.
 *
 * @param {object[]} servings
 * @returns {{ nutritionPer100g: object, defaultServing: object }|null}
 */
export const mapServings = (servings = []) => {
    const list = toArray(servings).filter(Boolean);
    if (!list.length) {
        return null;
    }

    const withGrams = list
        .map((serving) => ({ serving, grams: metricGrams(serving) }))
        .filter((entry) => entry.grams != null && entry.grams > 0);

    const hundredGram = withGrams.find((entry) => Math.abs(entry.grams - 100) < 0.5);
    const defaultFlagged = withGrams.find((entry) => Number(entry.serving.is_default) === 1);
    const chosen = hundredGram || defaultFlagged || withGrams[0];

    if (chosen) {
        const nutritionPer100g = scaleNutritionTo100g(servingNutrition(chosen.serving), chosen.grams);
        if (!nutritionPer100g) {
            return null;
        }

        const unit = String(chosen.serving.metric_serving_unit || 'g').toLowerCase() === 'ml' ? 'ml' : 'g';
        const isPieceLike = /piece|slice|large|medium|small|whole|egg/i.test(
            String(chosen.serving.serving_description || '')
        );

        const defaultServing = hundredGram
            ? { ...DEFAULT_SERVING }
            : isPieceLike
              ? {
                    quantity: toFiniteNumber(chosen.serving.number_of_units) || 1,
                    unit: 'piece',
                    gramWeight: chosen.grams,
                }
              : {
                    quantity: chosen.grams,
                    unit,
                    gramWeight: chosen.grams,
                };

        return { nutritionPer100g, defaultServing };
    }

    return null;
};

const nutritionFromDescription = (description) => {
    const parsed = parseFoodDescription(description);
    if (!parsed) {
        return null;
    }

    const nutrition = {
        calories: parsed.calories,
        protein: parsed.protein,
        carbs: parsed.carbs,
        fat: parsed.fat,
    };

    const gramsMatch = parsed.basis.match(/^(\d+(?:\.\d+)?)\s*g$/i);
    if (gramsMatch) {
        const grams = Number(gramsMatch[1]);
        const nutritionPer100g =
            Math.abs(grams - 100) < 0.5 ? nutrition : scaleNutritionTo100g(nutrition, grams);
        return {
            nutritionPer100g,
            defaultServing: { ...DEFAULT_SERVING },
            displayOnly: false,
        };
    }

    return {
        nutritionPer100g: nutrition,
        defaultServing: { quantity: 1, unit: 'serving', gramWeight: 100 },
        displayOnly: true,
    };
};

/**
 * Normalize a FatSecret search hit into a Fitly Food Selector item.
 * Search results are NOT persisted.
 *
 * @param {object} food
 * @returns {object|null}
 */
export const mapSearchFoodToFitlyFood = (food = {}) => {
    const externalId = String(food.food_id || '').trim();
    const name = String(food.food_name || '').trim();
    if (!externalId || !name) {
        return null;
    }

    const servings = toArray(food.servings?.serving);
    const fromServings = mapServings(servings);
    const fromDescription = nutritionFromDescription(food.food_description);
    const mappedNutrition = fromServings || fromDescription;

    if (!mappedNutrition?.nutritionPer100g) {
        return null;
    }

    const image = mapProductImage(food);
    const foodType = String(food.food_type || 'Generic');

    return {
        id: `fs:${externalId}`,
        name: name.slice(0, 120),
        brand: food.brand_name ? String(food.brand_name).slice(0, 120) : null,
        category: mapFitlyCategory(name, foodType),
        status: 'active',
        nutritionPer100g: mappedNutrition.nutritionPer100g,
        defaultServing: mappedNutrition.defaultServing,
        image,
        ownership: { type: 'system', trainerId: null },
        type: foodType.toLowerCase() === 'brand' ? 'brand' : 'generic',
        source: {
            type: 'import',
            provider: FATSECRET_PROVIDER,
            externalProvider: FATSECRET_PROVIDER,
            externalId,
        },
    };
};

/**
 * Map a FatSecret food.get payload to a persistable Fitly Food document.
 *
 * @param {object} food
 * @returns {object|null}
 */
export const mapFatSecretFoodToFitlyFood = (food = {}) => {
    const externalId = String(food.food_id || '').trim();
    const name = String(food.food_name || '').trim();
    if (!externalId || name.length < 2) {
        return null;
    }

    const mapped = mapServings(toArray(food.servings?.serving));
    if (!mapped) {
        return null;
    }

    const image = mapProductImage(food);
    const foodType = String(food.food_type || 'Generic');

    const payload = {
        ownership: { type: 'system', trainerId: null },
        trainerId: null,
        name: name.slice(0, 120),
        brand: food.brand_name ? String(food.brand_name).slice(0, 120) : null,
        category: mapFitlyCategory(name, foodType),
        status: 'active',
        nutritionPer100g: mapped.nutritionPer100g,
        defaultServing: mapped.defaultServing,
        source: {
            type: 'import',
            externalProvider: FATSECRET_PROVIDER,
            externalId,
            barcode: null,
            originalName: name.slice(0, 512),
        },
    };

    if (image) {
        payload.image = image;
    }

    return payload;
};

export const extractSearchFoods = (json = {}) => {
    const foodsNode = json.foods_search?.food || json.foods?.food || json.foods_search?.results?.food;
    return toArray(foodsNode);
};

export const extractSearchMeta = (json = {}) => {
    const node = json.foods_search || json.foods || {};
    return {
        maxResults: toFiniteNumber(node.max_results) ?? 20,
        totalResults: toFiniteNumber(node.total_results) ?? 0,
        pageNumber: toFiniteNumber(node.page_number) ?? 0,
    };
};

export const extractFoodGetPayload = (json = {}) => json.food || json;

export default {
    toArray,
    toFiniteNumber,
    extractFatSecretFoodId,
    mapFitlyCategory,
    mapProductImage,
    parseFoodDescription,
    mapServings,
    mapSearchFoodToFitlyFood,
    mapFatSecretFoodToFitlyFood,
    extractSearchFoods,
    extractSearchMeta,
    extractFoodGetPayload,
};
