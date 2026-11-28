import express from 'express';
import {
    getTrainerById,
    getTrainerCount,
    listTrainerClients,
    listTrainers,
} from './super-admin.controller.js';
import {
    validateSuperAdminListQuery,
    validateSuperAdminTrainerClientsQuery,
    validateTrainerIdParam,
} from './super-admin.validator.js';
import {
    validateParams,
    validateQuery,
} from '../../middlewares/validate.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * Super Admin routes — Phase 1.
 * Role in the data model is `admin` (product name: Super Admin).
 */
router.use(protect);
router.use(authorize('admin'));

router.get('/trainers/count', getTrainerCount);

router.get(
    '/trainers',
    validateQuery(validateSuperAdminListQuery),
    listTrainers
);

router.get(
    '/trainers/:trainerId/clients',
    validateParams(validateTrainerIdParam),
    validateQuery(validateSuperAdminTrainerClientsQuery),
    listTrainerClients
);

router.get(
    '/trainers/:trainerId',
    validateParams(validateTrainerIdParam),
    getTrainerById
);

export default router;
