/**
 * Shared pagination helpers for list endpoints.
 * Contract: { page, limit, total, pages }
 */

/**
 * @param {{ page?: number, limit?: number }} params
 */
export const resolvePagination = ({ page = 1, limit = 24 } = {}) => {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(1, Number(limit) || 24);
    const skip = (safePage - 1) * safeLimit;

    return { page: safePage, limit: safeLimit, skip };
};

/**
 * @param {number} page
 * @param {number} limit
 * @param {number} total
 */
export const buildPaginationMeta = (page, limit, total) => {
    const safeTotal = Math.max(0, Number(total) || 0);

    return {
        page,
        limit,
        total: safeTotal,
        pages: safeTotal > 0 ? Math.ceil(safeTotal / limit) : 0,
    };
};

/**
 * Run find + countDocuments with the same filter in parallel.
 *
 * @param {object} options
 * @param {import('mongoose').Model} options.model
 * @param {object} options.filter
 * @param {object|string} options.sort
 * @param {number} [options.page]
 * @param {number} [options.limit]
 * @param {boolean} [options.lean]
 */
export const paginateCollection = async ({
    model,
    filter,
    sort,
    page,
    limit,
    lean = true,
}) => {
    const { page: safePage, limit: safeLimit, skip } = resolvePagination({ page, limit });

    let query = model.find(filter).sort(sort).skip(skip).limit(safeLimit);
    if (lean) {
        query = query.lean();
    }

    const [docs, total] = await Promise.all([query, model.countDocuments(filter)]);

    return {
        docs,
        pagination: buildPaginationMeta(safePage, safeLimit, total),
    };
};

/**
 * @param {import('mongoose').Model} model
 * @param {object} filter
 */
export const countMatchingDocuments = (model, filter) => model.countDocuments(filter);
