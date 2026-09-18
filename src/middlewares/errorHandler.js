import config from '../config/index.js';
import { ApiError } from '../utils/ApiError.js';
import { isClientInvitationPath, redactSensitiveUrl } from '../utils/urlRedaction.js';

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

    // Never echo raw invitation tokens in API error messages
    const safeMessage = isClientInvitationPath(error.message)
        ? redactSensitiveUrl(error.message)
        : error.message;

    const response = {
        success: false,
        statusCode: error.statusCode,
        message: safeMessage,
        ...(error.errors && error.errors.length > 0 && { errors: error.errors }),
        ...(config.env === 'development' && { stack: error.stack }),
    };

    if (config.env === 'development') {
        console.error('❌ Error:', {
            statusCode: error.statusCode,
            message: safeMessage,
        });
    }

    res.status(error.statusCode).json(response);
};

/**
 * 404 Not Found Handler
 */
export const notFoundHandler = (req, res, next) => {
    const url = req.originalUrl || req.url || '';

    if (isClientInvitationPath(url)) {
        next(new ApiError(404, 'Invitation not found'));
        return;
    }

    next(new ApiError(404, `Route ${redactSensitiveUrl(url)} not found`));
};
