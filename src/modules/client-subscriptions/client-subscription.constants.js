/**
 * ClientSubscription — canonical enums.
 * Package durations reuse the shared FitlyFlow month-based catalog.
 */

import { PACKAGE_DURATION_VALUES } from '../clients/client.package-dates.js';

export { PACKAGE_DURATION_VALUES };

export const CLIENT_SUBSCRIPTION_STATUSES = Object.freeze([
    'active',
    'completed',
    'cancelled',
]);

export const CLIENT_SUBSCRIPTION_STATUS = Object.freeze({
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
});
