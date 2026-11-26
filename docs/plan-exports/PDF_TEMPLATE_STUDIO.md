# PDF Template Studio (Phase C)

Development-only workspace for discovering and previewing FitlyPro PDF templates with live reload.

## Start

```bash
npm run pdf-studio
```

Open: [http://127.0.0.1:8099/](http://127.0.0.1:8099/)

Port override: `PDF_STUDIO_PORT=8100 npm run pdf-studio`

The server **binds to `127.0.0.1` only**. There is no host override.

## Environment (fail-closed)

Allowed:

- `NODE_ENV` / `APP_NODE_ENV` = `development` or `test`
- Both unset → treated as `development`

Refused: `production`, unknown values (`staging`, `Production`, …), production npm lifecycles, and any conflict involving production/unknown.

## Startup boundary

- Supported entry: `npm run pdf-studio` → `scripts/pdf-studio.mjs` → `startStudioServer()`
- `createStudioApp()` also runs the environment guard
- Importing `server.mjs` does not listen

## Phase C supports

- Template / page discovery
- Fixture HTML + PDF preview (no auth, no MongoDB)
- Real-plan HTML + PDF preview with trainer/admin JWT + ownership checks
- Same production HTML builders and Playwright renderer
- Generic live reload for registered template JS/CSS/images via SSE

## Not available yet

- Logical multi-page fragmentation beyond registered `full` pages

## Live reload

- Watches registry `watchDir` roots only (never client paths)
- `GET /api/studio/events` streams `{ type, templateId, category, revision, at }` only
- JS changes → cache-busted module import (last-good retained on failure)
- CSS/image changes → next HTML build re-reads assets (Phase B.1)
- UI refreshes the active preview for the selected template without clearing the last success on failure

## Elevate design

**Single source of truth:** `templates/elevate/html/` (`index.html`, `styles.css`, `images/`, `fonts/`).

- Production export and Studio both use `templates/elevate/page.js`.
- Dynamic plan fields are injected into the HTML; CSS/images/fonts come from `html/`.
- Legacy `cover.css` markup is disconnected from the active flow.
- Raw design files are also mounted at `/studio-assets/elevate/html/` for inspection.

## Auth (real plans)

- Paste a trainer/admin JWT in the UI (`type="text"`, `autocomplete="off"`; kept in memory only; never stored; sent as `Authorization: Bearer …`)
- Identity is derived via shared `verifyAccessToken` (same JWT secret + user lookup as production `protect`)
- Studio surfaces inactive/wrong-role as 403; production `protect` still maps verification failures to 401 (legacy)
- `trainerId` in the request body is rejected
- HTML preview iframe uses an empty `sandbox` (no `allow-same-origin`, no `allow-scripts`); PDF uses a separate frame

## Fixtures

Allowlisted ids only:

- `workout-basic`
- `nutrition-basic`

Files live under `studio/fixtures/`. Clients pass fixture ids, never paths.

## Preview API

```http
POST /api/studio/preview
Content-Type: application/json
Authorization: Bearer <jwt>   # required when source=plan
```

Fixture:

```json
{
  "planType": "workout",
  "source": "fixture",
  "fixtureId": "workout-basic",
  "templateId": "elevate",
  "pageId": "full",
  "format": "html"
}
```

Real plan:

```json
{
  "planType": "workout",
  "source": "plan",
  "planId": "VALID_OBJECT_ID",
  "templateId": "elevate",
  "pageId": "full",
  "format": "pdf"
}
```

Responses use `Cache-Control: no-store`. HTML returns `text/html`; PDF returns `application/pdf` inline.

Production export uses the same Elevate builder via `POST /api/v1/plan-exports` with `templateId: "elevate"`.

## Register a template/page

1. Production metadata in `plan-export.constants.js` + renderer in `templates/index.js`
2. Studio pages in `studio/studio.registry.js` (`STUDIO_PAGES`)
3. Add trusted `STUDIO_TEMPLATE_SOURCES` watch/module metadata for the template
4. Restart Studio once so the new registry entry is loaded (subsequent JS/CSS/image edits live-reload)

## Tests

```bash
npm run test:pdf-studio
node scripts/test-plan-exports.mjs
```
