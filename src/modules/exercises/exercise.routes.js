import express from 'express';
import {
    createExercise,
    getExercises,
    getExerciseById,
    updateExercise,
} from './exercise.controller.js';
import { validateCreateExercise, validateUpdateExercise } from './exercise.validator.js';
import { validate } from '../../middlewares/validate.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * Exercise Routes
 * All routes require authentication and trainer/admin role
 */

router.use(protect);
router.use(authorize('trainer', 'admin'));

router
    .route('/')
    .get(getExercises)
    .post(validate(validateCreateExercise), createExercise);

router
    .route('/:id')
    .get(getExerciseById)
    .patch(validate(validateUpdateExercise), updateExercise);

export default router;
