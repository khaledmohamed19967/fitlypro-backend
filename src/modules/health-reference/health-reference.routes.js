import express from 'express';
import { listHealthReferenceOptions } from './health-reference.controller.js';
import { validateListHealthReferenceOptionsQuery } from './health-reference.validator.js';
import { validateQuery } from '../../middlewares/validate.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);
router.use(authorize('trainer', 'admin'));

router.get(
    '/',
    validateQuery(validateListHealthReferenceOptionsQuery),
    listHealthReferenceOptions
);

export default router;
