/**
 * Coaching package end date for User.startDate / User.packageDuration / User.endDate.
 * Workout and nutrition PlanAssignment dates are unrelated.
 */

export const PACKAGE_DURATION_MONTHS = Object.freeze({
    '1_month': 1,
    '3_months': 3,
    '6_months': 6,
    '12_months': 12,
});

const hasUsableDate = (value) => {
    if (value === undefined || value === null || value === '') {
        return false;
    }
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
};

/**
 * Add calendar months in UTC so ISO dates like 2026-09-06T00:00:00.000Z
 * stay date-stable regardless of server timezone.
 */
export const addCalendarMonthsUtc = (startDate, months) => {
    const start = new Date(startDate);      
    if (Number.isNaN(start.getTime())) {
        return null;
    }

    const result = new Date(
        Date.UTC(
            start.getUTCFullYear(),
            start.getUTCMonth(),
            start.getUTCDate(),
            start.getUTCHours(),
            start.getUTCMinutes(),
            start.getUTCSeconds(),
            start.getUTCMilliseconds()
        )
    );
    result.setUTCMonth(result.getUTCMonth() + Number(months));
    return result;
};

const normalizeOptionalDate = (value) => {
    if (value === undefined || value === '') {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/**
 * Resolve User.endDate from coaching package fields.
 *
 * - finite packageDuration + startDate → calendar-month endDate (overrides supplied endDate)
 * - packageDuration === 'ongoing' → null
 * - otherwise keep a usable supplied/existing endDate, or undefined
 */
export const resolveCoachingPackageEndDate = ({
    startDate,
    packageDuration,
    endDate,
} = {}) => {
    if (packageDuration === 'ongoing') {
        return null;
    }

    const months = PACKAGE_DURATION_MONTHS[packageDuration];
    if (hasUsableDate(startDate) && months) {
        return addCalendarMonthsUtc(startDate, months);
    }

    return normalizeOptionalDate(endDate);
};

export const applyCoachingPackageEndDate = (fields) => {
    const resolved = resolveCoachingPackageEndDate(fields);
    if (resolved === undefined) {
        return fields;
    }
    fields.endDate = resolved;
    return fields;
};
