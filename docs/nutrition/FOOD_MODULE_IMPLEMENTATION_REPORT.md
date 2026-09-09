# Food Module Implementation Report

> **Phase:** 2 — Food catalog module  
> **Status:** Implemented  
> **Date:** 2026-08-25  
> **Design reference:** `docs/nutrition/NUTRITION_BACKEND_DOMAIN_DESIGN.md`

---

## Status

Phase 2 Food module is implemented end-to-end: model, constants, helpers, validators, service, controller, routes, seed script, and manual verification script.

NutritionPlan, meals, assignments, and frontend integration are **not** implemented (Phase 3+).

---

## Schema

**Collection:** `foods`

| Field | Type | Notes |
|-------|------|-------|
| `ownership` | subdoc | `{ type: system \| trainer, trainerId }` — canonical |
| `trainerId` | ObjectId | Mirror; null for system |
| `name` | String | 2–120 chars |
| `brand` | String | optional, max 120 |
| `category` | enum | 14 MVP categories |
| `status` | enum | `active` \| `archived` |
| `nutritionPer100g` | subdoc | calories, protein, carbs, fat; optional fiber, sugar, sodium |
| `defaultServing` | subdoc | quantity, unit, gramWeight |
| `source` | subdoc | type, externalProvider, externalId |
| `createdAt` / `updatedAt` | Date | timestamps |

Canonical nutrition basis: **per 100g**.

---

## Ownership

| Kind | Read | Create (API) | Update | Archive |
|------|------|--------------|--------|---------|
| System | All trainers | Seed only | 403 | 403 |
| Trainer custom | Owner only | POST /foods | Owner PATCH | Owner DELETE |

Foreign trainer foods return **404** on read/update/archive (no ownership leak). System mutations return **403**.

`trainerId` is always set server-side from `req.user.id`.

---

## API

Base path: **`/api/v1/foods`**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/foods` | List with filters/pagination |
| POST | `/foods` | Create trainer custom food |
| GET | `/foods/:id` | Detail |
| PATCH | `/foods/:id` | Update own food |
| DELETE | `/foods/:id` | Archive own food |

### List query params

| Param | Default |
|-------|---------|
| `ownership` | `all` |
| `status` | `active` |
| `search` | name + brand regex |
| `category` | enum filter |
| `page` / `limit` | 1 / 24 |
| `sort` | `newest` |

Sort options: `name`, `name-desc`, `newest`, `oldest`, `calories-high`, `calories-low`.

---

## Validation

Joi schemas: `validateCreateFood`, `validateUpdateFood`, `validateFoodQuery`.

Forbidden on write: `ownership`, `trainerId`, `source`, `status`, `_id`, timestamps.

Serving units: `g`, `kg`, `ml`, `l`, `piece`, `serving`.

`defaultServing.gramWeight` required and > 0 for all foods (supports future piece/serving calculations).

---

## Authorization

Middleware: `protect` → `authorize('trainer', 'admin')`.

Service-layer checks via `canReadFood`, `canModifyFood`, `buildFoodVisibilityFilter`.

---

## Snapshot Helper

`buildFoodSnapshot(food)` in `food.helpers.js` returns:

```js
{
  name, brand, category,
  nutritionPer100g: { calories, protein, carbs, fat, ...optional },
  defaultServing: { quantity, unit, gramWeight }
}
```

Prepared for Phase 3 NutritionPlan `PlanFoodItem.foodSnapshot`. Updating a Food does **not** mutate existing plan snapshots (NutritionPlan not implemented yet).

---

## Indexes

- `{ ownership.type, ownership.trainerId, status }`
- `{ name: 'text' }`
- `{ name, ownership.type, ownership.trainerId }`
- Partial unique: `{ source.externalProvider, source.externalId }` for system seed dedupe

---

## Seed

Script: `scripts/seed-foods.mjs`  
Command: `pnpm run seed:foods`

17 system foods with stable keys under `source.externalProvider = fitlypro`.

Idempotent upsert — never modifies trainer-owned foods.

**Last run:** First run Created 17 / Updated 0; second run Created 0 / Updated 17.

---

## Tests

Script: `scripts/test-foods-phase2.mjs`

Covers create/read/update/archive, ownership isolation, list filters, search, pagination, validation, forbidden fields, snapshot helper, seed presence, serving validation.

Run: `node scripts/test-foods-phase2.mjs` (requires dev server on port 8000).

**Last run:** 24/24 passed.

---

## Files

```
src/modules/foods/
  food.constants.js
  food.model.js
  food.helpers.js
  food.validator.js
  food.service.js
  food.controller.js
  food.routes.js

scripts/seed-foods.mjs
scripts/test-foods-phase2.mjs

src/routes/index.js          (mounted /foods)
package.json                 (seed:foods script)
```

---

## Known Limitations

- No barcode / external food import integrations
- No duplicate-name prevention for trainer custom foods
- Archived foods excluded from default list but readable by id
- No unarchive endpoint (status not client-writable)
- `pnpm test` not configured — manual script used
- NutritionPlan macro calculations not wired yet

---

## Next Phase

**Phase 3 — NutritionPlan module foundation**

- Embedded `nutritionDays` → `meals` → `foodItems`
- Reference `foodId` + `foodSnapshot` via `buildFoodSnapshot`
- Constants, validators, helpers, macro calculation utils
- No full CRUD API until Phase 4
