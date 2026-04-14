/**
 * Async Handler Wrapper
 * Eliminates the need for try-catch blocks in controllers
 */
export const asyncHandler = (requestHandler) => {
    return (req, res, next) => {
        Promise.resolve(requestHandler(req, res, next)).catch((err) => next(err));
    };
};
