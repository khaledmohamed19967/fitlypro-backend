/**
 * Allowlisted Studio fixture export models (no filesystem paths from clients).
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PLAN_EXPORT_TYPES } from '../plan-export.constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

/**
 * Allowlist only. Client may pass these ids — never paths or filenames with separators.
 */
export const STUDIO_FIXTURE_IDS = Object.freeze([
    'workout-basic',
    'nutrition-basic',
]);

const FIXTURE_META = Object.freeze({
    'workout-basic': Object.freeze({
        id: 'workout-basic',
        planType: 'workout',
        label: 'Workout basic',
        file: 'workout-basic.json',
    }),
    'nutrition-basic': Object.freeze({
        id: 'nutrition-basic',
        planType: 'nutrition',
        label: 'Nutrition basic',
        file: 'nutrition-basic.json',
    }),
});

/**
 * @returns {{ id: string, planType: string, label: string }[]}
 */
export const listStudioFixtures = (planType) => {
    const all = STUDIO_FIXTURE_IDS.map((id) => {
        const meta = FIXTURE_META[id];
        return { id: meta.id, planType: meta.planType, label: meta.label };
    });
    if (planType == null || planType === '') return all;
    if (!PLAN_EXPORT_TYPES.includes(planType)) return [];
    return all.filter((entry) => entry.planType === planType);
};

/**
 * @param {string} fixtureId
 * @param {string} planType
 * @returns {{ ok: true, exportModel: object } | { ok: false, status: number, message: string }}
 */
export const loadStudioFixtureExportModel = (fixtureId, planType) => {
    if (typeof fixtureId !== 'string' || !STUDIO_FIXTURE_IDS.includes(fixtureId)) {
        return { ok: false, status: 400, message: 'Unknown fixture id' };
    }

    if (
        typeof fixtureId === 'string' &&
        (fixtureId.includes('/') ||
            fixtureId.includes('\\') ||
            fixtureId.includes('..') ||
            fixtureId.includes('\0'))
    ) {
        return { ok: false, status: 400, message: 'Unknown fixture id' };
    }

    const meta = FIXTURE_META[fixtureId];
    if (!meta) {
        return { ok: false, status: 400, message: 'Unknown fixture id' };
    }

    if (!PLAN_EXPORT_TYPES.includes(planType) || meta.planType !== planType) {
        return {
            ok: false,
            status: 400,
            message: 'Fixture does not match plan type',
        };
    }

    const absolute = join(FIXTURES_DIR, meta.file);
    if (!absolute.startsWith(FIXTURES_DIR)) {
        return { ok: false, status: 400, message: 'Unknown fixture id' };
    }

    let parsed;
    try {
        parsed = JSON.parse(readFileSync(absolute, 'utf8'));
    } catch {
        return { ok: false, status: 500, message: 'Fixture could not be loaded' };
    }

    if (!parsed || parsed.type !== planType) {
        return {
            ok: false,
            status: 500,
            message: 'Fixture export model is invalid',
        };
    }

    return { ok: true, exportModel: parsed, fixtureId: meta.id };
};

export default {
    STUDIO_FIXTURE_IDS,
    listStudioFixtures,
    loadStudioFixtureExportModel,
};
