/**
 * Client Module Entry Point
 * Exports all client-related functionality
 * Note: Uses User model for client data (no separate Client model)
 */

export { default as clientService } from './client.service.js';
export { default as clientRoutes } from './client.routes.js';
export * from './client.controller.js';
export * from './client.validator.js';
