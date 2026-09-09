/**
 * Nutrition Plan Assignment — pure helpers
 */

/**
 * @param {import('mongoose').Document|object} doc
 * @returns {object}
 */
const toPlainObject = (doc) =>
    typeof doc?.toObject === 'function' ? doc.toObject({ virtuals: true }) : doc ?? {};

/**
 * @param {import('mongoose').Types.ObjectId|string|undefined|null} id
 * @returns {string|null}
 */
const toIdString = (id) => (id != null ? id.toString?.() ?? String(id) : null);

/**
 * Resolve planId whether stored as ObjectId or populated NutritionPlan.
 *
 * @param {import('mongoose').Types.ObjectId|object|string|null|undefined} planIdField
 * @returns {string|null}
 */
const resolvePlanId = (planIdField) => {
    if (planIdField == null) return null;
    if (typeof planIdField === 'object' && (planIdField._id != null || planIdField.id != null)) {
        return toIdString(planIdField._id ?? planIdField.id);
    }
    return toIdString(planIdField);
};

/**
 * Map populated plan to Client Details summary only (id + name).
 * Returns null when planId is not populated — keeps plan-scoped list responses stable.
 *
 * @param {import('mongoose').Types.ObjectId|object|string|null|undefined} planIdField
 * @returns {{ id: string|null, name: string }|null}
 */
const mapPlanSummary = (planIdField) => {
    if (
        planIdField &&
        typeof planIdField === 'object' &&
        typeof planIdField.name === 'string'
    ) {
        return {
            id: toIdString(planIdField._id ?? planIdField.id),
            name: planIdField.name,
        };
    }
    return null;
};

/**
 * Map assignment to public API shape.
 *
 * @param {import('mongoose').Document|object} assignment
 * @param {import('mongoose').Document|object|null} [client]
 * @returns {object}
 */
export const mapNutritionAssignmentToPublic = (assignment, client = null) => {
    const doc = toPlainObject(assignment);

    return {
        id: toIdString(doc._id ?? doc.id),
        planId: resolvePlanId(doc.planId),
        planVersionId: toIdString(doc.planVersionId),
        clientId: toIdString(doc.clientId),
        client:
            client && typeof client.getPublicProfile === 'function'
                ? client.getPublicProfile()
                : null,
        plan: mapPlanSummary(doc.planId),
        startDate: doc.startDate,
        endDate: doc.endDate ?? null,
        status: doc.status,
        notes: doc.notes ?? null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};
