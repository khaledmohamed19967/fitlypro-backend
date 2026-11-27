# Plan PDF Export

## Architecture

```
POST /api/v1/plan-exports
  → validate (planType, planId, templateId)
  → load plan via existing workout/nutrition services (auth unchanged)
  → normalize export DTO
  → template registry
  → HTML template builder
  → Playwright Chromium PDF
  → application/pdf binary
```

## Renderer (current)

| Layer | Technology |
|-------|------------|
| Templates | HTML + CSS (`templates/elevate/`) |
| Browser | Playwright Chromium (local) / `@sparticuz/chromium` (Vercel) |
| Output | A4 PDF (`printBackground`, CSS `@page`) |

**Supported template:** `elevate` only (workout + nutrition).

## Add a new template

1. Create `src/modules/plan-exports/templates/<id>/` with CSS + HTML builders.
2. Register renderers in `templates/index.js`.
3. Add metadata in `plan-export.constants.js`.
4. Add Studio pages in `studio/studio.registry.js`.
5. Add tests in `scripts/test-plan-exports.mjs`.

## API

```http
GET  /api/v1/plan-exports/templates?planType=nutrition
POST /api/v1/plan-exports
Content-Type: application/json

{ "planType": "nutrition", "planId": "...", "templateId": "elevate" }
```

Response: `Content-Type: application/pdf` + `Content-Disposition: attachment; filename="..."`.

Requests with `templateId: "classic"` (or any unknown id) are rejected with HTTP 400.

## Ops notes

- Local: `playwright` + `npx playwright install chromium`
- Production (Vercel): `playwright-core` + `@sparticuz/chromium` (see `htmlPdfRenderer.js`)
- Vercel: keep legacy `builds`/`routes` so Express receives the original request path (not `/server.js`); `maxDuration` 60s + `memory` 1024 via **both** `server.js` `export const config` and `builds[].config` (builds config is what `@vercel/node` reliably applies); Elevate assets via `builds[].config.includeFiles`
- Soft render deadline: `PDF_EXPORT_DEADLINE_MS` (default 50000) races the full Playwright render; timed-out exports return HTTP 504 and close the page without tearing down in-use shared browsers
- Structured stage logs: JSON lines with `scope: "plan-export"` + `exportId` (also returned as `X-Export-Id`)
- Frontend export modal loads templates from the API (Elevate only)
