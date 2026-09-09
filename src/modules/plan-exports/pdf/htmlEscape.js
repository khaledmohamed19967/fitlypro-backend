/**
 * HTML escaping and tiny template helpers for plan PDF exports.
 */

/**
 * Escape user-controlled text for safe HTML insertion.
 *
 * @param {unknown} value
 * @returns {string}
 */
export const escapeHtml = (value) => {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export const formatLabel = (value) => {
    if (value == null || value === '') return null;
    return String(value)
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
};

/**
 * @param {unknown} value
 * @param {number} [digits]
 * @returns {string|null}
 */
export const formatNumber = (value, digits = 0) => {
    if (value == null || value === '' || Number.isNaN(Number(value))) return null;
    return Number(value).toFixed(digits);
};

/**
 * @param {unknown} value
 * @param {number} [digits]
 * @returns {string|null}
 */
export const formatNumberGrouped = (value, digits = 0) => {
    const formatted = formatNumber(value, digits);
    if (formatted == null) return null;
    const [whole, fraction] = formatted.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction != null ? `${grouped}.${fraction}` : grouped;
};

/**
 * @param {object|null|undefined} macros
 * @param {string[]} keys
 * @returns {number|null}
 */
export const pickMacro = (macros, keys) => {
    if (!macros) return null;
    for (const key of keys) {
        if (macros[key] != null && macros[key] !== '') {
            const n = Number(macros[key]);
            return Number.isNaN(n) ? null : n;
        }
    }
    return null;
};

/**
 * Replace {{tokens}} in a template string with escaped values by default.
 * Pass raw:true for pre-sanitized HTML fragments only.
 *
 * @param {string} template
 * @param {Record<string, unknown>} values
 * @returns {string}
 */
export const interpolate = (template, values) => {
    return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
        const value = values[key];
        if (value == null) return '';
        return String(value);
    });
};

/**
 * Format date for PDF header.
 *
 * @param {Date} [date]
 */
export const formatGeneratedDate = (date = new Date()) =>
    date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
