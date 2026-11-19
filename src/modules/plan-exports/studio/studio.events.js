/**
 * Studio SSE hub — reload notifications only (no plan/JWT/HTML/PDF/paths).
 */

/** @typedef {{ type: string, templateId?: string|null, category?: string|null, revision: number, at: string, message?: string|null }} StudioEvent */

/** @type {Set<import('http').ServerResponse>} */
const clients = new Set();

/** @type {Map<import('http').ServerResponse, NodeJS.Timeout>} */
const keepAlives = new Map();

let revision = 0;

const nextRevision = () => {
    revision += 1;
    return revision;
};

const detachClient = (res) => {
    const keepAlive = keepAlives.get(res);
    if (keepAlive) clearInterval(keepAlive);
    keepAlives.delete(res);
    clients.delete(res);
};

/**
 * @param {import('http').ServerResponse} res
 */
export const subscribeStudioEvents = (res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    clients.add(res);

    const keepAlive = setInterval(() => {
        if (res.writableEnded) return;
        try {
            res.write(': keepalive\n\n');
        } catch {
            detachClient(res);
        }
    }, 25000);
    keepAlives.set(res, keepAlive);

    const cleanup = () => detachClient(res);
    res.on('close', cleanup);
    res.on('error', cleanup);

    broadcastStudioEvent({
        type: 'ready',
        templateId: null,
        category: null,
        message: null,
    });
};

/**
 * @param {{ type: string, templateId?: string|null, category?: string|null, message?: string|null }} partial
 */
export const broadcastStudioEvent = (partial) => {
    /** @type {StudioEvent} */
    const payload = {
        type: partial.type,
        templateId: partial.templateId ?? null,
        category: partial.category ?? null,
        revision: nextRevision(),
        at: new Date().toISOString(),
        message: partial.message ?? null,
    };

    // Safety: never include paths/tokens/html
    const json = JSON.stringify(payload);
    if (
        /Bearer\s/i.test(json) ||
        /[A-Za-z]:\\/.test(json) ||
        json.includes('file://') ||
        json.includes('<!DOCTYPE')
    ) {
        return payload;
    }

    const frame = `event: studio\ndata: ${json}\n\n`;
    for (const client of [...clients]) {
        if (client.writableEnded) {
            detachClient(client);
            continue;
        }
        try {
            client.write(frame);
        } catch {
            detachClient(client);
        }
    }

    return payload;
};

export const getStudioEventClientCount = () => clients.size;

export const closeAllStudioEvents = () => {
    for (const client of [...clients]) {
        detachClient(client);
        try {
            client.end();
        } catch {
            // ignore
        }
    }
};

export default {
    subscribeStudioEvents,
    broadcastStudioEvent,
    getStudioEventClientCount,
    closeAllStudioEvents,
};
