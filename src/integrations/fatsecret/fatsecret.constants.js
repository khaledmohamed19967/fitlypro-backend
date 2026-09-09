/**
 * FatSecret Platform API constants.
 *
 * FatSecret is a live search source — not a catalog import.
 * Credentials and tokens stay server-side.
 */

export const DEFAULT_BASE_URL = 'https://platform.fatsecret.com';

export const DEFAULT_TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';

export const DEFAULT_TIMEOUT_MS = 15_000;

export const DEFAULT_REGION = 'US';

export const DEFAULT_LANGUAGE = 'en';

export const MAX_RESULTS = 50;

export const DEFAULT_PAGE_SIZE = 20;

export const TOKEN_EXPIRY_SKEW_MS = 30_000;

export const FATSECRET_SCOPES = Object.freeze(['basic', 'premier']);

export const FATSECRET_FOOD_TYPES = Object.freeze(['generic', 'brand', 'all']);

/** FatSecret returns zero results for an empty search_expression — use type-aware browse terms. */
export const DEFAULT_BROWSE_QUERIES = Object.freeze({
    generic: 'chicken',
    brand: 'coca',
    all: 'chicken',
});

/**
 * Resolve the FatSecret search_expression. Empty user input uses a browse default.
 *
 * @param {string} query
 * @param {string} [foodType]
 * @returns {{ expression: string, isBrowseDefault: boolean }}
 */
export const resolveSearchExpression = (query, foodType = 'generic') => {
    const trimmed = String(query ?? '').trim();
    if (trimmed) {
        return { expression: trimmed, isBrowseDefault: false };
    }

    const browseKey =
        foodType === 'brand' ? 'brand' : foodType === 'all' ? 'all' : 'generic';

    return {
        expression: DEFAULT_BROWSE_QUERIES[browseKey],
        isBrowseDefault: true,
    };
};

/** foods.search.v5 requires OAuth2 premier scope. */
export const SEARCH_METHOD_PREMIER = 'foods.search.v5';

/** foods.search (v1) is the Basic-compatible search. */
export const SEARCH_METHOD_BASIC = 'foods.search';

export const FOOD_GET_METHODS = Object.freeze(['food.get.v4', 'food.get']);

export const FATSECRET_ERROR_CODES = Object.freeze({
    INVALID_TOKEN: 13,
    MISSING_SCOPE: 14,
    VALUE_OUT_OF_RANGE: 107,
});
