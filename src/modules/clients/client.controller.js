import clientService from './client.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Client Controller
 * Handles HTTP requests and sends responses
 */

/**
 * @desc    Create a new client
 * @route   POST /api/v1/clients
 * @access  Private (Trainer only)
 */
export const createClient = asyncHandler(async (req, res) => {
    // req.user is set by auth middleware
    const trainerId = req.user.id;

    const client = await clientService.createClient(req.body, trainerId);

    res.status(201).json(
        new ApiResponse(201, client, 'Client created successfully')
    );
});

/**
 * @desc    Get all clients for logged-in trainer
 * @route   GET /api/v1/clients
 * @access  Private (Trainer only)
 */
export const getMyClients = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const { page = 1, limit = 10, status, search } = req.query;

    let result;

    // If search term provided, use search functionality
    if (search) {
        const clients = await clientService.searchClients(trainerId, search);
        result = {
            clients,
            pagination: {
                page: 1,
                limit: clients.length,
                total: clients.length,
                pages: 1,
            },
        };
    } else {
        // Build filters
        const filters = {};
        if (status) filters.status = status;

        result = await clientService.getClientsByTrainer(
            trainerId,
            filters,
            {
                page: parseInt(page),
                limit: parseInt(limit),
            }
        );
    }

    res.status(200).json(
        new ApiResponse(200, result, 'Clients retrieved successfully')
    );
});

/**
 * @desc    Get client by ID
 * @route   GET /api/v1/clients/:id
 * @access  Private (Trainer only - must own the client)
 */
export const getClientById = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const client = await clientService.getClientById(clientId, trainerId);

    res.status(200).json(
        new ApiResponse(200, client, 'Client retrieved successfully')
    );
});

/**
 * @desc    Update client
 * @route   PUT /api/v1/clients/:id
 * @access  Private (Trainer only - must own the client)
 */
export const updateClient = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const client = await clientService.updateClient(
        clientId,
        req.body,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(200, client, 'Client updated successfully')
    );
});

/**
 * @desc    Delete client (soft delete)
 * @route   DELETE /api/v1/clients/:id
 * @access  Private (Trainer only - must own the client)
 */
export const deleteClient = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    await clientService.deleteClient(clientId, trainerId);

    res.status(200).json(
        new ApiResponse(200, null, 'Client deactivated successfully')
    );
});

/**
 * @desc    Add progress note to client
 * @route   POST /api/v1/clients/:id/progress
 * @access  Private (Trainer only - must own the client)
 */
export const addProgressNote = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const client = await clientService.addProgressNote(
        clientId,
        req.body,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(200, client, 'Progress note added successfully')
    );
});

/**
 * @desc    Get trainer statistics
 * @route   GET /api/v1/clients/stats
 * @access  Private (Trainer only)
 */
export const getTrainerStats = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;

    const stats = await clientService.getTrainerStats(trainerId);

    res.status(200).json(
        new ApiResponse(200, stats, 'Statistics retrieved successfully')
    );
});
