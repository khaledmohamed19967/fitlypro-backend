import config from '../config/index.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Global Error Handler Middleware
 */
export const errorHandler = (err, req, res, next) => {
    let error = err;

    // If it's not an ApiError, create one
    if (!(error instanceof ApiError)) {
        const statusCode = error.statusCode || 500;
        const message = error.message || 'Something went wrong';
        error = new ApiError(statusCode, message, [], err.stack);
    }

    // Prepare response
    const response = {
        success: false,
        statusCode: error.statusCode,
        message: error.message,
        ...(error.errors && error.errors.length > 0 && { errors: error.errors }),
        ...(config.env === 'development' && { stack: error.stack }),
    };

    // Log error in development
    if (config.env === 'development') {
        console.error('❌ Error:', error);
    }

    // Send response
    res.status(error.statusCode).json(response);
};

/**
 * 404 Not Found Handler
 */
export const notFoundHandler = (req, res, next) => {
    const error = new ApiError(404, `Route ${req.originalUrl} not found`);
    next(error);
};
