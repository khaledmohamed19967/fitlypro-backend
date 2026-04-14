import User from '../users/user.model.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Client Service
 * Business logic for client operations (using User model only)
 */

// =========================================================================
// Service Methods
// =========================================================================

/**
 * Create a new client (creates User with role='client' and fitness data)
 */
const createClient = async (clientData, trainerId) => {
    // 1. Check if user with this email already exists
    const existingUser = await User.findByEmail(clientData.email);
    if (existingUser) {
        throw new ApiError(400, 'User with this email already exists');
    }

    // 2. Verify trainer exists and has trainer role
    const trainer = await User.findById(trainerId);
    if (!trainer) {
        throw new ApiError(404, 'Trainer not found');
    }
    if (trainer.role !== 'trainer') {
        throw new ApiError(403, 'Only trainers can add clients');
    }

    // 3. Create User with client role and all fitness data
    const userData = {
        // Personal information
        firstName: clientData.firstName,
        lastName: clientData.lastName,
        email: clientData.email,
        password: clientData.password,
        phone: clientData.phone,
        dateOfBirth: clientData.dateOfBirth,
        gender: clientData.gender,
        role: 'client',
        trainer: trainerId,

        // Fitness information (optional)
        primaryFitnessGoal: clientData.primaryFitnessGoal,
        currentWeight: clientData.currentWeight,
        targetWeight: clientData.targetWeight,
        height: clientData.height,
        experienceLevel: clientData.experienceLevel,

        // Program details (optional)
        programType: clientData.programType,
        sessionsPerWeek: clientData.sessionsPerWeek,
        startDate: clientData.startDate,
        packageDuration: clientData.packageDuration,
        endDate: clientData.endDate,

        // Additional information (optional)
        additionalNotes: clientData.additionalNotes,
        medicalConditions: clientData.medicalConditions,
        injuries: clientData.injuries,
    };

    const client = await User.create(userData);

    // Populate trainer info and return
    await client.populate('trainer', 'firstName lastName email');
    return client.getPublicProfile();
};

/**
 * Get all clients for a specific trainer
 */
const getClientsByTrainer = async (trainerId, filters = {}, pagination = {}) => {
    const { page = 1, limit = 10 } = pagination;
    const skip = (page - 1) * limit;

    // Build query - clients have role='client' and trainer field set
    const query = {
        role: 'client',
        trainer: trainerId,
        ...filters,
    };

    // Get total count
    const total = await User.countDocuments(query);

    // Get clients with pagination
    const clients = await User.find(query)
        .populate('trainer', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    return {
        clients: clients.map((client) => client.getPublicProfile()),
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
        },
    };
};

/**
 * Get client by ID
 */
const getClientById = async (clientId, trainerId = null) => {
    const client = await User.findOne({
        _id: clientId,
        role: 'client',
    }).populate('trainer', 'firstName lastName email');

    if (!client) {
        throw new ApiError(404, 'Client not found');
    }

    // If trainerId is provided, verify the client belongs to this trainer
    if (
        trainerId &&
        client.trainer &&
        client.trainer._id.toString() !== trainerId.toString()
    ) {
        throw new ApiError(403, 'You do not have access to this client');
    }

    return client.getPublicProfile();
};

/**
 * Update client fitness data
 */
const updateClient = async (clientId, updateData, trainerId = null) => {
    const client = await User.findOne({
        _id: clientId,
        role: 'client',
    });

    if (!client) {
        throw new ApiError(404, 'Client not found');
    }

    // Verify trainer has access
    if (trainerId && client.trainer?.toString() !== trainerId.toString()) {
        throw new ApiError(403, 'You do not have access to this client');
    }

    // Update client data
    Object.assign(client, updateData);
    await client.save();

    // Return updated client with populated data
    await client.populate('trainer', 'firstName lastName email');
    return client.getPublicProfile();
};

/**
 * Delete client (soft delete - deactivate)
 */
const deleteClient = async (clientId, trainerId = null) => {
    const client = await User.findOne({
        _id: clientId,
        role: 'client',
    });

    if (!client) {
        throw new ApiError(404, 'Client not found');
    }

    // Verify trainer has access
    if (trainerId && client.trainer?.toString() !== trainerId.toString()) {
        throw new ApiError(403, 'You do not have access to this client');
    }

    // Soft delete - mark as inactive
    client.isActive = false;
    await client.save();

    return client.getPublicProfile();
};

/**
 * Add progress note to client
 */
const addProgressNote = async (clientId, noteData, trainerId = null) => {
    const client = await User.findOne({
        _id: clientId,
        role: 'client',
    });

    if (!client) {
        throw new ApiError(404, 'Client not found');
    }

    // Verify trainer has access
    if (trainerId && client.trainer?.toString() !== trainerId.toString()) {
        throw new ApiError(403, 'You do not have access to this client');
    }

    // Add progress note using the User model's method
    await client.addProgressNote(
        noteData.weight,
        noteData.notes,
        trainerId
    );

    await client.populate('trainer', 'firstName lastName email');
    return client.getPublicProfile();
};

/**
 * Get client statistics for a trainer
 */
const getTrainerStats = async (trainerId) => {
    const stats = await User.aggregate([
        {
            $match: {
                role: 'client',
                trainer: trainerId,
            },
        },
        {
            $group: {
                _id: null,
                totalClients: { $sum: 1 },
                activeClients: {
                    $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] },
                },
                inactiveClients: {
                    $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] },
                },
            },
        },
    ]);

    return (
        stats[0] || {
            totalClients: 0,
            activeClients: 0,
            inactiveClients: 0,
        }
    );
};

/**
 * Search clients by name or email
 */
const searchClients = async (trainerId, searchTerm) => {
    const clients = await User.find({
        role: 'client',
        trainer: trainerId,
        $or: [
            { firstName: { $regex: searchTerm, $options: 'i' } },
            { lastName: { $regex: searchTerm, $options: 'i' } },
            { email: { $regex: searchTerm, $options: 'i' } },
        ],
    })
        .populate('trainer', 'firstName lastName email')
        .sort({ createdAt: -1 });

    return clients.map((client) => client.getPublicProfile());
};

export default {
    createClient,
    getClientsByTrainer,
    getClientById,
    updateClient,
    deleteClient,
    addProgressNote,
    getTrainerStats,
    searchClients,
};
