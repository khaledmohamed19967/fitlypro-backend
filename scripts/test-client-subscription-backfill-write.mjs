/**
 * Unit tests for backfill write-mode planning and CLI safety (no DB writes).
 *
 * Usage: node scripts/test-client-subscription-backfill-write.mjs
 */

import assert from 'node:assert/strict';
import {
    BACKFILL_CLASSIFICATION,
    BACKFILL_WRITE_OUTCOME,
    buildPreservedSubscriptionDoc,
    classifyLegacyClientForBackfill,
    isWriteEligibleClassification,
    planBackfillWrite,
    snapshotFingerprint,
} from './lib/client-subscription-backfill-classify.js';
import {
    parseArgs,
    assertSafeEnvironment,
} from './backfill-client-subscriptions.mjs';

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

check('parseArgs: default is dry-run', () => {
    assert.deepEqual(parseArgs([]), { mode: 'dry-run', confirmWrite: false });
});

check('parseArgs: --execute alone is rejected', () => {
    assert.throws(() => parseArgs(['--execute']), /confirm-write/);
});

check('parseArgs: --execute --confirm-write enables write', () => {
    assert.deepEqual(parseArgs(['--execute', '--confirm-write']), {
        mode: 'execute',
        confirmWrite: true,
    });
});

check('parseArgs: --confirm-write without --execute rejected', () => {
    assert.throws(() => parseArgs(['--confirm-write']), /only valid with --execute/);
});

check('parseArgs: --write rejected', () => {
    assert.throws(() => parseArgs(['--write']), /Unknown argument/);
});

check('parseArgs: unknown flag rejected', () => {
    assert.throws(() => parseArgs(['--force']), /Unknown argument/);
});

check('assertSafeEnvironment: production NODE_ENV rejected', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
        assert.throws(() => assertSafeEnvironment(), /NODE_ENV=production/);
    } finally {
        process.env.NODE_ENV = prev;
    }
});

check('isWriteEligibleClassification only active/expired', () => {
    assert.equal(isWriteEligibleClassification('legacy_active'), true);
    assert.equal(isWriteEligibleClassification('legacy_expired'), true);
    assert.equal(isWriteEligibleClassification('already_migrated'), false);
    assert.equal(isWriteEligibleClassification('invalid'), false);
});

check('buildPreservedSubscriptionDoc active preserves dates', () => {
    const classified = classifyLegacyClientForBackfill(
        client(),
        [],
        new Date('2024-01-15T00:00:00.000Z')
    );
    const doc = buildPreservedSubscriptionDoc(classified);
    assert.equal(doc.status, 'active');
    assert.equal(doc.packageDuration, '1_month');
    assert.equal(doc.startDate.toISOString(), '2024-01-01T00:00:00.000Z');
    assert.equal(doc.endDate.toISOString(), '2024-02-01T00:00:00.000Z');
});

check('buildPreservedSubscriptionDoc expired → completed', () => {
    const classified = classifyLegacyClientForBackfill(
        client(),
        [],
        new Date('2024-02-02T00:00:00.000Z')
    );
    assert.equal(classified.classification, BACKFILL_CLASSIFICATION.LEGACY_EXPIRED);
    const doc = buildPreservedSubscriptionDoc(classified);
    assert.equal(doc.status, 'completed');
});

check('buildPreservedSubscriptionDoc ongoing null endDate', () => {
    const classified = classifyLegacyClientForBackfill(
        client({ packageDuration: 'ongoing', endDate: null }),
        [],
        new Date('2024-01-15')
    );
    const doc = buildPreservedSubscriptionDoc(classified);
    assert.equal(doc.status, 'active');
    assert.equal(doc.endDate, null);
});

check('planBackfillWrite skips when any subscription exists', () => {
    const u = client();
    const plan = planBackfillWrite(
        u,
        [
            {
                _id: oid(9),
                trainerId: u.trainer,
                clientId: u._id,
                status: 'completed',
                packageDuration: '1_month',
                startDate: u.startDate,
                endDate: u.endDate,
            },
        ],
        BACKFILL_CLASSIFICATION.LEGACY_ACTIVE,
        new Date('2024-01-15')
    );
    assert.equal(plan.outcome, BACKFILL_WRITE_OUTCOME.SKIPPED_EXISTING);
});

check('planBackfillWrite skips when classification changed', () => {
    const plan = planBackfillWrite(
        client({ endDate: null }),
        [],
        BACKFILL_CLASSIFICATION.LEGACY_ACTIVE,
        new Date('2024-01-15')
    );
    assert.equal(plan.outcome, BACKFILL_WRITE_OUTCOME.SKIPPED_CHANGED);
});

check('planBackfillWrite creates when still eligible', () => {
    const plan = planBackfillWrite(
        client(),
        [],
        BACKFILL_CLASSIFICATION.LEGACY_ACTIVE,
        new Date('2024-01-15')
    );
    assert.equal(plan.outcome, BACKFILL_WRITE_OUTCOME.CREATED);
    assert.ok(plan.doc);
});

check('invalid data is not write-eligible', () => {
    const classified = classifyLegacyClientForBackfill(
        client({ packageDuration: '2_weeks' }),
        [],
        new Date()
    );
    assert.equal(classified.classification, BACKFILL_CLASSIFICATION.INVALID);
    assert.equal(isWriteEligibleClassification(classified.classification), false);
    assert.equal(buildPreservedSubscriptionDoc(classified), null);
});

check('snapshotFingerprint stable for same package fields', () => {
    const a = snapshotFingerprint(client());
    const b = snapshotFingerprint(client());
    assert.equal(a, b);
});

console.log(`\n${passed} backfill write-mode tests passed`);
