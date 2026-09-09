import express from 'express';
import { getActiveClientNutritionAssignment } from './nutrition-plan-assignment.controller.js';

/** Nested under /clients/:id/nutrition-plan-assignment — mergeParams for :id */
const router = express.Router({ mergeParams: true });

router.get('/', getActiveClientNutritionAssignment);

export default router;
