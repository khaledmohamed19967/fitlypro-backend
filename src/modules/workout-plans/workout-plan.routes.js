import express from 'express';
import {
    getWorkoutPlans,
    getWorkoutPlanSummary,
    getWorkoutPlanById,
    createWorkoutPlan,
    updateWorkoutPlan,
    archiveWorkoutPlan,
    cloneWorkoutPlan,
    createAssignments,
    getAssignments,
    cancelWorkoutAssignment,
} from './workout-plan.controller.js';
import {
    validateCreateWorkoutPlan,
    validateUpdateWorkoutPlan,
    validateCreateAssignment,
    validateCancelWorkoutAssignment,
    validateCloneWorkoutPlan,
} from './workout-plan.validator.js';
import { validate } from '../../middlewares/validate.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * Workout Plan Routes
 * All routes require authentication and trainer/admin role
 */

router.use(protect);
router.use(authorize('trainer', 'admin'));

router.get('/summary', getWorkoutPlanSummary);

router.route('/').get(getWorkoutPlans).post(validate(validateCreateWorkoutPlan), createWorkoutPlan);

router
    .route('/:id/assignments')
    .get(getAssignments)
    .post(validate(validateCreateAssignment), createAssignments);

router
    .route('/:id/assignments/:assignmentId')
    .patch(validate(validateCancelWorkoutAssignment), cancelWorkoutAssignment);

router.route('/:id/clone').post(validate(validateCloneWorkoutPlan), cloneWorkoutPlan);

router
    .route('/:id')
    .get(getWorkoutPlanById)
    .patch(validate(validateUpdateWorkoutPlan), updateWorkoutPlan)
    .delete(archiveWorkoutPlan);

export default router;
