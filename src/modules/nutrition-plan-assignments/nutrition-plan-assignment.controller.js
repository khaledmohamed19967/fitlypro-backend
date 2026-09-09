import nutritionPlanAssignmentService from './nutrition-plan-assignment.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

/**
 * Nutrition Plan Assignment Controller (Phase 6)
 */

/**
 * @desc    Assign nutrition plan to client(s)
 * @route   POST /api/v1/nutrition-plans/:id/assignments
 * @access  Private (Trainer / Admin)
 */
export const createNutritionAssignments = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const assignments = await nutritionPlanAssignmentService.createAssignments(
        req.params.id,
        req.body,
        trainerId
    );

    res.status(201).json(
        new ApiResponse(201, { assignments }, 'Nutrition plan assigned successfully')
    );
});

/**
 * @desc    List assignments for a nutrition plan
 * @route   GET /api/v1/nutrition-plans/:id/assignments
 * @access  Private (Trainer / Admin)
 */
export const getNutritionAssignments = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const assignments = await nutritionPlanAssignmentService.getAssignments(
        req.params.id,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(200, { assignments }, 'Assignments retrieved successfully')
    );
});

/**
 * @desc    Cancel a client's nutrition plan assignment ("Remove from Client")
 * @route   PATCH /api/v1/nutrition-plans/:id/assignments/:assignmentId
 * @access  Private (Trainer / Admin)
 */
export const cancelNutritionAssignment = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const assignment = await nutritionPlanAssignmentService.cancelAssignment(
        req.params.id,
        req.params.assignmentId,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(
            200,
            { assignment },
            'Nutrition plan assignment cancelled successfully'
        )
    );
});

/**
 * @desc    Get client's active nutrition plan assignment (Client Details → Nutrition)
 * @route   GET /api/v1/clients/:id/nutrition-plan-assignment
 * @access  Private (Trainer / Admin)
 */
export const getActiveClientNutritionAssignment = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const assignment = await nutritionPlanAssignmentService.getActiveAssignmentByClient(
        clientId,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(
            200,
            { assignment },
            assignment
                ? 'Active nutrition plan assignment retrieved successfully'
                : 'No active nutrition plan assignment for this client'
        )
    );
});
