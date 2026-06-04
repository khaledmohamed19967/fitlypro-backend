import dotenv from 'dotenv';

const productionScripts = new Set(['env:production', 'start:production']);
const useProductionEnv =
    productionScripts.has(process.env.npm_lifecycle_event) ||
    process.env.NODE_ENV === 'production' ||
    process.env.APP_NODE_ENV === 'production';

dotenv.config({
    path: useProductionEnv ? '.env.production' : '.env',
    override: useProductionEnv,
});
/**
 * Normalize a URL: trim, remove trailing slashes.
 */
const normalizeUrl = (url) => (url ? url.trim().replace(/\/+$/, '') : '');

/**
 * Parse CORS_ORIGIN into a string, array of origins, or true for allow-all.
 */
const parseCorsOrigin = (value) => {
    if (!value || value === '*') {
        return '*';
    }
    const origins = value.split(',').map((o) => o.trim()).filter(Boolean);
    return origins.length === 1 ? origins[0] : origins;
};

const PRODUCTION_API_URL = 'https://fitlypro-backend.netlify.app';

const port = Number(process.env.PORT || process.env.APP_PORT) || 8000;
const apiPrefix = process.env.API_PREFIX || '/api/v1';
const env = process.env.NODE_ENV || process.env.APP_NODE_ENV || 'development';

// Public base URL (scheme + host, no trailing slash)
const apiBaseUrl =
    normalizeUrl(process.env.API_URL) ||
    (env === 'production' ? PRODUCTION_API_URL : `http://localhost:${port}`);

/**
 * Application configuration object
 */
const config = {
    // Server
    port,
    env,
    trustProxy: process.env.TRUST_PROXY === 'true',

    // Database
    database: {
        url: process.env.APP_DB_URL,
    },

    // JWT (for future authentication)
    jwt: {
        secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    },

    // API
    api: {
        prefix: apiPrefix.startsWith('/') ? apiPrefix : `/${apiPrefix}`,
        baseUrl: apiBaseUrl,
        /** Full public API root, e.g. https://api.yourdomain.com/api/v1 */
        get publicUrl() {
            return apiBaseUrl ? `${apiBaseUrl}${this.prefix}` : '';
        },
    },

    // CORS — comma-separated origins in production, e.g. https://app.yourdomain.com,https://www.yourdomain.com
    cors: {
        origin: parseCorsOrigin(process.env.CORS_ORIGIN),
    },
};

export default config;
