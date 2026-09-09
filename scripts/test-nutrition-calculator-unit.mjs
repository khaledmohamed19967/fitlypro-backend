/**
 * Nutrition Calculator — pure unit tests (no HTTP / DB).
 * Run: node scripts/test-nutrition-calculator-unit.mjs
 */

import {
    calculateAgeFromDob,
    calculateBmr,
    resolveActivityFactor,
    applyGoalCalorieAdjustment,
    calculateNutritionRecommendation,
} from '../src/modules/nutrition-calculator/nutrition-calculator.service.js';
import { ACTIVITY_FACTORS } from '../src/modules/nutrition-calculator/nutrition-calculator.constants.js';
import { calculateRecommendedMacros } from '../src/modules/nutrition-calculator/nutrition-calculator.macros.js';

const results = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};

const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const assertThrows = (fn, expectedMessagePart) => {
    try {
        fn();
        return { ok: false, detail: 'no error thrown' };
    } catch (err) {
        if (expectedMessagePart && !String(err.message).includes(expectedMessagePart)) {
            return { ok: false, detail: err.message };
        }
        return { ok: true };
    }
};

// Male BMR: 80kg, 180cm, age 30 → 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
const maleBmr = calculateBmr('male', 80, 180, 30);
if (maleBmr === 1780) pass('Male BMR (Mifflin-St Jeor)');
else fail('Male BMR (Mifflin-St Jeor)', String(maleBmr));

// Female BMR: 65kg, 165cm, age 28 → 10*65 + 6.25*165 - 5*28 - 161 = 650 + 1031.25 - 140 - 161 = 1380.25
const femaleBmr = calculateBmr('female', 65, 165, 28);
if (Math.abs(femaleBmr - 1380.25) < 0.01) pass('Female BMR (Mifflin-St Jeor)');
else fail('Female BMR (Mifflin-St Jeor)', String(femaleBmr));

for (const [level, factor] of Object.entries(ACTIVITY_FACTORS)) {
    try {
        const resolved = resolveActivityFactor(level);
        if (resolved === factor) pass(`Activity factor: ${level}`);
        else fail(`Activity factor: ${level}`, `${resolved} != ${factor}`);
    } catch (err) {
        fail(`Activity factor: ${level}`, err.message);
    }
}

const invalidActivity = assertThrows(
    () => resolveActivityFactor('ultra'),
    'Invalid activity level'
);
if (invalidActivity.ok) pass('Invalid activity level rejected');
else fail('Invalid activity level rejected', invalidActivity.detail);

const maintenance = applyGoalCalorieAdjustment(2000, 'maintenance');
if (maintenance.recommendedCalories === 2000 && maintenance.multiplier === 1) {
    pass('Maintenance goal calories');
} else {
    fail('Maintenance goal calories', JSON.stringify(maintenance));
}

const muscle = applyGoalCalorieAdjustment(2000, 'muscle_gain');
if (muscle.recommendedCalories === 2200 && muscle.multiplier === 1.1) {
    pass('Muscle gain goal calories');
} else {
    fail('Muscle gain goal calories', JSON.stringify(muscle));
}

const loss = applyGoalCalorieAdjustment(2000, 'weight_loss');
if (loss.recommendedCalories === 1700 && loss.multiplier === 0.85) {
    pass('Weight loss goal calories');
} else {
    fail('Weight loss goal calories', JSON.stringify(loss));
}

const recomp = applyGoalCalorieAdjustment(2000, 'body_recomposition');
if (recomp.recommendedCalories === 2000 && recomp.multiplier === 1) {
    pass('Body recomposition goal calories');
} else {
    fail('Body recomposition goal calories', JSON.stringify(recomp));
}

const invalidGoal = assertThrows(
    () => applyGoalCalorieAdjustment(2000, 'bulk'),
    'Invalid calculator goal'
);
if (invalidGoal.ok) pass('Invalid goal rejected');
else fail('Invalid goal rejected', invalidGoal.detail);

const invalidHeight = assertThrows(
    () =>
        calculateNutritionRecommendation({
            sex: 'male',
            age: 30,
            heightCm: 0,
            weightKg: 80,
            activityLevel: 'sedentary',
            goal: 'maintenance',
        }),
    'Height'
);
if (invalidHeight.ok) pass('Invalid height rejected');
else fail('Invalid height rejected', invalidHeight.detail);

const invalidWeight = assertThrows(
    () =>
        calculateNutritionRecommendation({
            sex: 'male',
            age: 30,
            heightCm: 180,
            weightKg: -5,
            activityLevel: 'sedentary',
            goal: 'maintenance',
        }),
    'Weight'
);
if (invalidWeight.ok) pass('Invalid weight rejected');
else fail('Invalid weight rejected', invalidWeight.detail);

const missingAge = assertThrows(
    () =>
        calculateNutritionRecommendation({
            sex: 'male',
            heightCm: 180,
            weightKg: 80,
            activityLevel: 'sedentary',
            goal: 'maintenance',
        }),
    'Date of birth or age'
);
if (missingAge.ok) pass('Missing age/DOB rejected');
else fail('Missing age/DOB rejected', missingAge.detail);

// DOB preferred over age
const dob = new Date();
dob.setFullYear(dob.getFullYear() - 30);
const withDob = calculateNutritionRecommendation({
    sex: 'male',
    age: 99, // should be ignored
    dateOfBirth: dob,
    heightCm: 180,
    weightKg: 80,
    activityLevel: 'moderately_active',
    goal: 'maintenance',
});
if (withDob.inputs.age === 30) pass('Age derived from DOB (ignores provided age)');
else fail('Age derived from DOB (ignores provided age)', String(withDob.inputs.age));

const full = calculateNutritionRecommendation({
    sex: 'male',
    age: 30,
    heightCm: 180,
    weightKg: 80,
    activityLevel: 'moderately_active',
    goal: 'muscle_gain',
});
const expectedBmr = 1780;
const expectedMaint = Math.round(1780 * 1.55);
const expectedRec = Math.round(expectedMaint * 1.1);
if (
    full.results.bmr === expectedBmr &&
    full.results.maintenanceCalories === expectedMaint &&
    full.results.recommendedCalories === expectedRec &&
    full.results.recommendedMacros?.proteinG > 0
) {
    pass('Full recommendation structure');
} else {
    fail('Full recommendation structure', JSON.stringify(full.results));
}

const macros = calculateRecommendedMacros({
    recommendedCalories: 2200,
    weightKg: 80,
    goal: 'muscle_gain',
});
if (macros.proteinG === 160 && macros.fatG > 0 && macros.carbsG >= 0) {
    pass('Provisional macros isolated function');
} else {
    fail('Provisional macros isolated function', JSON.stringify(macros));
}

const ageOk = calculateAgeFromDob(dob);
if (ageOk === 30) pass('calculateAgeFromDob');
else fail('calculateAgeFromDob', String(ageOk));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
