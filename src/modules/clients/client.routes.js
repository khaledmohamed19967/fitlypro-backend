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
import nutritionProfileRoutes from '../nutrition-profiles/nutrition-profile.routes.js';
import {
    calculatorRouter,
    recommendationRouter,
} from '../nutrition-calculator/nutrition-calculator.routes.js';
import nutritionPlanAssignmentClientRoutes from '../nutrition-plan-assignments/nutrition-plan-assignment.client.routes.js';
import workoutPlanClientRoutes from '../workout-plans/workout-plan.client.routes.js';

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

// Nested nutrition / workout modules (before /:id CRUD so static segments match first is fine —
// these use /:id/... so mount explicitly)
router.use('/:id/nutrition-profile', nutritionProfileRoutes);
router.use('/:id/nutrition-calculator', calculatorRouter);
router.use('/:id/nutrition-recommendations', recommendationRouter);
router.use('/:id/nutrition-plan-assignment', nutritionPlanAssignmentClientRoutes);
router.use('/:id/workout-plan-assignment', workoutPlanClientRoutes);

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
