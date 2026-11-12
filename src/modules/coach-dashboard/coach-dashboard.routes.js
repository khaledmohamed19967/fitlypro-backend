import express from 'express';
import {
    getCoachDashboardOverview,
    getCoachDashboardClientsGrowth,
} from './coach-dashboard.controller.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);
router.use(authorize('trainer', 'admin'));

router.get('/overview', getCoachDashboardOverview);
router.get('/clients-growth', getCoachDashboardClientsGrowth);

export default router;
