import mongoose from 'mongoose';

const PACKAGE_DURATION_FILTERS = new Set([
    '1_month',
    '3_months',
    '6_months',
    '12_months',
    'ongoing',
]);

/**
 * Trainer-scoped Mongo filter for GET /clients list, search, and summary.
 * Summary counts use the same scope as the current list request (not page slice).
 *
 * @param {string|import('mongoose').Types.ObjectId} trainerId
 * @param {object} [options]
 * @param {string} [options.search]
 * @param {'active'|'inactive'} [options.status]
 * @param {string} [options.packageDuration]
 */
export const buildClientListScopeQuery = (
    trainerId,
    { search, status, packageDuration } = {}
) => {
    const query = {
        role: 'client',
        trainer: new mongoose.Types.ObjectId(String(trainerId)),
    };

    if (status === 'active') {
        query.isActive = true;
    } else if (status === 'inactive') {
        query.isActive = false;
    }

    if (
        packageDuration &&
        PACKAGE_DURATION_FILTERS.has(String(packageDuration))
    ) {
        query.packageDuration = String(packageDuration);
    }

    const term = typeof search === 'string' ? search.trim() : '';
    if (term) {
        query.$or = [
            { firstName: { $regex: term, $options: 'i' } },
            { lastName: { $regex: term, $options: 'i' } },
            { email: { $regex: term, $options: 'i' } },
        ];
    }

    return query;
};

export { PACKAGE_DURATION_FILTERS };
