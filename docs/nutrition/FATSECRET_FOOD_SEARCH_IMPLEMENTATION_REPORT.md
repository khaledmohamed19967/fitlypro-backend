# FatSecret Food Search — Implementation Report

**Status:** Complete  
**Date:** 2026-08-30  
**Phase:** 8 — Replace USDA/OFF catalog with FatSecret live search

---

## Architecture

```
Nutrition Builder
→ Food Selector
→ Nuxt BFF (/api/foods/search)
→ Fitly GET /api/v1/foods/search
→ FatSecret Platform API (server-side)
→ normalized Fitly food results
→ on confirm: POST /api/v1/foods/from-external
→ Fitly Food document (MongoDB ObjectId)
→ BuilderFoodItem.foodId
→ NutritionPlan PATCH (unchanged)
```

FatSecret is **not** bulk-imported. Search is live. A local Food document is created only when a trainer selects a result, because NutritionPlan still requires a MongoDB `foodId` and rebuilds `foodSnapshot` from that document.

---

## FatSecret API

| Item | Value |
|------|--------|
| API | Platform REST API |
| Auth | OAuth 2.0 Client Credentials |
| Token URL | `https://oauth.fatsecret.com/connect/token` |
| API URL | `https://platform.fatsecret.com/rest/server.api` |
| Preferred search | `foods.search.v5` (Premier; `food_type`, servings, optional images) |
| Fallback search | `foods.search` (v1 Basic; summary `food_description`) |
| Details | `food.get.v4` then `food.get` |
| Default region | US |
| Default language | en |

**Scope / edition**

- `foods.search.v5` requires OAuth2 **premier**
- Images (`include_food_images`) require an additional Premier offering
- If Premier is missing (error 14), the backend falls back to Basic `foods.search`
- `FATSECRET_SCOPE=basic` skips v5
- `FATSECRET_SCOPE=premier` uses v5 only

---

## BFF endpoints

| Fitly | Nuxt BFF | Purpose |
|-------|----------|---------|
| `GET /api/v1/foods/search` | `GET /api/foods/search` | Live FatSecret search |
| `POST /api/v1/foods/from-external` | `POST /api/foods/from-external` | Persist selected foods |
| `GET /api/v1/foods` | `GET /api/foods` | Trainer custom + seed foods |

Search query: `q`, `page` (1-based), `limit`, `foodType=generic|brand|all`, `region`, `language`.

---

## Mapping

Search results are normalized to the existing Food Selector shape (`id`, `name`, `brand`, `nutritionPer100g`, `defaultServing`, `image`, `source`).

Materialized foods use:

```
source.type = import
source.externalProvider = fatsecret
source.externalId = <food_id>
ownership.type = system
```

Nutrition is converted to per-100g using serving metric grams when available. `nutritionMacroCalc.ts` is unchanged.

---

## Food Selector

Existing modal preserved. Added:

- External Foods (default) vs My Foods
- Generic / Brand / All (server-side `food_type` when Premier is available)
- Live FatSecret search
- Existing image fallback when no URL is present

Selecting an external food materializes a Fitly Food, then uses the existing `BuilderFoodItem` path.

---

## Database cleanup

Script (not executed automatically):

```bash
pnpm run cleanup:foods:legacy -- --dry-run
pnpm run cleanup:foods:legacy
```

Deletes only `ownership.type=system` foods from `openfoodfacts` or `usda_fooddata_central`. Preserves trainer foods and FitlyPro seeds.

---

## Known limitations

- Basic accounts cannot filter Generic/Brand in FatSecret; the backend best-effort filters the current page
- Images only appear when the FatSecret account has the image offering
- FatSecret credentials must be set server-side (`FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET`)
