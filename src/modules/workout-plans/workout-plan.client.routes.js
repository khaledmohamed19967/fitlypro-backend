import express from 'express';
import { getClientWorkoutPlanAssignment } from './workout-plan.controller.js';

/** Nested under /clients/:id/workout-plan-assignment — mergeParams for :id */
const router = express.Router({ mergeParams: true });

router.get('/', getClientWorkoutPlanAssignment);

export default router;
