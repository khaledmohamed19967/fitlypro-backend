/**
 * Classic nutrition HTML builder.
 * Markup synced with fitlypro-template (index.html / styles.css).
 * Meals are structural — not presented as a workout-style calendar.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    escapeHtml,
    formatGeneratedDate,
    formatLabel,
    formatNumberGrouped,
    pickMacro,
} from '../../pdf/htmlEscape.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NUTRITION_STYLES = readFileSync(join(__dirname, 'nutrition.css'), 'utf8');

/**
 * @param {object} exportModel
 */
const collectMeals = (exportModel) => {
    const days = exportModel?.content?.nutritionDays ?? [];
    const meals = [];

    for (const day of days) {
        for (const meal of day.meals ?? []) {
            meals.push(meal);
        }
    }

    meals.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return meals;
};

const mealDisplayName = (meal) =>
    meal.name ||
    formatLabel(meal.mealType) ||
    (meal.order != null ? `Meal ${meal.order}` : 'Meal');

const foodLabel = (item) => {
    const name = item.name || 'Food';
    const brand = item.brand ? ` (${item.brand})` : '';
    return escapeHtml(`${name}${brand}`);
};

const formatMacroNumber = (macros, key) => {
    const value = pickMacro(macros, [key]);
    if (value == null) return '—';
    return escapeHtml(formatNumberGrouped(value, 0));
};

const buildFoodCellHtml = (item) => {
    const name = foodLabel(item);
    const hasQty = item.quantity != null && item.quantity !== '';
    const hasUnit = Boolean(item.unit);

    if (!hasQty && !hasUnit) {
        return `<span class="food-name">${name}</span>`;
    }

    const qty = hasQty
        ? `<span class="qty">${escapeHtml(String(item.quantity))}</span>`
        : '';
    const unit = hasUnit ? `<span class="unit">${escapeHtml(String(item.unit))}</span>` : '';

    return `<span class="food-amount">${qty}${unit}</span><span class="food-name">${name}</span>`;
};

const buildMacroCell = (macros, key, { calories = false } = {}) => {
    const formatted = formatMacroNumber(macros, key);

    if (calories) {
        return `<td class="cell-cal"><span class="cal-value">${formatted}</span></td>`;
    }

    return `<td class="cell-macro"><span class="qty">${formatted}</span></td>`;
};

const buildMealRows = (meal) => {
    const foods = meal.foodItems ?? [];
    const mealName = escapeHtml(mealDisplayName(meal));

    if (foods.length === 0) {
        return `<tr class="meal-start">
      <td class="cell-meal">${mealName}</td>
      <td colspan="5" class="empty">No foods</td>
    </tr>`;
    }

    return foods
        .map((item, index) => {
            const macros = item.itemMacros ?? {};
            const mealCell =
                index === 0
                    ? `<td class="cell-meal" rowspan="${foods.length}">${mealName}</td>`
                    : '';
            const rowClass = index === 0 ? 'meal-start' : '';

            return `<tr class="${rowClass}">
    ${mealCell}
    <td class="cell-food">${buildFoodCellHtml(item)}</td>
    ${buildMacroCell(macros, 'calories', { calories: true })}
    ${buildMacroCell(macros, 'protein')}
    ${buildMacroCell(macros, 'carbs')}
    ${buildMacroCell(macros, 'fat')}
  </tr>`;
        })
        .join('');
};

const sumMealTotals = (meals) => {
    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    let hasAny = false;

    for (const meal of meals) {
        const t = meal.mealTotals;
        if (!t) continue;

        for (const key of ['calories', 'protein', 'carbs', 'fat']) {
            const value = pickMacro(t, [key]);
            if (value != null) {
                totals[key] += value;
                hasAny = true;
            }
        }
    }

    return hasAny ? totals : null;
};

const formatTotalNumber = (value) => {
    if (value == null) return '—';
    return escapeHtml(formatNumberGrouped(value, 0));
};

const formatStatusValue = (status) => {
    const label = formatLabel(status) || '—';
    if (status === 'active') {
        return `<span class="info-status">${escapeHtml(label)}</span>`;
    }
    return escapeHtml(label);
};

const countMealsPerDay = (plan, meals) => {
    if (plan.totalMeals != null && plan.totalMeals > 0) {
        return String(plan.totalMeals);
    }
    if (meals.length) return String(meals.length);
    return '—';
};

const buildPlanInfoTable = (plan, trainer, mealsPerDay) => {
    const goal = formatLabel(plan.goal) || '—';
    const level = formatLabel(plan.scheduleMode) || '—';
    const duration =
        plan.duration != null ? `${plan.duration} weeks` : '—';

    return `<table class="plan-info-table" aria-label="Plan information">
    <colgroup>
      <col class="col-info-label" />
      <col class="col-info-value" />
      <col class="col-info-label" />
      <col class="col-info-value" />
    </colgroup>
    <thead>
      <tr>
        <th colspan="2">Contact</th>
        <th colspan="2">Program</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="info-label">Trainer</td>
        <td class="info-value">${escapeHtml(trainer.fullName || '—')}</td>
        <td class="info-label">Goal</td>
        <td class="info-value">${escapeHtml(goal)}</td>
      </tr>
      <tr>
        <td class="info-label">Email</td>
        <td class="info-value">${escapeHtml(trainer.email || '—')}</td>
        <td class="info-label">Level</td>
        <td class="info-value">${escapeHtml(level)}</td>
      </tr>
      <tr>
        <td class="info-label">Phone</td>
        <td class="info-value">${escapeHtml(trainer.phone || '—')}</td>
        <td class="info-label">Duration</td>
        <td class="info-value">${escapeHtml(duration)}</td>
      </tr>
      <tr>
        <td class="info-label">Meals / day</td>
        <td class="info-value">${escapeHtml(mealsPerDay)}</td>
        <td class="info-label">Status</td>
        <td class="info-value">${formatStatusValue(plan.status)}</td>
      </tr>
    </tbody>
  </table>`;
};

const buildPlanDetailsSection = (plan, trainer, mealsPerDay) =>
    `<section class="section plan-details-section">
    <div class="section-heading">
      <span class="accent-bar" aria-hidden="true"></span>
      <h2 class="section-title">Plan Details</h2>
    </div>
    ${buildPlanInfoTable(plan, trainer, mealsPerDay)}
  </section>`;

const buildMealPlanSection = (meals, planTotals) => {
    const rows = meals.length
        ? meals.map(buildMealRows).join('')
        : `<tr><td colspan="6" class="empty">No meals configured.</td></tr>`;

    const totals = planTotals ?? sumMealTotals(meals);
    const totalsRow = totals
        ? `<tr class="totals-row">
        <td class="cell-meal" colspan="2">Daily Totals</td>
        <td class="cell-cal"><span class="cal-value">${formatTotalNumber(totals.calories)}</span></td>
        <td class="cell-macro"><span class="qty">${formatTotalNumber(totals.protein)}</span></td>
        <td class="cell-macro"><span class="qty">${formatTotalNumber(totals.carbs)}</span></td>
        <td class="cell-macro"><span class="qty">${formatTotalNumber(totals.fat)}</span></td>
      </tr>`
        : '';

    return `<section class="section meal-plan-section">
    <div class="section-heading">
      <span class="accent-bar" aria-hidden="true"></span>
      <h2 class="section-title">Daily Meal Plan</h2>
    </div>
    <table class="meal-table">
      <colgroup>
        <col class="col-meal" />
        <col class="col-food" />
        <col class="col-cal" />
        <col class="col-p" />
        <col class="col-c" />
        <col class="col-f" />
      </colgroup>
      <thead>
        <tr>
          <th>Meal</th>
          <th>Food &amp; Ingredients</th>
          <th>Cal</th>
          <th>P</th>
          <th>C</th>
          <th>F</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        ${totalsRow}
      </tbody>
    </table>
  </section>`;
};

const parseNotesList = (notes) =>
    String(notes)
        .split(/\n+/)
        .map((line) => line.replace(/^[\s•\-*]+/, '').trim())
        .filter(Boolean);

const buildNotesSection = (notes) => {
    if (!notes) return '';

    const items = parseNotesList(notes);
    if (!items.length) return '';

    const body =
        items.length === 1
            ? `<p class="notes-text">${escapeHtml(items[0])}</p>`
            : `<ul class="notes-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;

    return `<section class="section notes-section">
    <div class="section-heading">
      <span class="accent-bar" aria-hidden="true"></span>
      <h2 class="section-title">Notes &amp; Instructions</h2>
    </div>
    <div class="notes-box">${body}</div>
  </section>`;
};

const wrapNutritionDocument = ({
    bodyHtml,
    pageTitle,
    planName,
    planDescription,
    planDate,
}) => `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <title>${pageTitle}</title>
  <link rel="preconnect" href="https://rsms.me/" />
  <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
  <style>${NUTRITION_STYLES}</style>
</head>
<body>
  <div class="page-wrap">
    <article class="page">
      <header class="header">
        <div class="brand">
          <div class="brand-wordmark">FITLY<span class="pro">PRO</span></div>
          <p class="brand-kicker">Nutrition Plan</p>
        </div>
        <p class="plan-date">
          <span class="plan-date-label">Plan Date:</span>
          <span class="plan-date-value">${planDate}</span>
        </p>
      </header>

      <section class="title-block">
        <h1 class="plan-title">${planName}</h1>
        ${planDescription}
      </section>

      ${bodyHtml}

      <footer class="footer">
        <div class="footer-url">www.fitlypro.com</div>
        <div class="footer-tagline">Train Smart. Eat Right. Live Better.</div>
      </footer>
    </article>
  </div>
</body>
</html>`;

/**
 * @param {object} exportModel
 * @returns {string}
 */
export const buildClassicNutritionHtml = (exportModel) => {
    const plan = exportModel.plan || {};
    const trainer = exportModel.trainer || {};

    const planDescription = plan.description
        ? `<p class="plan-subtitle">${escapeHtml(plan.description)}</p>`
        : '';

    const meals = collectMeals(exportModel);
    const mealsPerDay = countMealsPerDay(plan, meals);
    const planTotals = plan.computedMacros
        ? {
              calories: pickMacro(plan.computedMacros, [
                  'calories',
                  'avgDailyCalories',
              ]),
              protein: pickMacro(plan.computedMacros, [
                  'protein',
                  'avgDailyProtein',
              ]),
              carbs: pickMacro(plan.computedMacros, ['carbs', 'avgDailyCarbs']),
              fat: pickMacro(plan.computedMacros, ['fat', 'avgDailyFat']),
          }
        : sumMealTotals(meals);

    const bodyHtml = `
    ${buildPlanDetailsSection(plan, trainer, mealsPerDay)}
    ${buildMealPlanSection(meals, planTotals)}
    ${buildNotesSection(plan.notes)}
  `;

    return wrapNutritionDocument({
        bodyHtml,
        pageTitle: escapeHtml(plan.name || 'Nutrition Plan'),
        planName: escapeHtml(plan.name || 'Nutrition Plan'),
        planDescription,
        planDate: escapeHtml(formatGeneratedDate()),
    });
};
