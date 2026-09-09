# USDA FoodData Central — Implementation Report (Historical)

> **Historical.** Phase 8 replaced USDA FoodData Central as the Food Selector catalog source with FatSecret live search. Runtime USDA integration has been removed.

**Status:** Complete  
**Date:** 2026-08-30  
**Scope:** Data source migration from Open Food Facts → USDA FoodData Central

---

## Architecture

Unchanged application flow:

```
Frontend Food Selector → GET /api/v1/foods → Fitly Food collection → Nutrition Builder
```

USDA FoodData Central is **import-only**. The frontend and Food API never call USDA directly.

```
USDA FDC API
      ↓
Import script (server-side, API key)
      ↓
Fitly Food collection (ownership.type=system, source.externalProvider=usda_fooddata_central)
      ↓
GET /api/v1/foods
```

Existing FitlyPro seed foods (`source.externalProvider=fitlypro`) and trainer-owned foods are preserved.

---

## USDA Datasets Used

| Dataset | Included | Notes |
|---------|----------|-------|
| Foundation Foods | Yes | High-quality analytical composition |
| SR Legacy | Yes | Standard Reference legacy raw foods |
| Branded Foods | **No** | Explicitly rejected in mapper/validator |
| Survey (FNDDS) | **No** | Out of scope |

Import uses curated search queries against `/v1/foods/search` with `dataType: ["Foundation", "SR Legacy"]`.

---

## Mapping

| USDA field | Fitly field |
|------------|-------------|
| `fdcId` | `source.externalId` |
| `description` | `name` |
| `foodNutrients` (per 100g) | `nutritionPer100g` |
| `foodPortions` | `defaultServing` (or 100g fallback) |
| `foodCategory` + keywords | `category` (existing `FOOD_CATEGORIES`) |
| — | `ownership.type = system` |
| — | `source.type = import` |
| — | `source.externalProvider = usda_fooddata_central` |
| — | `image` omitted (no fabricated URLs) |

### Nutrition normalization (per 100g)

| Nutrient ID | Fitly field |
|-------------|-------------|
| 1008 Energy (kcal) | `calories` |
| 1062 Energy (kJ) | converted ÷ 4.184 → kcal |
| 1003 Protein | `protein` |
| 1005 Carbohydrate | `carbs` |
| 1004 Total lipid (fat) | `fat` |
| 1079 Fiber | `fiber` (optional) |
| 2000 Sugars | `sugar` (optional) |
| 1093 Sodium | `sodium` (optional) |

Foundation/SR Legacy search results are per 100g — values are **not** scaled from serving sizes.

### Serving

- Uses `foodPortions[].gramWeight` when reliable
- Supports `g`, `ml`, `piece`, `serving` when portion metadata allows
- Falls back to `{ quantity: 100, unit: 'g', gramWeight: 100 }`

### Category mapping

USDA `foodCategory.description` mapped to existing Fitly categories (`protein`, `grains`, `dairy`, `fruits`, `vegetables`, `legumes`, `nuts_seeds`, `fats`, `beverages`, `condiments`, `other`) with keyword fallback on `description`.

---

## Source Identity

```javascript
source: {
  type: 'import',
  externalProvider: 'usda_fooddata_central',
  externalId: '<fdcId>',
  barcode: null
}
```

Dedupe: partial unique index on `source.externalProvider + source.externalId` (system foods).

---

## Import Commands

```bash
# Controlled test import
pnpm run seed:foods:usda -- --limit=100 --dry-run
pnpm run seed:foods:usda -- --limit=500

# Filter dataset
pnpm run seed:foods:usda -- --data-type=Foundation --limit=200

# Options
--limit=N
--page-size=N
--dry-run
--data-type=Foundation|SR Legacy
```

Requires `USDA_FDC_API_KEY` in server environment (never exposed to frontend).

---

## Cleanup Command (Open Food Facts)

Removes **only** system-owned Open Food Facts records:

```bash
pnpm run cleanup:foods:openfoodfacts -- --dry-run
pnpm run cleanup:foods:openfoodfacts
```

Filter: `ownership.type=system` AND `source.externalProvider=openfoodfacts`

Preserves: trainer foods, FitlyPro seed foods (`fitlypro`), USDA foods.

---

## Idempotency

- First run: `created: N, updated: 0`
- Second run: `created: 0, updated: N`
- Trainer-owned foods never overwritten
- Trainer/externalId conflicts logged and skipped

---

## Validation & Skip Reasons

Importer stats:

```json
{
  "fetched": 0,
  "created": 0,
  "updated": 0,
  "skipped": 0,
  "invalid": 0,
  "failed": 0,
  "skipReasons": {
    "missing name": 0,
    "missing calories": 0,
    "missing protein": 0,
    "missing carbs": 0,
    "missing fat": 0,
    "invalid nutrient value": 0,
    "unsupported data type": 0,
    "duplicate fdc id": 0,
    "trainer-owned conflict": 0
  }
}
```

---

## API Changes

**None required.** Existing `GET /api/v1/foods` contract unchanged:

- `search` (includes `normalizedName`)
- `category`, `ownership`, `status`
- `page`, `limit`, `sort`

No frontend changes required for this migration.

---

## Files

### Added

- `src/integrations/usda-food-data-central/*`
- `scripts/import-usda-foods.mjs`
- `scripts/cleanup-open-food-facts.mjs`
- `scripts/test-food-usda.mjs`
- `docs/nutrition/USDA_FOOD_DATA_CENTRAL_IMPLEMENTATION_REPORT.md`

### Modified

- `src/modules/foods/food.constants.js` — `USDA_FDC_PROVIDER`
- `package.json` — new scripts
- `.env.example` — USDA env vars

### Not removed

- Open Food Facts integration (`src/integrations/open-food-facts/`) retained for reference; data removed via cleanup script
- `seed:foods:openfoodfacts` script retained but superseded by USDA workflow

---

## Tests Executed

| Test | Result |
|------|--------|
| `scripts/test-food-usda.mjs` | **22/22 passed** (fixtures, no live USDA in unit tests) |
| `scripts/test-nutrition-plan-foundation-phase3.mjs` | **30/30 passed** |
| `scripts/test-nutrition-templates-phase5.mjs` | **32/32 passed** |
| `scripts/test-nutrition-assignments-phase6.mjs` | **25/25 passed** |
| OFF cleanup dry-run | **475 matching records** (not deleted — dry-run only) |

Live USDA dry-run with `DEMO_KEY` can be run manually when validating API connectivity.

---

## Migration Procedure (Recommended)

1. `pnpm run cleanup:foods:openfoodfacts -- --dry-run` — review count
2. `pnpm run cleanup:foods:openfoodfacts` — remove OFF system foods
3. Set `USDA_FDC_API_KEY` in server `.env`
4. `pnpm run seed:foods:usda -- --limit=100 --dry-run` — validate mapping
5. `pnpm run seed:foods:usda -- --limit=500` — controlled import
6. Verify Food Selector manually (chicken, eggs, rice, banana, broccoli, etc.)

---

## Known Limitations

- Curated search queries (not full USDA database dump)
- No images on USDA composition foods
- Requires server-side USDA API key
- USDA rate limit: ~1000 req/hour per key
- Barcode lookup endpoint remains local-only (USDA composition foods have no barcodes)
- Branded Foods excluded by design

---

## Recommended Next Step

1. Run OFF cleanup + controlled USDA import in staging/production
2. Manually verify Food Selector with common foods
3. Optionally expand `USDA_IMPORT_SEARCH_QUERIES` based on trainer feedback
4. Future: on-demand USDA lookup for missing foods (separate phase)
