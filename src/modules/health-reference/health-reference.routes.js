import express from 'express';
import { listHealthReferenceOptions } from './health-reference.controller.js';
import { validateListHealthReferenceOptionsQuery } from './health-reference.validator.js';
import { validateQuery } from '../../middlewares/validate.js';

/**
 * Public read-only catalog (injury areas, allergies, dietary restrictions).
 * No auth: prospects need this for registration. No write routes on this module.
 */
const router = express.Router();

router.get(
    '/',
    validateQuery(validateListHealthReferenceOptionsQuery),
    listHealthReferenceOptions
);

export default router;
