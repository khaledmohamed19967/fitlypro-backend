/**
 * Custom API Error Class
 */
export class ApiError extends Error {
    constructor(statusCode, message = 'Something went wrong', errors = [], stack = '') {
        super(message);
        this.statusCode = statusCode;
        this.success = false;
        this.errors = errors;
        this.data = null;

        if (stack) {
            // Preserve the original exception stack when wrapping non-ApiError throws
            // (e.g. in errorHandler). Leaving this commented made every 500 look like
            // it originated inside errorHandler.js.
            this.stack = stack;
        } else {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}
