import express from 'express';
import {
    createClient,
    getMyClients,
    getClientById,
    updateClient,
    deleteClient,
    addProgressNote,
    getTrainerStats,
} from './client.controller.js';
import {
    validateCreateClient,
    validateUpdateClient,
    validateProgressNote,
} from './client.validator.js';
import { validate } from '../../middlewares/validate.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * Client Routes
 * All routes require authentication and trainer role
 */

// Apply authentication middleware to all routes
router.use(protect);
router.use(authorize('trainer', 'admin'));

// Statistics route (before :id to avoid conflict)
router.get('/stats', getTrainerStats);

// CRUD routes
router
    .route('/')
    .get(getMyClients)
    .post(validate(validateCreateClient), createClient);

router
    .route('/:id')
    .get(getClientById)
    .put(validate(validateUpdateClient), updateClient)
    .delete(deleteClient);

// Progress notes route
router
    .route('/:id/progress')
    .post(validate(validateProgressNote), addProgressNote);

export default router;
