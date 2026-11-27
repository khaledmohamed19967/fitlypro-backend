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
    /** Logo + WORKOUT PLAN title + dek + padding/footer on the first detail page. */
    pageChrome: 168,
    /** Logo + padding/footer only (title/dek omitted on later detail pages). */
    compactPageChrome: 72,
    cardChrome: 78,
    /** Section title bar + per-section column header row. */
    sectionHeaderHeight: 60,
    rowHeight: 52,
    sectionGap: 8,
    cardGap: 14,
});

/** Section accents for Warm-up / Exercise / Cardio (day pill theme stays separate). */
const SECTION_THEMES = Object.freeze({
    warmup: Object.freeze({
        id: 'warmup',
        label: 'Warm-up',
        accent: '#ff9f0a',
    }),
    main: Object.freeze({
        id: 'main',
        label: 'Exercise',
        accent: '#ccff01',
    }),
    cardio: Object.freeze({
        id: 'cardio',
        label: 'Cardio',
        accent: '#b794f6',
    }),
});

const ICON_FLAME = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.2 2.4c.2 2.8-1.5 4.1-1.4 6.6 0 1.3.7 2.2 1.4 2.7.6-.6 1.5-1.6 1.5-3.1 0-1.1-.3-2-.3-2 .9 1.2 2.4 2.7 2.4 5.4 0 3.4-2.6 5.8-5.8 5.8S4.2 15.4 4.2 12c.7-1.8 2.4-2.8 2.4-5 .7 1.2 1.8 1.8 1.8 1.8.1-2.4 1.7-4.1 3.8-6.4z" fill="currentColor"/></svg>`;

const ICON_DUMBBELL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 8.2v7.6M17.8 8.2v7.6M3.6 10v4M20.4 10v4M6.2 12h11.6M8.4 9.3v5.4M15.6 9.3v5.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;

const ICON_HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-6.4-3.8-8.6-7.2C1.6 10.2 2.4 6.8 5.2 5.6c1.8-.8 3.8-.2 4.9 1.3C11.2 5.4 13.2 4.8 15 5.6c2.8 1.2 3.6 4.6 1.8 7.2C18.4 16.2 12 20 12 20z" fill="currentColor"/></svg>`;

const SECTION_ICONS = Object.freeze({
    warmup: ICON_FLAME,
    main: ICON_DUMBBELL,
    cardio: ICON_HEART,
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
 * Rest days persist as workoutDays with no activities (frontend `kind` is UI-only).
 * Detect via empty warmup + main + cardio — not by title matching alone.
 * @param {object} day
 * @returns {boolean}
 */
const isRestWorkoutDay = (day) => {
    const warmup = Array.isArray(day?.warmupActivities)
        ? day.warmupActivities.length
        : 0;
    const main = Array.isArray(day?.exercises) ? day.exercises.length : 0;
    const cardio = Array.isArray(day?.cardioActivities)
        ? day.cardioActivities.length
        : 0;
    return warmup + main + cardio === 0;
};

/**
 * Letter labels for training days only (rest days keep sequence letters in overview).
 * @param {object[]} workoutDays
 */
const buildWorkoutLabels = (workoutDays = []) => {
    if (!workoutDays.length) return '';
    return workoutDays
        .map((day, index) =>
            isRestWorkoutDay(day)
                ? null
                : DAY_LETTERS[index] || String(index + 1)
        )
        .filter(Boolean)
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
 * @param {object} day
 * @returns {{ warmup: number, main: number, cardio: number, total: number }}
 */
const countDayActivities = (day) => {
    const warmup = Array.isArray(day?.warmupActivities)
        ? day.warmupActivities.length
        : 0;
    const main = Array.isArray(day?.exercises) ? day.exercises.length : 0;
    const cardio = Array.isArray(day?.cardioActivities)
        ? day.cardioActivities.length
        : 0;
    return { warmup, main, cardio, total: warmup + main + cardio };
};

/**
 * Page-02 workout summary rows from real workoutDays only.
 * Rest days keep their sequence letter and render as compact overview rows.
 * @param {object[]} workoutDays
 */
const buildWorkoutSummaries = (workoutDays = []) =>
    workoutDays.map((day, index) => {
        const letter = DAY_LETTERS[index] || String(index + 1);
        if (isRestWorkoutDay(day)) {
            return {
                letter,
                name: 'Rest Day',
                isRest: true,
                exerciseCount: 0,
                activityCount: 0,
                setCount: 0,
                meta: 'Take a long day recovery and rest',
                muscles: [],
            };
        }

        const exercises = Array.isArray(day?.exercises) ? day.exercises : [];
        const counts = countDayActivities(day);
        const exerciseCount = counts.main;
        const setCount = exercises.reduce(
            (sum, exercise) => sum + countExerciseSets(exercise),
            0
        );
        const name =
            String(day?.name ?? '').trim() ||
            (day?.dayNumber != null ? `Day ${day.dayNumber}` : `Workout ${letter}`);
        const activityLabel =
            counts.total === counts.main
                ? `${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`
                : `${counts.total} activit${counts.total === 1 ? 'y' : 'ies'}`;
        return {
            letter,
            name,
            isRest: false,
            exerciseCount,
            activityCount: counts.total,
            setCount,
            meta: `${activityLabel} · ${setCount} set${setCount === 1 ? '' : 's'}`,
            muscles: collectPrimaryMuscles(day),
        };
    });

/**
 * Illustrative Mon–Sun grid only (export model has no weekday fields).
 * Labeled "Example only" in the design — not a claimed schedule.
 * Only training (non-rest) summaries occupy active slots.
 * @param {{ letter: string, isRest?: boolean }[]} summaries
 */
const buildExampleWeekDays = (summaries = []) => {
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const activeSlots = [0, 2, 4];
    const training = summaries.filter((row) => !row.isRest);
    return labels.map((label, index) => {
        const workoutIndex = activeSlots.indexOf(index);
        const summary =
            workoutIndex >= 0 && workoutIndex < training.length
                ? training[workoutIndex]
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
    const training = summaries.filter((row) => !row.isRest);
    const count = training.length;
    if (!count) {
        return duration != null
            ? `Your workout plan across ${duration} weeks.`
            : 'Your workout plan.';
    }
    const labels = training.map((row) => row.letter).join(', ');
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
    const labels = summaries
        .filter((row) => !row.isRest)
        .map((row) => row.letter)
        .filter(Boolean);
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
 * Resolve a row thumbnail the same way for strength + warm-up/cardio.
 * Prefers export-flattened `thumbnailUrl`, then nested snapshot/media fields.
 *
 * @param {object} item
 * @returns {string|null}
 */
const resolveRowImageUrl = (item) =>
    sanitizeExerciseImageUrl(
        item?.thumbnailUrl ||
            item?.media?.thumbnailUrl ||
            item?.activitySnapshot?.thumbnailUrl ||
            item?.exerciseSnapshot?.thumbnailUrl ||
            item?.exercise?.thumbnailUrl ||
            item?.exercise?.media?.thumbnailUrl ||
            null
    );

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
 * @param {object[]} items
 */
const sortByOrder = (items = []) =>
    [...items].sort((a, b) => {
        const ao = Number.isFinite(Number(a?.order)) ? Number(a.order) : 0;
        const bo = Number.isFinite(Number(b?.order)) ? Number(b.order) : 0;
        return ao - bo;
    });

/**
 * @param {unknown} minutes
 * @returns {string|null}
 */
const formatDurationMinutes = (minutes) => {
    if (minutes == null || minutes === '') return null;
    const n = Number(minutes);
    if (!Number.isFinite(n)) return null;
    return `${n} min`;
};

/**
 * Build subtitle from real warm-up / cardio fields only (no fabrication).
 * @param {object} activity
 * @returns {string|null}
 */
const buildActivitySubtitle = (activity = {}) => {
    const parts = [];
    const intensity = formatLabel(activity.intensity);
    if (intensity) parts.push(intensity);
    const protocol = formatLabel(activity.protocol);
    if (protocol) parts.push(protocol);
    if (activity.distanceKm != null && activity.distanceKm !== '') {
        const km = Number(activity.distanceKm);
        if (Number.isFinite(km)) parts.push(`${km} km`);
    }
    if (String(activity.protocol || '').toLowerCase() === 'interval') {
        if (activity.workSeconds != null && Number.isFinite(Number(activity.workSeconds))) {
            parts.push(`${Number(activity.workSeconds)}s work`);
        }
        if (
            activity.recoverySeconds != null &&
            Number.isFinite(Number(activity.recoverySeconds))
        ) {
            parts.push(`${Number(activity.recoverySeconds)}s recover`);
        }
        if (activity.rounds != null && Number.isFinite(Number(activity.rounds))) {
            parts.push(`${Number(activity.rounds)} rounds`);
        }
    }
    if (activity.targetHeartRate != null && Number.isFinite(Number(activity.targetHeartRate))) {
        parts.push(`${Number(activity.targetHeartRate)} bpm`);
    }
    const notes = String(activity.notes ?? '').trim();
    if (notes) parts.push(notes);
    return parts.length ? parts.join(' · ') : null;
};

/**
 * Map warm-up / cardio export activity into a detail row (not strength sets/reps).
 * @param {object} activity
 * @param {'warmup'|'cardio'} sectionId
 */
const mapActivityDetailRow = (activity, sectionId) => {
    const duration = formatDurationMinutes(activity?.durationMinutes);
    const subtitle = buildActivitySubtitle(activity);
    return {
        kind: 'activity',
        sectionId,
        name: String(activity?.name ?? '').trim() || 'Activity',
        notes: subtitle,
        imageUrl: resolveRowImageUrl(activity),
        // Same public Exercise Library URL rules as Main (null when not linkable).
        publicUrl: buildPublicExerciseUrl(activity),
        // Activities do not have strength sets/reps — show duration in the metric cell.
        setCountLabel: '—',
        repsLabel: duration || '—',
        metricLabel: duration || null,
        usesMetricSpan: true,
        checkboxCount: 1,
    };
};

/**
 * @param {object} exercise
 */
const mapStrengthDetailRow = (exercise) => {
    const summary = summarizeExerciseSets(exercise?.sets);
    return {
        kind: 'strength',
        sectionId: 'main',
        name: String(exercise?.name ?? '').trim() || 'Exercise',
        notes: String(exercise?.notes ?? '').trim() || null,
        imageUrl: resolveRowImageUrl(exercise),
        publicUrl: buildPublicExerciseUrl(exercise),
        setCountLabel: summary.setCountLabel,
        repsLabel: summary.repsLabel,
        metricLabel: null,
        usesMetricSpan: false,
        checkboxCount: summary.checkboxCount,
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

    const warmupRows = sortByOrder(day?.warmupActivities ?? []).map((activity) =>
        mapActivityDetailRow(activity, 'warmup')
    );
    const mainRows = sortByOrder(day?.exercises ?? []).map(mapStrengthDetailRow);
    const cardioRows = sortByOrder(day?.cardioActivities ?? []).map((activity) =>
        mapActivityDetailRow(activity, 'cardio')
    );

    /** @type {object[]} */
    const sections = [];
    if (warmupRows.length) {
        sections.push({
            ...SECTION_THEMES.warmup,
            count: warmupRows.length,
            countLabel: `${warmupRows.length} exercise${warmupRows.length === 1 ? '' : 's'}`,
            rows: warmupRows,
        });
    }
    if (mainRows.length) {
        sections.push({
            ...SECTION_THEMES.main,
            count: mainRows.length,
            countLabel: `${mainRows.length} exercise${mainRows.length === 1 ? '' : 's'}`,
            rows: mainRows,
        });
    }
    if (cardioRows.length) {
        sections.push({
            ...SECTION_THEMES.cardio,
            count: cardioRows.length,
            countLabel: `${cardioRows.length} exercise${cardioRows.length === 1 ? '' : 's'}`,
            rows: cardioRows,
        });
    }

    const totalRows = warmupRows.length + mainRows.length + cardioRows.length;
    const setCount = mainRows.reduce(
        (sum, row) => sum + (row.checkboxCount || 0),
        0
    );
    const meta =
        totalRows === 1
            ? '1 exercise'
            : `${totalRows} exercises`;

    // Flat list kept for backwards-compatible packing callers / tests.
    const exercises = sections.flatMap((section) => section.rows);

    return {
        letter,
        name,
        theme,
        muscles,
        exerciseCount: mainRows.length,
        activityCount: totalRows,
        setCount,
        meta,
        sections,
        exercises,
    };
};

/**
 * Content height available for one workout card on a detail page.
 * @param {boolean} compact later pages omit the WORKOUT PLAN intro
 * @returns {number}
 */
const detailContentBudget = (compact = false) => {
    const { pageBudget, pageChrome, compactPageChrome } = DETAIL_LAYOUT;
    return pageBudget - (compact ? compactPageChrome : pageChrome);
};

/**
 * Estimated height of a workout card containing the given section slices.
 * @param {object[]} sectionSlices
 * @returns {number}
 */
const estimateWorkoutCardHeight = (sectionSlices = []) => {
    const { cardChrome, sectionHeaderHeight, rowHeight, sectionGap } =
        DETAIL_LAYOUT;
    if (!sectionSlices.length) return cardChrome;
    return (
        cardChrome +
        sectionSlices.reduce(
            (sum, slice, index) =>
                sum +
                (index > 0 ? sectionGap : 0) +
                sectionHeaderHeight +
                Math.max(slice.rows?.length || 0, 1) * rowHeight,
            0
        )
    );
};

/**
 * Pack detail pages so each workout day is one parent page containing its
 * Warm-up + Exercise + Cardio child sections. Page breaks occur between
 * workout days only. Oversized workouts continue at safe row boundaries.
 * @param {ReturnType<typeof buildDetailWorkout>[]} workouts
 */
const packDetailPages = (workouts = []) => {
    const { sectionHeaderHeight, rowHeight, sectionGap, cardChrome } =
        DETAIL_LAYOUT;

    /** @type {{ blocks: object[] }[]} */
    const pages = [];

    const pushWorkoutPage = (workout, sectionSlices, continued) => {
        const metaBase = workout.meta || '0 exercises';
        pages.push({
            blocks: [
                {
                    workout,
                    sections: sectionSlices,
                    exercises: sectionSlices.flatMap((slice) => slice.rows || []),
                    continued,
                    meta: continued ? `${metaBase} (continued)` : metaBase,
                },
            ],
        });
    };

    for (const workout of workouts) {
        const sections = (Array.isArray(workout.sections) ? workout.sections : [])
            .map((section) => ({
                id: section.id,
                label: section.label,
                accent: section.accent,
                countLabel: section.countLabel,
                showHeader: true,
                rows: Array.isArray(section.rows) ? [...section.rows] : [],
            }))
            .filter((section) => section.rows.length > 0);

        // Empty days (e.g. rest) are excluded upstream; never emit blank detail pages.
        if (!sections.length) continue;

        // Prefer one unified page when the full workout fits.
        const compactFirst = pages.length > 0;
        if (
            estimateWorkoutCardHeight(sections) <=
            detailContentBudget(compactFirst)
        ) {
            pushWorkoutPage(workout, sections, false);
            continue;
        }

        // Oversized workout: pack as many complete rows as fit; continue at row boundaries.
        /** @type {{ id: string, label: string, accent: string, countLabel: string, showHeader: boolean, rows: object[] }[]} */
        let queue = sections.map((section) => ({
            ...section,
            rows: [...section.rows],
        }));
        let continued = false;

        while (queue.some((section) => section.rows.length > 0)) {
            const compact = pages.length > 0;
            const room = detailContentBudget(compact);
            /** @type {object[]} */
            const pageSlices = [];
            let used = cardChrome;

            while (queue.length) {
                const section = queue[0];
                if (!section.rows.length) {
                    queue.shift();
                    continue;
                }

                const gap = pageSlices.length ? sectionGap : 0;
                const headerCost = gap + sectionHeaderHeight;
                const remainingRoom = room - used - headerCost;
                let maxRows = Math.floor(remainingRoom / rowHeight);

                if (maxRows < 1) {
                    // No room for this section header + a row on the current page.
                    if (pageSlices.length) break;
                    // Always place at least one row so progress is guaranteed.
                    maxRows = 1;
                }

                const remaining = section.rows.length;
                let take = Math.min(maxRows, remaining);
                if (remaining > take && remaining - take === 1 && take > 1) {
                    take -= 1;
                }

                pageSlices.push({
                    id: section.id,
                    label: section.label,
                    accent: section.accent,
                    countLabel: section.countLabel,
                    showHeader: true,
                    rows: section.rows.slice(0, take),
                });
                used += headerCost + take * rowHeight;
                section.rows = section.rows.slice(take);
                if (!section.rows.length) {
                    queue.shift();
                } else {
                    // Section continues on the next page; stop filling this page.
                    break;
                }
            }

            if (!pageSlices.length) {
                // Safety: force one row forward to avoid an infinite loop.
                const section = queue.find((s) => s.rows.length > 0);
                if (!section) break;
                pageSlices.push({
                    id: section.id,
                    label: section.label,
                    accent: section.accent,
                    countLabel: section.countLabel,
                    showHeader: true,
                    rows: section.rows.slice(0, 1),
                });
                section.rows = section.rows.slice(1);
            }

            pushWorkoutPage(workout, pageSlices, continued);
            continued = true;
            queue = queue.filter((section) => section.rows.length > 0);
        }
    }

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
    const totalSets = countTotalSets(workoutDays);
    const workoutSummaries = buildWorkoutSummaries(workoutDays);
    const workoutCount = workoutSummaries.filter((row) => !row.isRest).length;
    const perWorkout =
        workoutCount > 0 ? Math.round(totalExercises / workoutCount) : null;
    const exampleWeekDays = buildExampleWeekDays(workoutSummaries);
    const workoutsPageDek = buildWorkoutsPageDek(workoutSummaries, duration);
    const programNotes = buildProgramNotes(workoutSummaries, plan.notes);
    // Rest days appear in the overview only — skip empty detail pages.
    const detailWorkouts = workoutDays
        .map((day, index) => ({ day, index }))
        .filter(({ day }) => !isRestWorkoutDay(day))
        .map(({ day, index }) => buildDetailWorkout(day, index));
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

const DETAILS_DUMBBELL_ICON = ICON_DUMBBELL;

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
 * @param {object} row
 * @param {string} sectionId
 * @returns {string}
 */
const renderRowIdentity = (row, sectionId) => {
    const note = row.notes
        ? `<p class="details-ex-note">${escapeHtml(row.notes)}</p>`
        : '';
    const safeName = escapeHtml(row.name);
    const safeHref = row.publicUrl ? escapeHtml(row.publicUrl) : null;
    const nameHtml = safeHref
        ? `<a class="details-ex-name details-ex-link" href="${safeHref}">${safeName}</a>`
        : `<p class="details-ex-name">${safeName}</p>`;

    let mediaHtml;
    if (row.imageUrl) {
        const imageTag = `<img class="details-thumb" src="${escapeHtml(
            row.imageUrl
        )}" alt="">`;
        mediaHtml =
            safeHref
                ? `<a class="details-ex-thumb-link details-ex-link" href="${safeHref}">${imageTag}</a>`
                : imageTag;
    } else {
        const icon = SECTION_ICONS[sectionId] || ICON_DUMBBELL;
        mediaHtml = `<span class="details-thumb details-thumb-icon details-thumb-icon--${escapeHtml(
            sectionId
        )}" aria-hidden="true">${icon}</span>`;
    }

    return `<td class="details-ex">
              <div class="details-ex-inner">
                ${mediaHtml}
                <div class="details-ex-copy">
                  ${nameHtml}
                  ${note}
                </div>
              </div>
            </td>`;
};

/**
 * Main Exercises: Exercise | Sets | Reps | Tick each set
 * @param {object} row
 * @param {string} sectionId
 */
const renderStrengthRow = (row, sectionId) => `<tr class="details-row details-row--${escapeHtml(
    sectionId
)}">
            ${renderRowIdentity(row, sectionId)}
            <td class="details-sets">${escapeHtml(row.setCountLabel)}</td>
            <td class="details-reps">${escapeHtml(row.repsLabel)}</td>
            <td class="details-ticks">${renderTickBoxes(row.checkboxCount)}</td>
          </tr>`;

/**
 * Warm-up / Cardio: Activity | Duration | Done
 * @param {object} row
 * @param {string} sectionId
 */
const renderActivityRow = (row, sectionId) => `<tr class="details-row details-row--${escapeHtml(
    sectionId
)}">
            ${renderRowIdentity(row, sectionId)}
            <td class="details-duration">${escapeHtml(
                row.metricLabel || row.repsLabel || '—'
            )}</td>
            <td class="details-ticks details-done">${renderTickBoxes(
                row.checkboxCount
            )}</td>
          </tr>`;

/**
 * One section owns its title bar + column headers + rows (no global thead).
 * @param {object} sectionSlice
 * @returns {string}
 */
const renderSectionSlice = (sectionSlice) => {
    const sectionId = sectionSlice.id;
    const isActivity = sectionId === 'warmup' || sectionId === 'cardio';
    const icon = SECTION_ICONS[sectionId] || ICON_DUMBBELL;

    const headCols = isActivity
        ? `<span class="details-section-col-label details-section-col-duration">Duration</span>
          <span class="details-section-col-label details-section-col-done">Done</span>`
        : `<span class="details-section-col-label details-section-col-sets">Sets</span>
          <span class="details-section-col-label details-section-col-reps">Reps</span>
          <span class="details-section-col-label details-section-col-ticks">Tick each set</span>`;

    const titleLabel = sectionSlice.showHeader
        ? `<header class="details-section-head details-section-head--${escapeHtml(
              sectionId
          )}">
        <div class="details-section-head-inner details-section-head-inner--${
            isActivity ? 'activity' : 'strength'
        }">
          <span class="details-section-label">
            ${icon}
            <span>${escapeHtml(sectionSlice.label)}</span>
          </span>
          ${headCols}
        </div>
      </header>`
        : '';

    const rows = sectionSlice.rows.length
        ? sectionSlice.rows
              .map((row) =>
                  isActivity
                      ? renderActivityRow(row, sectionId)
                      : renderStrengthRow(row, sectionId)
              )
              .join('\n')
        : `<tr class="details-row details-row-empty">
            <td class="details-ex" colspan="${
                isActivity ? 3 : 4
            }"><p class="details-ex-name">No exercises</p></td>
          </tr>`;

    return `<section class="details-section details-section--${escapeHtml(
        sectionId
    )}">
      ${titleLabel}
      <table class="details-table details-table--${escapeHtml(
          isActivity ? 'activity' : 'strength'
      )}">
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>`;
};

/**
 * @param {object} block
 * @returns {string}
 */
const renderDetailWorkoutCard = (block) => {
    const { workout, continued } = block;
    const theme = workout.theme;
    const rawName = String(workout.name || '').trim();
    const nameIsGeneric =
        !rawName ||
        /^day\s*\d+$/i.test(rawName) ||
        /^workout\s+[a-z0-9]+$/i.test(rawName);
    const focus = !nameIsGeneric
        ? rawName
        : workout.muscles.length > 0
          ? workout.muscles.join(' · ')
          : '';
    const focusPart = focus ? ` — ${focus}` : '';
    const title = continued
        ? `Workout ${workout.letter}${focusPart} (continued)`
        : `Workout ${workout.letter}${focusPart}`;

    const sectionSlices = Array.isArray(block.sections) ? block.sections : [];
    const sectionsHtml = sectionSlices.length
        ? sectionSlices.map((slice) => renderSectionSlice(slice)).join('\n')
        : `<section class="details-section details-section--empty">
      <p class="details-ex-name">No exercises</p>
    </section>`;

    const meta =
        typeof block.meta === 'string' && block.meta.trim()
            ? block.meta.trim()
            : continued
              ? `${workout.meta} (continued)`
              : workout.meta;

    return `<article class="details-card details-card--${escapeHtml(theme.id)}">
      <header class="details-card-head">
        <div class="details-pill">
          ${DETAILS_DUMBBELL_ICON}
          <span>${escapeHtml(title)}</span>
        </div>
        <p class="details-card-meta">${escapeHtml(meta)}</p>
      </header>
      <div class="details-card-body details-card-body--sections">
        ${sectionsHtml}
      </div>
    </article>`;
};

/**
 * @param {object} page
 * @param {number} pageNumber
 * @param {number} totalPages
 * @param {{ showIntro?: boolean }} [options]
 */
const renderDetailPage = (
    page,
    pageNumber,
    totalPages,
    { showIntro = false } = {}
) => {
    const cards = page.blocks.length
        ? page.blocks.map((block) => renderDetailWorkoutCard(block)).join('\n      ')
        : `<article class="details-card details-card-empty">
      <p class="details-empty">No workouts in this plan yet.</p>
    </article>`;

    const pageClass = showIntro
        ? 'page page-workout-details'
        : 'page page-workout-details page-workout-details--compact';

    // Title + dek only on the first detail page (single-line WORKOUT PLAN).
    const introHtml = showIntro
        ? `<h1 class="details-title">WORKOUT <span>PLAN</span></h1>
    <p class="details-dek">Warm-up, main exercises, and cardio. Tick a box for every set you finish.</p>
`
        : '';

    return `<section class="${pageClass}" aria-label="Workout plan details">
    <span class="details-corner details-corner-dark" aria-hidden="true"></span>
    <span class="details-corner details-corner-lime" aria-hidden="true"></span>
    <span class="details-slash" aria-hidden="true"></span>

    <p class="logo details-logo">
      <span class="logo-f">F</span><span class="logo-word">itlyPro</span>
    </p>

    ${introHtml}
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
                          !row.isRest && row.muscles.length > 0
                              ? row.muscles.join(' · ')
                              : '';
                      const rowClass = row.isRest
                          ? 'workout-row is-rest'
                          : 'workout-row';
                      return `<article class="${rowClass}">
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
                { showIntro: index === 0 }
            )
        )
        .join('\n\n  ');

    // Nested <section class="details-section"> inside the page must not truncate the match.
    next = replacePageSectionsByClass(next, 'page-workout-details', detailPagesHtml);

    return next;
};

/**
 * Replace every top-level <section class="... className ..."> block, respecting nested
 * <section> depth. A naive non-greedy </section> match stops at the first child section.
 *
 * @param {string} html
 * @param {string} className
 * @param {string} replacement
 * @returns {string}
 */
const replacePageSectionsByClass = (html, className, replacement) => {
    const openRe = new RegExp(
        `<section\\b[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`,
        'i'
    );
    const ranges = [];
    let searchFrom = 0;

    while (searchFrom < html.length) {
        const slice = html.slice(searchFrom);
        const openMatch = openRe.exec(slice);
        if (!openMatch) break;

        const absoluteOpen = searchFrom + openMatch.index;
        let cursor = absoluteOpen + openMatch[0].length;
        let depth = 1;

        while (cursor < html.length && depth > 0) {
            const rest = html.slice(cursor);
            const nextOpen = rest.search(/<section\b/i);
            const nextClose = rest.search(/<\/section>/i);
            if (nextClose === -1) {
                depth = 0;
                break;
            }
            if (nextOpen !== -1 && nextOpen < nextClose) {
                depth += 1;
                cursor += nextOpen + '<section'.length;
                continue;
            }
            depth -= 1;
            cursor += nextClose + '</section>'.length;
        }

        let rangeStart = absoluteOpen;
        while (rangeStart > 0 && /\s/.test(html[rangeStart - 1])) {
            rangeStart -= 1;
        }
        ranges.push([rangeStart, cursor]);
        searchFrom = cursor;
    }

    if (!ranges.length) {
        // No placeholder page — append before </body> when possible.
        if (/<\/body>/i.test(html)) {
            return html.replace(/<\/body>/i, `\n\n  ${replacement}\n</body>`);
        }
        return `${html}\n${replacement}`;
    }

    const firstStart = ranges[0][0];
    const lastEnd = ranges[ranges.length - 1][1];
    return `${html.slice(0, firstStart)}\n\n  ${replacement}\n${html.slice(lastEnd)}`;
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
