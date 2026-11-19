import express from 'express';
import {
    getCurrentClientSubscription,
    getClientSubscriptionHistory,
    createClientSubscription,
    cancelClientSubscription,
} from './client-subscription.controller.js';
import {
    validateCreateSubscription,
    validateSubscriptionHistoryQuery,
} from './client-subscription.validator.js';
import { validate, validateQuery } from '../../middlewares/validate.js';

/** Nested under /clients/:id/subscription — mergeParams for :id */
const router = express.Router({ mergeParams: true });

router.get(
    '/history',
    validateQuery(validateSubscriptionHistoryQuery),
    getClientSubscriptionHistory
);

router.post('/cancel', cancelClientSubscription);

router
    .route('/')
    .get(getCurrentClientSubscription)
    .post(validate(validateCreateSubscription), createClientSubscription);

export default router;
