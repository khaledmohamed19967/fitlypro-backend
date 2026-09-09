import express from 'express';
import {
    archiveFood,
    createFood,
    getFoodByBarcode,
    getFoodById,
    getFoods,
    materializeExternalFoods,
    searchExternalFoods,
    updateFood,
} from './food.controller.js';
import { validateCreateFood, validateUpdateFood } from './food.validator.js';
import { validate } from '../../middlewares/validate.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * Food Routes
 * All routes require authentication and trainer/admin role
 */

router.use(protect);
router.use(authorize('trainer', 'admin'));

router
    .route('/')
    .get(getFoods)
    .post(validate(validateCreateFood), createFood);

router.get('/search', searchExternalFoods);
router.post('/from-external', materializeExternalFoods);
router.get('/barcode/:barcode', getFoodByBarcode);

router
    .route('/:id')
    .get(getFoodById)
    .patch(validate(validateUpdateFood), updateFood)
    .delete(archiveFood);

export default router;
