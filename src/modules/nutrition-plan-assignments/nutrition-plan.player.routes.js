import express from 'express';
import { getMyNutritionPlan } from './nutrition-plan-assignment.controller.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

/**
 * Player-facing nutrition routes under /api/v1/me
 * Ownership is always the authenticated client (req.user.id).
 */
const router = express.Router();

router.use(protect);
router.use(authorize('client'));

router.get('/nutrition-plan', getMyNutritionPlan);

export default router;
