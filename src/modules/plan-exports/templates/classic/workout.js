/**
 * Classic workout HTML builder.
 * Markup synced with fitlypro-template (workouts.template.html / styles.css).
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    escapeHtml,
    formatGeneratedDate,
    formatLabel,
} from '../../pdf/htmlEscape.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKOUT_STYLES = readFileSync(join(__dirname, 'workout.css'), 'utf8');

const summarizeSets = (sets = []) => {
    const working = sets.filter((s) => !s.isWarmup);
    const list = working.length ? working : sets;

    if (!list.length) return { setCount: '—', reps: '—' };

    const setCount = String(list.length);
    const repsValues = list
        .map((s) => s.reps)
        .filter((r) => r != null && r !== '');

    let reps = '—';
    if (repsValues.length) {
        const min = Math.min(...repsValues.map(Number));
        const max = Math.max(...repsValues.map(Number));
        reps = min === max ? String(min) : `${min}-${max}`;
    }

    return { setCount, reps };
};

const formatRest = (seconds) => {
    if (seconds == null || seconds <= 0) return '—';
    return String(seconds);
};

const dayDisplayName = (day) => {
    if (day.name) return day.name;
    if (day.dayNumber != null) return `Day ${day.dayNumber}`;
    return 'Day';
};

const formatStatusValue = (status) => {
    const label = formatLabel(status) || '—';
    if (status === 'active') {
        return `<span class="info-status">${escapeHtml(label)}</span>`;
    }
    return escapeHtml(label);
};

const buildPlanInfoTable = (plan, trainer) => {
    const goal = formatLabel(plan.goal) || '—';
    const level = formatLabel(plan.level) || '—';
    const duration =
        plan.duration != null ? `${plan.duration} weeks` : '—';
    const daysPerWeek =
        plan.daysPerWeek != null ? String(plan.daysPerWeek) : '—';

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
        <td class="info-label">Days / week</td>
        <td class="info-value">${escapeHtml(daysPerWeek)}</td>
        <td class="info-label">Status</td>
        <td class="info-value">${formatStatusValue(plan.status)}</td>
      </tr>
    </tbody>
  </table>`;
};

const buildPlanDetailsSection = (plan, trainer) =>
    `<section class="section plan-details-section">
    <div class="section-heading">
      <span class="accent-bar" aria-hidden="true"></span>
      <h2 class="section-title">Plan Details</h2>
    </div>
    ${buildPlanInfoTable(plan, trainer)}
  </section>`;

const buildExerciseCell = (exercise) => {
    const name = escapeHtml(exercise.name || 'Exercise');
    const note = exercise.notes
        ? `<div class="exercise-note">${escapeHtml(exercise.notes)}</div>`
        : '';
    return `<td class="cell-food"><span class="food-name">${name}</span>${note}</td>`;
};

const buildDayRows = (day) => {
    const exercises = day.exercises ?? [];
    const dayLabel = escapeHtml(dayDisplayName(day));

    if (!exercises.length) {
        return `<tr class="meal-start">
      <td class="cell-meal">${dayLabel}</td>
      <td colspan="4" class="empty">No exercises</td>
    </tr>`;
    }

    return exercises
        .map((exercise, index) => {
            const summary = summarizeSets(exercise.sets);
            const rest = formatRest(exercise.restBetweenSets);
            const mealCell =
                index === 0
                    ? `<td class="cell-meal" rowspan="${exercises.length}">${dayLabel}</td>`
                    : '';
            const rowClass = index === 0 ? 'meal-start' : '';

            return `<tr class="${rowClass}">
      ${mealCell}
      ${buildExerciseCell(exercise)}
      <td class="cell-cal"><span class="qty">${escapeHtml(summary.setCount)}</span></td>
      <td class="cell-macro"><span class="qty">${escapeHtml(summary.reps)}</span></td>
      <td class="cell-macro"><span class="qty">${escapeHtml(rest)}</span></td>
    </tr>`;
        })
        .join('');
};

const computeWeeklySetTotal = (workoutDays) => {
    let total = 0;
    let hasAny = false;

    for (const day of workoutDays) {
        for (const exercise of day.exercises ?? []) {
            const { setCount } = summarizeSets(exercise.sets);
            if (setCount !== '—') {
                total += Number(setCount);
                hasAny = true;
            }
        }
    }

    return hasAny ? String(total) : '—';
};

const buildWorkoutSection = (workoutDays) => {
    const rows = workoutDays.length
        ? workoutDays.map(buildDayRows).join('')
        : `<tr><td colspan="5" class="empty">No workout days configured.</td></tr>`;

    const weeklySets = computeWeeklySetTotal(workoutDays);
    const totalsRow =
        workoutDays.length > 0
            ? `<tr class="totals-row">
        <td class="cell-meal" colspan="2">Weekly Totals</td>
        <td class="cell-cal"><span class="qty">${escapeHtml(weeklySets)}</span></td>
        <td class="cell-macro"><span class="qty">—</span></td>
        <td class="cell-macro"><span class="qty">—</span></td>
      </tr>`
            : '';

    return `<section class="section workout-section">
    <div class="section-heading">
      <span class="accent-bar" aria-hidden="true"></span>
      <h2 class="section-title">Weekly Workout Plan</h2>
    </div>
    <table class="meal-table">
      <colgroup>
        <col class="col-meal" />
        <col class="col-food" />
        <col class="col-cal" />
        <col class="col-p" />
        <col class="col-f" />
      </colgroup>
      <thead>
        <tr>
          <th>Day</th>
          <th>Exercise</th>
          <th>Sets</th>
          <th>Reps</th>
          <th>Rest</th>
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

const wrapWorkoutDocument = ({
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
  <style>${WORKOUT_STYLES}</style>
</head>
<body>
  <div class="page-wrap">
    <article class="page">
      <header class="header">
        <div class="brand">
          <div class="brand-wordmark">FITLY<span class="pro">PRO</span></div>
          <p class="brand-kicker">Workout Plan</p>
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
export const buildClassicWorkoutHtml = (exportModel) => {
    const plan = exportModel.plan || {};
    const trainer = exportModel.trainer || {};
    const workoutDays = exportModel.content?.workoutDays ?? [];

    const planDescription = plan.description
        ? `<p class="plan-subtitle">${escapeHtml(plan.description)}</p>`
        : '';

    const bodyHtml = `
    ${buildPlanDetailsSection(plan, trainer)}
    ${buildWorkoutSection(workoutDays)}
    ${buildNotesSection(plan.notes)}
  `;

    return wrapWorkoutDocument({
        bodyHtml,
        pageTitle: escapeHtml(plan.name || 'Workout Plan'),
        planName: escapeHtml(plan.name || 'Workout Plan'),
        planDescription,
        planDate: escapeHtml(formatGeneratedDate()),
    });
};
