/**
 * Catalog label map + optional live DB verification.
 *
 * Usage:
 *   node scripts/test-health-reference-catalog-labels.mjs
 *   BACKFILL_ACK_REMOTE_DB=1 node scripts/test-health-reference-catalog-labels.mjs --verify-db
 */

import 'dotenv/config';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import HealthReferenceOption from '../src/modules/health-reference/health-reference.model.js';
import {
    HEALTH_REFERENCE_LABEL_UPDATES,
    HEALTH_REFERENCE_SEED_OPTIONS,
} from '../src/modules/health-reference/health-reference.seed-data.js';

const EXPECTED_ALLERGY = {
    peanuts: 'Peanut Allergy',
    tree_nuts: 'Tree Nut Allergy',
    milk: 'Milk Allergy',
    eggs: 'Egg Allergy',
    wheat: 'Wheat / Gluten Allergy',
    soy: 'Soy Allergy',
    fish: 'Fish Allergy',
    shellfish: 'Shellfish Allergy',
    sesame: 'Sesame Allergy',
};

const EXPECTED_BODY = {
    lower_back: 'Lower Back Pain',
    upper_back: 'Upper Back Pain',
    neck: 'Neck Pain',
    left_shoulder: 'Left Shoulder Pain',
    right_shoulder: 'Right Shoulder Pain',
    left_knee: 'Left Knee Pain',
    right_knee: 'Right Knee Pain',
    left_hip: 'Left Hip Pain',
    right_hip: 'Right Hip Pain',
    left_ankle: 'Left Ankle Pain',
    right_ankle: 'Right Ankle Pain',
    left_wrist: 'Left Wrist Pain',
    right_wrist: 'Right Wrist Pain',
    left_elbow: 'Left Elbow Pain',
    right_elbow: 'Right Elbow Pain',
    abdomen: 'Abdominal Pain',
    chest: 'Chest Pain',
};

const EXPECTED_DIETARY = {
    halal: 'Halal',
    kosher: 'Kosher',
    vegetarian: 'Vegetarian',
    vegan: 'Vegan',
    gluten_free: 'Gluten-free',
    dairy_free: 'Dairy-free',
    pescatarian: 'Pescatarian',
    low_sodium: 'Low sodium',
};

let passed = 0;
const check = (name, fn) => {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
};

check('seed has 9 allergies with approved labels', () => {
    const allergies = HEALTH_REFERENCE_SEED_OPTIONS.filter(
        (o) => o.category === 'allergy'
    );
    assert.equal(allergies.length, 9);
    for (const [code, label] of Object.entries(EXPECTED_ALLERGY)) {
        const row = allergies.find((o) => o.code === code);
        assert.ok(row, code);
        assert.equal(row.label, label);
    }
});

check('seed has 17 body areas with approved labels', () => {
    const areas = HEALTH_REFERENCE_SEED_OPTIONS.filter(
        (o) => o.category === 'body_area'
    );
    assert.equal(areas.length, 17);
    for (const [code, label] of Object.entries(EXPECTED_BODY)) {
        const row = areas.find((o) => o.code === code);
        assert.ok(row, code);
        assert.equal(row.label, label);
    }
});

check('seed dietary labels unchanged', () => {
    const dietary = HEALTH_REFERENCE_SEED_OPTIONS.filter(
        (o) => o.category === 'dietary_restriction'
    );
    assert.equal(dietary.length, 8);
    for (const [code, label] of Object.entries(EXPECTED_DIETARY)) {
        const row = dietary.find((o) => o.code === code);
        assert.ok(row, code);
        assert.equal(row.label, label);
    }
});

check('scoped label updates are exactly 26 allergy+body rows', () => {
    assert.equal(HEALTH_REFERENCE_LABEL_UPDATES.length, 26);
    assert.ok(
        HEALTH_REFERENCE_LABEL_UPDATES.every(
            (o) => o.category === 'allergy' || o.category === 'body_area'
        )
    );
    assert.ok(
        !HEALTH_REFERENCE_LABEL_UPDATES.some(
            (o) => o.category === 'dietary_restriction'
        )
    );
});

const verifyDb = process.argv.includes('--verify-db');

if (!verifyDb) {
    console.log(`\n${passed} catalog label tests passed (seed static)`);
    process.exit(0);
}

if (process.env.BACKFILL_ACK_REMOTE_DB !== '1' && process.env.NODE_ENV !== 'test') {
    // allow local without ack
}

await mongoose.connect(process.env.APP_DB_URL);
assert.equal(mongoose.connection.name, 'test');

const total = await HealthReferenceOption.countDocuments();
assert.equal(total, 34);

for (const [code, label] of Object.entries(EXPECTED_ALLERGY)) {
    const doc = await HealthReferenceOption.findOne({
        category: 'allergy',
        code,
    }).lean();
    assert.ok(doc, code);
    assert.equal(doc.label, label);
}

for (const [code, label] of Object.entries(EXPECTED_BODY)) {
    const doc = await HealthReferenceOption.findOne({
        category: 'body_area',
        code,
    }).lean();
    assert.ok(doc, code);
    assert.equal(doc.label, label);
}

for (const [code, label] of Object.entries(EXPECTED_DIETARY)) {
    const doc = await HealthReferenceOption.findOne({
        category: 'dietary_restriction',
        code,
    }).lean();
    assert.ok(doc, code);
    assert.equal(doc.label, label);
}

const dupes = await HealthReferenceOption.aggregate([
    {
        $group: {
            _id: { category: '$category', code: '$code' },
            n: { $sum: 1 },
        },
    },
    { $match: { n: { $gt: 1 } } },
]);
assert.equal(dupes.length, 0);

await mongoose.disconnect();
passed += 1;
console.log('PASS: live DB labels match approved map; dietary intact; no dupes');
console.log(`\n${passed} catalog label tests passed`);
