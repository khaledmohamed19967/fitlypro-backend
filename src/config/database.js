import mongoose from 'mongoose';

/**
 * Database connection configuration
 */
const connectDatabase = async () => {
    try {
        const conn = await mongoose.connect(process.env.APP_DB_URL, {
            // These options are now defaults in Mongoose 6+
            // But explicitly set for clarity and backward compatibility
        });

        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

        // Handle connection events
        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('⚠️  MongoDB disconnected');
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('MongoDB connection closed through app termination');
            process.exit(0);
        });

        return conn;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        process.exit(1);
    }
};

export default connectDatabase;
