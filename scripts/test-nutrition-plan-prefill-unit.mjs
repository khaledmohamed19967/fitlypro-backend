/**
 * Recommendation → Plan Prefill unit tests (no HTTP).
 * Run: node scripts/test-nutrition-plan-prefill-unit.mjs
 */

import {
    mapCalculatorGoalToPlanGoal,
    mapRecommendationToPlanPrefill,
} from '../src/modules/nutrition-calculator/nutrition-recommendation-plan-prefill.js';

const results = [];
const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const assertThrows = (fn, part) => {
    try {
        fn();
        return { ok: false, detail: 'no throw' };
    } catch (err) {
        if (part && !String(err.message).includes(part)) {
            return { ok: false, detail: err.message };
        }
        return { ok: true };
    }
};

// Goal mapping
const goals = [
    ['maintenance', 'maintenance'],
    ['muscle_gain', 'muscle_gain'],
    ['weight_loss', 'weight_loss'],
    ['body_recomposition', 'body_recomp'],
];
for (const [from, to] of goals) {
    try {
        if (mapCalculatorGoalToPlanGoal(from) === to) pass(`Goal map ${from} → ${to}`);
        else fail(`Goal map ${from} → ${to}`, mapCalculatorGoalToPlanGoal(from));
    } catch (err) {
        fail(`Goal map ${from} → ${to}`, err.message);
    }
}

const badGoal = assertThrows(() => mapCalculatorGoalToPlanGoal('high_protein'), 'cannot be mapped');
if (badGoal.ok) pass('Unmapped calculator goal rejected');
else fail('Unmapped calculator goal rejected', badGoal.detail);

const baseRec = {
    id: 'rec1',
    status: 'approved',
    goal: 'body_recomposition',
    recommendedCalories: 2500,
    recommendedMacros: { proteinG: 150, carbsG: 250, fatG: 70 },
    finalCalories: null,
    finalMacros: null,
};

const prefill = mapRecommendationToPlanPrefill(baseRec);
if (
    prefill.goal === 'body_recomp' &&
    prefill.macroTargets.calories === 2500 &&
    prefill.macroTargets.protein === 150 &&
    prefill.macroTargets.carbs === 250 &&
    prefill.macroTargets.fat === 70 &&
    prefill.source.usedFinalCalories === false &&
    prefill.source.usedFinalMacros === false
) {
    pass('Prefill uses recommended values when no finals');
} else {
    fail('Prefill uses recommended values when no finals', JSON.stringify(prefill));
}

const withFinals = mapRecommendationToPlanPrefill({
    ...baseRec,
    goal: 'muscle_gain',
    finalCalories: 3000,
    finalMacros: { proteinG: 180, carbsG: 350, fatG: 90 },
});
if (
    withFinals.goal === 'muscle_gain' &&
    withFinals.macroTargets.calories === 3000 &&
    withFinals.macroTargets.protein === 180 &&
    withFinals.macroTargets.carbs === 350 &&
    withFinals.macroTargets.fat === 90 &&
    withFinals.source.usedFinalCalories === true &&
    withFinals.source.usedFinalMacros === true
) {
    pass('Prefill prefers coach final values');
} else {
    fail('Prefill prefers coach final values', JSON.stringify(withFinals));
}

const calculatedOnly = assertThrows(
    () => mapRecommendationToPlanPrefill({ ...baseRec, status: 'calculated' }),
    'Only approved'
);
if (calculatedOnly.ok) pass('Unapproved recommendation rejected');
else fail('Unapproved recommendation rejected', calculatedOnly.detail);

// Nested public DTO shape
const nested = mapRecommendationToPlanPrefill({
    id: 'rec2',
    status: 'approved',
    inputs: { goal: 'weight_loss' },
    results: {
        recommendedCalories: 2000,
        recommendedMacros: { proteinG: 140, carbsG: 180, fatG: 55 },
    },
    finalCalories: null,
    finalMacros: null,
});
if (
    nested.goal === 'weight_loss' &&
    nested.macroTargets.calories === 2000 &&
    nested.macroTargets.protein === 140
) {
    pass('Prefill accepts nested public recommendation DTO');
} else {
    fail('Prefill accepts nested public recommendation DTO', JSON.stringify(nested));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
