import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import helmet from 'helmet';
import config from './config/index.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';

const app = express();

/**
 * Security Middleware
 */
app.use(helmet()); // Adds security headers
app.use(cors({ origin: config.cors.origin })); // Enable CORS

/**
 * Logging Middleware
 */
if (config.env === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

/**
 * Body Parser Middleware
 */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * API Routes
 */
app.use(config.api.prefix, routes);

/**
 * Root endpoint
 */
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Welcome to Fitly Pro API',
        version: '1.0.0',
    });
});

/**
 * Error Handling Middleware
 */
app.use(notFoundHandler); // 404 handler
app.use(errorHandler); // Global error handler

export default app;
