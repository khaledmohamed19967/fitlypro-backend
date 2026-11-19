/**
 * Independent development-only PDF Template Studio server (Phase C).
 *
 * Discovery + HTML/PDF preview + live reload (SSE + generic watcher).
 */

import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { assertStudioStartupAllowed } from './studio.env.js';
import {
    listStudioTemplates,
    resolveStudioPages,
    STUDIO_REGISTRY_PHASE,
    normalizeStudioPlanType,
    ELEVATE_HTML_ASSET_MOUNT,
} from './studio.registry.js';
import { listStudioFixtures } from './studio.fixtures.js';
import { validateStudioPreviewBody } from './studio.validator.js';
import {
    authenticateStudioUser,
    extractBearerToken,
} from './studio.auth.js';
import { createStudioPreview } from './studio.service.js';
import { ApiError } from '../../../utils/ApiError.js';
import {
    closeAllStudioEvents,
    subscribeStudioEvents,
} from './studio.events.js';
import { startStudioWatcher } from './studio.watch.js';
import {
    ELEVATE_HTML_DIR,
    ELEVATE_HTML_ENTRY_NAME,
} from '../templates/elevate/page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const DEFAULT_PORT = 8099;
/** Studio listens on loopback only — never all interfaces. */
export const STUDIO_BIND_HOST = '127.0.0.1';
/** Browser URL for the author's raw HTML design entry. */
export const ELEVATE_HTML_PREVIEW_PATH = `${ELEVATE_HTML_ASSET_MOUNT}/${ELEVATE_HTML_ENTRY_NAME}`;
const sendJson = (res, status, payload) => {
    res.status(status).json(payload);
};

const sendError = (res, status, message) => {
    sendJson(res, status, {
        success: false,
        message,
        phase: STUDIO_REGISTRY_PHASE,
    });
};

const mapPreviewError = (err) => {
    if (err instanceof ApiError) {
        return { status: err.statusCode || 500, message: err.message };
    }
    if (err?.statusCode) {
        return { status: err.statusCode, message: err.message };
    }
    return { status: 500, message: 'Preview failed' };
};

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string|undefined } | { ok: false, message: string }}
 */
const readPlanTypeQuery = (value) => {
    if (value == null || value === '') {
        return { ok: true, value: undefined };
    }
    if (Array.isArray(value)) {
        return { ok: false, message: 'planType must be a single string value' };
    }
    if (typeof value !== 'string') {
        return { ok: false, message: 'planType must be a string' };
    }
    return { ok: true, value };
};

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 */
export const createStudioApp = (options = {}) => {
    assertStudioStartupAllowed(options.env ?? process.env);

    const app = express();

    app.disable('x-powered-by');
    app.use(express.json({ limit: '32kb' }));

    app.get('/api/studio/health', (_req, res) => {
        sendJson(res, 200, {
            success: true,
            data: {
                service: 'pdf-template-studio',
                phase: STUDIO_REGISTRY_PHASE,
                previewAvailable: true,
                liveReload: true,
            },
        });
    });

    app.get('/api/studio/events', (req, res) => {
        subscribeStudioEvents(res);
    });

    app.get('/api/studio/templates', (req, res) => {
        const planTypeQuery = readPlanTypeQuery(req.query.planType);
        if (!planTypeQuery.ok) {
            return sendError(res, 400, planTypeQuery.message);
        }

        const result = listStudioTemplates(planTypeQuery.value);
        if (!result.ok) {
            return sendError(res, result.status, result.message);
        }

        return sendJson(res, 200, {
            success: true,
            message: 'Studio templates retrieved',
            data: {
                phase: STUDIO_REGISTRY_PHASE,
                previewAvailable: true,
                planTypes: result.planTypes,
                templates: result.templates,
            },
        });
    });

    app.get('/api/studio/templates/:templateId/pages', (req, res) => {
        const planTypeQuery = readPlanTypeQuery(req.query.planType);
        if (!planTypeQuery.ok) {
            return sendError(res, 400, planTypeQuery.message);
        }
        if (planTypeQuery.value == null) {
            return sendError(res, 400, 'planType query parameter is required');
        }

        const result = resolveStudioPages(
            req.params.templateId,
            planTypeQuery.value
        );
        if (!result.ok) {
            return sendError(res, result.status, result.message);
        }

        return sendJson(res, 200, {
            success: true,
            message: 'Studio pages retrieved',
            data: {
                phase: STUDIO_REGISTRY_PHASE,
                previewAvailable: true,
                templateId: result.templateId,
                name: result.name,
                description: result.description,
                planType: result.planType,
                pages: result.pages,
                defaultPageId: result.defaultPageId,
            },
        });
    });

    app.get('/api/studio/fixtures', (req, res) => {
        const planTypeQuery = readPlanTypeQuery(req.query.planType);
        if (!planTypeQuery.ok) {
            return sendError(res, 400, planTypeQuery.message);
        }
        if (
            planTypeQuery.value != null &&
            !normalizeStudioPlanType(planTypeQuery.value)
        ) {
            return sendError(res, 400, 'Invalid plan type');
        }

        return sendJson(res, 200, {
            success: true,
            message: 'Studio fixtures retrieved',
            data: {
                fixtures: listStudioFixtures(planTypeQuery.value),
            },
        });
    });

    app.post('/api/studio/preview', async (req, res) => {
        try {
            const { error, value } = validateStudioPreviewBody.validate(
                req.body,
                {
                    abortEarly: false,
                    stripUnknown: false,
                    convert: true,
                }
            );

            if (error) {
                const message =
                    error.details?.[0]?.message || 'Validation failed';
                return sendError(res, 400, message);
            }

            if (
                Object.prototype.hasOwnProperty.call(req.body || {}, 'trainerId')
            ) {
                return sendError(
                    res,
                    400,
                    'trainerId is not accepted; identity comes from Authorization'
                );
            }

            const pages = resolveStudioPages(value.templateId, value.planType);
            if (!pages.ok) {
                return sendError(res, pages.status, pages.message);
            }
            if (!pages.pages.some((page) => page.id === value.pageId)) {
                return sendError(res, 400, 'Unknown page id');
            }

            let trainerId = null;
            if (value.source === 'plan') {
                const token = extractBearerToken(req.headers.authorization);
                const user = await authenticateStudioUser(token);
                trainerId = user.id;
            }

            const result = await createStudioPreview({
                ...value,
                trainerId,
            });

            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Pragma', 'no-cache');

            if (result.format === 'html') {
                res.setHeader('Content-Type', result.mimeType);
                return res.status(200).send(result.html);
            }

            res.setHeader('Content-Type', result.mimeType);
            res.setHeader(
                'Content-Disposition',
                `inline; filename="${result.filename || 'preview.pdf'}"`
            );
            res.setHeader('Content-Length', result.buffer.length);
            return res.status(200).send(result.buffer);
        } catch (err) {
            const mapped = mapPreviewError(err);
            return sendError(res, mapped.status, mapped.message);
        }
    });

    // Author's raw design folder — relative CSS/images/fonts resolve here.
    app.use(
        ELEVATE_HTML_ASSET_MOUNT,
        express.static(ELEVATE_HTML_DIR, {
            index: ELEVATE_HTML_ENTRY_NAME,
            fallthrough: false,
            setHeaders: (res) => {
                res.setHeader('Cache-Control', 'no-store');
            },
        })
    );
    app.use(express.static(PUBLIC_DIR, { index: 'index.html', fallthrough: true }));

    app.get('/', (_req, res) => {
        res.sendFile(join(PUBLIC_DIR, 'index.html'));
    });

    app.use((req, res) => {
        if (req.path.startsWith('/api/')) {
            return sendError(res, 404, 'Studio API route not found');
        }
        return res.status(404).send('Not found');
    });

    return app;
};

/**
 * @param {{ port?: number, env?: NodeJS.ProcessEnv, enableWatcher?: boolean }} [options]
 */
export const startStudioServer = async (options = {}) => {
    const env = options.env ?? process.env;
    const runtime = assertStudioStartupAllowed(env);

    const rawPort = options.port ?? env.PDF_STUDIO_PORT ?? DEFAULT_PORT;
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(
            `Invalid PDF Studio port: ${rawPort}. Use an integer 1–65535.`
        );
    }

    const app = createStudioApp({ env });
    const host = STUDIO_BIND_HOST;
    const enableWatcher = options.enableWatcher !== false;

    const watcher = enableWatcher ? startStudioWatcher() : null;

    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(port, host, () => resolve(instance));
        instance.on('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        watcher?.close();
        await new Promise((resolve) => server.close(() => resolve()));
        throw new Error('PDF Template Studio failed to resolve bind address');
    }

    if (address.address !== host && address.address !== '::ffff:127.0.0.1') {
        watcher?.close();
        await new Promise((resolve) => server.close(() => resolve()));
        throw new Error(
            `PDF Template Studio refused non-loopback bind (${address.address})`
        );
    }

    const resolvedPort = address.port;
    const url = `http://${host}:${resolvedPort}/`;

    return {
        app,
        server,
        host,
        port: resolvedPort,
        address: address.address,
        url,
        runtime,
        watcher,
        close: async () => {
            watcher?.close();
            closeAllStudioEvents();
            await new Promise((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            });
        },
    };
};

export default {
    createStudioApp,
    startStudioServer,
    DEFAULT_PORT,
    STUDIO_BIND_HOST,
};
