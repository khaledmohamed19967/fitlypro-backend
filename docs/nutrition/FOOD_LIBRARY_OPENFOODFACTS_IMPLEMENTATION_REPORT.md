# Food Library + Open Food Facts — Implementation Report (Historical)

> **Historical.** Phase 8 replaced Open Food Facts as the live Food Selector source with FatSecret. This document describes the former import-based catalog. Runtime OFF integration has been removed.

**Status:** Complete  
**Date:** 2026-08-30  
**Phase:** 7 — Food Library + Open Food Facts Integration

---

## Existing Food Architecture

The Fitly Food module (Phase 2) already provided:

- MongoDB `Food` collection with `ownership`, `nutritionPer100g`, `defaultServing`, `source`
- System vs trainer ownership with authorization helpers
- `GET/POST/PATCH/DELETE /api/v1/foods`
- Idempotent seed via `source.externalProvider + source.externalId` (FitlyPro catalog)
- NutritionPlan integration via `buildFoodSnapshot()` (backend rebuilds snapshots on create/PATCH)

Phase 7 extends this model — **no parallel Food architecture was introduced**.

---

## Model Changes

| Field | Change |
|-------|--------|
| `normalizedName` | Added — auto-synced from `name` (lowercase) for MongoDB search |
| `image.url`, `image.thumbnailUrl` | Added — optional OFF image URLs (not downloaded) |
| `source.barcode` | Added — mirrors barcode for lookup (OFF imports) |

**Preserved conventions:**

- `nutritionPer100g` (not a separate `nutrition` object)
- `defaultServing` (not `serving`)
- `source.type = 'import'` + `source.externalProvider = 'openfoodfacts'` (not a new `source.type` enum value)
- Implicit 100g nutrition basis via `nutritionPer100g`

**Indexes:**

- Existing partial unique index on `source.externalProvider + source.externalId` (system foods)
- Added compound index: `category + status + ownership.type`
- `normalizedName` field index

---

## Open Food Facts Integration

New integration layer at `src/integrations/open-food-facts/`:

| File | Responsibility |
|------|----------------|
| `open-food-facts.client.js` | HTTP, User-Agent, timeout, retry, rate delay |
| `open-food-facts.constants.js` | Base URL, fields, curated import categories |
| `open-food-facts.mapper.js` | OFF product → Fitly Food payload |
| `open-food-facts.validator.js` | Raw + mapped validation |
| `open-food-facts.importer.js` | Upsert orchestration, idempotent import |
| `index.js` | Public exports |

Environment variables (optional, with safe defaults):

```env
OPEN_FOOD_FACTS_BASE_URL=https://world.openfoodfacts.org
OPEN_FOOD_FACTS_USER_AGENT=FitlyPro/1.0 (https://fitlypro.app)
OPEN_FOOD_FACTS_TIMEOUT_MS=15000
OPEN_FOOD_FACTS_REQUEST_DELAY_MS=400
```

Open Food Facts is **never called from Food API routes**.

---

## Normalization

**Minimum import requirements:**

- `product_name` present
- Valid numeric barcode (`code`)
- Calories per 100g (`energy-kcal_100g`, or kJ → kcal conversion)
- Protein, carbs, fat per 100g as finite non-negative numbers

**Nutrition mapping:**

| OFF field | Fitly field |
|-----------|-------------|
| `energy-kcal_100g` | `nutritionPer100g.calories` |
| `energy_100g` (kJ) | converted ÷ 4.184 |
| `proteins_100g` | `nutritionPer100g.protein` |
| `carbohydrates_100g` | `nutritionPer100g.carbs` |
| `fat_100g` | `nutritionPer100g.fat` |
| `fiber_100g`, `sugars_100g`, `sodium_100g` | optional |

**Serving:**

- Parses `"100 g"`, `"30 ml"`, `"1 piece"` + `serving_quantity` when gram weight is reliable
- Falls back to `{ quantity: 100, unit: 'g', gramWeight: 100 }` when serving cannot be determined
- Does not invent gram weight for ambiguous piece/serving sizes

**Image:**

- Prefers `image_front_url` / `image_front_small_url`
- Stores source URLs only (no Fitly storage download in this phase)
- Null when no usable image

---

## Categories

OFF taxonomy is mapped to the **existing** Fitly `FOOD_CATEGORIES` vocabulary:

| Import group | Fitly categories used |
|--------------|----------------------|
| protein | `protein` |
| carbs | `grains` |
| dairy | `dairy` |
| fruits | `fruits` |
| vegetables | `vegetables` |
| fats | `fats` |

Keyword + OFF tag rules in `open-food-facts.mapper.js`. Unmapped products → `other`.

Curated import config: `OPEN_FOOD_FACTS_IMPORT_CATEGORIES` in constants (OFF `en:` category tags).

---

## Importer

**Script:** `scripts/import-open-food-facts.mjs`

**Behavior:**

1. Connect MongoDB via `APP_DB_URL`
2. Search OFF by curated category tags (paginated)
3. Normalize → validate → upsert system foods
4. Never wipes collection; never modifies trainer-owned foods
5. Idempotent by `openfoodfacts + barcode`

**Statistics:** `{ fetched, created, updated, skipped, invalid, failed }`

**Flags:**

| Flag | Example |
|------|---------|
| `--limit` | `--limit=500` |
| `--page-size` | `--page-size=100` |
| `--dry-run` | fetch/validate only, no DB writes |
| `--category` | `--category=protein` |

---

## Commands

```bash
pnpm run seed:foods:openfoodfacts
pnpm run seed:foods:openfoodfacts -- --limit=50 --dry-run
pnpm run seed:foods:openfoodfacts -- --category=protein --limit=100
node scripts/test-food-openfoodfacts-phase7.mjs
```

---

## API

Existing endpoints preserved. Enhancements:

| Endpoint | Notes |
|----------|-------|
| `GET /api/v1/foods` | Search includes `normalizedName`; filters: category, ownership, status, page, limit, sort |
| `GET /api/v1/foods/:id` | Returns image + source.barcode when present |
| `GET /api/v1/foods/barcode/:barcode` | **New** — local catalog lookup only; 404 if missing |

**Not implemented (by design):** live OFF lookup from API.

---

## Ownership

| Type | Behavior |
|------|----------|
| System (OFF imports) | Readable by all trainers; not editable/deletable by trainers |
| Trainer custom | Unchanged — create/update/archive own foods only |

Import upsert skips any document that is not system-owned with matching external identity.

---

## Snapshot Compatibility

- `buildFoodSnapshot()` unchanged for NutritionPlan core fields
- Optional `image` included in snapshot when present on Food document
- NutritionPlan create/PATCH still rebuilds snapshots server-side
- Clone behavior unchanged
- Calculation: `nutritionPer100g × grams / 100` unchanged

---

## Indexes

- Partial unique: `source.externalProvider + source.externalId` (system)
- `normalizedName`
- `category + status + ownership.type`
- Existing text index on `name`

---

## Tests

**Script:** `scripts/test-food-openfoodfacts-phase7.mjs`

Uses mocked OFF fixtures (`__fixtures__/products.js`) — **no live OFF network in unit/import tests**.

Coverage:

1. OFF normalization
2. Valid/invalid product handling
3. Nutrition, image, serving, category mapping
4. Deduplication + idempotent import
5. System ownership + trainer protection
6. Food list search, category filter, pagination
7. Food detail + barcode lookup
8. NutritionPlan foodSnapshot rebuild

---

## Regression

Run after Phase 7:

```bash
node scripts/test-food-openfoodfacts-phase7.mjs
node scripts/test-nutrition-plan-foundation-phase3.mjs
node scripts/test-nutrition-plans-phase4.mjs
node scripts/test-nutrition-templates-phase5.mjs
node scripts/test-nutrition-assignments-phase6.mjs
```

---

## Files Changed

**Modified:**

- `src/modules/foods/food.model.js`
- `src/modules/foods/food.constants.js`
- `src/modules/foods/food.helpers.js`
- `src/modules/foods/food.service.js`
- `src/modules/foods/food.controller.js`
- `src/modules/foods/food.routes.js`
- `package.json`
- `.env.example`

**Added:**

- `src/integrations/open-food-facts/*`
- `scripts/import-open-food-facts.mjs`
- `scripts/test-food-openfoodfacts-phase7.mjs`
- `docs/nutrition/FOOD_LIBRARY_OPENFOODFACTS_IMPLEMENTATION_REPORT.md`

---

## Known Limitations

- Curated import scope only (not full OFF database)
- No image download/hosting on Fitly storage
- No live OFF search or auto-import from barcode API endpoint
- OFF v2 search requires category/tag filters (no general full-text on OFF side)
- Barcode validation requires 8–14 digit numeric codes
- `pnpm build` not defined in package.json (N/A for this Node API project)

---

## Next Phase

- Optional: on-demand OFF import when barcode not found locally
- Trainer custom food UI + Food Builder
- Food Picker frontend wired to expanded system catalog
- Image proxy/CDN caching
- Expanded category coverage and regional OFF datasets
