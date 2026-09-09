# NutritionPlan CRUD API Implementation Report

> **Phase:** 4 — NutritionPlan CRUD API  
> **Status:** Implemented  
> **Date:** 2026-08-25  
> **Design reference:** `docs/nutrition/NUTRITION_BACKEND_DOMAIN_DESIGN.md`  
> **Foundation reference:** `docs/nutrition/NUTRITION_PLAN_FOUNDATION_IMPLEMENTATION_REPORT.md`

---

## Phase

Phase 4 implements the full NutritionPlan CRUD API for trainers: list, detail, create, update, and archive. Business logic lives in the service layer; controllers are thin. Phase 3 foundation (model, helpers, calculations, validators) is reused without redesign.

**Not implemented:** template seed, clone endpoint, assignments, versions, frontend.

---

## Endpoints

Base path: **`/api/v1/nutrition-plans`**

All routes require `protect` + `authorize('trainer', 'admin')`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/nutrition-plans` | List with filters, search, pagination, sort |
| POST | `/nutrition-plans` | Create trainer-owned plan |
| GET | `/nutrition-plans/:id` | Detail with computed macros |
| PATCH | `/nutrition-plans/:id` | Update metadata or full tree replace |
| DELETE | `/nutrition-plans/:id` | Soft archive (`status: archived`) |

---

## Request Examples

### Create

```json
POST /api/v1/nutrition-plans
{
  "name": "High Protein Muscle Gain",
  "description": "8 week muscle gain nutrition plan",
  "icon": "lucide:beef",
  "goal": "muscle_gain",
  "duration": 8,
  "daysCount": 7,
  "macroTargets": {
    "calories": 2800,
    "protein": 180,
    "carbs": 320,
    "fat": 80
  },
  "nutritionDays": [
    {
      "dayNumber": 1,
      "name": "Training Day",
      "meals": [
        {
          "order": 1,
          "name": "Breakfast",
          "mealType": "breakfast",
          "foodItems": [
            {
              "foodId": "FOOD_ID",
              "order": 1,
              "quantity": 100,
              "unit": "g"
            }
          ]
        }
      ]
    }
  ]
}
```

### Metadata PATCH

```json
PATCH /api/v1/nutrition-plans/:id
{
  "name": "Updated Muscle Gain Plan",
  "goal": "body_recomp",
  "icon": "lucide:dumbbell",
  "macroTargets": {
    "calories": 2700,
    "protein": 190,
    "carbs": 280,
    "fat": 75
  }
}
```

### Full tree PATCH

When `nutritionDays` is present, it **authoritatively replaces** the entire tree. Fresh food snapshots are generated from current Food records.

---

## Response Examples

### List

```json
{
  "statusCode": 200,
  "success": true,
  "message": "Nutrition plans retrieved successfully",
  "data": {
    "nutritionPlans": [
      {
        "id": "...",
        "name": "High Protein Muscle Gain",
        "icon": "lucide:beef",
        "goal": "muscle_gain",
        "duration": 8,
        "daysCount": 7,
        "macroTargets": { "calories": 2800, "protein": 180, "carbs": 320, "fat": 80 },
        "isTemplate": false,
        "status": "active",
        "ownership": { "type": "trainer", "trainerId": "..." },
        "totalMeals": 1,
        "totalFoodItems": 1,
        "avgDailyCalories": 200,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ],
    "pagination": { "page": 1, "limit": 24, "total": 1, "pages": 1 }
  }
}
```

### Detail

Includes full `nutritionDays` tree with:

- `foodSnapshot` on each food item
- `itemMacros`, `mealTotals`, `dailyTotals` (computed, not persisted)
- `computedMacros` at plan level

Macro values are rounded for API responses (calories → integer; protein/carbs/fat → 1 decimal).

---

## Ownership

| Kind | Read | Create | Update | Archive |
|------|------|--------|--------|---------|
| System | All trainers | N/A (seed later) | 403 | 403 |
| Trainer own | Owner | POST | PATCH | DELETE |
| Foreign trainer | 404 | — | 404 | 404 |

Server sets on create:

```js
ownership: { type: 'trainer', trainerId: req.user.id }
trainerId: req.user.id
```

Client cannot set `trainerId`, `ownership`, or `templateKey`.

---

## Food Visibility

Trainers may reference:

1. System foods
2. Their own trainer foods

Foreign trainer foods return **400** with field path e.g. `nutritionDays[0].meals[0].foodItems[0].foodId` — no ownership leak.

Food lookup is **batched**: all unique `foodId` values collected → single `Food.find` with `buildFoodVisibilityFilter(trainerId)`.

---

## Snapshot Behavior

- Client sends `foodId` only (no `foodSnapshot`)
- Server calls `buildFoodSnapshot(food)` at save time
- Snapshots are immutable until the trainer replaces `nutritionDays`
- Updating Food catalog does not retroactively change existing plan snapshots

---

## Macro Response

Computed at response time using Phase 3 pure functions:

| Level | Field |
|-------|-------|
| Food item | `itemMacros` |
| Meal | `mealTotals` |
| Day | `dailyTotals` |
| Plan | `computedMacros` |

Nothing persisted except denormalized list helpers: `totalMeals`, `totalFoodItems`, `avgDailyCalories`.

---

## Pagination

| Param | Default |
|-------|---------|
| `page` | 1 |
| `limit` | 24 (max 100) |

---

## Filtering

| Param | Default | Notes |
|-------|---------|-------|
| `status` | `active` | draft, active, archived |
| `ownership` | `trainer` | trainer, system, all |
| `isTemplate` | — | optional boolean |
| `goal` | — | nutrition goal enum |
| `search` | — | name + description regex |

---

## Sorting

| Sort | Behavior |
|------|----------|
| `newest` | createdAt desc (default) |
| `oldest` | createdAt asc |
| `name` / `name-desc` | alphabetical |
| `calories-high` / `calories-low` | avgDailyCalories |
| `duration-high` / `duration-low` | duration weeks |

List endpoint does **not** hydrate full nutrition trees.

---

## Archive

`DELETE /nutrition-plans/:id` sets `status: archived` — no physical delete.

- Archived plans excluded from default `status=active` list
- Still readable by ID
- Cannot archive system plans (403)
- PATCH cannot set `archived` — use DELETE

---

## Validation

Wired schemas:

- `validateCreateNutritionPlan` — POST body middleware
- `validateUpdateNutritionPlan` — PATCH body middleware
- `validateNutritionPlanQuery` — GET list query validation in controller

PATCH `status` limited to `draft` | `active` (not `archived`).

Errors return **400** via `ApiError` with `{ field, message }[]`.

---

## Authorization

Service layer enforces ownership independently of route middleware. Admin does not gain cross-trainer access (matches WorkoutPlan behavior).

---

## Tests

**Script:** `node scripts/test-nutrition-plans-phase4.mjs`  
**Requires:** dev server running

**Foundation regression:** `node scripts/test-nutrition-plan-foundation-phase3.mjs`

36 API/foundation checks covering CRUD, food visibility, snapshots, macros, archive, forbidden fields, query validation, and batch food loading.

---

## Files

```
src/modules/nutrition-plans/
  nutrition-plan.service.js      (new)
  nutrition-plan.controller.js   (new)
  nutrition-plan.routes.js       (new)
  nutrition-plan.helpers.js      (extended: mappers, _id preservation)
  nutrition-plan.constants.js    (sort options updated)
  nutrition-plan.validator.js    (status restrictions)
  index.js                       (exports service/routes)

src/routes/index.js              (mounted /nutrition-plans)

scripts/test-nutrition-plans-phase4.mjs
docs/nutrition/NUTRITION_PLAN_CRUD_IMPLEMENTATION_REPORT.md
```

---

## Known Limitations

- No system nutrition template seed
- No clone endpoint
- No client assignments or scheduling
- No plan versions
- No frontend integration
- List sort by calories uses denormalized `avgDailyCalories` (updated on save)

---

## Next Phase

**Phase 5 — Nutrition Templates + Clone**

- System nutrition template seed
- `POST /nutrition-plans/:id/clone`
- Template browsing (`ownership=system`, `isTemplate=true`)
