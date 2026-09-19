import mongoose from 'mongoose';

/**
 * Database connection configuration
 * Cached using global object for Vercel serverless functions
 */
let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

let listenersRegistered = false;

const registerConnectionListeners = () => {
    if (listenersRegistered) return;
    listenersRegistered = true;

    mongoose.connection.on('error', (err) => {
        console.error('[MongoDB] Connection error event:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
        console.warn(`[MongoDB] Disconnected. readyState: ${mongoose.connection.readyState}`);
        console.warn('[MongoDB] Clearing cached connection');
        cached.conn = null;
        cached.promise = null;
    });

    if (process.env.NODE_ENV !== 'production') {
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('MongoDB connection closed through app termination');
            process.exit(0);
        });
    }
};

const connectDatabase = async () => {
    const appDbUrlPresent = Boolean(process.env.APP_DB_URL);
    console.log(`[MongoDB] APP_DB_URL present: ${appDbUrlPresent}`);
    console.log(`[MongoDB] Current readyState: ${mongoose.connection.readyState}`);

    // 1. إعادة استخدام الاتصال القائم
    if (cached.conn) {
        console.log('[MongoDB] Reusing cached connection instance');
        return cached.conn;
    }

    if (mongoose.connection.readyState === 1) {
        console.log('[MongoDB] Reusing existing open connection');
        cached.conn = mongoose.connection;
        return cached.conn;
    }

    // 2. إعادة استخدام الـ Promise لو الاتصال شغال حالياً
    if (cached.promise) {
        console.log('[MongoDB] Reusing in-flight connection promise');
        return cached.promise;
    }

    registerConnectionListeners();

    // 3. خيارات الاتصال الخاصة بـ Serverless لعدم التعليق (Hanging)
    const opts = {
        bufferCommands: false, // بيمنع Mongoose إنه يعلق الـ Queries لو الاتصال مش جاهز
        serverSelectionTimeoutMS: 5000, // يرمي Error بعد 5 ثواني عشان يظهر في الـ Logs
    };

    console.log('[MongoDB] Starting connection attempt...');

    cached.promise = mongoose
        .connect(process.env.APP_DB_URL, opts)
        .then((mongooseInstance) => {
            console.log('[MongoDB] Connected successfully');
            console.log(`[MongoDB] readyState after connect: ${mongooseInstance.connection.readyState}`);
            cached.conn = mongooseInstance.connection;
            return cached.conn;
        })
        .catch((error) => {
            cached.promise = null;
            cached.conn = null;
            console.error(`[MongoDB] Connection failed: ${error.message}`);
            throw error;
        });

    try {
        await cached.promise;
    } catch (e) {
        cached.promise = null;
        throw e;
    }

    return cached.conn;
};

export default connectDatabase;
