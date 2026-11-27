/**
 * Stage-level tracing for plan PDF exports.
 * Logs safe metrics only — never client PII or plan content.
 */

import { randomUUID } from 'crypto';

/** Default app deadline: below Vercel `maxDuration: 60` with response-flush margin. */
export const DEFAULT_PDF_EXPORT_DEADLINE_MS = 50_000;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export const resolvePdfExportDeadlineMs = (env = process.env) => {
    const raw = env.PDF_EXPORT_DEADLINE_MS;
    if (raw == null || raw === '') return DEFAULT_PDF_EXPORT_DEADLINE_MS;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 5_000) return DEFAULT_PDF_EXPORT_DEADLINE_MS;
    return Math.floor(n);
};

/**
 * @param {string} [incoming]
 * @returns {string}
 */
export const createExportId = (incoming) => {
    const trimmed = typeof incoming === 'string' ? incoming.trim() : '';
    if (trimmed && /^[A-Za-z0-9_-]{8,64}$/.test(trimmed)) return trimmed;
    return randomUUID();
};

/**
 * @param {{
 *   exportId: string,
 *   planType: 'workout'|'nutrition'|string,
 *   templateId?: string,
 *   deadlineMs?: number,
 * }} opts
 */
export const createPdfExportTrace = (opts) => {
    const exportId = opts.exportId;
    const planType = opts.planType;
    const templateId = opts.templateId || 'elevate';
    const deadlineMs =
        opts.deadlineMs ?? resolvePdfExportDeadlineMs();
    const startedAt = Date.now();
    const deadlineAt = startedAt + deadlineMs;
    /** @type {Array<{ stage: string, ms: number, at: number, meta?: Record<string, unknown> }>} */
    const stages = [];
    let lastAt = startedAt;
    let finished = false;
    let failureStage = null;

    const base = () => ({
        exportId,
        planType,
        templateId,
        deadlineMs,
    });

    const mark = (stage, meta) => {
        const at = Date.now();
        const ms = at - lastAt;
        lastAt = at;
        const entry = {
            stage,
            ms,
            at,
            ...(meta && typeof meta === 'object' ? { meta: sanitizeMeta(meta) } : {}),
        };
        stages.push(entry);
        console.info('[pdf-export]', {
            ...base(),
            event: 'stage',
            stage,
            stageMs: ms,
            elapsedMs: at - startedAt,
            remainingMs: Math.max(0, deadlineAt - at),
            ...(entry.meta ? { meta: entry.meta } : {}),
        });
        return entry;
    };

    const remainingMs = () => Math.max(0, deadlineAt - Date.now());

    const isExpired = () => Date.now() >= deadlineAt;

    /**
     * Always emit a terminal log (success or failure), including deadline cases.
     * @param {{ ok: boolean, error?: unknown, extra?: Record<string, unknown> }} result
     */
    const finish = (result) => {
        if (finished) return;
        finished = true;
        const at = Date.now();
        const totalMs = at - startedAt;
        const ok = Boolean(result?.ok);
        const err = result?.error;
        const phase =
            (err && typeof err === 'object' && 'pdfPhase' in err && err.pdfPhase) ||
            failureStage ||
            (ok ? null : 'unknown');

        if (!ok && phase) {
            failureStage = String(phase);
        }

        console[ok ? 'info' : 'error']('[pdf-export]', {
            ...base(),
            event: ok ? 'complete' : 'failed',
            ok,
            totalMs,
            deadlineHit: !ok && (phase === 'deadline' || isExpired()),
            failureStage: failureStage || null,
            stages: stages.map((s) => ({
                stage: s.stage,
                ms: s.ms,
                ...(s.meta ? { meta: s.meta } : {}),
            })),
            ...(result?.extra && typeof result.extra === 'object'
                ? sanitizeMeta(result.extra)
                : {}),
            ...(err
                ? {
                      errorMessage:
                          err instanceof Error ? err.message : String(err),
                      pdfPhase:
                          err && typeof err === 'object' && 'pdfPhase' in err
                              ? err.pdfPhase
                              : undefined,
                  }
                : {}),
        });
    };

    const setFailureStage = (stage) => {
        failureStage = stage;
    };

    console.info('[pdf-export]', {
        ...base(),
        event: 'start',
        startedAt,
        deadlineAt,
    });

    return {
        exportId,
        planType,
        templateId,
        startedAt,
        deadlineAt,
        deadlineMs,
        mark,
        remainingMs,
        isExpired,
        finish,
        setFailureStage,
        getStages: () => stages.slice(),
    };
};

/**
 * Strip accidental sensitive keys from meta payloads.
 * @param {Record<string, unknown>} meta
 */
const sanitizeMeta = (meta) => {
    const blocked = new Set([
        'name',
        'fullName',
        'email',
        'phone',
        'client',
        'clientName',
        'notes',
        'instruction',
        'foodItems',
        'meals',
        'html',
        'buffer',
    ]);
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, value] of Object.entries(meta)) {
        if (blocked.has(key)) continue;
        if (typeof value === 'string' && value.length > 200) {
            out[key] = `[string:${value.length}]`;
            continue;
        }
        if (
            typeof value === 'number' ||
            typeof value === 'boolean' ||
            value == null
        ) {
            out[key] = value;
            continue;
        }
        if (Array.isArray(value)) {
            out[key] = { length: value.length };
            continue;
        }
        if (typeof value === 'object') {
            out[key] = { keys: Object.keys(value).length };
            continue;
        }
    }
    return out;
};

export default {
    createPdfExportTrace,
    createExportId,
    resolvePdfExportDeadlineMs,
    DEFAULT_PDF_EXPORT_DEADLINE_MS,
};
