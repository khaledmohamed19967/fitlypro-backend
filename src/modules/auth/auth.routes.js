import express from 'express';
import authController from './auth.controller.js';
import { validate } from '../../middlewares/validate.js';
import {
    validateRegister,
    validateLogin,
    validateUpdatePassword,
} from './auth.validator.js';
import { protect } from '../../middlewares/auth.middleware.js';
import upload from '../../middlewares/upload.js';

const router = express.Router();

router.post(
    '/register',
    upload.none(),  // will sent only on expect send form data
    validate(validateRegister),
    authController.register
);

router.post(
    '/login',
    validate(validateLogin),
    authController.login
);

router.get(
    '/me',
    protect,
    authController.getProfile
);

router.put(
    '/password',
    protect,
    validate(validateUpdatePassword),
    authController.updatePassword
);

export default router;
