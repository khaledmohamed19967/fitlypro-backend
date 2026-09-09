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
| Templates | HTML + CSS (`templates/classic/`) |
| Browser | Playwright Chromium |
| Output | A4 PDF (`printBackground`, CSS `@page`) |

**Removed:** `SimplePdfDocument` (manual Helvetica x/y positioning).

## Classic template layout

**Nutrition** uses the `fitlypro-template` layout with print-polished CSS: `@page { margin: 0 }`, content padding on `.page`, Playwright PDF margins set to `0` for nutrition only (single margin source). Typography uses `pt`; borders use `px`.

**Workout** uses the simple table layout (`styles.css`).

## Add a new template

1. Create `src/modules/plan-exports/templates/<id>/` with CSS + HTML builders.
2. Register renderers in `templates/index.js`.
3. Add metadata in `plan-export.constants.js`.
4. Add tests in `scripts/test-plan-exports.mjs`.

## API (unchanged)

```http
GET  /api/v1/plan-exports/templates?planType=nutrition
POST /api/v1/plan-exports
Content-Type: application/json

{ "planType": "nutrition", "planId": "...", "templateId": "classic" }
```

Response: `Content-Type: application/pdf` + `Content-Disposition: attachment; filename="..."`.

## Ops notes

- Dependency: `playwright`
- Install browser once: `npx playwright install chromium`
- Frontend export modal/flow is unchanged
