import express from 'express';
import {
    previewClientInvitation,
    acceptClientInvitation,
} from './client-invitation.controller.js';
import { validateAcceptClientInvitation } from './client-invitation.validator.js';
import { validate } from '../../middlewares/validate.js';

/**
 * Public client invitation routes — no protect middleware.
 */
const router = express.Router();

router.get('/:token', previewClientInvitation);

router.post(
    '/:token/accept',
    validate(validateAcceptClientInvitation),
    acceptClientInvitation
);

export default router;
