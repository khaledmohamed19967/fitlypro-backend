/**
 * Generic Studio filesystem watcher driven by registry watch roots.
 */

import { watch } from 'fs';
import { extname, resolve, sep } from 'path';
import { listStudioWatchRoots } from './studio.registry.js';
import { reloadStudioTemplateModules } from './studio.modules.js';
import { broadcastStudioEvent } from './studio.events.js';

const ASSET_EXTS = new Set([
    '.css',
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.svg',
]);
const MODULE_EXTS = new Set(['.js', '.mjs', '.cjs']);

/**
 * @param {string} filename
 * @returns {'module'|'assets'|null}
 */
export const classifyStudioWatchFile = (filename) => {
    if (!filename || typeof filename !== 'string') return null;
    // Ignore dotfiles / dotdirs (e.g. .DS_Store, .git)
    if (filename.split(/[/\\]/).some((part) => part.startsWith('.'))) {
        return null;
    }
    const ext = extname(filename).toLowerCase();
    if (MODULE_EXTS.has(ext)) return 'module';
    if (ASSET_EXTS.has(ext)) return 'assets';
    return null;
};

/**
 * @param {string} watchDir
 * @param {string} filename
 */
export const isPathInsideWatchDir = (watchDir, filename) => {
    const absolute = resolve(watchDir, filename);
    const root = resolve(watchDir);
    return absolute === root || absolute.startsWith(root + sep);
};

/**
 * @param {{
 *   roots?: { templateId: string, watchDir: string }[],
 *   debounceMs?: number,
 *   onEvent?: (event: object) => void,
 *   reloadModules?: typeof reloadStudioTemplateModules,
 * }} [options]
 */
export const startStudioWatcher = (options = {}) => {
    const roots = options.roots ?? listStudioWatchRoots();
    const debounceMs = options.debounceMs ?? 120;
    const onEvent = options.onEvent ?? broadcastStudioEvent;
    const reloadModules =
        options.reloadModules ?? reloadStudioTemplateModules;

    /** @type {Map<string, ReturnType<typeof setTimeout>>} */
    const timers = new Map();
    /** @type {import('fs').FSWatcher[]} */
    const watchers = [];
    let closed = false;

    const schedule = (templateId, category) => {
        const key = `${templateId}:${category}`;
        const existing = timers.get(key);
        if (existing) clearTimeout(existing);

        timers.set(
            key,
            setTimeout(async () => {
                timers.delete(key);
                if (closed) return;

                try {
                    if (category === 'module') {
                        const result = await reloadModules(templateId);
                        if (result.ok) {
                            onEvent({
                                type: 'module',
                                templateId,
                                category: 'module',
                                message: null,
                            });
                        } else {
                            onEvent({
                                type: 'error',
                                templateId,
                                category: 'module',
                                message:
                                    result.message ||
                                    'Template module reload failed',
                            });
                        }
                        return;
                    }

                    onEvent({
                        type: 'assets',
                        templateId,
                        category: 'assets',
                        message: null,
                    });
                } catch (err) {
                    onEvent({
                        type: 'error',
                        templateId,
                        category,
                        message: err?.message || 'Watcher handler failed',
                    });
                }
            }, debounceMs)
        );
    };

    for (const root of roots) {
        try {
            const watcher = watch(
                root.watchDir,
                { recursive: true },
                (eventType, filename) => {
                    if (closed) return;
                    if (!filename) return;
                    const name = String(filename);
                    if (!isPathInsideWatchDir(root.watchDir, name)) return;

                    const category = classifyStudioWatchFile(name);
                    if (!category) return;

                    schedule(root.templateId, category);
                }
            );

            watcher.on('error', () => {
                // Missing/recreated directories should not crash Studio.
                onEvent({
                    type: 'error',
                    templateId: root.templateId,
                    category: null,
                    message: 'Template watch error (will continue)',
                });
            });

            watchers.push(watcher);
        } catch (err) {
            onEvent({
                type: 'error',
                templateId: root.templateId,
                category: null,
                message: err?.message || 'Failed to watch template directory',
            });
        }
    }

    onEvent({
        type: 'ready',
        templateId: null,
        category: null,
        message: `Watching ${roots.length} template root(s)`,
    });

    return {
        roots,
        close: () => {
            closed = true;
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
            for (const watcher of watchers) {
                try {
                    watcher.close();
                } catch {
                    // ignore
                }
            }
            watchers.length = 0;
        },
    };
};

export default {
    classifyStudioWatchFile,
    isPathInsideWatchDir,
    startStudioWatcher,
};
