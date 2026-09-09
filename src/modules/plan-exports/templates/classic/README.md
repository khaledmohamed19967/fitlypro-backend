/**
 * Classic HTML shells (reference).
 *
 * Runtime rendering builds documents via:
 * - nutrition.js / workout.js (body from export DTO)
 * - document.js (shared shell + styles.css)
 * - pdf/htmlPdfRenderer.js (Playwright Chromium)
 *
 * To add a new template (e.g. modern):
 * 1. Create templates/modern/ with styles + builders
 * 2. Register renderers in templates/index.js
 * 3. Add metadata in plan-export.constants.js
 * 4. Add tests
 */
