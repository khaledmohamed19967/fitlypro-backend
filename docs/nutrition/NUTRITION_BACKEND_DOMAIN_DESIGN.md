# FitlyPro Nutrition Backend Domain Design

> **Phase:** Domain design / API contract only  
> **Status:** Design complete — **no implementation**  
> **Date:** 2026-08-25  
> **Architectural reference:** `docs/workout/WORKOUT_BACKEND_DOMAIN_DESIGN.md`  
> **Frontend context (non-authoritative):** `fityl-pro/app/features/dashboard/trainer/nutrition/`  
> **Backend repo:** `fitly-pro-backend`

This document defines the production Nutrition Plan backend from **nutrition product requirements first**, using the completed Workout Plans module as an **architectural reference** (module layout, ownership, validation, pagination, errors, assignments, templates). It does **not** implement models, routes, controllers, services, validators, seeds, or database writes.

---

## 1. Domain Overview

### Product summary

FitlyPro Nutrition Plans let a trainer define reusable meal programs with macro targets, organize content by **program days → meals → food items**, calculate nutrition totals, manage templates, clone system templates, assign plans to clients, and track assignment lifecycle.

### Conceptual hierarchy

```text
NutritionPlan
  └── nutritionDays[]          (embedded)
        └── meals[]            (embedded)
              └── foodItems[]  (embedded — programmed rows, not catalog Food docs)
```

Separate collections:

| Entity | Collection | MVP |
|--------|------------|-----|
| **Food** (catalog) | `foods` | ✅ Required |
| **NutritionPlan** | `nutritionplans` | ✅ Required |
| **NutritionPlanAssignment** | `nutritionplanassignments` | ✅ Required |
| **NutritionPlanVersion** | `nutritionplanversions` | 🟡 Designed, not MVP |

### Entities evaluated (frontend vs production)

| Frontend mock type | Production entity | Notes |
|--------------------|-------------------|-------|
| `NutritionPlan` | **NutritionPlan** | Remove `clientId`, `startDate`, `endDate` from plan doc — use Assignment |
| `NutritionPlanTemplate` | Same **NutritionPlan** with `isTemplate: true` | Mirror Workout Plan — no separate template collection |
| `DailyNutritionPlan` | **NutritionDay** (embedded) | Rename; use `dayNumber` not calendar `dayOfWeek` |
| `Meal` | **Meal** (embedded) | Simpler MVP — no nested recipes/alternatives |
| `MealIngredient` | **PlanFoodItem** (embedded) | Reference Food catalog + snapshot |
| `FoodItem` | **Food** (catalog) | Separate collection with ownership |
| `ClientNutritionProfile` | — | Client profile / TDEE calculator — **future**, not plan MVP |
| `ShoppingList` | — | Deferred |
| `MealAlternative` | — | Deferred |

### Naming note

Use **`PlanFoodItem`** in backend docs/code to distinguish programmed rows inside a meal from catalog **`Food`** documents (same pattern as Workout `PlanExercise` vs Exercise Library `Exercise`).

### Nutrition backend today

```text
No Nutrition models, routes, controllers, or services exist in fitly-pro-backend.
Frontend nutrition UI uses mock/local data (foodDatabase.ts, composables).
Do not treat frontend types as the source of truth.
```

---

## 2. NutritionPlan

### Purpose

Reusable nutrition program definition: metadata, macro targets, ordered program days, meals, and food programming. **Not** client-specific schedule — that belongs on **NutritionPlanAssignment**.

### Recommended persistence: **embedded tree (Option A)**

```text
NutritionPlan
  └── nutritionDays[]
        └── meals[]
              └── foodItems[]
```

**Separate collections:** `Food` (catalog), `NutritionPlanAssignment`, (future) `NutritionPlanVersion`.

#### Option A vs Option B (Key Design Question #1)

| Factor | **Option A — Embedded** | Option B — Normalized days/meals/foods |
|--------|-------------------------|----------------------------------------|
| Builder save | Single atomic document replace | Multi-collection sync; ordering complexity |
| Typical document size | 7 days × 6 meals × 8 foods ≈ 300–400 rows — still ≪ 16MB | Same data, many round-trips |
| Plan duplication / clone | Deep clone one document | Copy across 3+ collections transactionally |
| Version snapshot | Deep clone subtree | Join + assemble |
| Query “all plans using food X” | Requires `$elemMatch` / aggregation | Simple `foodId` index on child collection |
| Partial meal update | Replace meals via full day/plan save | Fine-grained updates |

**Recommendation: Option A (embedded) for FitlyPro MVP.**

Reasons:

1. **Builder UX** — The nutrition builder edits the full tree and saves once (same as Workout Plans). Embedded maps directly to `PATCH` with authoritative `nutritionDays[]` replacement.
2. **Atomic updates** — One Mongoose save avoids orphaned meals/foods if a multi-collection write fails (no transaction infrastructure in repo today).
3. **Clone / template seed** — Deep clone of one document is trivial and idempotent.
4. **Performance** — Detail read is one query; list reads use denormalized counters (see §9).
5. **Document limits** — Even aggressive plans (14 days × 8 meals × 15 foods) remain well under MongoDB’s 16MB limit with lightweight snapshots.

**When to revisit Option B:** If product requires cross-plan food analytics at scale, independent meal libraries shared across plans, or plans exceed safe embedded size. Not needed for MVP.

#### Subdocument identity

Enable Mongoose `_id` on embedded `nutritionDays`, `meals`, and `foodItems` so:

- Frontend `id` fields map to subdocument `_id` on create/update
- Future meal swaps / logging can reference stable instance ids
- Duplicate same `foodId` in one meal appears as distinct rows

### NutritionPlan fields (MVP)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `ownership` | subdoc | ✅ | `{ type: 'system' \| 'trainer', trainerId }` — canonical |
| `trainerId` | ObjectId → User | ✅* | *Null for system; mirrored from ownership for compatibility |
| `templateKey` | String | optional | System seed identity only (`weight-loss`, `muscle-gain`, …) |
| `icon` | String | optional | Iconify id, default `lucide:apple` — see §12 |
| `name` | String | ✅ | 2–120 chars |
| `description` | String | optional | max 2000 |
| `goal` | enum | ✅ | See §10 |
| `duration` | Number | ✅ | Program length in **weeks** (metadata — not Week entity) |
| `daysCount` | Number | ✅ | Number of configured program days (1–14 MVP cap) |
| `macroTargets` | object | ✅ | See §10 — `{ calories, protein, carbs, fat }` |
| `nutritionDays` | NutritionDay[] | ✅ | May be empty on step-1 create |
| `isTemplate` | Boolean | ✅ | List filter |
| `status` | enum | ✅ | `draft` \| `active` \| `archived` — see §16 |
| `notes` | String | optional | Trainer notes, max 500 |
| `createdAt` / `updatedAt` | Date | auto | Mongoose timestamps |

#### Denormalized list helpers (updated on save)

| Field | Type | Notes |
|-------|------|-------|
| `totalMeals` | Number | Sum of meals across all days |
| `totalFoodItems` | Number | Sum of food items |
| `avgDailyCalories` | Number | Computed from days (for list/card display) |

#### Explicitly excluded from NutritionPlan (MVP)

| Field | Reason |
|-------|--------|
| `clientId` | Use **NutritionPlanAssignment** |
| `startDate` / `endDate` | Assignment schedule |
| `version` / `previousVersionId` | Use separate Version collection later |
| `targetMacros` percentages | Frontend calculator output; store grams + calories only |
| `nameAr` | i18n handled in frontend until product requires server-side locale fields |
| `waterIntake` per day | Client logging feature — deferred |
| `trainerNotes` / `clientNotes` split | Single `notes` on plan; assignment has its own `notes` |

### 2.1 `goal` enum

Align with frontend `NutritionGoal` where useful, keep backend-focused set:

```text
weight_loss
maintenance
muscle_gain
body_recomp
high_protein
general_health
```

`high_protein` supports system templates (“High Protein”) without overloading `muscle_gain`.

---

## 3. NutritionDay

Embedded in `NutritionPlan.nutritionDays[]`.

### Purpose

One **program day** in the plan (Day 1, Day 2, …). This is **not** necessarily a calendar weekday — it is the nth day of the program template.

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `_id` | ObjectId | auto | Subdocument id |
| `dayNumber` | Number | ✅ | **1-based**, unique within plan (1–14 MVP) |
| `name` | String | optional | e.g. "Day 1", "Training Day", "Rest Day" — default generated |
| `notes` | String | optional | max 500 |
| `meals` | Meal[] | ✅ | Ordered by `order`; may be empty (rest day) |

### Day configuration model (Key Design Question #8)

**Recommendation: each day independently configurable.**

| Approach | Support |
|----------|---------|
| Same meals repeated every day | Trainer duplicates day in builder (or future “copy day” UX) |
| Different meals per day | Native — each `NutritionDay` has its own `meals[]` |
| 7-day weekly cycle | Use `dayNumber` 1–7 with names "Monday"… if desired — convention only |

Do **not** enforce calendar `dayOfWeek` (0–6) in backend — frontend mock uses weekday indexing but program-day numbering is more flexible for 3-day, 5-day, or 14-day plans.

#### Uniqueness

- `dayNumber` unique within plan.
- Days may be sparse during draft (e.g. only Day 1 filled) but `daysCount` should reflect intended program length.

#### Computed (API response, not stored on day in MVP)

| Field | Notes |
|-------|-------|
| `dailyTotals` | `{ calories, protein, carbs, fat }` — sum of meal totals |

---

## 4. Meal

Embedded in `NutritionDay.meals[]`.

### Purpose

Named eating occasion containing ordered food items.

### Fields (MVP)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `_id` | ObjectId | auto | |
| `order` | Number | ✅ | **1-based** within day; sort key |
| `name` | String | ✅ | **Free text** — "Breakfast", "Pre Workout", "Meal 3" |
| `mealType` | enum | optional | Hint/tag — see below |
| `suggestedTime` | String | optional | `HH:mm` 24h — display only |
| `notes` | String | optional | max 500 |
| `foodItems` | PlanFoodItem[] | ✅ | min 0 (empty meal allowed during draft) |

### Meal naming (Key Design Question #7)

**Recommendation: free-text `name` (required) + optional `mealType` enum.**

| Field | MVP |
|-------|-----|
| `name` | Required free text — maximum trainer flexibility |
| `mealType` | Optional enum for filters/analytics later |

```text
breakfast
morning_snack
lunch
afternoon_snack
dinner
evening_snack
pre_workout
post_workout
snack
other
```

Do **not** require predefined meal types — trainers must be able to add "Meal 4" or "Post-Training Shake" without constraint.

#### Excluded (MVP)

| Field | Reason |
|-------|--------|
| `instructions[]`, `prepTime`, `cookTime` | Recipe builder — deferred |
| `imageUrl` | Meal photos — deferred |
| `alternatives[]` | Meal swap — deferred |
| `isTemplate` on Meal | Meals live inside plans; separate meal library deferred |
| `nameAr` | Frontend i18n |

#### Computed (API response)

| Field | Notes |
|-------|-------|
| `mealTotals` | Sum of `PlanFoodItem` calculated macros |

---

## 5. Food

### Purpose

**Food catalog** — canonical nutrition database (system foods + trainer custom foods). Analogous to Exercise Library.

Separate MongoDB collection: **`foods`**.

### Ownership (mirror Exercise Library)

```js
ownership: {
  type: 'system' | 'trainer',
  trainerId: ObjectId | null
}
```

| Kind | Read | Mutate |
|------|------|--------|
| System food | All trainers | Admin/seed only (trainers read-only) |
| Trainer custom food | Owner | Owner CRUD |

Top-level `trainerId` mirror optional for query compatibility (same pattern as exercises/workout plans).

### Food fields — MVP vs future (Key Design Question #2)

#### MVP (persist)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `ownership` | subdoc | ✅ | |
| `name` | String | ✅ | 2–120 chars |
| `brand` | String | optional | max 120 — common on packaged foods |
| `category` | enum | ✅ | See §5.1 |
| `status` | enum | ✅ | `active` \| `archived` |
| `nutritionPer100g` | object | ✅ | `{ calories, protein, carbs, fat }` |
| `defaultServing` | object | ✅ | See §8 — basis for `piece` / `serving` units |
| `source` | object | optional | `{ type, externalProvider, externalId }` — future import |
| `createdAt` / `updatedAt` | Date | auto | |

#### MVP optional (include if low cost)

| Field | Notes |
|-------|-------|
| `fiber` | Per 100g — optional number in `nutritionPer100g` |
| `sugar` | Per 100g — optional |
| `sodium` | Per 100g mg — optional |

#### Future-ready (design now, implement later)

| Field | Phase |
|-------|-------|
| `nameAr` / localized names | i18n phase |
| `barcode` | Barcode scanning |
| `allergens[]` | Client safety filters |
| `dietaryFlags` (`isVegetarian`, …) | Search filters |
| `micronutrients` | Nested object or separate schema |
| `densityGPerMl` | Liquid volume → weight conversion refinement |

### 5.1 `category` enum (MVP)

Simplified from frontend mock:

```text
protein
carbs
fats
vegetables
fruits
dairy
grains
legumes
nuts_seeds
beverages
condiments
prepared_meals
supplements
other
```

### Canonical nutrition basis

**All catalog macros are stored per 100g** (matching frontend mock `macros per 100g`).

For liquids, treat “100g” as “100ml” equivalent when `defaultServing.unit` is `ml` (document this convention; optional `densityGPerMl` in future for precision).

### Food API (future module)

Base path: `/api/v1/foods` — list/search/create/update/archive, mirroring `/exercises`.

---

## 6. PlanFoodItem

Embedded in `Meal.foodItems[]`.

### Purpose

A programmed food row: quantity + link to catalog Food + snapshot for historical stability.

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `_id` | ObjectId | auto | Instance id |
| `foodId` | ObjectId → Food | ✅ | Catalog reference |
| `order` | Number | ✅ | **1-based** within meal |
| `quantity` | Number | ✅ | > 0 |
| `unit` | enum | ✅ | See §8 |
| `notes` | String | optional | max 200 |
| `foodSnapshot` | object | ✅* | *Required on write (server-assembled) — see §7 |

#### Excluded (MVP)

| Field | Reason |
|-------|--------|
| Embedded full `FoodItem` | Duplicates catalog; use reference + snapshot |
| `isOptional` | Meal planning edge case — defer |
| Pre-calculated macros stored | Computed on read (see §9) |

#### Uniqueness

- `order` unique within meal.
- Same `foodId` may appear multiple times in a meal/plan (e.g. chicken in lunch and dinner).

---

## 7. Food Snapshot Strategy

### Decision: **Reference + nutrition snapshot (Option B)**

```js
{
  foodId: ObjectId,
  foodSnapshot: {
    name: String,
    brand: String | null,
    category: String,
    nutritionPer100g: {
      calories: Number,
      protein: Number,
      carbs: Number,
      fat: Number
    },
    defaultServing: {
      quantity: Number,
      unit: String,
      gramWeight: Number   // weight in grams for 1 default serving / 1 piece
    }
  }
}
```

### Comparison (Key Design Question #3)

| Strategy | Pros | Cons |
|----------|------|------|
| **A: foodId only** | Smallest payload | Plans change when catalog changes — **unacceptable** for assigned plans |
| **B: foodId + snapshot** | Historical stability; still linked to catalog | Snapshot can stale; must set on save |
| **C: full embed only** | Fully immutable | Duplicates catalog; no single source of truth |

**Recommendation: Option B** — same proven pattern as Workout `PlanExercise.exerciseId + exerciseSnapshot`.

### Behavior

| Event | Behavior |
|-------|----------|
| Food edited in catalog | Existing plans keep snapshot values for calculations |
| Detail API read | Hydrate live `food` summary from catalog **for display**; calculations use snapshot |
| Food archived | `foodId` remains valid; hydrate with `status: archived` |
| Food deleted | Must not hard-delete if referenced; if missing, fall back to snapshot only |
| Clone / version | Copy subtree including `foodId` + snapshot |

### Snapshot refresh policy (MVP)

- Server sets/refreshes snapshot **on plan save** when `foodId` is present (after visibility validation).
- Do **not** auto-refresh snapshots on catalog edit (preserves history).
- Optional future: trainer-triggered “refresh food data from catalog” action.

---

## 8. Serving / Quantity Model

### Decision (Key Design Question #4)

Store on **PlanFoodItem**:

```js
{
  quantity: Number,   // e.g. 150, 3, 1.5
  unit: enum          // g | kg | ml | l | piece | serving
}
```

Food catalog provides conversion metadata via **`defaultServing`**:

```js
defaultServing: {
  quantity: 1,           // e.g. 1 piece, 1 serving
  unit: 'piece',         // canonical unit for this food's counted item
  gramWeight: 50         // grams equivalent for 1 piece/serving (required for piece/serving)
}
```

### Unit semantics

| Unit | Conversion to calculation basis (grams) |
|------|----------------------------------------|
| `g` | `quantity` |
| `kg` | `quantity × 1000` |
| `ml` | `quantity` (liquid convention: 1ml ≈ 1g unless density added later) |
| `l` | `quantity × 1000` |
| `piece` | `quantity × defaultServing.gramWeight` |
| `serving` | `quantity × defaultServing.gramWeight` (1 serving = food's default serving weight) |

### Examples

| Food | quantity | unit | gramWeight basis | Effective grams |
|------|----------|------|------------------|-----------------|
| Chicken breast | 150 | g | — | 150 |
| Rice | 200 | g | — | 200 |
| Eggs | 3 | piece | 50 g/piece | 150 |
| Milk | 250 | ml | — | 250 |
| Greek yogurt | 1 | serving | 170 g/serving | 170 |

### Why not a separate Serving entity?

Trainers think in “150 g” or “3 eggs” — `quantity + unit` is sufficient for MVP. Avoid `ServingSize`, `ServingUnit`, and `quantity` as three overlapping concepts.

### Validation rules

- `quantity` > 0, reasonable max (e.g. 10000) per unit type.
- When `unit` is `piece` or `serving`, food must have `defaultServing.gramWeight` or reject with field error.
- Unsupported units (cups, tbsp, oz) — **defer**; frontend can convert to g/ml before save in MVP.

---

## 9. Macro Calculation Model

### Data flow (Key Design Question #5)

```text
Food.nutritionPer100g
        ↓
PlanFoodItem quantity → gram equivalent (§8)
        ↓
itemMacros = nutritionPer100g × (grams / 100)   [uses snapshot]
        ↓
mealTotals = Σ itemMacros
        ↓
dayTotals = Σ mealTotals
        ↓
planTotals = Σ dayTotals   (or avg across days for list display)
```

### Where macros come from

| Level | Source |
|-------|--------|
| Catalog | `Food.nutritionPer100g` |
| Plan item | Scaled from **`foodSnapshot.nutritionPer100g`** (not live catalog) |
| Meal / day / plan totals | **Calculated** |

### Store vs calculate (Key Design Question #5)

| Approach | MVP recommendation |
|----------|-------------------|
| Calculate on every read | ✅ **Primary** — source of truth is items + snapshots |
| Store totals on meal/day/plan | 🟡 **Denormalize only list counters** (`avgDailyCalories`, `totalMeals`) updated on save |
| Store per-item calculated macros | ❌ Avoid — duplicates quantity changes |

**Safest MVP:** Pure calculation on read for detail/builder; update denormalized **plan-level** counters on save for list sort/filter performance.

### Rounding

- Store full precision internally; round to 1 decimal for API display (calories → whole numbers).
- Use same rounding in API helpers so builder totals match list cards.

### Macro targets vs actuals

| Concept | Storage |
|---------|---------|
| Targets | `NutritionPlan.macroTargets` — trainer-set goals |
| Actuals | Computed from days — returned as `computedMacros` / `dailyTotals` in API |

Detail response should include variance hints for UI (e.g. day calories vs target) — computed, not stored.

---

## 10. Macro Targets

### Decision (Key Design Question #6)

Store directly on **NutritionPlan**:

```js
macroTargets: {
  calories: Number,   // kcal, required, > 0
  protein: Number,    // grams, ≥ 0
  carbs: Number,      // grams, ≥ 0
  fat: Number         // grams, ≥ 0
}
```

### Notes

- **Belongs on plan** — targets define the program intent (same for all assignment days unless client-specific overrides added later).
- Do **not** persist `proteinPercentage` / macro splits in MVP — frontend TDEE calculator can derive percentages for display.
- Optional `macroPreset` enum (`balanced`, `high_protein`, `low_carb`, `keto`, `custom`) may be stored as UI hint — **optional**, not required for calculation.
- Server may validate soft consistency (protein+carb+fat calories ≈ target calories) as warning-only in MVP, not hard error.

### Relation to frontend calculator

`useMacroCalculator` (BMR/TDEE) operates on **client profile** — out of scope for plan document. Trainer manually sets `macroTargets` on plan (possibly after using calculator offline in UI).

---

## 11. Ownership

### Decision (Key Design Question #9)

**Reuse Workout Plan ownership model exactly.**

```js
ownership: {
  type: 'system' | 'trainer',
  trainerId: ObjectId | null
}
```

| Kind | ownership | isTemplate | Behavior |
|------|-----------|------------|----------|
| System template | `system` / null | `true` | Globally readable; trainer read-only; cloneable |
| Trainer template | `trainer` / owner | `true` | Owner CRUD; cloneable |
| Trainer plan | `trainer` / owner | `false` | Owner CRUD; assignable |

- Never accept `ownership`, `trainerId`, or `templateKey` from request body.
- `trainerId` always from `req.user.id` for trainer-created resources.

---

## 12. Templates

### Decision (Key Design Question #10)

Same UX direction as Workout Plans — **no separate template collection**.

| Concern | Design |
|---------|--------|
| System templates | Seeded with `ownership.type=system`, `templateKey`, `isTemplate=true` |
| Trainer templates | `isTemplate=true`, trainer ownership |
| Clone | `POST /nutrition-plans/:id/clone` — active templates only |
| Archive | `status: archived` — hidden from default lists |
| List browse | `?ownership=system&isTemplate=true` |

### Example system `templateKey` values (seed phase)

```text
weight-loss
muscle-gain
maintenance
high-protein
balanced-diet
```

### Plan icon (Key Design Question #11)

**Recommendation: reuse Workout Plan Iconify pattern.**

```js
icon: {
  type: String,
  trim: true,
  default: 'lucide:apple'
}
```

| Aspect | Decision |
|--------|----------|
| Storage | Lightweight string identifier (`lucide:apple`) |
| API | Optional on create/update; server default when omitted |
| Validation | Simple string trim/max length — **no** Iconify validation on backend |
| Picker | Frontend curated set only (like workout plans) |

Frontend currently derives icons from calorie tiers — when backend ships, **prefer trainer-selected icon from API** for templates and plans (consistent with workout plans). Calorie-tier icons may remain as frontend fallback for legacy/mock rows.

---

## 13. Cloning

Mirror Workout Plan clone semantics:

| Rule | Behavior |
|------|----------|
| Source | Active template (`isTemplate=true`, `status=active`) |
| System templates | Cloneable by any trainer |
| Trainer templates | Cloneable by owner |
| Result | New trainer-owned plan, `isTemplate=false`, `templateKey=null` |
| Payload | Optional `name` override only |
| Preserved | Full `nutritionDays` tree, `macroTargets`, `icon`, snapshots |
| New ids | New plan `_id` + new nested subdocument ids |

---

## 14. Assignments

### Decision (Key Design Question #12)

**Separate `NutritionPlanAssignment` collection** — same conceptual architecture as `PlanAssignment` (workout).

### NutritionPlanAssignment fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `trainerId` | ObjectId | ✅ | Server from JWT |
| `planId` | ObjectId → NutritionPlan | ✅ | Must be readable by trainer |
| `planVersionId` | ObjectId | optional | Future — pin snapshot |
| `clientId` | ObjectId → User | ✅ | Trainer's client |
| `startDate` | Date | ✅ | Client schedule start |
| `endDate` | Date | optional | |
| `status` | enum | ✅ | `active` \| `completed` \| `paused` \| `cancelled` |
| `notes` | String | optional | max 1000 |
| `createdAt` / `updatedAt` | Date | auto | |

#### Excluded from assignment (MVP)

| Field | Reason |
|-------|--------|
| `progress` / `completedSessions` | Workout-specific session tracking |
| Adherence percentage | Client food logging — future |

### Assignment validation

1. Plan readable: system ∪ own trainer plan.
2. `plan.status === 'active'` (not draft/archived).
3. Client: `User.findOne({ _id: clientId, role: 'client', trainer: trainerId })`.
4. Bulk assign: `clientIds[]` in body (mirror workout).

### API (Key Design Question #18)

| Method | Path |
|--------|------|
| POST | `/nutrition-plans/:id/assignments` |
| GET | `/nutrition-plans/:id/assignments` |

Future: `GET /nutrition-assignments` trainer dashboard aggregate.

---

## 15. Versioning Strategy

### Decision (Key Design Question #13)

**Design for separate `NutritionPlanVersion` collection — do not implement in MVP.**

```text
NutritionPlanVersion
  planId
  trainerId
  versionNumber
  name, description, goal, macroTargets, daysCount
  nutritionDays[]    // full deep snapshot
  createdBy
  createdAt
```

Same rationale as WorkoutPlanVersion: avoid unbounded growth inside plan document.

### MVP assignment behavior

| Approach | MVP |
|----------|-----|
| Assign live plan (`planId` only) | ✅ Supported |
| Pin `planVersionId` on assign | 🟡 Field reserved, null in MVP |

**Historical consistency problem:** If trainer edits plan after assignment, client effectively sees updated plan on next detail fetch (live reference).

**MVP mitigation (document, don't over-build):**

1. UI warning: “This plan has active assignments” before save.
2. Recommend trainers clone before major edits, or duplicate for client-specific tweaks.
3. Phase 5+ — version snapshot on assign (same as workout recommendation).

Editing assigned plans is **allowed** in MVP (trainer flexibility) with product warning — not blocked server-side.

---

## 16. Archive Semantics

### Status model (Key Design Question #14)

```text
draft     — work in progress; assignable optionally (recommend: block assignment)
active    — default usable state
archived  — soft-deleted
```

Mirror Workout Plan semantics:

| State | Default list | Readable by id | Assignable | Editable |
|-------|--------------|----------------|------------|----------|
| `draft` | Hidden unless filter | ✅ | ❌ (recommend) | ✅ owner |
| `active` | ✅ | ✅ | ✅ | ✅ owner |
| `archived` | ❌ | ✅ | ❌ | ❌ (recommend) |

**DELETE** endpoint → sets `status: archived` (not hard delete).

Frontend mock uses `completed` on plans — map client program completion to **assignment** `status: completed`, not plan status.

### Default on create

Recommend **`active`** to match current builder UX (same open decision as workout plans).

---

## 17. API Design

Base path: **`/api/v1/nutrition-plans`**

### MVP endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/nutrition-plans` | List (filters, sort, pagination) |
| GET | `/nutrition-plans/:id` | Full detail + computed macros |
| POST | `/nutrition-plans` | Create |
| PATCH | `/nutrition-plans/:id` | Update — see §17.1 |
| DELETE | `/nutrition-plans/:id` | Archive |
| POST | `/nutrition-plans/:id/clone` | Clone template |
| POST | `/nutrition-plans/:id/assignments` | Assign to client(s) |
| GET | `/nutrition-plans/:id/assignments` | List assignments |

### Food catalog (parallel module)

| Method | Path |
|--------|------|
| GET | `/foods` |
| GET | `/foods/:id` |
| POST | `/foods` |
| PATCH | `/foods/:id` |
| DELETE | `/foods/:id` |

### 17.1 PATCH strategy (Key Design Question #17)

Same as Workout Plans:

| PATCH type | Support |
|------------|---------|
| Partial metadata only | ✅ When `nutritionDays` **omitted** |
| Full tree replace | ✅ When `nutritionDays` **present** — authoritative replace of all days/meals/foodItems |

Partial PATCH updates top-level fields (`name`, `macroTargets`, `icon`, …) without touching days.

### 17.2 POST create body (trainer-controlled)

```json
{
  "name": "High Protein — 2200 kcal",
  "description": "optional",
  "icon": "lucide:apple",
  "goal": "high_protein",
  "duration": 8,
  "daysCount": 7,
  "macroTargets": {
    "calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fat": 70
  },
  "isTemplate": false,
  "nutritionDays": []
}
```

Forbidden: `trainerId`, `ownership`, `templateKey`, `clientId`, `startDate`, `endDate`, `_id`, timestamps.

### 17.3 List query parameters (Key Design Question #15)

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `search` | string | — | name + description regex |
| `status` | enum | `active` | |
| `ownership` | `system` \| `trainer` \| `all` | `trainer` | Mirror workout |
| `isTemplate` | boolean | — | |
| `goal` | enum | — | Nutrition-specific |
| `page` | number | 1 | |
| `limit` | number | 24 | max 100 |
| `sort` | enum | `newest` | See below |

**Sort options (MVP):**

```text
name, name-desc, newest, oldest,
calories-high, calories-low,
days-high, days-low
```

**Nutrition-specific filters (future-friendly):**

| Param | MVP |
|-------|-----|
| `goal` | ✅ |
| `minCalories` / `maxCalories` | 🟡 Optional — filter on `macroTargets.calories` |
| `dietaryPreference` | ❌ Deferred — lives on client profile |

### 17.4 Detail response shape (Key Design Question #16)

Return full tree + computed nutrition + optional catalog hydration:

```json
{
  "nutritionPlan": {
    "id": "...",
    "name": "...",
    "icon": "lucide:apple",
    "goal": "muscle_gain",
    "duration": 8,
    "daysCount": 7,
    "macroTargets": { "calories": 2200, "protein": 180, "carbs": 220, "fat": 70 },
    "computedMacros": {
      "avgDailyCalories": 2150,
      "avgDailyProtein": 175,
      "avgDailyCarbs": 210,
      "avgDailyFat": 68
    },
    "nutritionDays": [
      {
        "id": "...",
        "dayNumber": 1,
        "name": "Day 1",
        "dailyTotals": { "calories": 2180, "protein": 178, "carbs": 215, "fat": 69 },
        "meals": [
          {
            "id": "...",
            "order": 1,
            "name": "Breakfast",
            "mealType": "breakfast",
            "mealTotals": { "calories": 520, "protein": 35, "carbs": 45, "fat": 18 },
            "foodItems": [
              {
                "id": "...",
                "foodId": "...",
                "quantity": 150,
                "unit": "g",
                "foodSnapshot": { "name": "Chicken Breast", "nutritionPer100g": { "..." } },
                "itemMacros": { "calories": 248, "protein": 46, "carbs": 0, "fat": 5 },
                "food": { "id": "...", "name": "Chicken Breast", "status": "active" }
              }
            ]
          }
        ]
      }
    ],
    "ownership": { "type": "trainer", "trainerId": "..." },
    "isTemplate": false,
    "status": "active",
    "totalMeals": 42,
    "totalFoodItems": 210,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

| Field | Stored vs computed |
|-------|-------------------|
| `foodSnapshot` | Stored on item |
| `itemMacros`, `mealTotals`, `dailyTotals`, `computedMacros` | Computed on read |
| `food` | Hydrated from catalog for UI; optional if snapshot sufficient |

### 17.5 List item shape

```json
{
  "id": "...",
  "name": "...",
  "icon": "lucide:apple",
  "goal": "weight_loss",
  "duration": 8,
  "daysCount": 7,
  "macroTargets": { "calories": 1800, "protein": 150, "carbs": 150, "fat": 60 },
  "avgDailyCalories": 1780,
  "isTemplate": false,
  "status": "active",
  "totalMeals": 35,
  "totalFoodItems": 140,
  "ownership": { "type": "trainer", "trainerId": "..." },
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

## 18. Validation Design

Use **Joi** in `nutrition-plan.validator.js` and `food.validator.js` (not implemented yet).

### Forbidden server fields (all write schemas)

```js
trainerId, ownership, templateKey, clientId,
startDate, endDate, createdAt, updatedAt,
computedMacros, dailyTotals, mealTotals, itemMacros
```

### Plan metadata

| Field | Rules |
|-------|-------|
| `name` | required on create, 2–120 trim |
| `description` | optional, max 2000 |
| `icon` | optional string, trim, max 120 |
| `goal` | valid enum |
| `duration` | int ≥ 1 |
| `daysCount` | int 1–14 |
| `macroTargets.calories` | number > 0 |
| `macroTargets.protein/carbs/fat` | number ≥ 0 |
| `isTemplate` | boolean |
| `status` | enum on update only (or server-controlled archive) |

### nutritionDays array

| Rule | Constraint |
|------|------------|
| Max days | 14 |
| `dayNumber` | unique 1–14 |
| Max meals per day | 12 |
| `meal.order` | unique 1-based per day |
| Max foodItems per meal | 30 |
| `foodItem.order` | unique 1-based per meal |

### PlanFoodItem

| Field | Rules |
|-------|-------|
| `foodId` | valid ObjectId; food visible to trainer |
| `quantity` | number > 0 |
| `unit` | `g` \| `kg` \| `ml` \| `l` \| `piece` \| `serving` |

Custom validators (helpers):

- Unique day numbers, meal orders, food orders (mirror workout helpers).
- `piece`/`serving` requires food `defaultServing.gramWeight`.

### Food catalog

| Field | Rules |
|-------|-------|
| `name` | 2–120 |
| `nutritionPer100g.*` | ≥ 0; calories required |
| `defaultServing.gramWeight` | required if unit is piece/serving-capable food |

### Assignment

| Field | Rules |
|-------|-------|
| `clientIds` | min 1, unique ObjectIds |
| `startDate` | required |
| `endDate` | optional, after startDate |

---

## 19. Authorization Rules

All enforcement **server-side** in services.

| Action | Rule |
|--------|------|
| Read plan | System plan ∪ own trainer plan |
| Create plan | Trainer role; `ownership.trainerId = req.user.id` |
| Update / archive | Own trainer plan only — **not** system |
| Clone | Active template; system ∪ own |
| Assign | Readable plan + active + own client |
| Food read | System ∪ own (mirror exercise visibility) |
| Food write | Own trainer foods only |

`trainerId` **never** from request body — always `req.user.id`.

Middleware stack: `protect` → `authorize('trainer', 'admin')` → controller → service.

---

## 20. MongoDB Index Strategy

Document only — create in implementation phase.

### NutritionPlan

| Index | Purpose |
|-------|---------|
| `{ 'ownership.type': 1, 'ownership.trainerId': 1, status: 1, createdAt: -1 }` | Trainer list |
| `{ 'ownership.type': 1, isTemplate: 1, status: 1 }` | System template browse |
| `{ trainerId: 1, status: 1, isTemplate: 1 }` | Legacy/compatibility |
| `{ name: 'text', description: 'text' }` | Search (optional) |
| `{ templateKey: 1 }` unique partial `{ ownership.type: 'system', isTemplate: true, templateKey: { $type: 'string' } }` | Seed idempotency |

### Food

| Index | Purpose |
|-------|---------|
| `{ 'ownership.type': 1, 'ownership.trainerId': 1, status: 1 }` | Visibility filter |
| `{ name: 'text' }` | Search |
| `{ name: 1, 'ownership.type': 1, 'ownership.trainerId': 1 }` | Duplicate custom food check |

### NutritionPlanAssignment

| Index | Purpose |
|-------|---------|
| `{ trainerId: 1, status: 1, startDate: -1 }` | Trainer dashboard |
| `{ planId: 1, clientId: 1 }` | Plan-client lookup |
| `{ clientId: 1, status: 1 }` | Client active plan |

---

## 21. Frontend Integration Contract

When backend ships, frontend should migrate from mock data:

| Concern | Contract |
|---------|----------|
| Types | Map API `nutritionDays` → builder state; `PlanFoodItem` not full embedded food |
| Create/Edit | POST/PATCH with full `nutritionDays[]` on builder save |
| List | `GET /nutrition-plans?ownership=trainer&status=active` |
| Templates | `?ownership=system&isTemplate=true` |
| Clone | `POST /nutrition-plans/:id/clone` |
| Assign modal | `POST .../assignments` with `clientIds[]`, dates |
| Icons | Read/write `icon` string; replace calorie-tier derivation for API-backed rows |
| Macro calculator | Client-side only; writes `macroTargets` to plan payload |
| Foods | Replace `foodDatabase.ts` with `GET /foods?search=` |

**Do not** send `clientId` on plan create — use assignments.

---

## 22. MVP Scope

### In scope

- Food catalog (system + trainer custom)
- Nutrition plans with embedded days/meals/food items
- Macro targets on plan
- Quantity + unit on food items
- Macro calculation (read-time)
- foodId + foodSnapshot
- Ownership + system templates + templateKey + clone
- Plan icon string
- Assignments (separate collection)
- Archive + search/filter/pagination
- CRUD + list + detail APIs

### Out of scope (explicit)

- Micronutrient tracking
- Meal photos / media
- AI meal generation
- Grocery / shopping lists
- Barcode scanning
- Recipe builder (instructions, prep/cook)
- Supplement tracking
- Client food logging / adherence
- Client nutrition profile persistence
- Plan versioning implementation
- Meal alternatives / swaps
- Water intake targets

---

## 23. Future Extensions

| Extension | Design hook |
|-----------|-------------|
| NutritionPlanVersion | Separate collection; `planVersionId` on assignment |
| Client profile + TDEE | `ClientNutritionProfile` collection linked to User |
| Meal library | Reusable `Meal` collection referenced by id — requires normalized meal entity |
| Shopping list | Generated from plan snapshot + date range |
| Adherence tracking | Client meal logs referencing `PlanFoodItem._id` |
| Barcode / import | `Food.source.externalProvider` |
| Allergen filters | `Food.allergens[]` |
| i18n food names | `Food.localizedNames` |
| Copy day / repeat week | Builder UX; backend already supports independent days |
| Normalize foodItems collection | If analytics require cross-plan food queries at scale |

---

## 24. Recommended Implementation Phases

Adjusted from product dependencies (Food catalog must exist before plans reference foods):

| Phase | Deliverable |
|-------|-------------|
| **Phase 1** | **Domain design (this document)** ✅ |
| **Phase 2** | **Food module** — model, constants, validators, helpers, list/search/create/update/archive API, system seed |
| **Phase 3** | **NutritionPlan module foundation** — model (embedded tree), constants, validators, helpers, macro calculation utils |
| **Phase 4** | **NutritionPlan CRUD API** — list, detail, create, patch, archive |
| **Phase 5** | **Templates + clone** — system seed (5 templates), `POST /clone`, ownership filters |
| **Phase 6** | **Assignments** — NutritionPlanAssignment model + assign/list APIs |
| **Phase 7** | **Frontend list + templates** — replace mock listing, template library, clone flow |
| **Phase 8** | **Frontend builder (create)** — food search API, plan save |
| **Phase 9** | **Frontend edit + assign UI** — PATCH load/save, assignment modal |
| **Phase 10** | **Versioning (optional)** — NutritionPlanVersion + assign pin |

**Recommended next phase after design:** **Phase 2 — Food module**, because NutritionPlan validation depends on resolvable `foodId` references.

---

## Appendix A — Key Design Decisions Summary

| # | Question | Decision |
|---|----------|----------|
| 1 | Embedded vs separate collections | **Embedded days/meals/foods** in NutritionPlan |
| 2 | Food model | **Separate Food collection**; MVP per-100g macros + defaultServing |
| 3 | Reference vs snapshot | **foodId + foodSnapshot** (nutrition data in snapshot) |
| 4 | Quantity model | **quantity + unit enum** (g, kg, ml, l, piece, serving) |
| 5 | Macro totals | **Calculate on read**; denormalize plan list counters on save |
| 6 | Macro targets | **On NutritionPlan.macroTargets** |
| 7 | Meals | **Free-text name** + optional mealType |
| 8 | Days | **Independent days** with dayNumber 1–N |
| 9 | Ownership | **Same as Workout Plans** |
| 10 | Templates | **isTemplate + templateKey + system seed** |
| 11 | Icon | **Iconify string** — reuse workout pattern |
| 12 | Assignments | **Separate NutritionPlanAssignment collection** |
| 13 | Versioning | **Designed, not MVP**; live plan assign with UI warning |
| 14 | Archive | **draft / active / archived** — mirror workout |
| 15 | List API | **search, status, ownership, isTemplate, goal, sort, pagination** |
| 16 | Detail API | **Full tree + computed macros + optional food hydration** |
| 17 | PATCH | **Authoritative nutritionDays[] replace** when present |
| 18 | Assignment API | **POST/GET .../assignments** |

---

## Appendix B — Known Decisions / Tradeoffs

1. **Embedded tree vs normalized** — Simpler MVP at cost of harder cross-plan food analytics; acceptable until scale demands otherwise.
2. **Snapshot vs live catalog for macros** — Stability wins; trainer may see stale name until edit refresh — acceptable.
3. **Per-100g canonical basis** — Matches frontend mock; piece/serving requires explicit `gramWeight` on food — trainers must have accurate serving data.
4. **No versioning in MVP** — Editing assigned plans affects live client view — mitigated by UX warnings and future version pinning.
5. **Frontend mock divergence** — Backend intentionally drops recipe fields, clientId on plan, separate template entity, and weekday-based day indexing.
6. **Liquid ml ≈ g** — Good enough for MVP; density field later for accuracy (e.g. oils).
7. **Icon: trainer-selected vs calorie-derived** — Backend stores trainer/icon picker value; frontend may keep tier fallback for empty legacy rows.

---

*End of design document. No production code has been written.*
