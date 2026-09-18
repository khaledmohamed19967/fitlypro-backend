import mongoose from 'mongoose';

/**
 * Database connection configuration
 * Cached for Vercel serverless: reuse open / in-flight connections.
 */
let connectionPromise = null;
let listenersRegistered = false;

const registerConnectionListeners = () => {
    if (listenersRegistered) {
        return;
    }
    listenersRegistered = true;

    mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
        console.warn('⚠️  MongoDB disconnected');
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
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    if (connectionPromise) {
        return connectionPromise;
    }

    registerConnectionListeners();

    connectionPromise = mongoose
        .connect(process.env.APP_DB_URL, {
            // These options are now defaults in Mongoose 6+
            // But explicitly set for clarity and backward compatibility
        })
        .then((connection) => {
            console.log(`✅ MongoDB Connected: ${connection.connection.host}`);
            return connection;
        })
        .catch((error) => {
            connectionPromise = null;
            console.error('❌ Database connection failed:', error.message);
            throw error;
        });

    return connectionPromise;
};

export default connectDatabase;
