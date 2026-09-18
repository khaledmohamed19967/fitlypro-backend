import mongoose from 'mongoose';

/**
 * Database connection configuration
 * Cached for Vercel serverless: reuse open / in-flight connections.
 */
let connectionPromise = null;
let listenersRegistered = false;
let hasConnectedOnce = false;

const registerConnectionListeners = () => {
    if (listenersRegistered) {
        return;
    }
    listenersRegistered = true;

    mongoose.connection.on('error', (err) => {
        console.error('[MongoDB] Connection error event:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
        console.warn(
            `[MongoDB] Disconnected. readyState: ${mongoose.connection.readyState}`
        );
        console.warn('[MongoDB] Clearing cached connection promise');
        connectionPromise = null;
    });

    // Graceful shutdown (local / long-running process)
    process.on('SIGINT', async () => {
        await mongoose.connection.close();
        console.log('MongoDB connection closed through app termination');
        process.exit(0);
    });
};

const connectDatabase = async () => {
    const appDbUrlPresent = Boolean(process.env.APP_DB_URL);
    console.log(`[MongoDB] APP_DB_URL present: ${appDbUrlPresent}`);
    console.log(
        `[MongoDB] Current readyState: ${mongoose.connection.readyState}`
    );

    if (mongoose.connection.readyState === 1) {
        console.log('[MongoDB] Reusing existing open connection');
        return mongoose.connection;
    }

    if (connectionPromise) {
        console.log('[MongoDB] Reusing in-flight connection promise');
        return connectionPromise;
    }

    registerConnectionListeners();

    const isReconnect = hasConnectedOnce;
    if (isReconnect) {
        console.log('[MongoDB] Starting reconnect attempt...');
    } else {
        console.log('[MongoDB] Starting connection attempt...');
    }

    connectionPromise = mongoose
        .connect(process.env.APP_DB_URL, {
            // These options are now defaults in Mongoose 6+
            // But explicitly set for clarity and backward compatibility
        })
        .then((connection) => {
            hasConnectedOnce = true;
            if (isReconnect) {
                console.log('[MongoDB] Reconnected successfully');
                console.log(
                    `[MongoDB] Reconnect readyState: ${mongoose.connection.readyState}`
                );
            } else {
                console.log('[MongoDB] Connected successfully');
                console.log(
                    `[MongoDB] readyState after connect: ${mongoose.connection.readyState}`
                );
            }
            return connection;
        })
        .catch((error) => {
            connectionPromise = null;
            console.error(`[MongoDB] Connection failed: ${error.message}`);
            throw error;
        });

    return connectionPromise;
};

export default connectDatabase;
