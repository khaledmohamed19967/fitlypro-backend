/**
 * Coaching package end-date calculation (no HTTP / DB).
 * Run: node scripts/test-client-package-end-date.mjs
 */
import {
    addCalendarMonthsUtc,
    resolveCoachingPackageEndDate,
} from '../src/modules/clients/client.package-dates.js';

const results = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};

const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const iso = (value) => (value instanceof Date ? value.toISOString() : value);

const START = '2026-09-06T00:00:00.000Z';

const cases = [
    ['1_month', '2026-10-06T00:00:00.000Z'],
    ['3_months', '2026-12-06T00:00:00.000Z'],
    ['6_months', '2027-03-06T00:00:00.000Z'],
    ['12_months', '2027-09-06T00:00:00.000Z'],
];

for (const [duration, expected] of cases) {
    const resolved = resolveCoachingPackageEndDate({
        startDate: START,
        packageDuration: duration,
    });
    if (iso(resolved) === expected) {
        pass(`${duration} from 2026-09-06 → ${expected.slice(0, 10)}`);
    } else {
        fail(`${duration} from 2026-09-06`, `got=${iso(resolved)}`);
    }
}

const ongoing = resolveCoachingPackageEndDate({
    startDate: START,
    packageDuration: 'ongoing',
    endDate: '2027-03-06T00:00:00.000Z',
});
if (ongoing === null) {
    pass('ongoing clears endDate to null');
} else {
    fail('ongoing clears endDate to null', `got=${iso(ongoing)}`);
}

const missingStart = resolveCoachingPackageEndDate({
    packageDuration: '6_months',
    endDate: '2027-01-01T00:00:00.000Z',
});
if (iso(missingStart) === '2027-01-01T00:00:00.000Z') {
    pass('missing startDate keeps supplied endDate');
} else {
    fail('missing startDate keeps supplied endDate', `got=${iso(missingStart)}`);
}

const missingStartNoEnd = resolveCoachingPackageEndDate({
    packageDuration: '6_months',
});
if (missingStartNoEnd === undefined) {
    pass('missing startDate without endDate yields undefined');
} else {
    fail('missing startDate without endDate yields undefined', `got=${iso(missingStartNoEnd)}`);
}

const suppliedIgnored = resolveCoachingPackageEndDate({
    startDate: START,
    packageDuration: '6_months',
    endDate: '2026-09-07T00:00:00.000Z',
});
if (iso(suppliedIgnored) === '2027-03-06T00:00:00.000Z') {
    pass('finite duration overrides supplied endDate');
} else {
    fail('finite duration overrides supplied endDate', `got=${iso(suppliedIgnored)}`);
}

const changedStart = resolveCoachingPackageEndDate({
    startDate: '2026-01-15T00:00:00.000Z',
    packageDuration: '3_months',
});
if (iso(changedStart) === '2026-04-15T00:00:00.000Z') {
    pass('changing startDate recalculates endDate');
} else {
    fail('changing startDate recalculates endDate', `got=${iso(changedStart)}`);
}

const changedDuration = resolveCoachingPackageEndDate({
    startDate: START,
    packageDuration: '1_month',
});
if (iso(changedDuration) === '2026-10-06T00:00:00.000Z') {
    pass('changing packageDuration recalculates endDate');
} else {
    fail('changing packageDuration recalculates endDate', `got=${iso(changedDuration)}`);
}

const fromOngoing = resolveCoachingPackageEndDate({
    startDate: START,
    packageDuration: '6_months',
    endDate: null,
});
if (iso(fromOngoing) === '2027-03-06T00:00:00.000Z') {
    pass('switching from ongoing to finite package sets endDate');
} else {
    fail('switching from ongoing to finite package sets endDate', `got=${iso(fromOngoing)}`);
}

const add = addCalendarMonthsUtc(START, 6);
if (iso(add) === '2027-03-06T00:00:00.000Z') {
    pass('addCalendarMonthsUtc 6 months');
} else {
    fail('addCalendarMonthsUtc 6 months', `got=${iso(add)}`);
}

const failed = results.filter((r) => !r.ok);
console.log('\n---');
console.log(
    `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
);
process.exit(failed.length ? 1 : 0);
