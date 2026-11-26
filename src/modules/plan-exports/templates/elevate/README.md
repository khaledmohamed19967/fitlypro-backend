# Elevate (workout cover)

Single-page A4 cover template for workout plan PDF exports.

- Template id: `elevate`
- Plan types: `workout` only
- Renderer: Playwright Chromium via `pdf/htmlPdfRenderer.js`
- Design source: `html/` (`index.html`, `styles.css`, `images/`, `fonts/`)

Elevate is the only production PDF export template.

## Local development

Use the shared PDF Template Studio:

```bash
npm run pdf-studio
```

Open `http://127.0.0.1:8099/` (loopback only), choose plan type `workout`, template `elevate`, page `full`.

Use fixture `workout-basic` or a real plan JWT to preview HTML/PDF.

See [PDF_TEMPLATE_STUDIO.md](../../../../docs/plan-exports/PDF_TEMPLATE_STUDIO.md).
