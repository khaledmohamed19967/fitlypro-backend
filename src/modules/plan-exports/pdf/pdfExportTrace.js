/**
 * Safe, structured timing for plan PDF export (no PII).
 */

import { randomUUID } from 'crypto';

/**
 * @param {import('express').Request|null|undefined} req
 * @returns {string}
 */
export const createPdfExportId = (req) => {
    const header =
        req?.headers?.['x-request-id'] ||
        req?.headers?.['x-vercel-id'] ||
        req?.headers?.['x-correlation-id'];
    if (typeof header === 'string' && header.trim()) {
        return header.trim().slice(0, 128);
    }
    return randomUUID();
};

/**
 * @param {object|null|undefined} exportModel
 */
export const summarizeExportModelMetrics = (exportModel) => {
    const days = Array.isArray(exportModel?.content?.workoutDays)
        ? exportModel.content.workoutDays
        : Array.isArray(exportModel?.content?.nutritionDays)
          ? exportModel.content.nutritionDays
          : [];

    let exerciseCount = 0;
    let warmupActivityCount = 0;
    let cardioActivityCount = 0;
    let remoteImageUrlCount = 0;
    const uniqueRemoteImages = new Set();

    for (const day of days) {
        const exercises = Array.isArray(day.exercises) ? day.exercises : [];
        const warmups = Array.isArray(day.warmupActivities) ? day.warmupActivities : [];
        const cardios = Array.isArray(day.cardioActivities) ? day.cardioActivities : [];
        exerciseCount += exercises.length;
        warmupActivityCount += warmups.length;
        cardioActivityCount += cardios.length;

        for (const row of [...exercises, ...warmups, ...cardios]) {
            const url =
                typeof row?.thumbnailUrl === 'string' ? row.thumbnailUrl.trim() : '';
            if (/^https?:\/\//i.test(url)) {
                remoteImageUrlCount += 1;
                uniqueRemoteImages.add(url);
            }
        }
    }

    return {
        planType: exportModel?.type ?? null,
        workoutDayCount: Array.isArray(exportModel?.content?.workoutDays)
            ? exportModel.content.workoutDays.length
            : 0,
        nutritionDayCount: Array.isArray(exportModel?.content?.nutritionDays)
            ? exportModel.content.nutritionDays.length
            : 0,
        exerciseCount,
        warmupActivityCount,
        cardioActivityCount,
        remoteImageUrlCount,
        uniqueRemoteImageCount: uniqueRemoteImages.size,
    };
};

/**
 * @param {string} html
 */
export const countElevateHtmlPages = (html) => {
    if (typeof html !== 'string' || !html) return 0;
    const matches = html.match(/class="[^"]*\bpage\b[^"]*"/g);
    return matches ? matches.length : 0;
};

/**
 * @param {string} exportId
 * @param {object} [baseMeta]
 */
export const createPdfExportTrace = (exportId, baseMeta = {}) => {
    const startedAt = Date.now();
    /** @type {Record<string, { ms: number, ok: boolean, detail?: object }>} */
    const stages = {};

    const log = (event, payload = {}) => {
        console.info(
            JSON.stringify({
                scope: 'plan-export',
                event,
                exportId,
                elapsedMs: Date.now() - startedAt,
                ...baseMeta,
                ...payload,
            })
        );
    };

    /**
     * @template T
     * @param {string} stage
     * @param {() => Promise<T>|T} fn
     * @param {object} [detail]
     * @returns {Promise<T>}
     */
    const time = async (stage, fn, detail = {}) => {
        const t0 = Date.now();
        try {
            const result = await fn();
            const ms = Date.now() - t0;
            stages[stage] = { ms, ok: true, detail };
            log('stage', { stage, ok: true, ms, ...detail });
            return result;
        } catch (error) {
            const ms = Date.now() - t0;
            stages[stage] = {
                ms,
                ok: false,
                detail: {
                    ...detail,
                    message: error instanceof Error ? error.message : String(error),
                },
            };
            log('stage', {
                stage,
                ok: false,
                ms,
                ...detail,
                message: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    };

    const finish = (payload = {}) => {
        log('complete', {
            totalMs: Date.now() - startedAt,
            stages,
            ...payload,
        });
    };

    const fail = (payload = {}) => {
        log('failed', {
            totalMs: Date.now() - startedAt,
            stages,
            ...payload,
        });
    };

    return {
        exportId,
        startedAt,
        stages,
        log,
        time,
        finish,
        fail,
        totalMs: () => Date.now() - startedAt,
    };
};

export default {
    createPdfExportId,
    createPdfExportTrace,
    summarizeExportModelMetrics,
    countElevateHtmlPages,
};
