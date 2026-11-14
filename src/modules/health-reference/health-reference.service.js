import HealthReferenceOption from './health-reference.model.js';
import { mapHealthReferenceOptionToPublic } from './health-reference.helpers.js';

/**
 * List shared catalog options (active by default).
 * Public read-only: no user/trainer-specific data.
 *
 * @param {{ category?: string, includeInactive?: boolean }} query
 */
const listHealthReferenceOptions = async (query = {}) => {
    const filter = {};

    if (query.category) {
        filter.category = query.category;
    }

    if (!query.includeInactive) {
        filter.status = 'active';
    }

    const docs = await HealthReferenceOption.find(filter)
        .sort({ sortOrder: 1, label: 1 })
        .lean();

    return docs.map((doc) => mapHealthReferenceOptionToPublic(doc));
};

export default {
    listHealthReferenceOptions,
};
