/**
 * System health reference catalog — categories and statuses.
 */

export const HEALTH_REFERENCE_CATEGORIES = Object.freeze([
    'allergy',
    'dietary_restriction',
    'body_area',
]);

export const HEALTH_REFERENCE_STATUSES = Object.freeze(['active', 'inactive']);

/** Max selections per field (matches nutrition string-list caps). */
export const HEALTH_OPTION_SELECTION_MAX = 50;
