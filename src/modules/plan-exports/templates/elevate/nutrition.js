/**
 * Elevate Nutrition HTML builder.
 *
 * Page 01 — Cover & Overview (hero, overview, daily target, day glance).
 * Page 02+ — Daily Meal Plan (packed like Workout detail pages; may continue).
 * Final — Supplements & Notes (may continue when instruction lists are long).
 *
 * Design tokens / page chrome: shared styles.css (Workout Elevate source of truth).
 * Pagination mirrors templates/elevate/page.js `packDetailPages`.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
    escapeHtml,
    formatLabel,
    formatNumberGrouped,
    pickMacro,
} from '../../pdf/htmlEscape.js';
import {
    ELEVATE_HTML_DIR,
    fitElevateTitleLayout,
    inlineLocalAssets,
} from './page.js';

export const ELEVATE_NUTRITION_HTML_ENTRY_NAME = 'nutrition.html';
export const ELEVATE_NUTRITION_HTML_ENTRY = join(
    ELEVATE_HTML_DIR,
    ELEVATE_NUTRITION_HTML_ENTRY_NAME
);

export const ELEVATE_NUTRITION_HTML_SOURCE_MARKER =
    'elevate-html-source:templates/elevate/html/nutrition.html';

/**
 * Daily Target macro accents — CSS variables from styles.css :root.
 * SVG strokes resolve via the inlined Elevate stylesheet.
 */
const MACRO_COLORS = Object.freeze({
    protein: 'var(--macro-protein)',
    carbs: 'var(--macro-carbs)',
    fat: 'var(--macro-fat)',
});

const MACRO_ICON_PROTEIN = `<span class="macro-icon macro-icon--protein" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3.6c2.6 3.1 4.4 5.5 4.4 8.1a4.4 4.4 0 1 1-8.8 0c0-2.6 1.8-5 4.4-8.1Z" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linejoin="round"/></svg></span>`;

const MACRO_ICON_CARBS = `<span class="macro-icon macro-icon--carbs" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8.2 17.6c-2.1-2.1-2.3-5.2-.4-7.4L14.6 4.8c1.8-2 5-2.1 6.9-.3 1.9 1.8 2 4.9.3 6.8l-6.6 7.2c-1.9 2.1-5 2.1-7-.1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="11.2" cy="10.2" r="1.2" fill="currentColor"/><circle cx="13.5" cy="12.3" r="1.2" fill="currentColor"/><circle cx="15.7" cy="14.4" r="1.2" fill="currentColor"/></svg></span>`;

const MACRO_ICON_FAT = `<span class="macro-icon macro-icon--fat" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3.5c2.7 3.2 4.5 5.7 4.5 8.3A4.5 4.5 0 1 1 7.5 11.8C7.5 9.2 9.3 6.7 12 3.5Z" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linejoin="round"/></svg></span>`;

const TITLE_LAYOUT = Object.freeze({
    maxWidthPx: 400,
    maxSizePx: 55,
    lineHeight: 0.98,
});

const NOTES_PAGE_DEK =
    'What to take alongside the meals, and your daily totals.';

const NOTES_CARD_LEDE =
    'What to take alongside the meals, with dose and timing.';

/** Static template guidance — not client-specific export data. */
const DEFAULT_PLAN_GUIDANCE = Object.freeze([
    'Weigh food raw or cooked exactly as written in each meal.',
    'Meal times are flexible — keep the daily totals.',
    'Drink water throughout the day.',
    'Log your check-ins in the Fitly app so your coach can follow along.',
]);

const CAPSULE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.2 9.2c-1.8 1.8-1.8 4.7 0 6.5l.1.1c1.8 1.8 4.7 1.8 6.5 0l3-3c1.8-1.8 1.8-4.7 0-6.5s-4.7-1.8-6.5 0l-.3.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M15.8 14.8c1.8-1.8 1.8-4.7 0-6.5l-.1-.1c-1.8-1.8-4.7-1.8-6.5 0l-3 3c-1.8 1.8-1.8 4.7 0 6.5s4.7 1.8 6.5 0l.3-.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;

const NOTES_HOWTO_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="M14 3.6V8h4.6M8.5 12h7M8.5 15.5h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>`;

/**
 * Meal detail packing — same budget model as Workout DETAIL_LAYOUT,
 * with shorter food rows (no exercise thumbnails).
 */
const MEAL_PAGE_LAYOUT = Object.freeze({
    pageBudget: 920,
    /** Logo + DAILY MEAL PLAN title + dek on the first meals page. */
    pageChrome: 168,
    /** Logo + padding/footer only on later meals pages. */
    compactPageChrome: 72,
    cardChrome: 78,
    rowHeight: 34,
    cardGap: 18,
});

/**
 * Notes packing — reserves bottomChrome for stats + photo/howto on the last notes page.
 */
const NOTES_PAGE_LAYOUT = Object.freeze({
    pageBudget: 920,
    /** Logo + SUPPLEMENTS & NOTES title + dek on the first notes page. */
    pageChrome: 168,
    /** Logo + padding/footer only on later notes pages. */
    compactPageChrome: 72,
    cardChrome: 96,
    itemHeight: 52,
    bottomChrome: 320,
});

/**
 * Pack meals onto one or more A4 detail pages.
 * Prefer whole-meal placement; split food rows only when a meal exceeds a full page.
 *
 * @param {Array<{ foodItems?: unknown[] }>} meals
 * @returns {{ blocks: object[] }[]}
 */
const packMealPages = (meals = []) => {
    const {
        pageBudget,
        pageChrome,
        compactPageChrome,
        cardChrome,
        rowHeight,
        cardGap,
    } = MEAL_PAGE_LAYOUT;

    /** @type {{ blocks: object[] }[]} */
    const pages = [];
    let currentBlocks = [];
    const chromeForNextPage = () =>
        pages.length === 0 && currentBlocks.length === 0
            ? pageChrome
            : compactPageChrome;
    let used = chromeForNextPage();

    const flush = () => {
        if (!currentBlocks.length) return;
        pages.push({ blocks: currentBlocks });
        currentBlocks = [];
        used = chromeForNextPage();
    };

    /** @param {number} rowCount food rows + optional total row */
    const estimateCard = (rowCount) =>
        cardChrome + Math.max(rowCount, 1) * rowHeight;

    const pushBlock = (block, height) => {
        const gap = currentBlocks.length ? cardGap : 0;
        currentBlocks.push(block);
        used += gap + height;
    };

    for (const meal of meals) {
        const foods = Array.isArray(meal.foodItems) ? meal.foodItems : [];
        // Empty meal: placeholder row + total. Otherwise foods + total.
        const wholeRows = (foods.length > 0 ? foods.length : 1) + 1;
        const wholeHeight = estimateCard(wholeRows);
        const gap = currentBlocks.length ? cardGap : 0;
        const remaining = pageBudget - used - gap;
        // Next empty page uses compact chrome once any meals page exists.
        const nextPageChrome =
            pages.length > 0 || currentBlocks.length > 0
                ? compactPageChrome
                : pageChrome;
        const fullPageCapacity = pageBudget - nextPageChrome;

        if (wholeHeight <= remaining) {
            pushBlock(
                {
                    meal,
                    foodItems: foods,
                    continued: false,
                    showTotal: true,
                },
                wholeHeight
            );
            continue;
        }

        // Move intact meal to the next page when it fits there.
        if (
            currentBlocks.length &&
            wholeHeight <= fullPageCapacity
        ) {
            flush();
            pushBlock(
                {
                    meal,
                    foodItems: foods,
                    continued: false,
                    showTotal: true,
                },
                wholeHeight
            );
            continue;
        }

        // Meal taller than one page (or empty edge-case) — split food rows.
        if (foods.length === 0) {
            if (currentBlocks.length) flush();
            pushBlock(
                {
                    meal,
                    foodItems: [],
                    continued: false,
                    showTotal: true,
                },
                estimateCard(2)
            );
            continue;
        }

        let offset = 0;
        while (offset < foods.length) {
            const blockGap = currentBlocks.length ? cardGap : 0;
            let available =
                pageBudget - used - blockGap - cardChrome;
            let maxRows = Math.floor(available / rowHeight);

            if (maxRows < 1) {
                flush();
                continue;
            }

            const remainingFoods = foods.length - offset;
            let take;
            let showTotal;

            if (remainingFoods + 1 <= maxRows) {
                take = remainingFoods;
                showTotal = true;
            } else {
                take = Math.min(maxRows, remainingFoods);
                showTotal = false;
                if (remainingFoods > take && remainingFoods - take === 1 && take > 1) {
                    take -= 1;
                }
            }

            const slice = foods.slice(offset, offset + take);
            const rowCount = take + (showTotal ? 1 : 0);
            pushBlock(
                {
                    meal,
                    foodItems: slice,
                    continued: offset > 0,
                    showTotal,
                },
                estimateCard(rowCount)
            );
            offset += take;

            if (offset < foods.length) {
                flush();
            }
        }
    }

    flush();
    if (!pages.length) {
        pages.push({ blocks: [] });
    }
    return pages;
};

/**
 * Pack supplements/vitamins onto one or more notes pages.
 * Stats + howto/photo (bottomChrome) stay on the last notes page.
 *
 * @param {{ instruction: string, order: number }[]} entries
 * @returns {{ entries: object[], continued: boolean, includeBottom: boolean }[]}
 */
const packNotesPages = (entries = []) => {
    const {
        pageBudget,
        pageChrome,
        compactPageChrome,
        cardChrome,
        itemHeight,
        bottomChrome,
    } = NOTES_PAGE_LAYOUT;

    const estimateCard = (count) =>
        cardChrome + Math.max(count, 1) * itemHeight;
    const chromeAt = (pageIndex) =>
        pageIndex === 0 ? pageChrome : compactPageChrome;

    if (!entries.length) {
        return [{ entries: [], continued: false, includeBottom: true }];
    }

    if (pageChrome + estimateCard(entries.length) + bottomChrome <= pageBudget) {
        return [
            {
                entries: [...entries],
                continued: false,
                includeBottom: true,
            },
        ];
    }

    /** @type {{ entries: object[], continued: boolean, includeBottom: boolean }[]} */
    const pages = [];
    let offset = 0;
    let continued = false;

    while (offset < entries.length) {
        const pageIndex = pages.length;
        const chrome = chromeAt(pageIndex);
        const remaining = entries.length - offset;
        const remainingHeight = estimateCard(remaining);

        if (chrome + remainingHeight + bottomChrome <= pageBudget) {
            pages.push({
                entries: entries.slice(offset),
                continued,
                includeBottom: true,
            });
            offset = entries.length;
            break;
        }

        const available = pageBudget - chrome - cardChrome;
        let take = Math.max(1, Math.floor(available / itemHeight));
        take = Math.min(take, remaining);

        if (
            take >= remaining &&
            chrome + remainingHeight + bottomChrome > pageBudget
        ) {
            pages.push({
                entries: entries.slice(offset),
                continued,
                includeBottom: false,
            });
            offset = entries.length;
            pages.push({
                entries: [],
                continued: true,
                includeBottom: true,
            });
            break;
        }

        if (remaining > take && remaining - take === 1 && take > 1) {
            take -= 1;
        }

        pages.push({
            entries: entries.slice(offset, offset + take),
            continued,
            includeBottom: false,
        });
        offset += take;
        continued = true;
    }

    if (!pages.length) {
        pages.push({ entries: [], continued: false, includeBottom: true });
    }
    if (!pages[pages.length - 1].includeBottom) {
        pages.push({ entries: [], continued: true, includeBottom: true });
    }
    return pages;
};

/**
 * @param {number} n
 * @param {number} [width]
 */
const padPageNumber = (n, width = 2) => String(n).padStart(width, '0');

/**
 * @param {number|null|undefined} value
 * @param {{ suffix?: string }} [opts]
 */
const formatMacroCell = (value, opts = {}) => {
    if (value == null || Number.isNaN(Number(value))) return '—';
    const formatted = formatNumberGrouped(value, 0) || String(value);
    return opts.suffix ? `${formatted}${opts.suffix}` : formatted;
};

/**
 * @param {number|null|undefined} quantity
 * @param {string|null|undefined} unit
 */
const formatQtyCell = (quantity, unit) => {
    if (quantity == null || Number.isNaN(Number(quantity))) return '—';
    const qty =
        formatNumberGrouped(
            quantity,
            Number.isInteger(Number(quantity)) ? 0 : 1
        ) || String(quantity);
    const u =
        unit != null && String(unit).trim() !== ''
            ? ` ${String(unit).trim()}`
            : '';
    return `${qty}${u}`;
};

/**
 * Normalize export instruction entries (supplements / vitamins).
 * Blank UI draft rows are excluded — same rule as plan-export.helpers.
 *
 * @param {unknown} entries
 * @returns {{ instruction: string, order: number }[]}
 */
const normalizeInstructionEntries = (entries) => {
    if (!Array.isArray(entries)) return [];
    return entries
        .map((entry, index) => {
            const raw =
                typeof entry?.instruction === 'string'
                    ? entry.instruction
                    : '';
            const instruction = raw.trim().replace(/\s+/g, ' ');
            if (!instruction) return null;
            const order =
                entry?.order != null && !Number.isNaN(Number(entry.order))
                    ? Number(entry.order)
                    : index + 1;
            return { instruction, order };
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order);
};

/**
 * @returns {string}
 */
export const readElevateNutritionHtmlEntryFile = () => {
    if (!existsSync(ELEVATE_NUTRITION_HTML_ENTRY)) {
        throw new Error(
            `Elevate Nutrition HTML design entry missing: ${ELEVATE_NUTRITION_HTML_ENTRY}`
        );
    }
    return readFileSync(ELEVATE_NUTRITION_HTML_ENTRY, 'utf8');
};

/**
 * First nutrition day that has meals (overview-day convention).
 * Never merges meals across days.
 *
 * @param {object} exportModel
 * @returns {object|null}
 */
const pickOverviewDay = (exportModel) => {
    const days = exportModel?.content?.nutritionDays ?? [];
    if (!Array.isArray(days) || days.length === 0) return null;

    const withMeals = days.find(
        (day) => Array.isArray(day?.meals) && day.meals.length > 0
    );
    return withMeals ?? days[0] ?? null;
};

/**
 * @param {object} day
 * @returns {object[]}
 */
const orderedMeals = (day) => {
    const meals = Array.isArray(day?.meals) ? [...day.meals] : [];
    return meals.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
};

/**
 * @param {object|null|undefined} macros
 * @returns {number|null}
 */
const mealCalories = (macros) =>
    pickMacro(macros, ['calories', 'avgDailyCalories']);

/**
 * Macro calorie contributions and safe percentages.
 *
 * @param {{ calories?: number|null, protein?: number|null, carbs?: number|null, fat?: number|null }} targets
 */
const deriveMacroBreakdown = (targets) => {
    const protein = targets.protein != null ? Number(targets.protein) : null;
    const carbs = targets.carbs != null ? Number(targets.carbs) : null;
    const fat = targets.fat != null ? Number(targets.fat) : null;
    const calories =
        targets.calories != null ? Number(targets.calories) : null;

    const proteinKcal =
        protein != null && !Number.isNaN(protein) ? protein * 4 : null;
    const carbsKcal = carbs != null && !Number.isNaN(carbs) ? carbs * 4 : null;
    const fatKcal = fat != null && !Number.isNaN(fat) ? fat * 9 : null;

    const parts = [proteinKcal, carbsKcal, fatKcal].filter(
        (v) => v != null && v > 0
    );
    const sumKcal = parts.reduce((acc, v) => acc + v, 0);

    const pct = (kcal) => {
        if (kcal == null || sumKcal <= 0) return null;
        return Math.round((kcal / sumKcal) * 100);
    };

    let proteinPct = pct(proteinKcal);
    let carbsPct = pct(carbsKcal);
    let fatPct = pct(fatKcal);

    // Keep displayed % summing to 100 when all three exist.
    if (proteinPct != null && carbsPct != null && fatPct != null) {
        const drift = 100 - (proteinPct + carbsPct + fatPct);
        fatPct += drift;
    }

    return {
        calories:
            calories != null && !Number.isNaN(calories) && calories > 0
                ? calories
                : sumKcal > 0
                  ? Math.round(sumKcal)
                  : null,
        protein,
        carbs,
        fat,
        proteinPct,
        carbsPct,
        fatPct,
        proteinKcal,
        carbsKcal,
        fatKcal,
        sumKcal,
    };
};

/**
 * SVG donut using Elevate colors. Empty when no macro kcal data.
 *
 * @param {ReturnType<typeof deriveMacroBreakdown>} macros
 */
const buildMacroRingSvg = (macros) => {
    const size = 168;
    const stroke = 14;
    const radius = (size - stroke) / 2;
    const cx = size / 2;
    const cy = size / 2;
    const circumference = 2 * Math.PI * radius;

    const segments = [
        {
            key: 'protein',
            kcal: macros.proteinKcal,
            color: MACRO_COLORS.protein,
        },
        { key: 'carbs', kcal: macros.carbsKcal, color: MACRO_COLORS.carbs },
        { key: 'fat', kcal: macros.fatKcal, color: MACRO_COLORS.fat },
    ].filter((s) => s.kcal != null && s.kcal > 0);

    const track = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#2A2E35" stroke-width="${stroke}"/>`;

    if (!segments.length || macros.sumKcal <= 0) {
        return `<svg class="macro-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${track}</svg>`;
    }

    let offset = 0;
    const arcs = segments
        .map((segment) => {
            const length = (segment.kcal / macros.sumKcal) * circumference;
            const circle = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${segment.color}" stroke-width="${stroke}" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" stroke-linecap="butt" transform="rotate(-90 ${cx} ${cy})"/>`;
            offset += length;
            return circle;
        })
        .join('');

    return `<svg class="macro-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${track}${arcs}</svg>`;
};

/**
 * Meal icon from Elevate-style stroke icons (mealType-aware).
 *
 * @param {string|null|undefined} mealType
 * @param {{ className?: string }} [opts]
 */
const mealIconSvg = (mealType, opts = {}) => {
    const type = String(mealType || '').toLowerCase();
    const classAttr = opts.className ? ` class="${opts.className}"` : '';
    const open = `<svg${classAttr} viewBox="0 0 24 24" aria-hidden="true">`;

    if (type.includes('breakfast') || type === 'pre_workout') {
        return `${open}
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
    }

    if (type.includes('lunch') || type === 'prepared') {
        return `${open}
      <path d="M4.5 11.2h15.2c0 4.6-3.4 8.3-7.6 8.3S4.5 15.8 4.5 11.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M7 11.2c.4-2.2 1.8-3.6 3.2-3.6 1.2 0 1.7.9 2.3.9s1.2-.9 2.3-.9c1.5 0 2.8 1.5 3.2 3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
    }

    if (type.includes('dinner') || type.includes('evening')) {
        return `${open}
      <path d="M16.8 5.2A7.2 7.2 0 1 0 18.6 15a5.6 5.6 0 0 1-1.8-9.8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>`;
    }

    // snack / default — apple
    return `${open}
    <path d="M12 7.2c.2-1.4 1.1-2.6 2.4-3.1-.1 1.5-.9 2.8-2.4 3.1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M12.1 7.4c-1.6 0-3 .6-3.9 1.7C6.8 10.6 6.4 12.4 7 14.4c.7 2.2 2.4 3.8 4.4 3.8h.1c1.2 0 2.1-.5 2.9-.5.8 0 1.6.5 2.8.5 1.7 0 3.3-1.3 4-3.2.3-.8.4-1.5.4-1.7-1.5-.1-2.7-.9-3.4-2.1-.7-1.1-.8-2.4-.3-3.5-1.1.1-2.1.6-2.9 1.4-.6.6-1.1.9-1.9.9Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
  </svg>`;
};

/**
 * @param {object} exportModel
 */
export const deriveElevateNutritionViewModel = (exportModel) => {
    const plan = exportModel?.plan ?? {};
    const titleFit = fitElevateTitleLayout(plan.name || 'Nutrition Plan');
    const overviewDay = pickOverviewDay(exportModel);
    const meals = orderedMeals(overviewDay);

    const goalLabel = formatLabel(plan.goal) || '—';
    const duration =
        plan.duration != null && !Number.isNaN(Number(plan.duration))
            ? Number(plan.duration)
            : null;
    const mealsPerDay = meals.length;
    const supplementEntries = normalizeInstructionEntries(plan.supplements);
    const vitaminEntries = normalizeInstructionEntries(plan.vitamins);
    const instructionEntries = [...supplementEntries, ...vitaminEntries];
    const supplementCount = supplementEntries.length;
    const vitaminCount = vitaminEntries.length;
    const statusLabel = formatLabel(plan.status) || '—';
    const statusActive = String(plan.status || '').toLowerCase() === 'active';

    const macroTargets = plan.macroTargets ?? {};
    const computed = plan.computedMacros ?? {};
    const calorieTarget =
        pickMacro(macroTargets, ['calories']) ??
        pickMacro(computed, ['avgDailyCalories', 'calories']) ??
        (plan.avgDailyCalories > 0 ? Number(plan.avgDailyCalories) : null);

    const macros = deriveMacroBreakdown({
        calories: calorieTarget,
        protein:
            pickMacro(macroTargets, ['protein']) ??
            pickMacro(computed, ['avgDailyProtein', 'protein']),
        carbs:
            pickMacro(macroTargets, ['carbs']) ??
            pickMacro(computed, ['avgDailyCarbs', 'carbs']),
        fat:
            pickMacro(macroTargets, ['fat']) ??
            pickMacro(computed, ['avgDailyFat', 'fat']),
    });

    const durationPart =
        duration != null ? `${duration}-week` : 'Custom-duration';
    const mealsPart =
        mealsPerDay > 0
            ? `${mealsPerDay} meal${mealsPerDay === 1 ? '' : 's'} a day`
            : 'No meals yet';
    const dek = `${durationPart} ${goalLabel.toLowerCase()} plan · ${mealsPart}`;

    const mealsView = meals.map((meal, index) => {
        const order =
            meal.order != null && !Number.isNaN(Number(meal.order))
                ? Number(meal.order)
                : index + 1;
        const name =
            meal.name ||
            formatLabel(meal.mealType) ||
            `Meal ${order}`;
        const totals = meal.mealTotals ?? null;
        const foodItems = Array.isArray(meal.foodItems) ? meal.foodItems : [];

        return {
            order,
            name,
            mealType: meal.mealType ?? null,
            calories: mealCalories(totals),
            totals: {
                calories: pickMacro(totals, ['calories']),
                protein: pickMacro(totals, ['protein']),
                carbs: pickMacro(totals, ['carbs']),
                fat: pickMacro(totals, ['fat']),
            },
            foodItems: foodItems.map((item) => ({
                name: item?.name || 'Food',
                quantity: item?.quantity ?? null,
                unit: item?.unit ?? null,
                calories: pickMacro(item?.itemMacros, ['calories']),
                protein: pickMacro(item?.itemMacros, ['protein']),
                carbs: pickMacro(item?.itemMacros, ['carbs']),
                fat: pickMacro(item?.itemMacros, ['fat']),
            })),
        };
    });

    const mealsPageDek =
        mealsPerDay > 0
            ? `${mealsPerDay} meal${mealsPerDay === 1 ? '' : 's'} a day. Amounts are per serving · P / C / F in grams.`
            : 'No meals in this plan yet. Amounts are per serving · P / C / F in grams.';

    const mealPages = packMealPages(mealsView);
    const notesPages = packNotesPages(instructionEntries);
    const totalPages = 1 + mealPages.length + notesPages.length;

    return {
        planName: titleFit.planName,
        titleHtml: titleFit.titleHtml,
        titleFontSize: titleFit.fontSize,
        dek,
        mealsPageDek,
        notesPageDek: NOTES_PAGE_DEK,
        goalLabel,
        duration,
        mealsPerDay,
        supplementCount,
        vitaminCount,
        instructionEntries,
        guidance: [...DEFAULT_PLAN_GUIDANCE],
        statusLabel,
        statusActive,
        macros,
        meals: mealsView,
        mealPages,
        notesPages,
        mealsStartPageNumber: 2,
        notesStartPageNumber: 2 + mealPages.length,
        totalPages,
    };
};

/**
 * @param {ReturnType<typeof deriveElevateNutritionViewModel>} view
 */
const renderDailyTargetHtml = (view) => {
    const { macros } = view;
    const calDisplay =
        macros.calories != null
            ? escapeHtml(formatNumberGrouped(macros.calories, 0) || '—')
            : '—';

    const row = (label, grams, pct, iconHtml, tone) => {
        const g =
            grams != null && !Number.isNaN(grams)
                ? `${escapeHtml(formatNumberGrouped(grams, 0) || String(grams))}g`
                : '—';
        const p = pct != null ? `${escapeHtml(String(pct))}%` : '—';
        return `<li class="macro-row macro-row--${tone}">
        <span class="macro-label">${iconHtml}<span class="macro-name">${escapeHtml(label)}</span></span>
        <span class="macro-values"><strong>${g}</strong><em>${p}</em></span>
      </li>`;
    };

    return `<div class="daily-target-card">
      <div class="daily-target-chart">
        ${buildMacroRingSvg(macros)}
        <div class="daily-target-kcal">
          <strong>${calDisplay}</strong>
          <span>KCAL / DAY</span>
        </div>
      </div>
      <div class="daily-target-copy">
        <header>
          <h2>Daily target</h2>
          <p>Hit these totals across the day.</p>
        </header>
        <ul class="macro-rows">
          ${row('Protein', macros.protein, macros.proteinPct, MACRO_ICON_PROTEIN, 'protein')}
          ${row('Carbs', macros.carbs, macros.carbsPct, MACRO_ICON_CARBS, 'carbs')}
          ${row('Fat', macros.fat, macros.fatPct, MACRO_ICON_FAT, 'fat')}
        </ul>
      </div>
    </div>`;
};

/**
 * @param {ReturnType<typeof deriveElevateNutritionViewModel>} view
 */
const renderGlanceHtml = (view) => {
    const meals = view.meals ?? [];

    const head = `<header class="example-week-head">
      <div class="example-week-title">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.25" y="4.75" width="17.5" height="16" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <path d="M3.25 9.4h17.5M8 3.1v3.4M16 3.1v3.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <h2>Your day at a glance</h2>
      </div>
    </header>`;

    if (meals.length === 0) {
        return `${head}<p class="example-week-empty">No meals in this plan yet.</p>`;
    }

    const cols = meals
        .map((meal) => {
            const cal =
                meal.calories != null
                    ? `${escapeHtml(formatNumberGrouped(meal.calories, 0) || String(meal.calories))} kcal`
                    : '—';
            return `<article class="week-day is-active">
        ${mealIconSvg(meal.mealType, { className: 'week-day-icon' })}
        <strong>${escapeHtml(meal.name)}</strong>
        <span>${cal}</span>
      </article>`;
        })
        .join('\n      ');

    return `${head}<div class="example-week-grid">
      ${cols}
    </div>`;
};

/**
 * @param {{
 *   meal: ReturnType<typeof deriveElevateNutritionViewModel>['meals'][number],
 *   foodItems: object[],
 *   continued: boolean,
 *   showTotal: boolean,
 * }} block
 */
const renderMealCardHtml = (block) => {
    const { meal, foodItems, continued, showTotal } = block;
    const kcalMeta =
        meal.totals.calories != null
            ? `${escapeHtml(formatMacroCell(meal.totals.calories))} kcal`
            : '—';

    const titleBase = `Meal ${meal.order} — ${meal.name}`;
    const title = continued ? `${titleBase} (continued)` : titleBase;

    const foodRows = foodItems.length
        ? foodItems
              .map(
                  (item) => `<tr class="details-row">
              <td class="meal-food">${escapeHtml(item.name)}</td>
              <td class="meal-qty">${escapeHtml(formatQtyCell(item.quantity, item.unit))}</td>
              <td class="meal-kcal">${escapeHtml(formatMacroCell(item.calories))}</td>
              <td class="meal-p">${escapeHtml(formatMacroCell(item.protein))}</td>
              <td class="meal-c">${escapeHtml(formatMacroCell(item.carbs))}</td>
              <td class="meal-f">${escapeHtml(formatMacroCell(item.fat))}</td>
            </tr>`
              )
              .join('\n            ')
        : `<tr class="details-row meal-empty-row">
              <td class="meal-food" colspan="6">No foods in this meal yet.</td>
            </tr>`;

    const totalRow = showTotal
        ? `<tr class="details-row meal-total-row">
              <td class="meal-food">Meal total</td>
              <td class="meal-qty"></td>
              <td class="meal-kcal">${escapeHtml(formatMacroCell(meal.totals.calories))}</td>
              <td class="meal-p">${escapeHtml(formatMacroCell(meal.totals.protein, { suffix: 'g' }))}</td>
              <td class="meal-c">${escapeHtml(formatMacroCell(meal.totals.carbs, { suffix: 'g' }))}</td>
              <td class="meal-f">${escapeHtml(formatMacroCell(meal.totals.fat, { suffix: 'g' }))}</td>
            </tr>`
        : '';

    return `<article class="details-card details-card--lime">
      <header class="details-card-head">
        <div class="details-pill">
          ${mealIconSvg(meal.mealType)}
          <span>${escapeHtml(title)}</span>
        </div>
        <p class="details-card-meta">${kcalMeta}</p>
      </header>
      <div class="details-card-body">
        <table class="details-table meal-table">
          <thead>
            <tr>
              <th scope="col">Food</th>
              <th scope="col">Qty</th>
              <th scope="col">Kcal</th>
              <th scope="col">P</th>
              <th scope="col">C</th>
              <th scope="col">F</th>
            </tr>
          </thead>
          <tbody>
            ${foodRows}
            ${totalRow}
          </tbody>
        </table>
      </div>
    </article>`;
};

/**
 * @param {{ blocks: object[] }} page
 * @param {number} pageNumber
 * @param {number} totalPages
 * @param {boolean} isFirstMealsPage
 * @param {string} mealsPageDek
 */
const renderMealPageHtml = (
    page,
    pageNumber,
    totalPages,
    isFirstMealsPage,
    mealsPageDek
) => {
    const cards = page.blocks.length
        ? page.blocks.map((block) => renderMealCardHtml(block)).join('\n      ')
        : `<article class="details-card details-card-empty">
      <p class="details-empty">No meals in this plan yet.</p>
    </article>`;

    const pageClass = isFirstMealsPage
        ? 'page page-nutrition-meals'
        : 'page page-nutrition-meals page-nutrition-meals--compact';

    // Section title + dek only on the first meals page (single-line heading).
    const introHtml = isFirstMealsPage
        ? `<h1 class="details-title">DAILY <span>MEAL PLAN</span></h1>
    <p class="details-dek">${escapeHtml(mealsPageDek)}</p>
`
        : '';

    return `<section class="${pageClass}" aria-label="Daily meal plan" data-elevate="nutrition-meals">
    <img class="details-corner details-corner-dark" src="images/top-corner-2.png" alt="">
    <img class="details-corner details-corner-lime" src="images/top-corner-1.png" alt="">
    <img class="details-slash" src="images/Frame-Cornars.png" alt="">

    <p class="logo details-logo">
      <span class="logo-f">F</span><span class="logo-word">itlyPro</span>
    </p>

    ${introHtml}
    <div class="details-stack" data-elevate="nutrition-meals-stack">
      ${cards}
    </div>

    <footer class="details-footer">
      <span>FitlyPro | Nutrition Plan</span>
      <span>${padPageNumber(pageNumber)} / ${padPageNumber(totalPages)}</span>
    </footer>
  </section>`;
};

/** Daily target icons — same stroke style as Workout `.stat` icons. */
const STAT_ICON_KCAL = `<svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.2c.4 2.5-1.3 3.6-1.3 6.1 0 1.5.8 2.5 1.3 3 .5-.5 1.3-1.5 1.3-3 0-1.2-.4-2.2-.4-2.2.9 1.1 2.6 2.5 2.6 5.2A5.5 5.5 0 1 1 8.2 12c.6-1.7 2.2-2.6 2.2-4.6.6 1.1 1.6 1.6 1.6 1.6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        </svg>`;

const STAT_ICON_PROTEIN = `<svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.6c2.6 3.1 4.4 5.5 4.4 8.1a4.4 4.4 0 1 1-8.8 0c0-2.6 1.8-5 4.4-8.1Z" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linejoin="round"/>
        </svg>`;

const STAT_ICON_CARBS = `<svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.2 17.6c-2.1-2.1-2.3-5.2-.4-7.4L14.6 4.8c1.8-2 5-2.1 6.9-.3 1.9 1.8 2 4.9.3 6.8l-6.6 7.2c-1.9 2.1-5 2.1-7-.1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
          <circle cx="11.2" cy="10.2" r="1.2" fill="currentColor"/>
          <circle cx="13.5" cy="12.3" r="1.2" fill="currentColor"/>
          <circle cx="15.7" cy="14.4" r="1.2" fill="currentColor"/>
        </svg>`;

const STAT_ICON_FAT = `<svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.5c2.7 3.2 4.5 5.7 4.5 8.3A4.5 4.5 0 1 1 7.5 11.8C7.5 9.2 9.3 6.7 12 3.5Z" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linejoin="round"/>
        </svg>`;

/**
 * Workout Elevate `.stats` / `.stat` / `.stat-hot` with daily macro targets.
 *
 * @param {ReturnType<typeof deriveElevateNutritionViewModel>} view
 */
const renderNutritionStatsHtml = (view) => {
    const macros = view.macros ?? {};
    const kcal =
        macros.calories != null
            ? escapeHtml(formatNumberGrouped(macros.calories, 0) || '—')
            : '—';
    const grams = (value) =>
        value != null
            ? `${escapeHtml(formatNumberGrouped(value, 0) || String(value))}g`
            : '—';

    return `<section class="stats" aria-label="Daily nutrition targets" data-elevate="nutrition-stats">
      <article class="stat stat-hot">
        ${STAT_ICON_KCAL}
        <div>
          <strong>${kcal}</strong>
          <span>kcal / day</span>
        </div>
      </article>
      <article class="stat">
        ${STAT_ICON_PROTEIN}
        <div>
          <strong>${grams(macros.protein)}</strong>
          <span>protein</span>
        </div>
      </article>
      <article class="stat">
        ${STAT_ICON_CARBS}
        <div>
          <strong>${grams(macros.carbs)}</strong>
          <span>carbs</span>
        </div>
      </article>
      <article class="stat">
        ${STAT_ICON_FAT}
        <div>
          <strong>${grams(macros.fat)}</strong>
          <span>fat</span>
        </div>
      </article>
    </section>`;
};

/**
 * @param {object[]} entries
 * @param {{ continued?: boolean, startIndex?: number, totalCount?: number }} [opts]
 */
const renderSupplementsCardHtml = (entries, opts = {}) => {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length && !opts.continued) {
        return `<article class="details-card details-card-empty">
      <p class="details-empty">No supplements or vitamins in this plan yet.</p>
    </article>`;
    }
    if (!list.length) {
        return '';
    }

    const totalCount = opts.totalCount ?? list.length;
    const startIndex = opts.startIndex ?? 0;
    const title = opts.continued
        ? 'Supplements & vitamins (continued)'
        : 'Supplements & vitamins';
    const countLabel = `${totalCount} item${totalCount === 1 ? '' : 's'}`;
    const rows = list
        .map(
            (entry, index) => `<li class="notes-item">
          <span class="notes-num">${escapeHtml(String(startIndex + index + 1))}</span>
          <p>${escapeHtml(entry.instruction)}</p>
        </li>`
        )
        .join('\n        ');

    return `<article class="details-card details-card--orange">
      <header class="details-card-head">
        <div class="details-pill">
          ${CAPSULE_ICON}
          <span>${title}</span>
        </div>
        <p class="details-card-meta">${escapeHtml(countLabel)}</p>
      </header>
      <p class="notes-lede">${escapeHtml(NOTES_CARD_LEDE)}</p>
      <ol class="notes-list" start="${startIndex + 1}">
        ${rows}
      </ol>
    </article>`;
};

/**
 * @param {ReturnType<typeof deriveElevateNutritionViewModel>} view
 */
const renderHowToHtml = (view) => {
    const items = (view.guidance ?? DEFAULT_PLAN_GUIDANCE)
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join('\n          ');

    return `<section class="notes-howto" aria-label="How to use this plan">
        <header class="notes-howto-head">
          ${NOTES_HOWTO_ICON}
          <h2>How to use this plan</h2>
        </header>
        <ul class="notes-howto-list">
          ${items}
        </ul>
      </section>`;
};

/**
 * @param {{ entries: object[], continued: boolean, includeBottom: boolean }} page
 * @param {ReturnType<typeof deriveElevateNutritionViewModel>} view
 * @param {number} pageNumber
 * @param {number} totalPages
 * @param {number} entryOffset
 */
const renderNotesPageHtml = (
    page,
    view,
    pageNumber,
    totalPages,
    entryOffset,
    { showIntro = false } = {}
) => {
    const cardHtml = renderSupplementsCardHtml(page.entries, {
        continued: page.continued,
        startIndex: entryOffset,
        totalCount: view.instructionEntries?.length ?? 0,
    });
    const stackContent =
        cardHtml ||
        (page.includeBottom
            ? ''
            : `<article class="details-card details-card-empty">
      <p class="details-empty">No supplements or vitamins in this plan yet.</p>
    </article>`);

    const bottomHtml = page.includeBottom
        ? `
    ${renderNutritionStatsHtml(view)}

    <div class="notes-bottom">
      <img class="notes-photo" src="images/nutartion-page3.png" alt="">
      ${renderHowToHtml(view)}
    </div>`
        : '';

    const pageClass = showIntro
        ? 'page page-nutrition-notes'
        : 'page page-nutrition-notes page-nutrition-notes--compact';

    // Section title + dek only on the first notes page (single-line heading).
    const introHtml = showIntro
        ? `<h1 class="details-title">SUPPLEMENTS <span>&amp; NOTES</span></h1>
    <p class="details-dek">${escapeHtml(NOTES_PAGE_DEK)}</p>
`
        : '';

    return `<section class="${pageClass}" aria-label="Supplements and notes" data-elevate="nutrition-notes">
    <img class="details-corner details-corner-dark" src="images/top-corner-2.png" alt="">
    <img class="details-corner details-corner-lime" src="images/top-corner-1.png" alt="">
    <img class="details-slash" src="images/Frame-Cornars.png" alt="">

    <p class="logo details-logo">
      <span class="logo-f">F</span><span class="logo-word">itlyPro</span>
    </p>

    ${introHtml}
    <div class="details-stack" data-elevate="nutrition-notes-stack">
      ${stackContent}
    </div>
    ${bottomHtml}

    <footer class="details-footer">
      <span>FitlyPro | Nutrition Plan</span>
      <span>${padPageNumber(pageNumber)} / ${padPageNumber(totalPages)}</span>
    </footer>
  </section>`;
};

/**
 * @param {string} html
 * @param {ReturnType<typeof deriveElevateNutritionViewModel>} view
 */
const applyNutritionDynamicContent = (html, view) => {
    let next = html;

    next = next.replace(
        /<title>[\s\S]*?<\/title>/i,
        `<title>${escapeHtml(view.planName)}</title>`
    );

    const layoutStyle = [
        `--title-size:${Number(view.titleFontSize) || TITLE_LAYOUT.maxSizePx}px`,
        `--title-line-height:${TITLE_LAYOUT.lineHeight}`,
        `--title-width:${TITLE_LAYOUT.maxWidthPx}px`,
    ].join(';');

    next = next.replace(
        /<main class="page page-nutrition-cover"([^>]*)>/i,
        `<main class="page page-nutrition-cover"$1 style="${layoutStyle}">`
    );

    next = next.replace(
        /<h1 class="title">[\s\S]*?<\/h1>/i,
        `<h1 class="title">\n      ${view.titleHtml}\n    </h1>`
    );

    next = next.replace(
        /<p class="dek">[\s\S]*?<\/p>/i,
        `<p class="dek">${escapeHtml(view.dek)}</p>`
    );

    const statusHtml = view.statusActive
        ? `<strong class="status-active"><span class="status-dot" aria-hidden="true"></span>${escapeHtml(view.statusLabel)}</strong>`
        : `<strong>${escapeHtml(view.statusLabel)}</strong>`;

    next = next.replace(
        /<ul class="overview-rows">[\s\S]*?<\/ul>/i,
        `<ul class="overview-rows">
          <li><span>Goal</span><strong>${escapeHtml(view.goalLabel)}</strong></li>
          <li><span>Duration</span><strong>${
              view.duration != null
                  ? `${escapeHtml(String(view.duration))} weeks`
                  : '—'
          }</strong></li>
          <li><span>Meals per day</span><strong>${escapeHtml(
              String(view.mealsPerDay)
          )}</strong></li>
          <li><span>Supplements</span><strong>${escapeHtml(
              String(view.supplementCount)
          )}</strong></li>
          <li><span>Status</span>${statusHtml}</li>
        </ul>`
    );

    next = next.replace(
        /<section class="nutrition-daily"[\s\S]*?<\/section>/i,
        `<section class="nutrition-daily" aria-label="Daily target" data-elevate="nutrition-daily">
      ${renderDailyTargetHtml(view)}
    </section>`
    );

    const glanceCols = Math.max(view.meals?.length || 0, 1);
    next = next.replace(
        /<section\b[^>]*\bdata-elevate="nutrition-glance"[^>]*>[\s\S]*?<\/section>/i,
        `<section class="example-week" aria-label="Your day at a glance" data-elevate="nutrition-glance" style="--example-week-cols:${glanceCols}">
      ${renderGlanceHtml(view)}
    </section>`
    );

    const mealPages = view.mealPages?.length
        ? view.mealPages
        : [{ blocks: [] }];
    const mealPagesHtml = mealPages
        .map((page, index) =>
            renderMealPageHtml(
                page,
                (view.mealsStartPageNumber || 2) + index,
                view.totalPages,
                index === 0,
                view.mealsPageDek
            )
        )
        .join('\n\n  ');

    // Match through the page footer — nested <section> tags (stats/howto) must not truncate.
    next = next.replace(
        /<section\b[^>]*\bpage-nutrition-meals\b[^>]*>[\s\S]*?<footer class="details-footer">[\s\S]*?<\/footer>\s*<\/section>/i,
        mealPagesHtml
    );

    const notesPages = view.notesPages?.length
        ? view.notesPages
        : [{ entries: [], continued: false, includeBottom: true }];
    let entryOffset = 0;
    const notesPagesHtml = notesPages
        .map((page, index) => {
            const html = renderNotesPageHtml(
                page,
                view,
                (view.notesStartPageNumber || 2 + mealPages.length) + index,
                view.totalPages,
                entryOffset,
                { showIntro: index === 0 }
            );
            entryOffset += page.entries?.length || 0;
            return html;
        })
        .join('\n\n  ');

    next = next.replace(
        /<section\b[^>]*\bpage-nutrition-notes\b[^>]*>[\s\S]*?<footer class="details-footer">[\s\S]*?<\/footer>\s*<\/section>/i,
        notesPagesHtml
    );

    return next;
};

/**
 * Safe structural metrics for PDF export tracing (no PII / food names).
 *
 * @param {object} exportModel
 */
export const getNutritionExportSafeMetrics = (exportModel) => {
    const days = Array.isArray(exportModel?.content?.nutritionDays)
        ? exportModel.content.nutritionDays
        : [];
    let mealCount = 0;
    let foodItemCount = 0;
    for (const day of days) {
        const meals = Array.isArray(day?.meals) ? day.meals : [];
        mealCount += meals.length;
        for (const meal of meals) {
            foodItemCount += Array.isArray(meal?.foodItems)
                ? meal.foodItems.length
                : 0;
        }
    }

    let mealPages = 0;
    let notesPages = 0;
    let totalPages = 0;
    try {
        const view = deriveElevateNutritionViewModel(exportModel);
        mealPages = view.mealPages?.length || 0;
        notesPages = view.notesPages?.length || 0;
        totalPages = view.totalPages || 0;
    } catch {
        // Metrics are best-effort; HTML build will surface real errors.
    }

    return {
        dayCount: days.length,
        mealCount,
        foodItemCount,
        mealPages,
        notesPages,
        totalPages,
        // Nutrition PDF uses local decorative assets only (no remote food thumbs).
        remoteFoodImages: 0,
    };
};

/**
 * Production + Studio builder: Nutrition cover + packed meal/notes pages.
 *
 * @param {object} exportModel
 * @param {{ inlineAssets?: boolean }} [options]
 *   Production PDF path should pass `inlineAssets: false` so decorative images
 *   are served once via the shared renderer instead of duplicated data URIs.
 * @returns {string}
 */
export const buildElevateNutritionHtml = (exportModel, options = {}) => {
    const inlineAssets = options.inlineAssets !== false;
    const view = deriveElevateNutritionViewModel(exportModel);
    const withData = applyNutritionDynamicContent(
        readElevateNutritionHtmlEntryFile(),
        view
    );

    let html = inlineAssets ? inlineLocalAssets(withData) : withData;

    if (!html.includes(ELEVATE_NUTRITION_HTML_SOURCE_MARKER)) {
        html = html.replace(
            /<head([^>]*)>/i,
            `<head$1>\n  <!-- ${ELEVATE_NUTRITION_HTML_SOURCE_MARKER} -->`
        );
    }

    if (
        !html.includes('class="page page-nutrition-cover"') ||
        !html.includes('Plan overview') ||
        !html.includes('Daily target') ||
        !html.includes('Your day at a glance') ||
        !html.includes('class="slash"') ||
        !html.includes('page-nutrition-meals') ||
        !html.includes('DAILY') ||
        !html.includes('MEAL PLAN') ||
        !html.includes('page-nutrition-notes') ||
        !html.includes('SUPPLEMENTS') ||
        !html.includes('How to use this plan') ||
        !html.includes('notes-photo') ||
        !html.includes('data-elevate="nutrition-stats"') ||
        !html.includes('details-footer')
    ) {
        throw new Error(
            'Elevate Nutrition HTML builder lost required design markup'
        );
    }

    // CSS may mention .page-cover / .page-workouts; guard against Workout page markup only.
    if (
        /<main\b[^>]*\bpage-cover\b/i.test(html) ||
        /<(?:main|section)\b[^>]*\bpage-workouts\b/i.test(html) ||
        /<(?:main|section)\b[^>]*\bpage-workout-details\b/i.test(html)
    ) {
        throw new Error(
            'Elevate Nutrition builder incorrectly included Workout pages'
        );
    }

    return html;
};

export {
    packMealPages,
    packNotesPages,
};

export default {
    buildElevateNutritionHtml,
    deriveElevateNutritionViewModel,
    getNutritionExportSafeMetrics,
    readElevateNutritionHtmlEntryFile,
    packMealPages,
    packNotesPages,
    ELEVATE_NUTRITION_HTML_ENTRY,
    ELEVATE_NUTRITION_HTML_ENTRY_NAME,
    ELEVATE_NUTRITION_HTML_SOURCE_MARKER,
};
