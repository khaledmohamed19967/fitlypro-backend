/**
 * Food catalog — canonical taxonomy & enums
 * Shared by Mongoose schema, Joi validators, and services.
 */

export const FOOD_CATEGORIES = Object.freeze([
    'protein',
    'carbs',
    'fats',
    'vegetables',
    'fruits',
    'dairy',
    'grains',
    'legumes',
    'nuts_seeds',
    'beverages',
    'condiments',
    'prepared_meals',
    'supplements',
    'other',
]);

export const FOOD_STATUSES = Object.freeze(['active', 'archived']);

export const OWNERSHIP_TYPES = Object.freeze(['system', 'trainer']);

export const OWNERSHIP_FILTERS = Object.freeze(['system', 'trainer', 'all']);

export const SERVING_UNITS = Object.freeze(['g', 'kg', 'ml', 'l', 'piece', 'serving']);

export const SOURCE_TYPES = Object.freeze(['manual', 'seed', 'import']);

/** External provider slug for FatSecret live search / selected foods. */
export const FATSECRET_PROVIDER = 'fatsecret';

/** External provider slug for FitlyPro manual seed catalog. */
export const FITLYPRO_SEED_PROVIDER = 'fitlypro';

/** Legacy imported providers — used only by cleanup scripts. */
export const LEGACY_IMPORT_PROVIDERS = Object.freeze([
    'openfoodfacts',
    'usda_fooddata_central',
]);

export const FOOD_SORT_OPTIONS = Object.freeze([
    'name',
    'name-desc',
    'newest',
    'oldest',
    'calories-high',
    'calories-low',
]);

/** Units that require defaultServing.gramWeight for piece/serving calculations. */
export const GRAM_WEIGHT_REQUIRED_UNITS = Object.freeze(['piece', 'serving']);
