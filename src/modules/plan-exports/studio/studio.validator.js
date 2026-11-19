/**
 * Studio preview request validation (allowlisted fields only).
 */

import Joi from 'joi';
import {
    PLAN_EXPORT_TEMPLATE_IDS,
    PLAN_EXPORT_TYPES,
} from '../plan-export.constants.js';
import { STUDIO_FIXTURE_IDS } from './studio.fixtures.js';

const objectIdSchema = Joi.string().hex().length(24).messages({
    'string.hex': 'Must be a valid ObjectId',
    'string.length': 'Must be a valid ObjectId',
});

/**
 * Preview body — rejects unknown keys, trainerId, paths, HTML, URLs.
 */
export const validateStudioPreviewBody = Joi.object({
    planType: Joi.string()
        .valid(...PLAN_EXPORT_TYPES)
        .required(),
    source: Joi.string().valid('fixture', 'plan').required(),
    fixtureId: Joi.when('source', {
        is: 'fixture',
        then: Joi.string()
            .valid(...STUDIO_FIXTURE_IDS)
            .required(),
        otherwise: Joi.forbidden(),
    }),
    planId: Joi.when('source', {
        is: 'plan',
        then: objectIdSchema.required(),
        otherwise: Joi.forbidden(),
    }),
    templateId: Joi.string()
        .valid(...PLAN_EXPORT_TEMPLATE_IDS)
        .required(),
    pageId: Joi.string().trim().min(1).max(64).required(),
    format: Joi.string().valid('html', 'pdf').required(),
})
    .unknown(false)
    .messages({
        'object.unknown': 'Unknown or forbidden field in preview request',
    });

export default {
    validateStudioPreviewBody,
};
