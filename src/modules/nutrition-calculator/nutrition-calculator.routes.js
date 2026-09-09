import express from 'express';
import {
    calculateNutrition,
    createRecommendation,
    listRecommendations,
    getRecommendationById,
    getRecommendationPlanPrefill,
    updateRecommendation,
} from './nutrition-calculator.controller.js';
import {
    validateCalculateNutrition,
    validateCreateRecommendation,
    validateUpdateRecommendation,
} from './nutrition-calculator.validator.js';
import { validate } from '../../middlewares/validate.js';

/** Nested under /clients/:id — mergeParams for :id */
const calculatorRouter = express.Router({ mergeParams: true });
const recommendationRouter = express.Router({ mergeParams: true });

calculatorRouter.post(
    '/calculate',
    validate(validateCalculateNutrition),
    calculateNutrition
);

recommendationRouter
    .route('/')
    .get(listRecommendations)
    .post(validate(validateCreateRecommendation), createRecommendation);

recommendationRouter.get(
    '/:recommendationId/plan-prefill',
    getRecommendationPlanPrefill
);

recommendationRouter
    .route('/:recommendationId')
    .get(getRecommendationById)
    .patch(validate(validateUpdateRecommendation), updateRecommendation);

export { calculatorRouter, recommendationRouter };
export default calculatorRouter;
