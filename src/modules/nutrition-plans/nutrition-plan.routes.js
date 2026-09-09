import express from 'express';
import {
    getNutritionPlans,
    getNutritionPlanSummary,
    getNutritionPlanById,
    createNutritionPlan,
    updateNutritionPlan,
    archiveNutritionPlan,
    cloneNutritionPlan,
} from './nutrition-plan.controller.js';
import {
    createNutritionAssignments,
    getNutritionAssignments,
    cancelNutritionAssignment,
} from '../nutrition-plan-assignments/nutrition-plan-assignment.controller.js';
import {
    validateCreateNutritionPlan,
    validateUpdateNutritionPlan,
    validateCloneNutritionPlan,
} from './nutrition-plan.validator.js';
import {
    validateCreateNutritionAssignment,
    validateCancelNutritionAssignment,
} from '../nutrition-plan-assignments/nutrition-plan-assignment.validator.js';
import { validate } from '../../middlewares/validate.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * Nutrition Plan Routes
 * All routes require authentication and trainer/admin role
 */

router.use(protect);
router.use(authorize('trainer', 'admin'));

router.get('/summary', getNutritionPlanSummary);

router
    .route('/')
    .get(getNutritionPlans)
    .post(validate(validateCreateNutritionPlan), createNutritionPlan);

router.route('/:id/clone').post(validate(validateCloneNutritionPlan), cloneNutritionPlan);

router
    .route('/:id/assignments')
    .get(getNutritionAssignments)
    .post(validate(validateCreateNutritionAssignment), createNutritionAssignments);

router
    .route('/:id/assignments/:assignmentId')
    .patch(validate(validateCancelNutritionAssignment), cancelNutritionAssignment);

router
    .route('/:id')
    .get(getNutritionPlanById)
    .patch(validate(validateUpdateNutritionPlan), updateNutritionPlan)
    .delete(archiveNutritionPlan);

export default router;
