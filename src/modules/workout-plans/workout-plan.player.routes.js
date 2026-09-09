import express from 'express';
import { getMyWorkoutPlan } from './workout-plan.controller.js';
import workoutSessionRoutes from './workout-session.routes.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

/**
 * Player-facing workout routes under /api/v1/me
 * Ownership is always the authenticated client (req.user.id).
 */
const router = express.Router();

router.use(protect);
router.use(authorize('client'));

router.get('/workout-plan', getMyWorkoutPlan);
router.use('/workout-sessions', workoutSessionRoutes);

export default router;
