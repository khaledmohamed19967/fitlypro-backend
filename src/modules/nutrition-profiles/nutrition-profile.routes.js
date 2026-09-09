import express from 'express';
import {
    getNutritionProfile,
    upsertNutritionProfile,
} from './nutrition-profile.controller.js';
import { validateUpsertNutritionProfile } from './nutrition-profile.validator.js';
import { validate } from '../../middlewares/validate.js';

/** Nested under /clients/:id/nutrition-profile — mergeParams for :id */
const router = express.Router({ mergeParams: true });

router
    .route('/')
    .get(getNutritionProfile)
    .put(validate(validateUpsertNutritionProfile), upsertNutritionProfile);

export default router;
