import { ApiError } from '../../utils/ApiError.js';
import {
    DEFAULT_BASE_URL,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_TOKEN_URL,
    FATSECRET_ERROR_CODES,
    FOOD_GET_METHODS,
    SEARCH_METHOD_BASIC,
    SEARCH_METHOD_PREMIER,
    TOKEN_EXPIRY_SKEW_MS,
} from './fatsecret.constants.js';

let tokenCache = {
    accessToken: null,
    expiresAt: 0,
    scope: null,
};

export const resetFatSecretTokenCache = () => {
    tokenCache = { accessToken: null, expiresAt: 0, scope: null };
};

const resolveConfig = () => {
    const clientId = process.env.FATSECRET_CLIENT_ID;
    const clientSecret = process.env.FATSECRET_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new ApiError(500, 'FatSecret is not configured');
    }

    const preferredScope = String(process.env.FATSECRET_SCOPE || '')
        .trim()
        .toLowerCase();

    return {
        clientId,
        clientSecret,
        baseUrl: (process.env.FATSECRET_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
        tokenUrl: process.env.FATSECRET_TOKEN_URL || DEFAULT_TOKEN_URL,
        timeoutMs: Number(process.env.FATSECRET_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
        preferredScope: preferredScope === 'premier' || preferredScope === 'basic' ? preferredScope : null,
    };
};

const fetchWithTimeout = async (url, options = {}) => {
    const { timeoutMs } = resolveConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
        });
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new ApiError(504, 'FatSecret request timed out');
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
};

const parseFatSecretError = (json, httpStatus) => {
    const code = Number(json?.error?.code);
    const message = json?.error?.message || 'FatSecret request failed';

    if (httpStatus === 429 || /rate limit/i.test(message)) {
        return new ApiError(429, 'FatSecret rate limit exceeded');
    }

    if (code === FATSECRET_ERROR_CODES.INVALID_TOKEN) {
        return new ApiError(401, 'FatSecret token is invalid');
    }

    if (code === FATSECRET_ERROR_CODES.MISSING_SCOPE) {
        const err = new ApiError(403, 'FatSecret account is missing required API scope');
        err.fatsecretCode = code;
        return err;
    }

    if (code === FATSECRET_ERROR_CODES.VALUE_OUT_OF_RANGE) {
        return new ApiError(400, 'FatSecret parameter out of range');
    }

    if (/invalid ip address/i.test(message)) {
        return new ApiError(
            403,
            'FatSecret blocked this server IP. Add it under Manage API Keys → IP Restrictions, then retry.'
        );
    }

    if (code) {
        const err = new ApiError(502, `FatSecret error: ${message}`);
        err.fatsecretCode = code;
        return err;
    }

    return null;
};

const requestAccessToken = async (scope) => {
    const { clientId, clientSecret, tokenUrl } = resolveConfig();
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        scope,
    });

    const response = await fetchWithTimeout(tokenUrl, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });

    const json = await response.json().catch(() => ({}));

    if (!response.ok || !json.access_token) {
        if (response.status === 429) {
            throw new ApiError(429, 'FatSecret rate limit exceeded');
        }
        throw new ApiError(502, 'Unable to authenticate with FatSecret');
    }

    const expiresInMs = Number(json.expires_in || 86400) * 1000;

    tokenCache = {
        accessToken: json.access_token,
        expiresAt: Date.now() + Math.max(expiresInMs - TOKEN_EXPIRY_SKEW_MS, 5_000),
        scope,
    };

    return tokenCache.accessToken;
};

const getAccessToken = async (scope) => {
    if (
        tokenCache.accessToken &&
        tokenCache.scope === scope &&
        Date.now() < tokenCache.expiresAt
    ) {
        return tokenCache.accessToken;
    }

    return requestAccessToken(scope);
};

const postServerApi = async (params, scope) => {
    const { baseUrl } = resolveConfig();
    const token = await getAccessToken(scope);
    const body = new URLSearchParams({
        format: 'json',
        ...params,
    });

    const response = await fetchWithTimeout(`${baseUrl}/rest/server.api`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
    });

    if (response.status === 429) {
        throw new ApiError(429, 'FatSecret rate limit exceeded');
    }

    const json = await response.json().catch(() => null);
    if (json == null || typeof json !== 'object') {
        throw new ApiError(502, 'Invalid FatSecret response');
    }

    const apiError = parseFatSecretError(json, response.status);
    if (apiError) {
        if (apiError.fatsecretCode === FATSECRET_ERROR_CODES.INVALID_TOKEN) {
            resetFatSecretTokenCache();
        }
        throw apiError;
    }

    if (!response.ok) {
        throw new ApiError(502, 'FatSecret request failed');
    }

    return json;
};

const resolveSearchScope = () => {
    const { preferredScope } = resolveConfig();
    if (preferredScope === 'basic') {
        return { method: SEARCH_METHOD_BASIC, scope: 'basic', supportsFoodType: false };
    }
    if (preferredScope === 'premier') {
        return { method: SEARCH_METHOD_PREMIER, scope: 'premier', supportsFoodType: true };
    }
    return { method: SEARCH_METHOD_PREMIER, scope: 'premier', supportsFoodType: true, allowBasicFallback: true };
};

/**
 * Search FatSecret foods.
 *
 * Prefers foods.search.v5 (Premier, food_type + servings + optional images).
 * Falls back to foods.search (Basic) when Premier scope is unavailable.
 *
 * @param {object} options
 * @returns {Promise<{ json: object, method: string, scope: string, supportsFoodType: boolean }>}
 */
export const searchFoods = async ({
    query,
    pageNumber = 0,
    maxResults = 20,
    foodType = 'generic',
    region = 'US',
    language = 'en',
    includeImages = true,
} = {}) => {
    const searchConfig = resolveSearchScope();

    const buildParams = (method, supportsFoodType) => {
        const params = {
            method,
            search_expression: query || '',
            page_number: String(pageNumber),
            max_results: String(maxResults),
            region,
            language,
        };

        if (supportsFoodType && foodType && foodType !== 'all') {
            params.food_type = foodType;
        }

        if (method === SEARCH_METHOD_PREMIER) {
            params.flag_default_serving = 'true';
            if (includeImages) {
                params.include_food_images = 'true';
            }
        }

        return params;
    };

    try {
        const json = await postServerApi(
            buildParams(searchConfig.method, searchConfig.supportsFoodType),
            searchConfig.scope
        );
        return {
            json,
            method: searchConfig.method,
            scope: searchConfig.scope,
            supportsFoodType: searchConfig.supportsFoodType,
        };
    } catch (error) {
        const missingScope = error?.fatsecretCode === FATSECRET_ERROR_CODES.MISSING_SCOPE;
        const canFallback = searchConfig.allowBasicFallback && missingScope;

        if (!canFallback) {
            throw error;
        }

        resetFatSecretTokenCache();
        const json = await postServerApi(
            buildParams(SEARCH_METHOD_BASIC, false),
            'basic'
        );
        return {
            json,
            method: SEARCH_METHOD_BASIC,
            scope: 'basic',
            supportsFoodType: false,
        };
    }
};

/**
 * Fetch full FatSecret food details (servings + nutrition).
 *
 * @param {string} foodId
 * @returns {Promise<object>}
 */
export const getFoodById = async (foodId) => {
    const { preferredScope } = resolveConfig();
    const scope = preferredScope === 'basic' ? 'basic' : tokenCache.scope || preferredScope || 'premier';
    let lastError;

    for (const method of FOOD_GET_METHODS) {
        try {
            return await postServerApi({ method, food_id: String(foodId) }, scope === 'basic' ? 'basic' : 'premier');
        } catch (error) {
            lastError = error;
            if (error?.fatsecretCode === FATSECRET_ERROR_CODES.MISSING_SCOPE && scope !== 'basic') {
                resetFatSecretTokenCache();
                try {
                    return await postServerApi({ method, food_id: String(foodId) }, 'basic');
                } catch (basicError) {
                    lastError = basicError;
                }
            }
        }
    }

    throw lastError || new ApiError(502, 'Unable to load FatSecret food details');
};

export default {
    searchFoods,
    getFoodById,
    resetFatSecretTokenCache,
};
