/**
 * Application-level protection for User.joinedCoachAt.
 *
 * Allows:
 * - Initial assignment on document create / save (isNew)
 * - Query/bulk updates that only target docs with null/missing joinedCoachAt (backfill)
 *
 * Blocks:
 * - Replacing or clearing an existing non-null joinedCoachAt via save / query updates / bulkWrite
 *
 * Does not protect raw MongoDB collection APIs (User.collection.*).
 */

const isPlainObject = (value) =>
    value != null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

/**
 * True when the filter can only match documents that still lack joinedCoachAt.
 *
 * @param {object} filter
 */
export const filterAllowsInitialJoinedCoachAtAssignment = (filter = {}) => {
    if (!filter || typeof filter !== 'object') {
        return false;
    }

    if (filter.joinedCoachAt === null) {
        return true;
    }

    if (filter.joinedCoachAt && filter.joinedCoachAt.$exists === false) {
        return true;
    }

    if (Array.isArray(filter.$or)) {
        const hasNull = filter.$or.some((clause) => clause && clause.joinedCoachAt === null);
        const hasMissing = filter.$or.some(
            (clause) => clause?.joinedCoachAt && clause.joinedCoachAt.$exists === false
        );
        if (hasNull && hasMissing) {
            return true;
        }
        if (hasNull || hasMissing) {
            return true;
        }
    }

    if (Array.isArray(filter.$and)) {
        return filter.$and.some((clause) => filterAllowsInitialJoinedCoachAtAssignment(clause));
    }

    return false;
};

const deleteJoinedCoachAtKey = (target) => {
    if (!isPlainObject(target)) {
        return false;
    }
    if (!Object.prototype.hasOwnProperty.call(target, 'joinedCoachAt')) {
        return false;
    }
    delete target.joinedCoachAt;
    return true;
};

/**
 * Strip joinedCoachAt mutations from a Mongoose/Mongo update document.
 * Returns true if anything was removed.
 *
 * @param {object|object[]|null|undefined} update
 */
export const stripJoinedCoachAtFromUpdate = (update) => {
    if (update == null) {
        return false;
    }

    let stripped = false;

    if (Array.isArray(update)) {
        // Aggregation-pipeline updates: drop stages that assign joinedCoachAt.
        for (let i = update.length - 1; i >= 0; i -= 1) {
            const stage = update[i];
            if (!isPlainObject(stage)) continue;
            if (stage.$set && deleteJoinedCoachAtKey(stage.$set)) {
                stripped = true;
                if (Object.keys(stage.$set).length === 0) {
                    delete stage.$set;
                }
            }
            if (stage.$unset && deleteJoinedCoachAtKey(stage.$unset)) {
                stripped = true;
                if (Object.keys(stage.$unset).length === 0) {
                    delete stage.$unset;
                }
            }
            // Entire stage that only sets joinedCoachAt via $set alias forms
            if (deleteJoinedCoachAtKey(stage)) {
                stripped = true;
            }
            if (Object.keys(stage).length === 0) {
                update.splice(i, 1);
            }
        }
        return stripped;
    }

    if (!isPlainObject(update)) {
        return false;
    }

    // Replacement-style update (no operators)
    const keys = Object.keys(update);
    const hasOperators = keys.some((key) => key.startsWith('$'));
    if (!hasOperators) {
        return deleteJoinedCoachAtKey(update);
    }

    if (update.$set && deleteJoinedCoachAtKey(update.$set)) {
        stripped = true;
        if (Object.keys(update.$set).length === 0) {
            delete update.$set;
        }
    }
    if (update.$unset && deleteJoinedCoachAtKey(update.$unset)) {
        stripped = true;
        if (Object.keys(update.$unset).length === 0) {
            delete update.$unset;
        }
    }
    // $setOnInsert may set on upsert of a brand-new doc — still strip unless
    // caller uses null filter; creation should use User.create instead.
    if (update.$setOnInsert && deleteJoinedCoachAtKey(update.$setOnInsert)) {
        stripped = true;
        if (Object.keys(update.$setOnInsert).length === 0) {
            delete update.$setOnInsert;
        }
    }
    if (update.$rename && update.$rename.joinedCoachAt !== undefined) {
        delete update.$rename.joinedCoachAt;
        stripped = true;
        if (Object.keys(update.$rename).length === 0) {
            delete update.$rename;
        }
    }

    return stripped;
};

/**
 * Sanitize a query update against its filter.
 *
 * @param {object} filter
 * @param {object|object[]} update
 * @returns {boolean} whether the update was modified
 */
export const sanitizeJoinedCoachAtQueryUpdate = (filter, update) => {
    if (filterAllowsInitialJoinedCoachAtAssignment(filter)) {
        return false;
    }
    return stripJoinedCoachAtFromUpdate(update);
};

/**
 * Sanitize bulkWrite operations in place.
 *
 * @param {object[]} ops
 * @returns {number} number of ops sanitized
 */
export const sanitizeJoinedCoachAtBulkWriteOps = (ops) => {
    if (!Array.isArray(ops)) {
        return 0;
    }

    let sanitized = 0;
    for (const op of ops) {
        if (!op || typeof op !== 'object') continue;

        if (op.updateOne) {
            const changed = sanitizeJoinedCoachAtQueryUpdate(
                op.updateOne.filter,
                op.updateOne.update
            );
            if (changed) sanitized += 1;
        }
        if (op.updateMany) {
            const changed = sanitizeJoinedCoachAtQueryUpdate(
                op.updateMany.filter,
                op.updateMany.update
            );
            if (changed) sanitized += 1;
        }
        if (op.replaceOne?.replacement) {
            if (
                !filterAllowsInitialJoinedCoachAtAssignment(op.replaceOne.filter) &&
                deleteJoinedCoachAtKey(op.replaceOne.replacement)
            ) {
                sanitized += 1;
            }
        }
    }
    return sanitized;
};

/**
 * Register Mongoose middleware on the User schema.
 *
 * @param {import('mongoose').Schema} schema
 */
export const registerJoinedCoachAtGuards = (schema) => {
    schema.pre('init', function captureJoinedCoachAt(doc) {
        this.$locals.joinedCoachAtFrozen =
            doc?.joinedCoachAt != null ? new Date(doc.joinedCoachAt) : null;
    });

    schema.pre('save', function preventJoinedCoachAtOverwriteOnSave() {
        if (this.isNew) {
            return;
        }
        const frozen = this.$locals?.joinedCoachAtFrozen;
        if (frozen != null && this.isModified('joinedCoachAt')) {
            this.joinedCoachAt = frozen;
        }
    });

    schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function sanitizeQueryUpdate() {
        const filter = this.getFilter?.() ?? {};
        const update = this.getUpdate?.();
        if (update == null) {
            return;
        }
        sanitizeJoinedCoachAtQueryUpdate(filter, update);
        // Ensure Mongoose sees the mutated update object
        this.setUpdate?.(update);
    });

    schema.pre('bulkWrite', function sanitizeBulkWrite(ops) {
        sanitizeJoinedCoachAtBulkWriteOps(ops);
    });
};
