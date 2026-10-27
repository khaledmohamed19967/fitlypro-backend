import PlanAssignment from '../workout-plans/plan-assignment.model.js';
import NutritionPlanAssignment from '../nutrition-plan-assignments/nutrition-plan-assignment.model.js';
import ClientInvitation from '../client-invitations/client-invitation.model.js';
import { CLIENT_INVITATION_STATUS } from '../client-invitations/client-invitation.constants.js';
import User from '../users/user.model.js';

/**
 * Deactivation without MongoDB transactions.
 *
 * Order: cancel active assignments → revoke pending invitations → set isActive=false.
 * If persist fails after side effects, retry DELETE reconciles when assignments are
 * already cancelled (see completeClientDeactivation). Retries do not restore assignments.
 */

/**
 * @param {import('mongoose').Types.ObjectId|string} clientId
 * @param {import('mongoose').Types.ObjectId|string} trainerId
 */
export const countActivePlanAssignmentsForClient = async (clientId, trainerId) => {
    const filter = { clientId, trainerId, status: 'active' };
    const [workoutCount, nutritionCount] = await Promise.all([
        PlanAssignment.countDocuments(filter),
        NutritionPlanAssignment.countDocuments(filter),
    ]);
    return workoutCount + nutritionCount;
};

/**
 * @param {import('mongoose').Types.ObjectId|string} clientId
 */
export const persistClientDeactivation = async (clientId) => {
    const result = await User.updateOne(
        { _id: clientId, role: 'client', isActive: true },
        { $set: { isActive: false } }
    );

    if (result.modifiedCount > 0) {
        return { applied: true };
    }

    const user = await User.findById(clientId).select('isActive role');
    if (user?.role === 'client' && user.isActive === false) {
        return { applied: false };
    }

    throw new Error('Failed to persist client deactivation');
};

/**
 * @param {import('mongoose').Types.ObjectId|string} clientId
 * @param {import('mongoose').Types.ObjectId|string} trainerId
 */
export const cancelActivePlanAssignmentsForClient = async (clientId, trainerId) => {
    const filter = { clientId, trainerId, status: 'active' };

    const [workoutResult, nutritionResult] = await Promise.all([
        PlanAssignment.updateMany(filter, { $set: { status: 'cancelled' } }),
        NutritionPlanAssignment.updateMany(filter, { $set: { status: 'cancelled' } }),
    ]);

    return {
        workoutCancelled: workoutResult.modifiedCount,
        nutritionCancelled: nutritionResult.modifiedCount,
    };
};

/**
 * @param {import('mongoose').Types.ObjectId|string} clientId
 */
export const revokePendingInvitationsForClient = async (clientId) => {
    await ClientInvitation.updateMany(
        { clientId, status: CLIENT_INVITATION_STATUS.PENDING },
        {
            $set: {
                status: CLIENT_INVITATION_STATUS.REVOKED,
                revokedAt: new Date(),
            },
        }
    );
};

/**
 * @param {import('mongoose').Types.ObjectId|string} clientId
 * @param {import('mongoose').Types.ObjectId|string} trainerId
 * @param {boolean} clientIsActive
 */
export const completeClientDeactivation = async (clientId, trainerId, clientIsActive) => {
    const activeAssignments = await countActivePlanAssignmentsForClient(clientId, trainerId);

    if (clientIsActive && activeAssignments === 0) {
        await revokePendingInvitationsForClient(clientId);
        await persistClientDeactivation(clientId);
        return;
    }

    await cancelActivePlanAssignmentsForClient(clientId, trainerId);
    await revokePendingInvitationsForClient(clientId);
    await persistClientDeactivation(clientId);
};
