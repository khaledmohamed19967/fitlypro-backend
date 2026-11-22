/**
 * Elevate — production + Studio HTML builder.
 *
 * Source of truth:
 *   templates/elevate/html/index.html
 *   templates/elevate/html/styles.css
 *   templates/elevate/html/images/*
 *   templates/elevate/html/fonts/*
 *
 * Loads the author's HTML/CSS/assets and injects workout export-model values.
 * Does not use the legacy cover.css design.
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join, normalize, sep } from 'path';
import { fileURLToPath } from 'url';
import { escapeHtml, formatLabel } from '../../pdf/htmlEscape.js';
import { EXERCISE_IMAGE_FALLBACK } from '../../pdf/exerciseImageFallback.js';
import { buildPublicExerciseUrl } from '../../pdf/publicExerciseUrl.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ELEVATE_HTML_DIR = join(__dirname, 'html');
export const ELEVATE_HTML_ENTRY = join(ELEVATE_HTML_DIR, 'index.html');
export const ELEVATE_HTML_ENTRY_NAME = 'index.html';
export const ELEVATE_HTML_CSS_NAME = 'styles.css';

export const ELEVATE_HTML_SOURCE_MARKER =
    'elevate-html-source:templates/elevate/html/index.html';

const DAY_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Page 03 uses exactly two deterministic variants (A=lime, B=orange, …).
 * Lime = FitlyPro primary. Orange header uses the approved gradient; outline is solid.
 */
const WORKOUT_THEME_COLORS = Object.freeze([
    {
        id: 'lime',
        accent: '#ccff01',
        outline: '#ccff01',
        pillBackground: '#ccff01',
        textOnAccent: '#0b0d0f',
    },
    {
        id: 'orange',
        accent: '#e8781a',
        outline: '#e8781a',
        pillBackground: 'linear-gradient(90deg, #F7A33A 0%, #E8781A 100%)',
        textOnAccent: '#0b0d0f',
    },
]);

/** Vertical budget for packing Page 03 tables onto A4 (794×1123). */
const DETAIL_LAYOUT = Object.freeze({
    pageBudget: 920,
    pageChrome: 96,
    cardChrome: 78,
    rowHeight: 52,
    cardGap: 14,
});

const MIME_BY_EXT = Object.freeze({
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
});

/**
 * @param {string} relativePath
 */
const resolveSafeAssetPath = (relativePath) => {
    const cleaned = String(relativePath || '')
        .trim()
        .replace(/^[.][/\\]/, '')
        .replace(/\\/g, '/');
    if (
        !cleaned ||
        cleaned.includes('..') ||
        cleaned.startsWith('/') ||
        /^[a-zA-Z]:/.test(cleaned)
    ) {
        throw new Error(
            `Unsafe asset path in Elevate HTML design: ${relativePath}`
        );
    }

    const absolute = normalize(join(ELEVATE_HTML_DIR, cleaned));
    const root = normalize(ELEVATE_HTML_DIR + sep);
    if (absolute !== ELEVATE_HTML_DIR && !absolute.startsWith(root)) {
        throw new Error(`Asset escapes HTML design root: ${relativePath}`);
    }
    return absolute;
};

/**
 * @param {string} relativePath
 */
const readAssetBuffer = (relativePath) => {
    const absolute = resolveSafeAssetPath(relativePath);
    if (!existsSync(absolute)) {
        throw new Error(`Missing Elevate HTML design asset: ${relativePath}`);
    }
    return readFileSync(absolute);
};

/**
 * @param {string} relativePath
 */
const toDataUri = (relativePath) => {
    const absolute = resolveSafeAssetPath(relativePath);
    const ext = absolute.slice(absolute.lastIndexOf('.')).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) {
        throw new Error(`Unsupported Elevate HTML asset type: ${relativePath}`);
    }
    const buffer = readAssetBuffer(relativePath);
    return `data:${mime};base64,${buffer.toString('base64')}`;
};

/**
 * @param {string} css
 */
const inlineCssUrls = (css) =>
    css.replace(
        /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
        (match, _quote, rawUrl) => {
            const url = String(rawUrl || '').trim();
            if (
                !url ||
                url.startsWith('data:') ||
                /^https?:/i.test(url) ||
                url.startsWith('#')
            ) {
                return match;
            }
            return `url("${toDataUri(url)}")`;
        }
    );

/** Left-column title box used by the Elevate cover layout. */
const TITLE_LAYOUT = Object.freeze({
    // Calibrated so "FOUNDATIONS" still fits at 55px (measured ~393px).
    maxWidthPx: 400,
    maxSizePx: 55,
    minSizePx: 24,
    lineHeight: 0.98,
    maxLines: 3,
});

/**
 * Approximate rendered width for Inter 800 uppercase (matches cover CSS).
 * Coefficients calibrated against Playwright measurements of the bundled font.
 * @param {string} text
 * @param {number} fontSize
 */
const estimateUppercaseWidth = (text, fontSize) => {
    let width = 0;
    for (const raw of String(text || '').toUpperCase()) {
        if (raw === ' ') {
            width += fontSize * 0.25;
            continue;
        }
        if (raw === '—' || raw === '–' || raw === '-' || raw === '−') {
            width += fontSize * 0.58;
            continue;
        }
        if ("IL1|!.:,;'\"“.…".includes(raw)) {
            width += fontSize * 0.34;
            continue;
        }
        if ('MW@%'.includes(raw)) {
            width += fontSize * 0.82;
            continue;
        }
        width += fontSize * 0.65;
    }
    // Small safety margin so fitted sizes don't brush the column edge.
    return width * 1.03;
};

/**
 * Greedy word wrap using the uppercase width estimate.
 * @param {string[]} words
 * @param {number} fontSize
 * @param {number} maxWidth
 * @returns {string[]|null}
 */
const wrapWordsToLines = (words, fontSize, maxWidth) => {
    const lines = [];
    let current = '';

    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (estimateUppercaseWidth(candidate, fontSize) <= maxWidth) {
            current = candidate;
            continue;
        }
        if (!current) {
            // Single token wider than the column — still accept one overflow line;
            // CSS overflow-wrap handles extreme glyphs.
            lines.push(word);
            current = '';
            continue;
        }
        lines.push(current);
        current = word;
    }
    if (current) lines.push(current);
    return lines;
};

/**
 * Build accented title HTML for a chosen line break strategy.
 * @param {string[]} words
 * @param {'split-last' | 'flow'} mode
 */
const formatTitleHtml = (words, mode) => {
    if (!words.length) {
        return '<span>Workout Plan</span>';
    }
    if (words.length === 1) {
        return `<span>${escapeHtml(words[0])}</span>`;
    }

    const last = escapeHtml(words[words.length - 1]);
    const headWords = words.slice(0, -1).map((word) => escapeHtml(word));

    if (mode === 'split-last') {
        return `${headWords.join(' ')}<br>\n      <span>${last}</span>`;
    }

    return `${headWords.join(' ')} <span>${last}</span>`;
};

/**
 * Choose font size + break mode so the title fits the left column.
 * Prefer the design's last-word accent line when it still fits cleanly.
 *
 * @param {unknown} name
 * @returns {{
 *   planName: string,
 *   titleHtml: string,
 *   fontSize: number,
 *   lineCount: number,
 *   overviewTop: number,
 *   mode: 'split-last' | 'flow'
 * }}
 */
export const fitElevateTitleLayout = (name) => {
    const planName = String(name ?? '').trim() || 'Workout Plan';
    const words = planName.split(/\s+/).filter(Boolean);
    const { maxWidthPx, maxSizePx, minSizePx, maxLines } = TITLE_LAYOUT;

    let chosen = null;

    const linesFitWidth = (lines, fontSize) =>
        lines.every(
            (line) => estimateUppercaseWidth(line, fontSize) <= maxWidthPx
        );

    for (let fontSize = maxSizePx; fontSize >= minSizePx; fontSize -= 1) {
        // Keep large type to ≤2 lines; allow a 3rd line only after scaling down.
        const lineBudget = fontSize >= 38 ? 2 : maxLines;

        // Preferred Elevate look: one head line + accented last word on the next.
        // Skip when the head already wraps or the last token is a tiny remnant
        // (e.g. "… Copy 5") — that creates a giant lone lime numeral.
        if (words.length >= 2) {
            const headWords = words.slice(0, -1);
            const lastWord = words[words.length - 1];
            const headLines = wrapWordsToLines(headWords, fontSize, maxWidthPx);
            const lastFits =
                estimateUppercaseWidth(lastWord, fontSize) <= maxWidthPx;
            const substantialLast =
                lastWord.length >= 4 || headWords.length <= 3;
            if (
                lastFits &&
                substantialLast &&
                headLines.length === 1 &&
                linesFitWidth(headLines, fontSize) &&
                lineBudget >= 2
            ) {
                chosen = {
                    fontSize,
                    mode: 'split-last',
                    lineCount: 2,
                    titleHtml: formatTitleHtml(words, 'split-last'),
                };
                break;
            }
        }

        // Fallback: natural wrap with last-word accent kept inline.
        const flowLines = wrapWordsToLines(words, fontSize, maxWidthPx);
        const fits =
            flowLines.length <= lineBudget &&
            linesFitWidth(flowLines, fontSize);
        const lastResort =
            fontSize === minSizePx && flowLines.length <= maxLines;
        if (fits || lastResort) {
            chosen = {
                fontSize,
                mode: 'flow',
                lineCount: Math.max(flowLines.length, 1),
                titleHtml: formatTitleHtml(words, 'flow'),
            };
            break;
        }
    }

    if (!chosen) {
        chosen = {
            fontSize: minSizePx,
            mode: 'flow',
            lineCount: 1,
            titleHtml: formatTitleHtml(words, 'flow'),
        };
    }

    return {
        planName,
        titleHtml: chosen.titleHtml,
        fontSize: chosen.fontSize,
        lineCount: chosen.lineCount,
        mode: chosen.mode,
    };
};

/**
 * Highlight the last word for the design's `.title span` accent.
 * Uses the fitted layout (may omit the forced line break for long names).
 * @param {unknown} name
 * @returns {string} safe HTML fragment for inside `<h1 class="title">`
 */
export const buildHighlightedTitleHtml = (name) =>
    fitElevateTitleLayout(name).titleHtml;

/**
 * @param {object[]} workoutDays
 */
const buildWorkoutLabels = (workoutDays = []) => {
    if (!workoutDays.length) return '';
    return workoutDays
        .map((_, index) => DAY_LETTERS[index] || String(index + 1))
        .join(', ');
};

/**
 * @param {object[]} workoutDays
 */
const countTotalSets = (workoutDays = []) =>
    workoutDays.reduce((daySum, day) => {
        const exercises = Array.isArray(day?.exercises) ? day.exercises : [];
        return (
            daySum +
            exercises.reduce((exSum, exercise) => {
                const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];
                return exSum + sets.length;
            }, 0)
        );
    }, 0);

/**
 * @param {object} exercise
 */
const countExerciseSets = (exercise) =>
    Array.isArray(exercise?.sets) ? exercise.sets.length : 0;

/**
 * Unique primary muscles for a workout day (export model only).
 * @param {object} day
 * @returns {string[]}
 */
const collectPrimaryMuscles = (day) => {
    const exercises = Array.isArray(day?.exercises) ? day.exercises : [];
    const seen = new Set();
    const labels = [];
    for (const exercise of exercises) {
        const primary = formatLabel(exercise?.muscles?.primary);
        if (!primary) continue;
        const key = primary.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        labels.push(primary);
        if (labels.length >= 3) break;
    }
    return labels;
};

/**
 * Page-02 workout summary rows from real workoutDays only.
 * @param {object[]} workoutDays
 */
const buildWorkoutSummaries = (workoutDays = []) =>
    workoutDays.map((day, index) => {
        const exercises = Array.isArray(day?.exercises) ? day.exercises : [];
        const exerciseCount = exercises.length;
        const setCount = exercises.reduce(
            (sum, exercise) => sum + countExerciseSets(exercise),
            0
        );
        const letter = DAY_LETTERS[index] || String(index + 1);
        const name =
            String(day?.name ?? '').trim() ||
            (day?.dayNumber != null ? `Day ${day.dayNumber}` : `Workout ${letter}`);
        return {
            letter,
            name,
            exerciseCount,
            setCount,
            meta: `${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'} · ${setCount} set${setCount === 1 ? '' : 's'}`,
            muscles: collectPrimaryMuscles(day),
        };
    });

/**
 * Illustrative Mon–Sun grid only (export model has no weekday fields).
 * Labeled "Example only" in the design — not a claimed schedule.
 * @param {{ letter: string }[]} summaries
 */
const buildExampleWeekDays = (summaries = []) => {
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const activeSlots = [0, 2, 4];
    return labels.map((label, index) => {
        const workoutIndex = activeSlots.indexOf(index);
        const summary =
            workoutIndex >= 0 && workoutIndex < summaries.length
                ? summaries[workoutIndex]
                : null;
        if (summary) {
            return {
                label,
                active: true,
                detail: `Workout ${summary.letter}`,
            };
        }
        return { label, active: false, detail: 'Rest' };
    });
};

/**
 * @param {object[]} summaries
 * @param {number|null} duration
 */
const buildWorkoutsPageDek = (summaries, duration) => {
    const count = summaries.length;
    if (!count) {
        return duration != null
            ? `Your workout plan across ${duration} weeks.`
            : 'Your workout plan.';
    }
    const labels = summaries.map((row) => row.letter).join(', ');
    const head = `${count} workout${count === 1 ? '' : 's'} (${labels}). Train them in any order`;
    if (duration != null) {
        return `${head}, as many rounds as the ${duration} weeks allow.`;
    }
    return `${head}.`;
};

/**
 * @param {object[]} summaries
 * @param {unknown} planNotes
 */
const buildProgramNotes = (summaries, planNotes) => {
    const labels = summaries.map((row) => row.letter).filter(Boolean);
    const orderCopy = labels.length
        ? `Train ${labels.join(', ').replace(/, ([^,]*)$/, ' and $1')} in any order.`
        : 'Train your workouts in any order.';
    const notes = [
        { text: orderCopy, coach: false },
        { text: 'Log every set in the app.', coach: false },
    ];
    const coach = String(planNotes ?? '').trim();
    if (coach) {
        notes.push({ text: `Coach note: ${coach}`, coach: true });
    }
    return notes;
};

/**
 * @param {unknown} url
 * @returns {string|null}
 */
const sanitizeExerciseImageUrl = (url) => {
    const raw = String(url ?? '').trim();
    if (!raw) return null;
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
};

/**
 * Summarize prescribed sets/reps from export-model set rows (no fabrication).
 * @param {object[]} sets
 */
const summarizeExerciseSets = (sets = []) => {
    const list = Array.isArray(sets) ? sets : [];
    if (!list.length) {
        return { setCount: 0, setCountLabel: '—', repsLabel: '—', checkboxCount: 0 };
    }

    const repsValues = list
        .map((set) => set?.reps)
        .filter((reps) => reps != null && reps !== '' && !Number.isNaN(Number(reps)));

    let repsLabel = '—';
    if (repsValues.length) {
        const nums = repsValues.map(Number);
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        repsLabel = min === max ? String(min) : `${min}-${max}`;
    }

    return {
        setCount: list.length,
        setCountLabel: String(list.length),
        repsLabel,
        checkboxCount: list.length,
    };
};

/**
 * @param {object} day
 * @param {number} index
 */
const buildDetailWorkout = (day, index) => {
    const letter = DAY_LETTERS[index] || String(index + 1);
    const theme =
        WORKOUT_THEME_COLORS[index % WORKOUT_THEME_COLORS.length];
    const name =
        String(day?.name ?? '').trim() ||
        (day?.dayNumber != null ? `Day ${day.dayNumber}` : `Workout ${letter}`);
    const muscles = collectPrimaryMuscles(day);
    const rawExercises = Array.isArray(day?.exercises) ? [...day.exercises] : [];
    rawExercises.sort((a, b) => {
        const ao = Number.isFinite(Number(a?.order)) ? Number(a.order) : 0;
        const bo = Number.isFinite(Number(b?.order)) ? Number(b.order) : 0;
        return ao - bo;
    });

    const exercises = rawExercises.map((exercise) => {
        const summary = summarizeExerciseSets(exercise?.sets);
        return {
            name: String(exercise?.name ?? '').trim() || 'Exercise',
            notes: String(exercise?.notes ?? '').trim() || null,
            imageUrl: sanitizeExerciseImageUrl(exercise?.thumbnailUrl),
            publicUrl: buildPublicExerciseUrl(exercise),
            setCountLabel: summary.setCountLabel,
            repsLabel: summary.repsLabel,
            checkboxCount: summary.checkboxCount,
        };
    });

    const setCount = exercises.reduce(
        (sum, exercise) => sum + (exercise.checkboxCount || 0),
        0
    );

    return {
        letter,
        name,
        theme,
        muscles,
        exerciseCount: exercises.length,
        setCount,
        meta: `${exercises.length} exercise${exercises.length === 1 ? '' : 's'} · ${setCount} set${setCount === 1 ? '' : 's'}`,
        exercises,
    };
};

/**
 * Pack workout exercise tables onto one or more A4 detail pages.
 * @param {ReturnType<typeof buildDetailWorkout>[]} workouts
 */
const packDetailPages = (workouts = []) => {
    const { pageBudget, pageChrome, cardChrome, rowHeight, cardGap } =
        DETAIL_LAYOUT;

    /** @type {{ blocks: object[] }[]} */
    const pages = [];
    let currentBlocks = [];
    let used = pageChrome;

    const flush = () => {
        if (!currentBlocks.length) return;
        pages.push({ blocks: currentBlocks });
        currentBlocks = [];
        used = pageChrome;
    };

    const estimateCard = (rowCount) =>
        cardChrome + Math.max(rowCount, 1) * rowHeight;

    for (const workout of workouts) {
        const exercises = workout.exercises;
        if (!exercises.length) {
            const height = estimateCard(1);
            const gap = currentBlocks.length ? cardGap : 0;
            if (currentBlocks.length && used + gap + height > pageBudget) {
                flush();
            }
            currentBlocks.push({
                workout,
                exercises: [],
                continued: false,
            });
            used += (currentBlocks.length > 1 ? cardGap : 0) + height;
            continue;
        }

        let offset = 0;
        let continued = false;
        while (offset < exercises.length) {
            const gap = currentBlocks.length ? cardGap : 0;
            let available = pageBudget - used - gap - cardChrome;
            let maxRows = Math.floor(available / rowHeight);

            if (maxRows < 1) {
                flush();
                continued = offset > 0;
                continue;
            }

            const remaining = exercises.length - offset;
            let take = Math.min(maxRows, remaining);

            // Avoid leaving a single orphan row when the rest can wait for next page.
            if (remaining > take && remaining - take === 1 && take > 1) {
                take -= 1;
            }

            const slice = exercises.slice(offset, offset + take);
            const height = estimateCard(slice.length);
            currentBlocks.push({
                workout,
                exercises: slice,
                continued: continued || offset > 0,
            });
            used += gap + height;
            offset += take;
            continued = true;

            if (offset < exercises.length) {
                flush();
                continued = true;
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
 * @param {number} n
 * @param {number} width
 */
const padPageNumber = (n, width = 2) => String(n).padStart(width, '0');

/**
 * @param {object} exportModel
 */
export const deriveElevateViewModel = (exportModel) => {
    const plan = exportModel?.plan || {};
    const workoutDays = exportModel?.content?.workoutDays ?? [];

    const titleLayout = fitElevateTitleLayout(plan.name);
    const planName = titleLayout.planName;
    const duration =
        plan.duration != null && Number.isFinite(Number(plan.duration))
            ? Number(plan.duration)
            : null;
    const workoutCount = workoutDays.length;
    const workoutLabels = buildWorkoutLabels(workoutDays);
    const totalExercises =
        plan.totalExercises != null &&
        Number.isFinite(Number(plan.totalExercises))
            ? Number(plan.totalExercises)
            : workoutDays.reduce(
                  (sum, day) =>
                      sum +
                      (Array.isArray(day.exercises) ? day.exercises.length : 0),
                  0
              );
    const perWorkout =
        workoutCount > 0 ? Math.round(totalExercises / workoutCount) : null;
    const totalSets = countTotalSets(workoutDays);
    const workoutSummaries = buildWorkoutSummaries(workoutDays);
    const exampleWeekDays = buildExampleWeekDays(workoutSummaries);
    const workoutsPageDek = buildWorkoutsPageDek(workoutSummaries, duration);
    const programNotes = buildProgramNotes(workoutSummaries, plan.notes);
    const detailWorkouts = workoutDays.map((day, index) =>
        buildDetailWorkout(day, index)
    );
    const detailPages = packDetailPages(detailWorkouts);
    // Cover + workouts summary + one or more detail pages (continuation included).
    const totalPageCount = 2 + detailPages.length;

    const nameWords = planName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join(' ')
        .toLowerCase();

    const dekParts = [];
    if (duration != null) dekParts.push(`${duration}-week`);
    if (nameWords) dekParts.push(`${nameWords} plan`);
    else dekParts.push('workout plan');
    if (workoutCount > 0) {
        dekParts.push(
            `· ${workoutCount} workout${workoutCount === 1 ? '' : 's'}`
        );
    }
    const dek = dekParts.join(' ');

    const workoutsValue = workoutLabels
        ? `${workoutCount} · ${workoutLabels}`
        : String(workoutCount || '—');
    const exercisesValue =
        perWorkout != null && workoutCount > 0
            ? `${totalExercises} · ${perWorkout} per workout`
            : String(totalExercises || '—');

    const pickStepDetail = workoutLabels
        ? `${workoutLabels} — any order`
        : 'Any order';

    return {
        planName,
        titleHtml: titleLayout.titleHtml,
        titleFontSize: titleLayout.fontSize,
        titleLineCount: titleLayout.lineCount,
        titleMode: titleLayout.mode,
        dek,
        duration,
        workoutCount,
        totalExercises,
        totalSets,
        workoutsValue,
        exercisesValue,
        orderLabel: 'Any order',
        pickStepDetail,
        workoutSummaries,
        exampleWeekDays,
        workoutsPageDek,
        programNotes,
        detailWorkouts,
        detailPages,
        totalPageCount,
        workoutsPageNumber: 2,
        detailsStartPageNumber: 3,
    };
};

const DETAILS_DUMBBELL_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.2 8.2v7.6M17.8 8.2v7.6M3.6 10v4M20.4 10v4M6.2 12h11.6M8.4 9.3v5.4M15.6 9.3v5.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
          </svg>`;

/**
 * @param {number} count
 * @returns {string}
 */
const renderTickBoxes = (count) => {
    if (!count || count < 1) {
        return `<div class="details-ticks-row"><span class="details-tick-empty">—</span></div>`;
    }
    const ticks = Array.from(
        { length: count },
        () => '<span class="details-tick"></span>'
    ).join('');
    return `<div class="details-ticks-row">${ticks}</div>`;
};

/**
 * @param {object} block
 * @returns {string}
 */
const renderDetailWorkoutCard = (block) => {
    const { workout, exercises, continued } = block;
    const theme = workout.theme;
    const muscles =
        workout.muscles.length > 0 ? ` — ${workout.muscles.join(' · ')}` : '';
    const title = continued
        ? `Workout ${workout.letter}${muscles} (continued)`
        : `Workout ${workout.letter}${muscles}`;

    const rows = exercises.length
        ? exercises
              .map((exercise) => {
                  const imageSrc = exercise.imageUrl || EXERCISE_IMAGE_FALLBACK;
                  const note = exercise.notes
                      ? `<p class="details-ex-note">${escapeHtml(exercise.notes)}</p>`
                      : '';
                  const safeName = escapeHtml(exercise.name);
                  const safeHref = exercise.publicUrl
                      ? escapeHtml(exercise.publicUrl)
                      : null;
                  const nameHtml = safeHref
                      ? `<a class="details-ex-name details-ex-link" href="${safeHref}">${safeName}</a>`
                      : `<p class="details-ex-name">${safeName}</p>`;
                  const imageTag = `<img class="details-thumb" src="${escapeHtml(
                      imageSrc
                  )}" alt="">`;
                  // Link real catalog thumbnails only — never the SVG fallback silhouette.
                  const imageHtml =
                      safeHref && exercise.imageUrl
                          ? `<a class="details-ex-thumb-link details-ex-link" href="${safeHref}">${imageTag}</a>`
                          : imageTag;
                  return `<tr class="details-row">
            <td class="details-ex">
              <div class="details-ex-inner">
                ${imageHtml}
                <div class="details-ex-copy">
                  ${nameHtml}
                  ${note}
                </div>
              </div>
            </td>
            <td class="details-sets">${escapeHtml(exercise.setCountLabel)}</td>
            <td class="details-reps">${escapeHtml(exercise.repsLabel)}</td>
            <td class="details-ticks">${renderTickBoxes(exercise.checkboxCount)}</td>
          </tr>`;
              })
              .join('\n')
        : `<tr class="details-row details-row-empty">
            <td class="details-ex" colspan="4"><p class="details-ex-name">No exercises</p></td>
          </tr>`;

    return `<article class="details-card details-card--${escapeHtml(theme.id)}">
      <header class="details-card-head">
        <div class="details-pill">
          ${DETAILS_DUMBBELL_ICON}
          <span>${escapeHtml(title)}</span>
        </div>
        <p class="details-card-meta">${escapeHtml(workout.meta)}</p>
      </header>
      <div class="details-card-body">
        <table class="details-table">
          <thead>
            <tr>
              <th scope="col">Exercise</th>
              <th scope="col">Sets</th>
              <th scope="col">Reps</th>
              <th scope="col">Tick each set</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </article>`;
};

/**
 * @param {object} page
 * @param {number} pageNumber
 * @param {number} totalPages
 * @param {boolean} isFirstDetailsPage
 */
const renderDetailPage = (page, pageNumber, totalPages, isFirstDetailsPage) => {
    const cards = page.blocks.length
        ? page.blocks.map((block) => renderDetailWorkoutCard(block)).join('\n      ')
        : `<article class="details-card details-card-empty">
      <p class="details-empty">No workouts in this plan yet.</p>
    </article>`;

    const dek = isFirstDetailsPage
        ? 'Sets and reps for each workout. Tick a box for every set you finish.'
        : 'Continued from previous page.';

    return `<section class="page page-workout-details" aria-label="Workout plan details">
    <img class="details-corner details-corner-dark" src="images/top-corner-2.png" alt="">
    <img class="details-corner details-corner-lime" src="images/top-corner-1.png" alt="">
    <img class="details-slash" src="images/Frame-Cornars.png" alt="">

    <p class="logo details-logo">
      <span class="logo-f">F</span><span class="logo-word">itlyPro</span>
    </p>

    <h1 class="details-title">
      WORKOUT<br>
      <span>PLAN</span>
    </h1>
    <p class="details-dek">${escapeHtml(dek)}</p>

    <div class="details-stack" data-elevate="workout-details-stack">
      ${cards}
    </div>

    <footer class="details-footer">
      <span>FitlyPro | Workout Plan</span>
      <span>${padPageNumber(pageNumber)} / ${padPageNumber(totalPages)}</span>
    </footer>
  </section>`;
};

/**
 * Inject dynamic plan values into the author's HTML without redesigning it.
 * @param {string} html
 * @param {ReturnType<typeof deriveElevateViewModel>} view
 */
const applyDynamicContent = (html, view) => {
    let next = html;

    next = next.replace(
        /<title>[\s\S]*?<\/title>/i,
        `<title>${escapeHtml(view.planName)}</title>`
    );

    // Inject fitted title metrics before PDF/Studio paint (no runtime JS needed).
    const layoutStyle = [
        `--title-size:${Number(view.titleFontSize) || TITLE_LAYOUT.maxSizePx}px`,
        `--title-line-height:${TITLE_LAYOUT.lineHeight}`,
        `--title-width:${TITLE_LAYOUT.maxWidthPx}px`,
    ].join(';');

    next = next.replace(
        /<main class="page page-cover"([^>]*)>/i,
        `<main class="page page-cover"$1 style="${layoutStyle}">`
    );

    next = next.replace(
        /<h1 class="title">[\s\S]*?<\/h1>/i,
        `<h1 class="title">\n      ${view.titleHtml}\n    </h1>`
    );

    next = next.replace(
        /<p class="dek">[\s\S]*?<\/p>/i,
        `<p class="dek">${escapeHtml(view.dek)}</p>`
    );

    // Keep the how-to steps section; only the first card's detail is plan-aware.
    next = next.replace(
        /(<section class="steps"[\s\S]*?<h2>Pick a workout<\/h2>\s*)<p>[\s\S]*?<\/p>/i,
        `$1<p>${escapeHtml(view.pickStepDetail)}</p>`
    );

    next = next.replace(
        /<ul class="overview-rows">[\s\S]*?<\/ul>/i,
        `<ul class="overview-rows">
        <li><span>Plan</span><strong>${escapeHtml(view.planName)}</strong></li>
        <li><span>Duration</span><strong>${
            view.duration != null
                ? `${escapeHtml(String(view.duration))} weeks`
                : '—'
        }</strong></li>
        <li><span>Workouts</span><strong>${escapeHtml(
            view.workoutsValue
        )}</strong></li>
        <li><span>Exercises</span><strong>${escapeHtml(
            view.exercisesValue
        )}</strong></li>
        <li><span>Order</span><strong class="lime">${escapeHtml(
            view.orderLabel
        )}</strong></li>
      </ul>`
    );

    next = next.replace(
        /<section class="stats"[\s\S]*?<\/section>/i,
        `<section class="stats" aria-label="Plan totals">
      <article class="stat">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.25" y="4.75" width="17.5" height="16" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <path d="M3.25 9.4h17.5M8 3.1v3.4M16 3.1v3.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M8 13.2h.01M12 13.2h.01M16 13.2h.01M8 16.6h.01M12 16.6h.01" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
        <div>
          <strong>${
              view.duration != null ? escapeHtml(String(view.duration)) : '—'
          }</strong>
          <span>weeks</span>
        </div>
      </article>
      <article class="stat">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.2 3.4 7.6 12 12l8.6-4.4L12 3.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M3.4 12 12 16.4 20.6 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M3.4 16.2 12 20.6l8.6-4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div>
          <strong>${escapeHtml(String(view.workoutCount || '—'))}</strong>
          <span>workouts</span>
        </div>
      </article>
      <article class="stat">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.2 8.2v7.6M17.8 8.2v7.6M3.6 10v4M20.4 10v4M6.2 12h11.6M8.4 9.3v5.4M15.6 9.3v5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <div>
          <strong>${escapeHtml(String(view.totalExercises || '—'))}</strong>
          <span>exercises</span>
        </div>
      </article>
      <article class="stat stat-hot">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.2c.4 2.5-1.3 3.6-1.3 6.1 0 1.5.8 2.5 1.3 3 .5-.5 1.3-1.5 1.3-3 0-1.2-.4-2.2-.4-2.2.9 1.1 2.6 2.5 2.6 5.2A5.5 5.5 0 1 1 8.2 12c.6-1.7 2.2-2.6 2.2-4.6.6 1.1 1.6 1.6 1.6 1.6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        </svg>
        <div>
          <strong>${
              view.totalSets > 0 ? escapeHtml(String(view.totalSets)) : '—'
          }</strong>
          <span>sets per round</span>
        </div>
      </article>
    </section>`
    );

    const dumbbellIcon = `<svg class="week-day-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.2 8.2v7.6M17.8 8.2v7.6M3.6 10v4M20.4 10v4M6.2 12h11.6M8.4 9.3v5.4M15.6 9.3v5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>`;
    const restIcon = `<svg class="week-day-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.5 14.5h17M5 14.5V11a2 2 0 0 1 2-2h4.5a2 2 0 0 1 2 2v3.5M14.5 12.5H19a1.5 1.5 0 0 1 1.5 1.5v.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>`;

    const workoutsListHtml =
        view.workoutSummaries.length > 0
            ? view.workoutSummaries
                  .map((row) => {
                      const muscles =
                          row.muscles.length > 0
                              ? row.muscles.join(' · ')
                              : '';
                      return `<article class="workout-row">
        <span class="workout-letter">${escapeHtml(row.letter)}</span>
        <div class="workout-copy">
          <h2>${escapeHtml(row.name)}</h2>
          <p>${escapeHtml(row.meta)}</p>
        </div>
        <p class="workout-muscles">${escapeHtml(muscles)}</p>
      </article>`;
                  })
                  .join('\n      ')
            : `<article class="workout-row">
        <span class="workout-letter">—</span>
        <div class="workout-copy">
          <h2>No workouts yet</h2>
          <p>0 exercises · 0 sets</p>
        </div>
        <p class="workout-muscles"></p>
      </article>`;

    const exampleWeekHtml = view.exampleWeekDays
        .map((day) => {
            const cls = day.active ? 'is-active' : 'is-rest';
            const icon = day.active ? dumbbellIcon : restIcon;
            return `<article class="week-day ${cls}">
          ${icon}
          <strong>${escapeHtml(day.label)}</strong>
          <span>${escapeHtml(day.detail)}</span>
        </article>`;
        })
        .join('\n        ');

    const programNotesHtml = view.programNotes
        .map((note) => {
            const cls = note.coach ? ' class="is-coach"' : '';
            return `<li${cls}>${escapeHtml(note.text)}</li>`;
        })
        .join('\n        ');

    next = next.replace(
        /<p class="workouts-dek"[^>]*>[\s\S]*?<\/p>/i,
        `<p class="workouts-dek" data-elevate="workouts-dek">${escapeHtml(
            view.workoutsPageDek
        )}</p>`
    );

    next = next.replace(
        /<section class="workouts-list"[^>]*>[\s\S]*?<\/section>/i,
        `<section class="workouts-list" aria-label="Workout summaries" data-elevate="workouts-list">
      ${workoutsListHtml}
    </section>`
    );

    next = next.replace(
        /<div class="example-week-grid"[^>]*>[\s\S]*?<\/div>/i,
        `<div class="example-week-grid" data-elevate="example-week">
        ${exampleWeekHtml}
      </div>`
    );

    next = next.replace(
        /<ul class="program-notes-list"[^>]*>[\s\S]*?<\/ul>/i,
        `<ul class="program-notes-list" data-elevate="program-notes">
        ${programNotesHtml}
      </ul>`
    );

    const totalLabel = padPageNumber(view.totalPageCount);
    next = next.replace(
        /(<footer class="workouts-footer">[\s\S]*?<span>FitlyPro \| Workout Plan<\/span>\s*<span>)[\s\S]*?(<\/span>\s*<\/footer>)/i,
        `$1${padPageNumber(view.workoutsPageNumber)} / ${totalLabel}$2`
    );

    const detailPagesHtml = (view.detailPages || [])
        .map((page, index) =>
            renderDetailPage(
                page,
                view.detailsStartPageNumber + index,
                view.totalPageCount,
                index === 0
            )
        )
        .join('\n\n  ');

    // Cards use <article>, so this can safely match each outer details page section.
    next = next.replace(
        /(?:\s*<section class="page page-workout-details"[\s\S]*?<\/section>)+/i,
        `\n\n  ${detailPagesHtml}\n`
    );

    return next;
};

/**
 * @returns {string}
 */
export const readElevateHtmlEntryFile = () => {
    if (!existsSync(ELEVATE_HTML_ENTRY)) {
        throw new Error(
            `Elevate HTML design entry missing: ${ELEVATE_HTML_ENTRY}`
        );
    }
    return readFileSync(ELEVATE_HTML_ENTRY, 'utf8');
};

/**
 * Inline CSS + local images/fonts for Playwright / srcdoc preview.
 * Shared by Workout and Nutrition Elevate builders.
 * @param {string} html
 */
export const inlineLocalAssets = (html) => {
    let next = html;
    const cssRaw = readAssetBuffer(ELEVATE_HTML_CSS_NAME).toString('utf8');
    const cssInlined = inlineCssUrls(cssRaw);

    if (!next.includes(ELEVATE_HTML_SOURCE_MARKER)) {
        next = next.replace(
            /<head([^>]*)>/i,
            `<head$1>\n  <!-- ${ELEVATE_HTML_SOURCE_MARKER} -->`
        );
    }

    next = next.replace(
        /<link\s+rel=["']stylesheet["']\s+href=["']styles\.css["']\s*\/?>/i,
        `<style data-elevate-html-css="${ELEVATE_HTML_CSS_NAME}">\n${cssInlined}\n</style>`
    );

    next = next.replace(
        /\b(src|href)=["']([^"']+)["']/gi,
        (match, attr, rawUrl) => {
            const url = String(rawUrl || '').trim();
            if (
                !url ||
                url.startsWith('data:') ||
                url.startsWith('#') ||
                /^https?:/i.test(url) ||
                url.startsWith('mailto:')
            ) {
                return match;
            }
            if (
                !/^(images|fonts)\//i.test(url) &&
                !/\.(png|jpe?g|webp|gif|svg|woff2?|ttf|otf)$/i.test(url)
            ) {
                return match;
            }
            return `${attr}="${toDataUri(url)}"`;
        }
    );

    if (/href=["']styles\.css["']/i.test(next)) {
        throw new Error('Failed to inline Elevate HTML design stylesheet');
    }
    if (/\ssrc=["']images\//i.test(next)) {
        throw new Error('Failed to inline Elevate HTML design images');
    }
    if (/url\(["']?fonts\//i.test(next)) {
        throw new Error('Failed to inline Elevate HTML design fonts');
    }

    return next;
};

/**
 * Production + Studio builder: author's HTML + export-model data + inlined assets.
 * @param {object} exportModel
 * @returns {string}
 */
export const buildElevateWorkoutHtml = (exportModel) => {
    const view = deriveElevateViewModel(exportModel);
    const withData = applyDynamicContent(readElevateHtmlEntryFile(), view);
    const html = inlineLocalAssets(withData);

    if (
        !html.includes('class="page page-cover"') ||
        !html.includes('Program overview') ||
        !html.includes('class="steps"') ||
        !html.includes('How to log') ||
        !html.includes('page-workouts') ||
        !html.includes('THE') ||
        !html.includes('WORKOUTS') ||
        !html.includes('page-workout-details') ||
        !html.includes('Tick each set') ||
        !/\d{2} \/ \d{2}/.test(html)
    ) {
        throw new Error('Elevate HTML builder lost required design markup');
    }
    if (html.includes('data-fitly-cover>') || html.includes('class="cover"')) {
        throw new Error(
            'Elevate HTML builder incorrectly used legacy cover.css markup'
        );
    }

    return html;
};

export default {
    buildElevateWorkoutHtml,
    buildHighlightedTitleHtml,
    fitElevateTitleLayout,
    deriveElevateViewModel,
    readElevateHtmlEntryFile,
    ELEVATE_HTML_DIR,
    ELEVATE_HTML_ENTRY,
    ELEVATE_HTML_ENTRY_NAME,
    ELEVATE_HTML_CSS_NAME,
    ELEVATE_HTML_SOURCE_MARKER,
};
