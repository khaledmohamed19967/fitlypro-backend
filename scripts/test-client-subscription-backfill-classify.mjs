/**
 * Unit tests for legacy subscription backfill classification (no DB).
 *
 * Usage: node scripts/test-client-subscription-backfill-classify.mjs
 */

import assert from 'node:assert/strict';
import {
    BACKFILL_CLASSIFICATION,
    classifyLegacyClientForBackfill,
    daysUntilStoredEnd,
    snapshotMatchesSubscription,
    storedEndDiffersFromPackageCalc,
} from './lib/client-subscription-backfill-classify.js';

const oid = (n) => `507f1f77bcf86cd79943901${n}`;

const client = (overrides = {}) => ({
    _id: oid(1),
    role: 'client',
    trainer: oid(2),
    packageDuration: '1_month',
    startDate: new Date('2024-01-01T00:00:00.000Z'),
    endDate: new Date('2024-02-01T00:00:00.000Z'),
    ...overrides,
});

let passed = 0;
const check = (name, fn) => {
    try {
        fn();
        passed += 1;
        console.log(`PASS: ${name}`);
    } catch (err) {
        console.error(`FAIL: ${name}`);
        throw err;
    }
};

check('daysUntilStoredEnd: inclusive today is 0', () => {
    const end = new Date('2025-06-15T12:00:00.000Z');
    const now = new Date('2025-06-15T23:59:59.000Z');
    assert.equal(daysUntilStoredEnd(end, now), 0);
});

check('daysUntilStoredEnd: yesterday is expired (-1)', () => {
    const end = new Date('2025-06-14T00:00:00.000Z');
    const now = new Date('2025-06-15T00:00:00.000Z');
    assert.equal(daysUntilStoredEnd(end, now), -1);
});

check('missing package → missing_package', () => {
    const r = classifyLegacyClientForBackfill(
        client({
            packageDuration: undefined,
            startDate: undefined,
            endDate: undefined,
        }),
        [],
        new Date('2025-01-01')
    );
    assert.equal(r.classification, BACKFILL_CLASSIFICATION.MISSING_PACKAGE);
});

check('unsupported duration → invalid', () => {
    const r = classifyLegacyClientForBackfill(
        client({ packageDuration: '2_weeks' }),
        [],
        new Date('2025-01-01')
    );
    assert.equal(r.classification, BACKFILL_CLASSIFICATION.INVALID);
    assert.equal(r.skipReason, 'unsupported_package_duration');
});

check('finite missing end → invalid', () => {
    const r = classifyLegacyClientForBackfill(
        client({ endDate: null }),
        [],
        new Date('2025-01-01')
    );
    assert.equal(r.classification, BACKFILL_CLASSIFICATION.INVALID);
    assert.equal(r.skipReason, 'finite_missing_end_date');
});

check('ongoing with end → invalid', () => {
    const r = classifyLegacyClientForBackfill(
        client({
            packageDuration: 'ongoing',
            endDate: new Date('2025-01-01'),
        }),
        [],
        new Date('2025-01-01')
    );
    assert.equal(r.classification, BACKFILL_CLASSIFICATION.INVALID);
    assert.equal(r.skipReason, 'ongoing_with_non_null_end_date');
});

check('ongoing null end → legacy_active', () => {
    const r = classifyLegacyClientForBackfill(
        client({ packageDuration: 'ongoing', endDate: null }),
        [],
        new Date('2025-01-01')
    );
    assert.equal(r.classification, BACKFILL_CLASSIFICATION.LEGACY_ACTIVE);
    assert.equal(r.proposedStatus, 'active');
    assert.equal(r.endDate, null);
});

check('past end → legacy_expired completed', () => {
    const r = classifyLegacyClientForBackfill(
        client({
            startDate: new Date('2024-01-01T00:00:00.000Z'),
            endDate: new Date('2024-02-01T00:00:00.000Z'),
        }),
        [],
        new Date('2024-02-02T00:00:00.000Z')
    );
    assert.equal(r.classification, BACKFILL_CLASSIFICATION.LEGACY_EXPIRED);
    assert.equal(r.proposedStatus, 'completed');
});

check('end today → legacy_active (inclusive)', () => {
    const r = classifyLegacyClientForBackfill(
        client({
            startDate: new Date('2024-01-01T00:00:00.000Z'),
            endDate: new Date('2024-02-01T00:00:00.000Z'),
        }),
        [],
        new Date('2024-02-01T18:00:00.000Z')
    );
    assert.equal(r.classification, BACKFILL_CLASSIFICATION.LEGACY_ACTIVE);
    assert.equal(r.proposedStatus, 'active');
});

check('existing subscription → already_migrated', () => {
    const u = client();
    const sub = {
        _id: oid(9),
        trainerId: u.trainer,
        clientId: u._id,
        status: 'active',
        packageDuration: u.packageDuration,
        startDate: u.startDate,
        endDate: u.endDate,
    };
    const r = classifyLegacyClientForBackfill(u, [sub], new Date('2024-01-15'));
    assert.equal(r.classification, BACKFILL_CLASSIFICATION.ALREADY_MIGRATED);
    assert.equal(r.snapshotMatchesActive, true);
});

check('snapshot mismatch flagged, still already_migrated', () => {
    const u = client({ packageDuration: '3_months' });
    const sub = {
        _id: oid(9),
        trainerId: u.trainer,
        clientId: u._id,
        status: 'active',
        packageDuration: '1_month',
        startDate: u.startDate,
        endDate: u.endDate,
    };
    const r = classifyLegacyClientForBackfill(u, [sub], new Date('2024-01-15'));
    assert.equal(r.classification, BACKFILL_CLASSIFICATION.ALREADY_MIGRATED);
    assert.equal(r.snapshotMatchesActive, false);
});

check('multiple actives → ambiguous', () => {
    const u = client();
    const sub = {
        trainerId: u.trainer,
        clientId: u._id,
        status: 'active',
        packageDuration: '1_month',
        startDate: u.startDate,
        endDate: u.endDate,
    };
    const r = classifyLegacyClientForBackfill(
        u,
        [sub, { ...sub, _id: oid(8) }],
        new Date('2024-01-15')
    );
    assert.equal(r.classification, BACKFILL_CLASSIFICATION.AMBIGUOUS);
    assert.equal(r.skipReason, 'multiple_active_subscriptions');
});

check('missing trainer → invalid', () => {
    const r = classifyLegacyClientForBackfill(
        client({ trainer: null }),
        [],
        new Date()
    );
    assert.equal(r.skipReason, 'missing_trainer');
});

check('end before start → invalid', () => {
    const r = classifyLegacyClientForBackfill(
        client({
            startDate: new Date('2024-03-01'),
            endDate: new Date('2024-02-01'),
        }),
        [],
        new Date()
    );
    assert.equal(r.skipReason, 'end_date_not_after_start_date');
});

check('snapshotMatchesSubscription UTC day compare', () => {
    assert.equal(
        snapshotMatchesSubscription(
            {
                packageDuration: '1_month',
                startDate: new Date('2024-01-01T10:00:00.000Z'),
                endDate: new Date('2024-02-01T22:00:00.000Z'),
            },
            {
                packageDuration: '1_month',
                startDate: new Date('2024-01-01T00:00:00.000Z'),
                endDate: new Date('2024-02-01T00:00:00.000Z'),
            }
        ),
        true
    );
});

check('storedEndDiffersFromPackageCalc detects mismatch', () => {
    // 1_month from Jan 1 → Feb 1 per calendar months; wrong stored end
    const differs = storedEndDiffersFromPackageCalc({
        packageDuration: '1_month',
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-31T00:00:00.000Z'),
    });
    assert.equal(differs, true);
});

console.log(`\n${passed} classification tests passed`);
