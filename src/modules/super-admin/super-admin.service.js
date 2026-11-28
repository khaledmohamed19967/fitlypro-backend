import mongoose from 'mongoose';
import User from '../users/user.model.js';
import { ApiError } from '../../utils/ApiError.js';
import {
    buildPaginationMeta,
    resolvePagination,
} from '../../utils/pagination.js';
import {
    toTrainerClientListItem,
    toTrainerDetail,
    toTrainerListItem,
} from './super-admin.dto.js';

const TRAINER_ROLE = 'trainer';
const CLIENT_ROLE = 'client';

const escapeRegex = (value) =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} [search]
 */
const buildTrainerSearchFilter = (search) => {
    const filter = { role: TRAINER_ROLE };
    const term = typeof search === 'string' ? search.trim() : '';
    if (!term) return filter;

    const rx = new RegExp(escapeRegex(term), 'i');
    filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
    return filter;
};

/**
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @param {{ search?: string, status?: 'active'|'inactive' }} [options]
 */
const buildTrainerClientsFilter = (trainerId, { search, status } = {}) => {
    const filter = {
        role: CLIENT_ROLE,
        trainer: new mongoose.Types.ObjectId(String(trainerId)),
    };

    if (status === 'active') {
        filter.isActive = true;
    } else if (status === 'inactive') {
        filter.isActive = false;
    }

    const term = typeof search === 'string' ? search.trim() : '';
    if (term) {
        const rx = new RegExp(escapeRegex(term), 'i');
        filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
    }

    return filter;
};

/**
 * Total registered trainer accounts (all statuses).
 */
const getTrainerCount = async () => {
    const totalTrainers = await User.countDocuments({ role: TRAINER_ROLE });
    return { totalTrainers };
};

/**
 * @param {string|import('mongoose').Types.ObjectId[]} trainerIds
 * @returns {Promise<Map<string, number>>}
 */
const countClientsByTrainerIds = async (trainerIds) => {
    const ids = (trainerIds || [])
        .map((id) => {
            try {
                return new mongoose.Types.ObjectId(String(id));
            } catch {
                return null;
            }
        })
        .filter(Boolean);

    const counts = new Map();
    if (!ids.length) return counts;

    const rows = await User.aggregate([
        {
            $match: {
                role: CLIENT_ROLE,
                trainer: { $in: ids },
            },
        },
        {
            $group: {
                _id: '$trainer',
                count: { $sum: 1 },
            },
        },
    ]);

    for (const row of rows) {
        counts.set(String(row._id), row.count);
    }
    return counts;
};

/**
 * Searchable paginated trainers with assigned client counts (no N+1).
 */
const listTrainers = async ({ page = 1, limit = 10, search } = {}) => {
    const { page: safePage, limit: safeLimit, skip } = resolvePagination({
        page,
        limit,
    });
    const filter = buildTrainerSearchFilter(search);

    const [trainers, total] = await Promise.all([
        User.find(filter)
            .select(
                'firstName lastName email isActive createdAt updatedAt role'
            )
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(safeLimit)
            .lean(),
        User.countDocuments(filter),
    ]);

    const counts = await countClientsByTrainerIds(trainers.map((t) => t._id));

    return {
        trainers: trainers.map((trainer) =>
            toTrainerListItem(trainer, counts.get(String(trainer._id)) || 0)
        ),
        pagination: buildPaginationMeta(safePage, safeLimit, total),
    };
};

/**
 * @param {string} trainerId
 */
const assertTrainerId = (trainerId) => {
    if (!mongoose.Types.ObjectId.isValid(String(trainerId))) {
        throw new ApiError(400, 'Invalid trainer id');
    }
};

/**
 * @param {string} trainerId
 */
const getTrainerById = async (trainerId) => {
    assertTrainerId(trainerId);

    const trainer = await User.findOne({
        _id: trainerId,
        role: TRAINER_ROLE,
    })
        .select(
            'firstName lastName email phone phoneCountryIso phoneCountryCode gender dateOfBirth isActive role createdAt updatedAt'
        )
        .lean();

    if (!trainer) {
        throw new ApiError(404, 'Trainer not found');
    }

    const counts = await countClientsByTrainerIds([trainer._id]);
    return toTrainerDetail(trainer, counts.get(String(trainer._id)) || 0);
};

/**
 * Clients assigned to a trainer (real User.trainer relationship).
 */
const listTrainerClients = async (
    trainerId,
    { page = 1, limit = 10, search, status } = {}
) => {
    assertTrainerId(trainerId);

    const trainerExists = await User.exists({
        _id: trainerId,
        role: TRAINER_ROLE,
    });
    if (!trainerExists) {
        throw new ApiError(404, 'Trainer not found');
    }

    const { page: safePage, limit: safeLimit, skip } = resolvePagination({
        page,
        limit,
    });
    const filter = buildTrainerClientsFilter(trainerId, { search, status });

    const [clients, total] = await Promise.all([
        User.find(filter)
            .select(
                'firstName lastName email isActive createdAt joinedCoachAt packageDuration startDate endDate'
            )
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(safeLimit)
            .lean(),
        User.countDocuments(filter),
    ]);

    return {
        clients: clients.map(toTrainerClientListItem),
        pagination: buildPaginationMeta(safePage, safeLimit, total),
    };
};

export default {
    getTrainerCount,
    listTrainers,
    getTrainerById,
    listTrainerClients,
    // exported for tests
    buildTrainerSearchFilter,
    buildTrainerClientsFilter,
    countClientsByTrainerIds,
};
