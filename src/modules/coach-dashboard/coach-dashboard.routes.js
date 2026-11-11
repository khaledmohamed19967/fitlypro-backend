import express from 'express';
import { getCoachDashboardOverview } from './coach-dashboard.controller.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);
router.use(authorize('trainer', 'admin'));

router.get('/overview', getCoachDashboardOverview);

export default router;
