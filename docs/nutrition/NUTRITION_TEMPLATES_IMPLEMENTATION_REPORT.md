# Nutrition Templates + Clone Implementation Report

> **Phase:** 5 — System nutrition templates + clone  
> **Status:** Implemented  
> **Date:** 2026-08-25  
> **Design reference:** `docs/nutrition/NUTRITION_BACKEND_DOMAIN_DESIGN.md`

---

## Phase

Phase 5 adds eight system-owned NutritionPlan templates (seeded, idempotent) and a clone endpoint so trainers can copy templates into editable trainer-owned plans.

**Not implemented:** assignments, versions, frontend, nutrition builder.

---

## System Templates

**Count:** 8/8

| templateKey | Name | Goal |
|-------------|------|------|
| `weight-loss-beginner` | Weight Loss — Beginner | weight_loss |
| `weight-loss-high-protein` | Weight Loss — High Protein | weight_loss |
| `maintenance-balanced` | Maintenance — Balanced | maintenance |
| `muscle-gain-beginner` | Muscle Gain — Beginner | muscle_gain |
| `muscle-gain-high-protein` | Muscle Gain — High Protein | muscle_gain |
| `body-recomposition` | Body Recomposition | body_recomp |
| `high-protein` | High Protein | high_protein |
| `general-health` | General Health | general_health |

Each template includes one starter day (Breakfast, Lunch, Dinner, Snack) referencing existing system Foods by `source.externalId`. Templates are editable examples — not medical prescriptions.

---

## Seed

**Script:** `pnpm run seed:nutrition-templates`  
**Prerequisite:** `pnpm run seed:foods`

| Run | Created | Updated |
|-----|---------|---------|
| First | 8 | 0 |
| Second | 0 | 8 |

- Upserts by `templateKey` where `ownership.type = system` and `isTemplate = true`
- Never modifies trainer-owned plans
- Never wipes the collection
- Builds `foodSnapshot` from system Food records at seed time

---

## Clone Endpoint

```
POST /api/v1/nutrition-plans/:id/clone
```

**Auth:** `protect` + `authorize('trainer', 'admin')`

**Body (optional):** `{ "name": "My Plan Name" }` — only `name` allowed.

**Response:** `201` with trainer-owned `nutritionPlan`.

### Source validation

| Condition | Result |
|-----------|--------|
| Missing / foreign | 404 |
| Not a template | 400 |
| Archived | 400 |
| System template (active) | Allowed |
| Own trainer template (active) | Allowed |

### Clone behavior

- New plan ID and new embedded `_id` on every day, meal, and food item
- Preserves `foodId` and `foodSnapshot` (does **not** rebuild from Food catalog)
- Preserves `icon`, `macroTargets`, plan metadata
- Sets `ownership.type = trainer`, `templateKey = null`, `isTemplate = false`, `status = active`
- Recalculates denormalized counters via `applyPlanDenormalizedCounters`
- Auto-name: `{sourceName} Copy`, then `Copy 2`, `Copy 3`, … scoped to trainer

---

## Ownership

| Kind | Read | Clone | PATCH | DELETE |
|------|------|-------|-------|--------|
| System template | All trainers | Yes | 403 | 403 |
| Own trainer plan | Owner | — | Yes | Yes |
| Own trainer template | Owner | Yes | Yes | Yes |
| Foreign trainer | 404 | 404 | 404 | 404 |

---

## Snapshot Behavior

- **Create/PATCH with nutritionDays:** snapshots rebuilt from current Food records (Phase 4)
- **Clone:** snapshots copied from source plan unchanged (historical fidelity)

---

## List / Detail

Existing endpoints unchanged:

- `GET /nutrition-plans?ownership=system&isTemplate=true` — system templates
- `GET /nutrition-plans?ownership=trainer` — default, trainer plans only
- `GET /nutrition-plans?ownership=all` — system + own trainer plans

---

## Tests

**Script:** `node scripts/test-nutrition-templates-phase5.mjs`

**Result:** 32/32 passed

Covers: template list/detail, system mutation guards, clone ownership/IDs/snapshots, name handling, authorization, seed idempotency.

**Regression:**

| Script | Result |
|--------|--------|
| `test-nutrition-plans-phase4.mjs` | 36/36 |
| `test-nutrition-plan-foundation-phase3.mjs` | 30/30 |

---

## Files

```
src/modules/nutrition-plans/
  nutrition-plan.helpers.js     (+ canClone, generateCloneName, deepCloneNutritionDays)
  nutrition-plan.validator.js   (+ validateCloneNutritionPlan)
  nutrition-plan.service.js     (+ cloneNutritionPlan)
  nutrition-plan.controller.js  (+ cloneNutritionPlan)
  nutrition-plan.routes.js      (+ POST /:id/clone)

scripts/seed-nutrition-templates.mjs
scripts/test-nutrition-templates-phase5.mjs
docs/nutrition/NUTRITION_TEMPLATES_IMPLEMENTATION_REPORT.md
package.json                    (+ seed:nutrition-templates)
```

Model partial unique index on `templateKey` (system templates) was already present from Phase 3.

---

## Known Limitations

- Starter templates use a single example day (not full 7–14 day programs)
- No assignment or scheduling
- No plan versions
- No frontend template browser UI
- Clone preserves snapshots even if source Food was later archived

---

## Next Phase

**Phase 6 — Nutrition Plan Assignments**

Client assignment, scheduling, and progress tracking for trainer-owned nutrition plans.
