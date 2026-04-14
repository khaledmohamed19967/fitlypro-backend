import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Application configuration object
 */
const config = {
    // Server
    port: process.env.PORT || 8000,
    env: process.env.NODE_ENV || 'development',

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
        prefix: '/api/v1',
    },

    // CORS
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
    },
};

export default config;
