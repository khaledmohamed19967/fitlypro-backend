/**
 * Development-only environment guard for the PDF Template Studio.
 *
 * Fail-closed allowlist: only recognized safe local environments may start.
 * Does not import the main application config (avoids dotenv/DB side effects).
 */

/** Environments explicitly allowed to run the Studio. */
export const STUDIO_ALLOWED_ENVS = Object.freeze(['development', 'test']);

const PRODUCTION_LIFECYCLES = Object.freeze([
    'env:production',
    'start:production',
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
const readEnvString = (value) =>
    typeof value === 'string' ? value.trim() : '';

/**
 * Classify a single env string.
 * Empty string means "unset" (project config defaults missing NODE_ENV/APP_NODE_ENV
 * to development — Studio applies the same explicit default only when both are unset).
 *
 * @param {string} value
 * @returns {'unset'|'allowed'|'production'|'unknown'}
 */
const classifyEnvValue = (value) => {
    if (!value) return 'unset';
    if (value === 'production') return 'production';
    if (STUDIO_ALLOWED_ENVS.includes(value)) return 'allowed';
    return 'unknown';
};

/**
 * Resolve Studio runtime environment with fail-closed semantics.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{
 *   allowed: boolean,
 *   isProduction: boolean,
 *   reason: string|null,
 *   resolvedEnv: string|null,
 * }}
 */
export const resolveStudioRuntimeEnv = (env = process.env) => {
    const nodeEnv = readEnvString(env.NODE_ENV);
    const appNodeEnv = readEnvString(env.APP_NODE_ENV);
    const lifecycle = readEnvString(env.npm_lifecycle_event);

    if (PRODUCTION_LIFECYCLES.includes(lifecycle)) {
        return {
            allowed: false,
            isProduction: true,
            reason: `npm_lifecycle_event=${lifecycle}`,
            resolvedEnv: 'production',
        };
    }

    const nodeClass = classifyEnvValue(nodeEnv);
    const appClass = classifyEnvValue(appNodeEnv);

    if (nodeClass === 'production') {
        return {
            allowed: false,
            isProduction: true,
            reason: 'NODE_ENV=production',
            resolvedEnv: 'production',
        };
    }

    if (appClass === 'production') {
        return {
            allowed: false,
            isProduction: true,
            reason: 'APP_NODE_ENV=production',
            resolvedEnv: 'production',
        };
    }

    if (nodeClass === 'unknown') {
        return {
            allowed: false,
            isProduction: false,
            reason: `NODE_ENV=${nodeEnv} is not an allowed Studio environment`,
            resolvedEnv: nodeEnv,
        };
    }

    if (appClass === 'unknown') {
        return {
            allowed: false,
            isProduction: false,
            reason: `APP_NODE_ENV=${appNodeEnv} is not an allowed Studio environment`,
            resolvedEnv: appNodeEnv,
        };
    }

    // Both unset → project convention defaults to development.
    if (nodeClass === 'unset' && appClass === 'unset') {
        return {
            allowed: true,
            isProduction: false,
            reason: null,
            resolvedEnv: 'development',
        };
    }

    const resolvedEnv = nodeClass === 'allowed' ? nodeEnv : appNodeEnv;
    return {
        allowed: true,
        isProduction: false,
        reason: null,
        resolvedEnv,
    };
};

/**
 * Throw unless Studio may start in this environment.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 */
export const assertStudioStartupAllowed = (env = process.env) => {
    const resolved = resolveStudioRuntimeEnv(env);
    if (!resolved.allowed) {
        const detail = resolved.reason || 'environment not allowed';
        throw new Error(
            `PDF Template Studio refuses to start (${detail}). Allowed: ${STUDIO_ALLOWED_ENVS.join(', ')} (or both NODE_ENV and APP_NODE_ENV unset → development).`
        );
    }
    return resolved;
};

export default {
    STUDIO_ALLOWED_ENVS,
    resolveStudioRuntimeEnv,
    assertStudioStartupAllowed,
};
