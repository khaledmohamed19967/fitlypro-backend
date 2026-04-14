import app from './app.js';
import config from './config/index.js';
import connectDatabase from './config/database.js';

/**
 * Initialize Database Connection
 */
connectDatabase();

/**
 * Start Server
 */
const PORT = config.port;

const server = app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT} in ${config.env} mode`);
    console.log(`📡 API endpoint: http://localhost:${PORT}${config.api.prefix}`);
});

/**
 * Graceful Shutdown
 */
const gracefulShutdown = () => {
    console.log('\n⚠️  Received shutdown signal, closing server gracefully...');

    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
        console.error('❌ Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('❌ Unhandled Promise Rejection:', err);
    gracefulShutdown();
});

export default server;
