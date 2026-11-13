import express from 'express';
import {
    listRegistrationRequests,
    getRegistrationRequestById,
    approveRegistrationRequest,
    rejectRegistrationRequest,
} from './client-registration-request.controller.js';
import {
    validateListRegistrationRequestsQuery,
    validateApproveRegistrationRequest,
    validateRejectRegistrationRequest,
} from './client-registration-request.validator.js';
import { validate, validateQuery } from '../../middlewares/validate.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);
router.use(authorize('trainer'));

router.get(
    '/',
    validateQuery(validateListRegistrationRequestsQuery),
    listRegistrationRequests
);

router.get('/:id', getRegistrationRequestById);

router.post(
    '/:id/approve',
    validate(validateApproveRegistrationRequest),
    approveRegistrationRequest
);

router.post(
    '/:id/reject',
    validate(validateRejectRegistrationRequest),
    rejectRegistrationRequest
);

export default router;
