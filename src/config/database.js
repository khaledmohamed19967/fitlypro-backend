import mongoose from 'mongoose';

const connectDatabase = async () => {
    try {
        if (mongoose.connection.readyState === 1) {
            return mongoose.connection;
        }

        const conn = await mongoose.connect(process.env.APP_DB_URL);

        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

        return conn;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        throw error;
    }
};

export default connectDatabase;
