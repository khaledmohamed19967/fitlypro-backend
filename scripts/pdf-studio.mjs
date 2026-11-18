/**
 * Launcher for the development-only PDF Template Studio.
 *
 * Usage: npm run pdf-studio
 *
 * This is the only supported external startup path. It calls startStudioServer(),
 * which applies the fail-closed environment allowlist and binds to 127.0.0.1 only.
 */

import { startStudioServer } from '../src/modules/plan-exports/studio/server.mjs';
import { STUDIO_REGISTRY_PHASE } from '../src/modules/plan-exports/studio/studio.registry.js';

startStudioServer()
    .then(({ url, host, port, runtime }) => {
        console.log(`FitlyPro PDF Template Studio (Phase ${STUDIO_REGISTRY_PHASE})`);
        console.log(`Env: ${runtime.resolvedEnv}`);
        console.log(`Bound: ${host}:${port}`);
        console.log(`Open: ${url}`);
        console.log('Phase C: live reload enabled for registered template assets/modules.');
    })
    .catch((err) => {
        console.error(err.message || err);
        process.exit(1);
    });
