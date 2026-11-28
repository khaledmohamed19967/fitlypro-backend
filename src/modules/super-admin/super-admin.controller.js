import superAdminService from './super-admin.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

/**
 * Super Admin Controller — Phase 1 trainer oversight.
 */

/**
 * @desc    Total registered trainer accounts
 * @route   GET /api/v1/super-admin/trainers/count
 * @access  Private (admin)
 */
export const getTrainerCount = asyncHandler(async (req, res) => {
    const data = await superAdminService.getTrainerCount();
    res.status(200).json(
        new ApiResponse(200, data, 'Trainer count retrieved successfully')
    );
});

/**
 * @desc    Searchable paginated trainers with client counts
 * @route   GET /api/v1/super-admin/trainers
 * @access  Private (admin)
 */
export const listTrainers = asyncHandler(async (req, res) => {
    const { page, limit, search } = req.query;
    const data = await superAdminService.listTrainers({
        page,
        limit,
        search: search ? String(search).trim() : undefined,
    });
    res.status(200).json(
        new ApiResponse(200, data, 'Trainers retrieved successfully')
    );
});

/**
 * @desc    Single trainer profile
 * @route   GET /api/v1/super-admin/trainers/:trainerId
 * @access  Private (admin)
 */
export const getTrainerById = asyncHandler(async (req, res) => {
    const data = await superAdminService.getTrainerById(req.params.trainerId);
    res.status(200).json(
        new ApiResponse(200, data, 'Trainer retrieved successfully')
    );
});

/**
 * @desc    Clients assigned to a trainer
 * @route   GET /api/v1/super-admin/trainers/:trainerId/clients
 * @access  Private (admin)
 */
export const listTrainerClients = asyncHandler(async (req, res) => {
    const { page, limit, search, status } = req.query;
    const data = await superAdminService.listTrainerClients(req.params.trainerId, {
        page,
        limit,
        search: search ? String(search).trim() : undefined,
        status,
    });
    res.status(200).json(
        new ApiResponse(200, data, 'Trainer clients retrieved successfully')
    );
});
