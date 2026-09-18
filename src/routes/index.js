import express from 'express';
import userRoutes from '../modules/users/user.routes.js';
import authRoutes from '../modules/auth/auth.routes.js';
import clientRoutes from '../modules/clients/client.routes.js';
import exerciseRoutes from '../modules/exercises/exercise.routes.js';
import workoutPlanRoutes from '../modules/workout-plans/workout-plan.routes.js';
import workoutPlanPlayerRoutes from '../modules/workout-plans/workout-plan.player.routes.js';
import nutritionPlanPlayerRoutes from '../modules/nutrition-plan-assignments/nutrition-plan.player.routes.js';
import foodRoutes from '../modules/foods/food.routes.js';
import nutritionPlanRoutes from '../modules/nutrition-plans/nutrition-plan.routes.js';
import planExportRoutes from '../modules/plan-exports/plan-export.routes.js';
import clientInvitationRoutes from '../modules/client-invitations/client-invitation.routes.js';

const router = express.Router();

/**
 * Main Routes Configuration
 */

// Health check endpoint
router.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'API is running',
        timestamp: new Date().toISOString(),
    });
});

// Module routes
router.use('/users', userRoutes);
router.use('/auth', authRoutes);
router.use('/clients', clientRoutes);
router.use('/client-invitations', clientInvitationRoutes);
router.use('/exercises', exerciseRoutes);
router.use('/workout-plans', workoutPlanRoutes);
router.use('/me', workoutPlanPlayerRoutes);
router.use('/me', nutritionPlanPlayerRoutes);
router.use('/foods', foodRoutes);
router.use('/nutrition-plans', nutritionPlanRoutes);
router.use('/plan-exports', planExportRoutes);

// Add more module routes here

export default router;
