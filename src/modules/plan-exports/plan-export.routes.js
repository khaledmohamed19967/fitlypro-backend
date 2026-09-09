import express from 'express';
import {
    createPlanExport,
    getPlanExportTemplates,
} from './plan-export.controller.js';
import { validate } from '../../middlewares/validate.js';
import { validatePlanExportBody } from './plan-export.validator.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);
router.use(authorize('trainer', 'admin'));

router.get('/templates', getPlanExportTemplates);
router.post('/', validate(validatePlanExportBody), createPlanExport);

export default router;
