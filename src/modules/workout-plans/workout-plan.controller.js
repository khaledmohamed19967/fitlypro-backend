import workoutPlanService from './workout-plan.service.js';
import {
    validateWorkoutPlanQuery,
    validateWorkoutPlanSummaryQuery,
    validateCreateWorkoutPlan,
    validateUpdateWorkoutPlan,
    validateCreateAssignment,
} from './workout-plan.validator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Workout Plan Controller — CRUD + assignments + clone (Phase 2 + 4A)
 */

/**
 * @desc    List trainer workout plans
 * @route   GET /api/v1/workout-plans
 * @access  Private (Trainer / Admin)
 */
export const getWorkoutPlans = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;

    const { error, value } = validateWorkoutPlanQuery.validate(req.query, {
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

    const result = await workoutPlanService.getWorkoutPlans(value, trainerId);

    res.status(200).json(
        new ApiResponse(200, result, 'Workout plans retrieved successfully')
    );
});

/**
 * @desc    Workout plan tab/status counts for the current filter context
 * @route   GET /api/v1/workout-plans/summary
 * @access  Private (Trainer / Admin)
 */
export const getWorkoutPlanSummary = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;

    const { error, value } = validateWorkoutPlanSummaryQuery.validate(req.query, {
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

    const counts = await workoutPlanService.getWorkoutPlanSummary(value, trainerId);

    res.status(200).json(
        new ApiResponse(200, counts, 'Workout plan summary retrieved successfully')
    );
});

/**
 * @desc    Get workout plan by ID
 * @route   GET /api/v1/workout-plans/:id
 * @access  Private (Trainer / Admin)
 */
export const getWorkoutPlanById = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const workoutPlan = await workoutPlanService.getWorkoutPlanById(req.params.id, trainerId);

    res.status(200).json(
        new ApiResponse(200, { workoutPlan }, 'Workout plan retrieved successfully')
    );
});

/**
 * @desc    Create workout plan
 * @route   POST /api/v1/workout-plans
 * @access  Private (Trainer / Admin)
 */
export const createWorkoutPlan = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const workoutPlan = await workoutPlanService.createWorkoutPlan(req.body, trainerId);

    res.status(201).json(
        new ApiResponse(201, { workoutPlan }, 'Workout plan created successfully')
    );
});

/**
 * @desc    Update workout plan
 * @route   PATCH /api/v1/workout-plans/:id
 * @access  Private (Trainer / Admin)
 */
export const updateWorkoutPlan = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const workoutPlan = await workoutPlanService.updateWorkoutPlan(
        req.params.id,
        req.body,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(200, { workoutPlan }, 'Workout plan updated successfully')
    );
});

/**
 * @desc    Archive workout plan
 * @route   DELETE /api/v1/workout-plans/:id
 * @access  Private (Trainer / Admin)
 */
export const archiveWorkoutPlan = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const workoutPlan = await workoutPlanService.archiveWorkoutPlan(req.params.id, trainerId);

    res.status(200).json(
        new ApiResponse(200, { workoutPlan }, 'Workout plan archived successfully')
    );
});

/**
 * @desc    Clone an active plan into a new trainer-owned plan
 * @route   POST /api/v1/workout-plans/:id/clone
 * @access  Private (Trainer / Admin)
 */
export const cloneWorkoutPlan = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const workoutPlan = await workoutPlanService.cloneWorkoutPlan(
        req.params.id,
        trainerId,
        req.body
    );

    res.status(201).json(
        new ApiResponse(201, { workoutPlan }, 'Workout plan cloned successfully')
    );
});

/**
 * @desc    Assign workout plan to client(s)
 * @route   POST /api/v1/workout-plans/:id/assignments
 * @access  Private (Trainer / Admin)
 */
export const createAssignments = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const assignments = await workoutPlanService.createAssignments(
        req.params.id,
        req.body,
        trainerId
    );

    res.status(201).json(
        new ApiResponse(201, { assignments }, 'Workout plan assigned successfully')
    );
});

/**
 * @desc    List assignments for a workout plan
 * @route   GET /api/v1/workout-plans/:id/assignments
 * @access  Private (Trainer / Admin)
 */
export const getAssignments = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const assignments = await workoutPlanService.getAssignments(req.params.id, trainerId);

    res.status(200).json(
        new ApiResponse(200, { assignments }, 'Assignments retrieved successfully')
    );
});

/**
 * @desc    Get authenticated client's active workout assignment + executable plan
 * @route   GET /api/v1/me/workout-plan
 * @access  Private (Client)
 */
export const getMyWorkoutPlan = asyncHandler(async (req, res) => {
    const clientId = req.user.id;
    const assignment = await workoutPlanService.getMyActiveAssignment(clientId);

    res.status(200).json(
        new ApiResponse(
            200,
            { assignment },
            assignment
                ? 'Active workout plan retrieved successfully'
                : 'No active workout plan assignment for this client'
        )
    );
});

/**
 * @desc    Get client's active workout plan assignment (Client Details → Workout)
 * @route   GET /api/v1/clients/:id/workout-plan-assignment
 * @access  Private (Trainer / Admin)
 */
export const getClientWorkoutPlanAssignment = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const clientId = req.params.id;

    const assignment = await workoutPlanService.getClientActiveAssignment(
        clientId,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(
            200,
            { assignment },
            assignment
                ? 'Active workout plan assignment retrieved successfully'
                : 'No active workout plan assignment for this client'
        )
    );
});

/**
 * @desc    Cancel a client's workout plan assignment ("Remove from Client")
 * @route   PATCH /api/v1/workout-plans/:id/assignments/:assignmentId
 * @access  Private (Trainer / Admin)
 */
export const cancelWorkoutAssignment = asyncHandler(async (req, res) => {
    const trainerId = req.user.id;
    const assignment = await workoutPlanService.cancelAssignment(
        req.params.id,
        req.params.assignmentId,
        trainerId
    );

    res.status(200).json(
        new ApiResponse(
            200,
            { assignment },
            'Workout plan assignment cancelled successfully'
        )
    );
});
