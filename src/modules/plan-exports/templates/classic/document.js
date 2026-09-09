/**
 * Shared HTML document shell for classic templates.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { escapeHtml, formatGeneratedDate } from '../../pdf/htmlEscape.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES = readFileSync(join(__dirname, 'styles.css'), 'utf8');

/**
 * @param {{ label: string, value: string, subs?: string[] }[]} rows
 */
export const buildKeyValueTable = (rows) => {
    if (!rows.length) return '';

    const body = rows
        .map((row) => {
            const subs = (row.subs || [])
                .map((s) => `<div class="cell-sub">${escapeHtml(s)}</div>`)
                .join('');
            return `<tr>
        <th scope="row">${escapeHtml(row.label)}</th>
        <td>${escapeHtml(row.value)}${subs}</td>
      </tr>`;
        })
        .join('');

    return `<table class="table info-table">
    <tbody>${body}</tbody>
  </table>`;
};

/**
 * @param {{
 *   label: string,
 *   calories?: number|null,
 *   protein?: number|null,
 *   carbs?: number|null,
 *   fat?: number|null,
 *   formatNumber: (v: number, d?: number) => string|null,
 * }}[] rows
 */
export const buildMacroTable = (rows, formatNumber) => {
    if (!rows.length) return '';

    const cell = (value) => {
        const n = value != null ? formatNumber(value, 0) : null;
        return n == null ? '—' : escapeHtml(n);
    };

    const body = rows
        .map(
            (row) => `<tr>
        <th scope="row">${escapeHtml(row.label)}</th>
        <td class="num">${cell(row.calories)}</td>
        <td class="num">${cell(row.protein)}</td>
        <td class="num">${cell(row.carbs)}</td>
        <td class="num">${cell(row.fat)}</td>
      </tr>`
        )
        .join('');

    return `<table class="table macro-table">
    <thead>
      <tr>
        <th scope="col"></th>
        <th scope="col" class="num">Calories</th>
        <th scope="col" class="num">Protein (g)</th>
        <th scope="col" class="num">Carbs (g)</th>
        <th scope="col" class="num">Fat (g)</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
};

/**
 * @param {{
 *   title: string,
 *   planTypeLabel: string,
 *   planName: string,
 *   description?: string|null,
 *   bodyHtml: string,
 *   dir?: 'ltr'|'rtl',
 * }} opts
 */
export const wrapClassicDocument = (opts) => {
    const dir = opts.dir || 'ltr';
    const title = escapeHtml(opts.title || 'Fitly Plan');
    const planType = escapeHtml(opts.planTypeLabel || '');
    const planName = escapeHtml(opts.planName || '');
    const description = opts.description
        ? `<p class="plan-description">${escapeHtml(opts.description)}</p>`
        : '';
    const generated = escapeHtml(`Generated on ${formatGeneratedDate()}`);

    return `<!DOCTYPE html>
<html lang="en" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="doc">
    <header class="header">
      <div class="brand">FITLY PRO</div>
      <div class="generated">${generated}</div>
    </header>

    <h1 class="plan-title">${planName}</h1>
    <p class="plan-type">${planType}</p>
    ${description}

    ${opts.bodyHtml || ''}

    <footer class="doc-footer">www.fitlypro.com</footer>
  </div>
</body>
</html>`;
};
