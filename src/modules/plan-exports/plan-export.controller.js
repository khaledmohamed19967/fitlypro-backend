import planExportService from './plan-export.service.js';
import { validatePlanExportTemplatesQuery } from './plan-export.validator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';
import { createExportId } from './pdf/pdfExportTrace.js';

/**
 * @desc    List available PDF export templates
 * @route   GET /api/v1/plan-exports/templates
 * @access  Private (Trainer / Admin)
 */
export const getPlanExportTemplates = asyncHandler(async (req, res) => {
    const { error, value } = validatePlanExportTemplatesQuery.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
    });

    if (error) {
        const errors = error.details.map((detail) => ({
            field: detail.path.join('.'),
            message: detail.message,
        }));
        throw new ApiError(400, 'Validation failed', errors);
    }

    const result = planExportService.listTemplates(value.planType);
    res.status(200).json(
        new ApiResponse(200, result, 'Export templates retrieved successfully')
    );
});

/**
 * @desc    Generate a plan PDF (authoritative server-side load)
 * @route   POST /api/v1/plan-exports
 * @access  Private (Trainer / Admin)
 */
export const createPlanExport = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const exportId = createExportId(
        req.get('x-export-id') || req.body?.exportId
    );

    const result = await planExportService.exportPlanPdf(
        { ...req.body, exportId },
        trainerId
    );

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`
    );
    res.setHeader('Content-Length', result.buffer.length);
    res.setHeader('X-Export-Id', result.exportId || exportId);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(result.buffer);
});
