/**
 * Pure classification helpers for legacy User package → ClientSubscription backfill.
 * Read-only; no database access.
 */

import {
    PACKAGE_DURATION_VALUES,
    PACKAGE_DURATION_MONTHS,
    resolveCoachingPackageEndDate,
} from '../../src/modules/clients/client.package-dates.js';
import { utcCalendarDayMs } from '../../src/modules/clients/client.subscription-attention.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const BACKFILL_CLASSIFICATION = Object.freeze({
    LEGACY_ACTIVE: 'legacy_active',
    LEGACY_EXPIRED: 'legacy_expired',
    ALREADY_MIGRATED: 'already_migrated',
    MISSING_PACKAGE: 'missing_package',
    INVALID: 'invalid',
    AMBIGUOUS: 'ambiguous',
});

const hasUsableDate = (value) => {
    if (value === undefined || value === null || value === '') {
        return false;
    }
    const parsed = value instanceof Date ? value : new Date(value);
    return !Number.isNaN(parsed.getTime());
};

const toDate = (value) => {
    if (!hasUsableDate(value)) return null;
    return value instanceof Date ? value : new Date(value);
};

/**
 * Inclusive UTC end-day expiry using the **stored** endDate (not recalculated).
 * @returns {number|null} daysUntilEnd, or null if no end
 */
export const daysUntilStoredEnd = (endDate, now = new Date()) => {
    const endDay = utcCalendarDayMs(endDate);
    const todayDay = utcCalendarDayMs(now);
    if (endDay === null || todayDay === null) {
        return null;
    }
    return Math.round((endDay - todayDay) / DAY_MS);
};

export const snapshotMatchesSubscription = (user, subscription) => {
    if (!user || !subscription) {
        return false;
    }
    if (user.packageDuration !== subscription.packageDuration) {
        return false;
    }
    const userStart = utcCalendarDayMs(user.startDate);
    const subStart = utcCalendarDayMs(subscription.startDate);
    if (userStart === null || subStart === null || userStart !== subStart) {
        return false;
    }
    if (subscription.packageDuration === 'ongoing') {
        return user.endDate == null && subscription.endDate == null;
    }
    const userEnd = utcCalendarDayMs(user.endDate);
    const subEnd = utcCalendarDayMs(subscription.endDate);
    return userEnd != null && subEnd != null && userEnd === subEnd;
};

/**
 * Whether stored finite endDate differs from calendar-month calc (report only).
 */
export const storedEndDiffersFromPackageCalc = (user) => {
    if (!user || user.packageDuration === 'ongoing') {
        return false;
    }
    if (!PACKAGE_DURATION_MONTHS[user.packageDuration]) {
        return false;
    }
    if (!hasUsableDate(user.startDate) || !hasUsableDate(user.endDate)) {
        return false;
    }
    const calculated = resolveCoachingPackageEndDate({
        startDate: user.startDate,
        packageDuration: user.packageDuration,
    });
    if (!calculated) {
        return false;
    }
    return utcCalendarDayMs(user.endDate) !== utcCalendarDayMs(calculated);
};

/**
 * Classify one coach-owned client for backfill dry-run / future write planning.
 *
 * @param {object} user — lean User client fields
 * @param {Array<object>} subscriptions — existing ClientSubscription rows for trainer/client
 * @param {Date} [now]
 */
export const classifyLegacyClientForBackfill = (
    user,
    subscriptions = [],
    now = new Date()
) => {
    const trainerId = user?.trainer != null ? String(user.trainer) : null;
    const clientId = user?._id != null ? String(user._id) : null;
    const base = {
        trainerId,
        clientId,
        packageDuration: user?.packageDuration ?? null,
        startDate: hasUsableDate(user?.startDate)
            ? toDate(user.startDate).toISOString()
            : null,
        endDate: hasUsableDate(user?.endDate)
            ? toDate(user.endDate).toISOString()
            : user?.endDate === null
              ? null
              : null,
        proposedStatus: null,
        classification: null,
        skipReason: null,
        notes: [],
        snapshotMatchesActive: null,
        datesInconsistentWithPackageCalc: false,
    };

    if (!clientId) {
        return {
            ...base,
            classification: BACKFILL_CLASSIFICATION.INVALID,
            skipReason: 'missing_client_id',
        };
    }

    if (user.role !== 'client') {
        return {
            ...base,
            classification: BACKFILL_CLASSIFICATION.INVALID,
            skipReason: 'not_client_role',
        };
    }

    if (!trainerId) {
        return {
            ...base,
            classification: BACKFILL_CLASSIFICATION.INVALID,
            skipReason: 'missing_trainer',
        };
    }

    const subs = Array.isArray(subscriptions) ? subscriptions : [];
    const activeSubs = subs.filter((s) => s.status === 'active');

    if (activeSubs.length > 1) {
        return {
            ...base,
            classification: BACKFILL_CLASSIFICATION.AMBIGUOUS,
            skipReason: 'multiple_active_subscriptions',
            notes: [`activeCount=${activeSubs.length}`],
        };
    }

    if (subs.length > 0) {
        const active = activeSubs[0] ?? null;
        const match = active ? snapshotMatchesSubscription(user, active) : null;
        const notes = [
            `existingSubscriptionCount=${subs.length}`,
            `activeCount=${activeSubs.length}`,
        ];
        if (active && match === false) {
            notes.push('snapshot_mismatch_vs_active_subscription');
        }
        if (!active && (user.packageDuration || user.startDate || user.endDate)) {
            notes.push('history_only_with_user_package_fields');
        }
        return {
            ...base,
            classification: BACKFILL_CLASSIFICATION.ALREADY_MIGRATED,
            skipReason: 'subscription_already_exists',
            snapshotMatchesActive: match,
            notes,
        };
    }

    const hasDuration =
        user.packageDuration != null && String(user.packageDuration).trim() !== '';
    const hasStart = hasUsableDate(user.startDate);
    const hasEnd = hasUsableDate(user.endDate);

    if (!hasDuration && !hasStart && !hasEnd) {
        return {
            ...base,
            classification: BACKFILL_CLASSIFICATION.MISSING_PACKAGE,
            skipReason: 'no_package_fields',
        };
    }

    if (!hasDuration) {
        return {
            ...base,
            classification: BACKFILL_CLASSIFICATION.INVALID,
            skipReason: 'missing_package_duration',
        };
    }

    if (!PACKAGE_DURATION_VALUES.includes(user.packageDuration)) {
        return {
            ...base,
            classification: BACKFILL_CLASSIFICATION.INVALID,
            skipReason: 'unsupported_package_duration',
        };
    }

    if (!hasStart) {
        return {
            ...base,
            classification: BACKFILL_CLASSIFICATION.INVALID,
            skipReason: 'missing_start_date',
        };
    }

    const start = toDate(user.startDate);
    const inconsistent = storedEndDiffersFromPackageCalc(user);

    if (user.packageDuration === 'ongoing') {
        if (user.endDate != null && user.endDate !== '') {
            return {
                ...base,
                classification: BACKFILL_CLASSIFICATION.INVALID,
                skipReason: 'ongoing_with_non_null_end_date',
                datesInconsistentWithPackageCalc: inconsistent,
            };
        }
        return {
            ...base,
            endDate: null,
            classification: BACKFILL_CLASSIFICATION.LEGACY_ACTIVE,
            proposedStatus: 'active',
            datesInconsistentWithPackageCalc: inconsistent,
            notes: inconsistent ? ['stored_end_differs_from_package_calc'] : [],
        };
    }

    // Finite package
    if (!hasEnd) {
        return {
            ...base,
            classification: BACKFILL_CLASSIFICATION.INVALID,
            skipReason: 'finite_missing_end_date',
            datesInconsistentWithPackageCalc: inconsistent,
        };
    }

    const end = toDate(user.endDate);
    if (end.getTime() <= start.getTime()) {
        return {
            ...base,
            classification: BACKFILL_CLASSIFICATION.INVALID,
            skipReason: 'end_date_not_after_start_date',
            datesInconsistentWithPackageCalc: inconsistent,
        };
    }

    const daysUntilEnd = daysUntilStoredEnd(end, now);
    const notes = [];
    if (inconsistent) {
        notes.push('stored_end_differs_from_package_calc');
    }

    if (daysUntilEnd != null && daysUntilEnd < 0) {
        return {
            ...base,
            endDate: end.toISOString(),
            startDate: start.toISOString(),
            classification: BACKFILL_CLASSIFICATION.LEGACY_EXPIRED,
            proposedStatus: 'completed',
            datesInconsistentWithPackageCalc: inconsistent,
            notes,
        };
    }

    // Inclusive: today (0) and future remain active
    return {
        ...base,
        endDate: end.toISOString(),
        startDate: start.toISOString(),
        classification: BACKFILL_CLASSIFICATION.LEGACY_ACTIVE,
        proposedStatus: 'active',
        datesInconsistentWithPackageCalc: inconsistent,
        notes,
    };
};

export const BACKFILL_WRITE_OUTCOME = Object.freeze({
    CREATED: 'created',
    SKIPPED_EXISTING: 'skipped_existing',
    SKIPPED_CHANGED: 'skipped_changed',
    FAILED: 'failed',
});

export const isWriteEligibleClassification = (classification) =>
    classification === BACKFILL_CLASSIFICATION.LEGACY_ACTIVE ||
    classification === BACKFILL_CLASSIFICATION.LEGACY_EXPIRED;

/**
 * Build a ClientSubscription document from a write-eligible classification result.
 * Preserves original dates — does not recalculate.
 *
 * @param {object} classificationResult
 * @returns {object|null}
 */
export const buildPreservedSubscriptionDoc = (classificationResult) => {
    if (!isWriteEligibleClassification(classificationResult?.classification)) {
        return null;
    }
    if (
        !classificationResult.trainerId ||
        !classificationResult.clientId ||
        !classificationResult.packageDuration ||
        !classificationResult.startDate ||
        !classificationResult.proposedStatus
    ) {
        return null;
    }

    const endDate =
        classificationResult.packageDuration === 'ongoing'
            ? null
            : classificationResult.endDate
              ? new Date(classificationResult.endDate)
              : null;

    if (
        classificationResult.packageDuration !== 'ongoing' &&
        !(endDate instanceof Date && !Number.isNaN(endDate.getTime()))
    ) {
        return null;
    }

    return {
        trainerId: classificationResult.trainerId,
        clientId: classificationResult.clientId,
        packageDuration: classificationResult.packageDuration,
        startDate: new Date(classificationResult.startDate),
        endDate,
        status: classificationResult.proposedStatus,
    };
};

/**
 * Decide write outcome for a candidate after re-reading live User + Subscriptions.
 * Pure — no DB access.
 *
 * @param {object} freshUser
 * @param {Array<object>} freshSubscriptions
 * @param {string} expectedClassification — from pre-execution dry-run row
 * @param {Date} [now]
 */
export const planBackfillWrite = (
    freshUser,
    freshSubscriptions,
    expectedClassification,
    now = new Date()
) => {
    const fresh = classifyLegacyClientForBackfill(
        freshUser,
        freshSubscriptions,
        now
    );

    if (
        fresh.classification === BACKFILL_CLASSIFICATION.ALREADY_MIGRATED ||
        (Array.isArray(freshSubscriptions) && freshSubscriptions.length > 0)
    ) {
        return {
            outcome: BACKFILL_WRITE_OUTCOME.SKIPPED_EXISTING,
            reason: 'subscription_already_exists',
            classification: fresh,
            doc: null,
        };
    }

    if (
        !isWriteEligibleClassification(fresh.classification) ||
        fresh.classification !== expectedClassification
    ) {
        return {
            outcome: BACKFILL_WRITE_OUTCOME.SKIPPED_CHANGED,
            reason:
                fresh.classification !== expectedClassification
                    ? `classification_changed:${expectedClassification}->${fresh.classification}`
                    : fresh.skipReason || 'no_longer_eligible',
            classification: fresh,
            doc: null,
        };
    }

    const doc = buildPreservedSubscriptionDoc(fresh);
    if (!doc) {
        return {
            outcome: BACKFILL_WRITE_OUTCOME.SKIPPED_CHANGED,
            reason: 'could_not_build_preserved_doc',
            classification: fresh,
            doc: null,
        };
    }

    return {
        outcome: BACKFILL_WRITE_OUTCOME.CREATED,
        reason: null,
        classification: fresh,
        doc,
    };
};

export const snapshotFingerprint = (user) => {
    if (!user) return null;
    return JSON.stringify({
        packageDuration: user.packageDuration ?? null,
        startDate: hasUsableDate(user.startDate)
            ? toDate(user.startDate).toISOString()
            : null,
        endDate: hasUsableDate(user.endDate)
            ? toDate(user.endDate).toISOString()
            : user?.endDate == null
              ? null
              : null,
    });
};
