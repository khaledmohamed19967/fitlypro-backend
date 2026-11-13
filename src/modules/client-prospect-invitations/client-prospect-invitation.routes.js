import express from 'express';
import {
    createClientProspectInvitation,
    previewClientProspectInvitation,
    registerClientProspectInvitation,
} from './client-prospect-invitation.controller.js';
import {
    validateCreateClientProspectInvitation,
    validateProspectRegistration,
} from './client-prospect-invitation.validator.js';
import { validate } from '../../middlewares/validate.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * Coach create — authenticated.
 * Public preview / register — no auth (token in path).
 */

router.post(
    '/',
    protect,
    authorize('trainer', 'admin'),
    validate(validateCreateClientProspectInvitation),
    createClientProspectInvitation
);

router.get('/:token', previewClientProspectInvitation);

router.post(
    '/:token/register',
    validate(validateProspectRegistration),
    registerClientProspectInvitation
);

export default router;
