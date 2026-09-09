import express from 'express';
import {
    startWorkoutSession,
    logWorkoutSet,
    updateWorkoutSetLog,
    completeWorkoutSession,
    abandonWorkoutSession,
    listMyWorkoutSessions,
    getMyWorkoutSession,
} from './workout-session.controller.js';
import {
    validateStartWorkoutSession,
    validateLogWorkoutSet,
    validateUpdateWorkoutSetLog,
} from './workout-session.validator.js';
import { validate } from '../../middlewares/validate.js';

/**
 * Nested under /api/v1/me — parent applies protect + authorize('client').
 */
const router = express.Router({ mergeParams: true });

router
    .route('/')
    .get(listMyWorkoutSessions)
    .post(validate(validateStartWorkoutSession), startWorkoutSession);

router.get('/:sessionId', getMyWorkoutSession);

router.post(
    '/:sessionId/sets',
    validate(validateLogWorkoutSet),
    logWorkoutSet
);

router.patch(
    '/:sessionId/sets/:setLogId',
    validate(validateUpdateWorkoutSetLog),
    updateWorkoutSetLog
);

router.post('/:sessionId/complete', completeWorkoutSession);
router.post('/:sessionId/abandon', abandonWorkoutSession);

export default router;
