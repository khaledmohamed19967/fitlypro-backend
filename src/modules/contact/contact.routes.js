import express from 'express';
import { createContactMessage } from './contact.controller.js';
import { validateCreateContactMessage } from './contact.validator.js';
import { validate } from '../../middlewares/validate.js';

/**
 * Public Contact Us — no authentication.
 * Rate limiting is enforced in the service via MongoDB (serverless-safe).
 */
const router = express.Router();

router.post('/', validate(validateCreateContactMessage), createContactMessage);

export default router;
