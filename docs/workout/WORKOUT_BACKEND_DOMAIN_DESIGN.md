# FitlyPro Workout Plan — Backend Domain Design

> **Phase:** Domain design / API contract only  
> **Status:** Design complete — **no implementation**  
> **Date:** 2026-08-23  
> **Primary frontend source:** `fityl-pro/docs/workout/WORKOUT_MODULE_SPEC.md`  
> **Backend repo:** `fitly-pro-backend`

This document defines the production Workout Plan backend based on the **current frontend Workout implementation** and **existing backend architecture**. It does not implement models, routes, or database writes.

---

## 1. Existing Backend Conventions

### Architecture

Feature modules under `src/modules/` follow:

```text
routes → controller → service → model
```

Existing modules: `auth`, `users`, `clients`, `exercises`.

Mount point: `src/routes/index.js` → `/api/v1/*` (via `config.api.prefix`).

### Authentication & authorization

| Layer | Pattern |
|-------|---------|
| JWT | `protect` middleware → `req.user` (full User document) |
| Role gate | `authorize('trainer', 'admin')` on trainer modules |
| Ownership | **Service layer** — never trust client-sent `trainerId` |

Trainer identity: `req.user.id` (ObjectId string).

### Response & errors

| Utility | Usage |
|---------|--------|
| `ApiResponse(statusCode, data, message)` | `{ success, statusCode, message, data }` |
| `ApiError(statusCode, message, errors[])` | Thrown from services; global error handler |
| `asyncHandler` | Wraps controllers |

List pagination (clients / exercises style):

```json
{
  "items": [],
  "pagination": { "page", "limit", "total", "pages" }
}
```

Exercise list uses `exercises`; clients use `clients`. Workout plans should use `workoutPlans`.

### Validation

- Joi schemas in `*.validator.js`
- Body: `validate(schema)` middleware → `req.body` sanitized, `stripUnknown: true`
- Query: validated in controller (Exercise pattern) or dedicated middleware
- Forbidden server fields: `Joi.forbidden()` (Exercise create/update pattern)

### ObjectId handling

Exercise service pattern:

```js
mongoose.Types.ObjectId.isValid(id) &&
new mongoose.Types.ObjectId(id).toString() === String(id)
```

Invalid id → `400`; missing / foreign-owned → `404` or `403` per domain rules.

### Ownership patterns (reference)

| Module | Rule |
|--------|------|
| **Clients** | `User` with `role: 'client'`, `trainer: trainerId`. Service checks `client.trainer.toString() === trainerId`. |
| **Exercises** | System ∪ own trainer via `buildExerciseVisibilityFilter(trainerId)`. Mutations require `ownership.type === 'trainer'` **and** `ownership.trainerId === trainerId`. System → `403`. |

Workout plans should mirror **client/exercise trainer scoping**: all plans and assignments scoped to `trainerId = req.user.id`.

### Soft delete precedent

Clients use `isActive = false` (soft delete), not hard delete. Workout plans should use **archive** (`status: archived`) for delete semantics.

### Transactions

Clients module explicitly avoids transactions (single-model writes). Exercise seed/import uses sequential saves. **No existing transaction infrastructure** — recommend transactions only where truly needed (see §20).

### Workout backend today

```text
No Workout models, routes, controllers, or services.
src/routes/index.js contains commented: // router.use('/workouts', workoutRoutes);
```

---

## 2. Domain Overview

### Entities evaluated

| Frontend type | Production entity | MongoDB collection | MVP |
|---------------|-------------------|--------------------|-----|
| `WorkoutPlan` | **WorkoutPlan** | `workoutplans` | ✅ Required |
| `WorkoutDay` | Embedded in WorkoutPlan | — (embedded) | ✅ Required |
| `WorkoutExercise` | **PlanExercise** (embedded) | — (embedded) | ✅ Required |
| `ExerciseSet` | Embedded in PlanExercise | — (embedded) | ✅ Required |
| `PlanAssignment` | **PlanAssignment** | `planassignments` | ✅ Required |
| `PlanVersion` | **WorkoutPlanVersion** | `workoutplanversions` | 🟡 Recommended (UI exists) |
| `Circuit` | — | — | ❌ Deferred |
| `WorkoutSession` | — | Future epic | ❌ Out of scope |

### Naming note

Use **`PlanExercise`** in backend docs/code to avoid confusion with the Exercise Library `Exercise` catalog model. API JSON may expose as `exercises[]` inside a day to match frontend shape.

### System / global templates

**Supported (Phase 4A).** WorkoutPlan supports system ownership:

```js
ownership: {
  type: 'system' | 'trainer',
  trainerId: ObjectId | null
}
```

| Kind | ownership | isTemplate | Notes |
|------|-----------|------------|-------|
| System template | `system` / `null` | `true` | Globally readable; trainer read-only; cloneable |
| Trainer template | `trainer` / owner | `true` | Owner only; cloneable |
| Trainer plan | `trainer` / owner | `false` | Owner CRUD |

Compatibility: top-level `trainerId` is retained and mirrored from `ownership.trainerId` (null for system). `ownership` is canonical.

Clone: `POST /workout-plans/:id/clone` — active templates only (system or own).

List: `?ownership=system|trainer|all` (default `trainer`). Template browse: `?ownership=system&isTemplate=true`.

---

## 3. WorkoutPlan

### Purpose

Reusable program definition: metadata + ordered training days + programmed exercises/sets. **Not** client-specific schedule (that is `PlanAssignment`).

### Ownership

```js
{
  ownership: {
    type: 'system' | 'trainer',  // CANONICAL — server-only
    trainerId: ObjectId | null
  },
  trainerId: ObjectId | null,   // Phase 2 compatibility mirror
  templateKey: String | null    // system seed identity only
}
```

- Never accept `ownership`, `trainerId`, or `templateKey` from request body.
- Never accept `clientId` on the plan document (frontend type has optional `clientId` but assignment uses `PlanAssignment.clientId`).
- System: `ownership.type=system`, both trainerId fields null, `isTemplate=true`.
- Trainer: `ownership.type=trainer`, `ownership.trainerId=req.user.id`, `trainerId` mirrored.

### Recommended persistence: **embedded tree (Option A)**

```text
WorkoutPlan
  └── workoutDays[]          (embedded subdocuments)
        └── exercises[]      (PlanExercise embedded)
              └── sets[]     (ExerciseSet embedded)
```

**Separate collections:** `PlanAssignment`, `WorkoutPlanVersion`.

#### Why embed (vs normalize days/exercises/sets)

| Factor | Embedded | Normalized |
|--------|----------|------------|
| Builder save | Single atomic document replace | Multi-collection sync, ordering complexity |
| Typical size | ~3–7 days × ~5–12 exercises × ~3–5 sets ≪ 16MB | Same data, more round-trips |
| Reorder / bulk edit | Array updates on one doc | Many updates |
| Version snapshot | Deep clone subtree | Join + assemble |
| Session logging (future) | May need denormalized session docs anyway | Easier reference by id |

**Recommendation:** Embed days/exercises/sets for MVP. Revisit normalization only if plans exceed safe document size or session logging requires independent exercise documents.

#### Subdocument identity

Enable Mongoose `_id` on embedded `workoutDays`, `exercises`, and `sets` subdocuments so:

- `supersetWith` can reference sibling `PlanExercise._id`
- Duplicate same `exerciseId` appears as distinct instances
- Frontend `id` fields map to subdocument `_id` on create/update

### WorkoutPlan fields (MVP)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `trainerId` | ObjectId → User | ✅ | Server-only |
| `name` | String | ✅ | 2–120 chars (align Exercise name limits) |
| `description` | String | optional | max 2000 |
| `duration` | Number | ✅ | Program length in **weeks** (metadata only — no Week entity) |
| `daysPerWeek` | Number | ✅ | 1–7, target frequency |
| `goal` | enum | ✅ | See §3.1 |
| `level` | enum | ✅ | See §3.2 |
| `workoutDays` | WorkoutDay[] | ✅ | May be empty array on create step 1 |
| `isTemplate` | Boolean | ✅ | List filter: Templates |
| `status` | enum | ✅ | `draft` \| `active` \| `archived` — see §9 |
| `notes` | String | optional | Plan-level notes (rare in UI) |
| `createdAt` / `updatedAt` | Date | auto | Mongoose timestamps |

#### Explicitly excluded from WorkoutPlan (MVP)

| Field | Reason |
|-------|--------|
| `startDate` / `endDate` | Belong on **PlanAssignment**, not plan template |
| `clientId` | Use PlanAssignment |
| `isActive` (boolean) | Replaced by `status` enum; API adapter maps for frontend |

### 3.1 `goal` enum (from frontend `WorkoutGoal`)

```text
muscle_gain
strength
fat_loss
endurance
athletic_performance
general_fitness
rehabilitation
```

### 3.2 `level` enum (from frontend `DifficultyLevel`)

Frontend includes `expert`. Backend Exercise Library uses `beginner | intermediate | advanced`.

**Recommendation:** Persist plan `level` as:

```text
beginner | intermediate | advanced | expert
```

Accept frontend `expert` as-is for plan metadata (program difficulty label). Do not conflate with Exercise catalog `difficulty`.

---

## 4. WorkoutDay

Embedded in `WorkoutPlan.workoutDays[]`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `_id` | ObjectId | auto | Subdocument id |
| `dayNumber` | Number | ✅ | **1-based** ordinal (1–7). Matches frontend. |
| `name` | String | ✅ | e.g. "Push Day" |
| `description` | String | optional | |
| `exercises` | PlanExercise[] | ✅ | Ordered by `order` field |

#### Excluded (MVP)

| Field | Reason |
|-------|--------|
| `estimatedDuration` | Mock seed only; not computed in builder |
| `notes` | Unused in UI |
| Rest-day entity | No `isRestDay` in product; empty exercise list = implicit rest |

#### Uniqueness

- `dayNumber` unique **within plan** (validator enforced).
- Days may be sparse (e.g. 4-day split with dayNumber 1–4).

---

## 5. PlanExercise

Embedded in `WorkoutDay.exercises[]`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `_id` | ObjectId | auto | Instance id — **not** catalog exercise id |
| `exerciseId` | ObjectId → Exercise | ✅ | Exercise Library reference |
| `order` | Number | ✅ | **1-based** within day; sort key |
| `sets` | ExerciseSet[] | ✅ | min 1 set recommended |
| `restBetweenSets` | Number | ✅ | Seconds, ≥ 0 |
| `notes` | String | optional | max 500 |
| `tempo` | String | optional | e.g. `3-1-1-0`, max 20 |
| `supersetWith` | ObjectId | optional | Ref sibling `PlanExercise._id` same day |
| `exerciseSnapshot` | object | optional | See §7 — `{ name, thumbnailUrl }` |

#### Excluded (MVP)

| Field | Reason |
|-------|--------|
| `exercise` (populated) | Response-only via join/hydration |
| `circuitGroup` | Unused string; circuits deferred |
| `alternatives` | UI not wired |

#### Duplicate exercises

Same `exerciseId` may appear **multiple times** in a day/plan. Each row is a distinct `PlanExercise` with its own `_id`, sets, and order.

**Never** use `exerciseId` as unique key within a day.

---

## 6. ExerciseSet

Embedded in `PlanExercise.sets[]`.

### MVP fields (builder UI)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `_id` | ObjectId | auto | |
| `setNumber` | Number | ✅ | **1-based** within exercise |
| `reps` | Number | optional | Integer ≥ 0 |
| `weight` | Number | optional | ≥ 0 |
| `weightUnit` | enum | ✅ | `kg` \| `lbs` |
| `isWarmup` | Boolean | optional | default false |
| `isDropset` | Boolean | optional | default false |

### Future fields (type-only in frontend — **do not persist in MVP**)

```text
repRange { min, max }
duration
distance
rpe
rir
notes (per-set)
percentage loading
```

Add in a later phase when UI supports them.

#### Set model structure

**Embed sets inside PlanExercise** (not a separate collection). Builder edits sets together with the exercise; atomic plan save is simpler.

#### Ordering

- `setNumber` is **1-based**, unique within parent `PlanExercise`.
- Reorder = renumber sets sequentially on save.

---

## 7. Exercise Reference Strategy

### Decision: **Option B — reference + lightweight snapshot**

```js
{
  exerciseId: ObjectId,           // canonical link to Exercise Library
  exerciseSnapshot: {             // optional but recommended on write
    name: String,
    thumbnailUrl: String | null
  }
}
```

### Comparison

| Strategy | Pros | Cons |
|----------|------|------|
| **A: id only** | Smallest payload; always live catalog data | Broken display if exercise archived/deleted; extra joins every read |
| **B: id + snapshot** | Stable builder/history display; still one source of truth for programming | Snapshot can become stale; need refresh policy |
| **C: full embed** | Offline-friendly | Duplicates catalog; violates Exercise Library ownership |

### Behavior

| Event | Behavior |
|-------|----------|
| Exercise edited in library | Plan shows updated data on read **if** hydrated from catalog; snapshot remains fallback |
| Exercise archived | `exerciseId` still valid for historical plans; hydrate with `status: archived` flag in API response |
| Exercise deleted | Should not hard-delete catalog exercises assigned to plans; if missing, fall back to `exerciseSnapshot` |
| Version snapshot | Copy `workoutDays` subtree including `exerciseId` + snapshot at version time |
| Client execution (future) | Session logs reference `PlanExercise._id` + `exerciseId` |

### Snapshot refresh policy (MVP)

- Set/update snapshot **on plan save** when `exerciseId` is present (server-side after validation).
- Do not store full muscles/equipment/category in snapshot.

---

## 8. Exercise Visibility Validation

On create/update, for **each** `PlanExercise.exerciseId`:

```js
Exercise.findOne({
  _id: exerciseId,
  ...buildExerciseVisibilityFilter(trainerId)
})
```

| Catalog exercise | Allowed |
|------------------|---------|
| System (`ownership.type: system`) | ✅ |
| Own trainer exercise | ✅ |
| Another trainer's private exercise | ❌ `400` with field error |
| Missing / invalid id | ❌ `400` |

Do not rely on frontend filtering. Reuse `buildExerciseVisibilityFilter` from `exercise.helpers.js`.

---

## 9. Plan Lifecycle

### Status model

Replace frontend `isActive` boolean with semantic **`status`**:

```text
draft     — editable, not promoted (maps from isActive: false)
active    — usable for assignment (maps from isActive: true)
archived  — soft-deleted, hidden from default lists
```

Keep **`isTemplate`** boolean (frontend Templates filter).

| Frontend | Backend |
|----------|---------|
| `isTemplate: true` | `isTemplate: true` |
| `isActive: true` | `status: active` |
| `isActive: false` | `status: draft` |
| Delete action | `status: archived` (not hard delete) |

### Defaults on create

```js
{
  isTemplate: false,
  status: 'draft',        // or 'active' if product prefers — frontend create hardcodes isActive: true
  trainerId: req.user.id
}
```

**Open decision:** Match frontend create (`isActive: true`) → default `status: active`, or default `draft` until explicit publish. Recommend **`active`** to match current builder behavior until publish workflow exists.

### Archived plans

- Remain readable by id for assignment history.
- Excluded from default list (`status=active` filter).
- Cannot assign new clients (validator/service rule).

---

## 10. Assignment

### Separate domain: `PlanAssignment`

One plan → many assignments. Plan template stays reusable.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `trainerId` | ObjectId | ✅ | Server from JWT |
| `planId` | ObjectId → WorkoutPlan | ✅ | Must belong to trainer |
| `planVersionId` | ObjectId → WorkoutPlanVersion | optional | See §11 — recommended when versioning enabled |
| `clientId` | ObjectId → User | ✅ | Must be trainer's client |
| `startDate` | Date | ✅ | Assignment schedule start |
| `endDate` | Date | optional | |
| `status` | enum | ✅ | `active` \| `completed` \| `paused` \| `cancelled` |
| `progress` | Number | optional | 0–100, default 0 |
| `completedSessions` | Number | optional | default 0 |
| `totalSessions` | Number | optional | default 0; future calculation |
| `notes` | String | optional | |
| `createdAt` / `updatedAt` | Date | auto | |

### Date semantics

| Location | Meaning |
|----------|---------|
| `PlanAssignment.startDate/endDate` | **Client-specific schedule** (from assignment modal) |
| `WorkoutPlan.duration` | Program length in weeks (metadata) |
| `WorkoutPlan.startDate/endDate` | **Do not persist** — frontend type unused |

### Assignment validation

1. `plan.trainerId === req.user.id`
2. `plan.status !== archived`
3. Client exists: `User.findOne({ _id: clientId, role: 'client', trainer: trainerId })`
4. If `planVersionId` set, version must belong to `planId`

### MVP assignment API

Bulk assign (multiple clients) can be one request with `clientIds[]` or repeated POST — recommend **`clientIds[]`** array in body to match frontend modal.

---

## 11. Versioning

### Decision: **Separate `WorkoutPlanVersion` collection (Option B)**

Do not embed version history inside `WorkoutPlan` (unbounded document growth).

```text
WorkoutPlanVersion
  planId
  trainerId
  versionNumber        // incrementing per plan
  name
  description
  changes              // user description of change
  workoutDays          // deep snapshot (same shape as embedded days)
  isActive             // marker for "current published snapshot"
  createdBy            // trainerId
  createdAt
```

### Why separate collection

| Factor | Embedded versions[] | Separate collection |
|--------|---------------------|---------------------|
| Document size | Grows with every save | Plan doc stays bounded |
| Query history | Load entire plan | Paginate versions |
| Assignment pin | Easy to reference version id | Easy to reference version id |
| Restore | Swap subtree | Replace plan.workoutDays from version doc |

### Version snapshot content

Capture at version creation time:

- Plan metadata copy (`name`, `description`, `goal`, `level`, `duration`, `daysPerWeek`)
- Full `workoutDays[]` tree including sets
- Each `PlanExercise`: `exerciseId` + `exerciseSnapshot` (not live catalog join)

### Assignment + version

- **Recommended:** `PlanAssignment.planVersionId` optional but set on assign to pin client to snapshot.
- MVP may assign latest plan state without version id; add version pinning in same phase if version API ships.

### Restore (future behavior)

`POST /workout-plans/:id/versions/:versionId/restore` replaces plan's `workoutDays` from snapshot — **not MVP** unless explicitly scoped; design supports it.

---

## 12. Circuits

### Decision: **Exclude from MVP persistence**

| Evidence | Implication |
|----------|-------------|
| Circuit builder buttons **commented out** in UI | No user-facing create flow |
| Separate `Circuit` type + `useCircuitTraining` ref | Parallel model, not in plan save |
| `circuitGroup` string on exercise unused | Dead field |

**Future:** Embed optional `circuits[]` on `WorkoutDay` or separate collection linked by `workoutDayId` when UI is enabled. Prefer structured `Circuit` over free-text `circuitGroup`.

---

## 13. Supersets

### Current frontend

- `supersetWith`: optional bidirectional link between `PlanExercise._id` values
- UI checkbox **not wired**; composable methods exist; mock data has pairs

### MVP persistence

**Include field, do not build superset-specific API.**

```js
supersetWith: ObjectId | null  // sibling PlanExercise._id, same day
```

Validation rules:

- Target must exist on same `WorkoutDay`
- Optionally enforce mutual pairing on save (server normalizes bidirectional link)
- If UI not wired, field remains null in practice

### Alternative considered: group id

```js
supersetGroup: String  // e.g. "ss-1"
```

More extensible for 3+ exercise supersets. **Defer** until product requires tri-sets; pairwise `supersetWith` matches current types.

---

## 14. Client Relationship

Clients are **`User`** documents:

```js
{ role: 'client', trainer: trainerId }
```

Reuse `clientService.getClientById(clientId, trainerId)` or equivalent check:

```js
client.trainer.toString() === trainerId.toString()
```

Assignment and any client-scoped read must verify this server-side.

---

## 15. API Contract

Base path: **`/api/v1/workout-plans`** (plural, kebab-case — matches `/exercises`, `/clients`).

### MVP required

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/workout-plans` | List trainer's plans (filters, sort, pagination) |
| GET | `/workout-plans/:id` | Plan detail with nested days/exercises/sets |
| POST | `/workout-plans` | Create plan (metadata + optional nested days) |
| PATCH | `/workout-plans/:id` | Update plan — **see §15.1** |
| DELETE | `/workout-plans/:id` | **Archive** (`status: archived`) |
| POST | `/workout-plans/:id/assignments` | Assign to client(s) |
| GET | `/workout-plans/:id/assignments` | List assignments for plan |

### Recommended (UI exists — can ship with MVP or +1 sprint)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/workout-plans/:id/versions` | Version history |
| POST | `/workout-plans/:id/versions` | Create snapshot |
| GET | `/assignments` | All assignments for trainer (dashboard) |

### Future

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/workout-plans/:id/duplicate` | Duplicate plan |
| POST | `/workout-plans/:id/versions/:vid/restore` | Restore snapshot |
| GET | `/clients/:clientId/assignments` | Client-centric assignment list |
| Workout session logging | `/workout-sessions/*` | Execution tracking |

### 15.1 PATCH strategy — **full nested replace for builder saves**

Frontend builder edits the **entire nested tree** then saves.

**MVP recommendation:**

| PATCH type | Support |
|------------|---------|
| Partial metadata only (`name`, `goal`, …) | ✅ When `workoutDays` omitted |
| Full plan + `workoutDays[]` replacement | ✅ When `workoutDays` present — replace entire array |

When `workoutDays` is included, treat as **authoritative replace** of all days/exercises/sets (not deep merge). Simpler, matches builder mental model, avoids stale nested data.

Partial PATCH without `workoutDays` updates top-level fields only.

### 15.2 POST create body (trainer-controlled)

```json
{
  "name": "Upper / Lower Split",
  "description": "optional",
  "duration": 12,
  "daysPerWeek": 4,
  "goal": "muscle_gain",
  "level": "intermediate",
  "isTemplate": false,
  "workoutDays": []
}
```

Server sets: `_id`, `trainerId`, `status`, `createdAt`, `updatedAt`, subdocument ids, `exerciseSnapshot` enrichment.

Forbidden in body: `trainerId`, `clientId`, `startDate`, `endDate`, `_id`, timestamps.

### 15.3 List query parameters

From `WorkoutsListScreen` + `useWorkoutPlansListingToolbar`:

| Param | Type | Notes |
|-------|------|-------|
| `search` | string | name + description regex |
| `status` | enum | default `active`; exclude archived |
| `isTemplate` | boolean | when true, templates only |
| `goal` | enum | |
| `level` | enum | |
| `page` | number | default 1 |
| `limit` | number | default 24, max 100 |
| `sort` | enum | `name`, `name-desc`, `newest`, `oldest`, `exercises-high`, `exercises-low` |

Default list: trainer's non-archived plans.

**Exercise count sort:** computed field or aggregation on save (`totalExerciseCount` denormalized) — recommend denormalized counter updated on save for performance.

### 15.4 Response shapes

**List item (card/table row):**

```json
{
  "id": "...",
  "name": "...",
  "goal": "muscle_gain",
  "level": "intermediate",
  "duration": 12,
  "daysPerWeek": 4,
  "isTemplate": false,
  "status": "active",
  "totalExercises": 24,
  "totalDays": 4,
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Detail:** full nested `workoutDays` with hydrated `exercise` summary:

```json
{
  "exerciseId": "...",
  "exercise": { "id", "name", "thumbnailUrl", "status" },
  "exerciseSnapshot": { "name", "thumbnailUrl" },
  "...": "sets, rest, tempo, etc."
}
```

Use `ApiResponse(200, { workoutPlan } | { workoutPlans, pagination }, message)`.

---

## 16. Validation (Joi — design only)

Schemas: `validateCreateWorkoutPlan`, `validateUpdateWorkoutPlan`, `validateWorkoutPlanQuery`, `validateCreateAssignment`, `validateCreatePlanVersion`.

### Limits (recommended)

| Rule | Limit |
|------|-------|
| Plan name | 2–120 chars |
| Description | max 2000 |
| Days per plan | max 7 |
| Exercises per day | max 50 |
| Sets per exercise | max 20 |
| Instructions/notes fields | max 500 |
| Tempo | max 20 |
| Assignment notes | max 1000 |
| Version `changes` | max 500 |

### Nested validation

- `workoutDays[].dayNumber` unique within plan, 1–7
- `exercises[].order` unique within day, ≥ 1
- `sets[].setNumber` unique within exercise, ≥ 1
- `weightUnit` enum: `kg`, `lbs`
- `reps`, `weight` ≥ 0 when present
- `restBetweenSets` ≥ 0

### Forbidden fields (all write schemas)

```text
trainerId, clientId, slug, ownership, source, createdAt, updatedAt, _id (top-level plan id on create)
```

Subdocument ids on update: accept client-provided ids for upsert matching **or** server regenerates — recommend **server regenerates ids on full replace** except when stabilizing for superset links (accept `_id` in payload if valid ObjectId).

---

## 17. Indexes

### WorkoutPlan

```js
{ trainerId: 1, status: 1, createdAt: -1 }
{ trainerId: 1, isTemplate: 1, status: 1 }
{ trainerId: 1, goal: 1 }
{ trainerId: 1, level: 1 }
{ trainerId: 1, name: 1 }                    // sort / search assist
```

Text index optional later for search; MVP uses regex like exercises/clients.

### PlanAssignment

```js
{ trainerId: 1, status: 1, startDate: -1 }
{ planId: 1, clientId: 1 }                   // unique partial for active? TBD
{ clientId: 1, status: 1 }
{ trainerId: 1, clientId: 1 }
```

Consider unique compound `{ planId, clientId, status: 'active' }` partial index to prevent duplicate active assignments — **open decision**.

### WorkoutPlanVersion

```js
{ planId: 1, versionNumber: -1 }
{ planId: 1, isActive: 1 }
{ trainerId: 1, planId: 1 }
```

---

## 18. Authorization

| Action | Rule |
|--------|------|
| List / read plans | `plan.trainerId === req.user.id` |
| Create plan | `trainerId` set from JWT |
| Update / archive plan | Own plan only; system N/A |
| Read system exercise refs | Allowed via Exercise visibility |
| Use foreign exercise id | ❌ 400 |
| Assign plan | Own plan + own client |
| Read assignments | Own assignments |
| Create version | Own plan |
| Read another trainer's plan | ❌ 404 (prefer over 403 to avoid leak) |
| Update another trainer's plan | ❌ 403 or 404 — match Exercise pattern: **404 for GET**, **403 for mutation** if id exists but foreign? Exercise uses 404 for getById non-visible. **Recommend 404** for all foreign plan access. |
| Admin | Route allows `admin` role; **no special system-plan behavior** defined — admin uses same ownership rules unless product defines admin impersonation later |

---

## 19. Response Contract

Follow existing patterns:

```js
res.status(200).json(new ApiResponse(200, data, 'Workout plans retrieved successfully'));
res.status(201).json(new ApiResponse(201, data, 'Workout plan created successfully'));
throw new ApiError(400, 'Validation failed', errors);
throw new ApiError(403, 'Not authorized to modify this workout plan');
throw new ApiError(404, 'Workout plan not found');
throw new ApiError(409, '...');  // if needed for assignment conflicts
```

---

## 20. Transactions / Atomicity

| Operation | Transaction needed? |
|-----------|---------------------|
| Create / update plan (single doc) | **No** — single document write |
| Assign to N clients | **Optional** — `insertMany` with duplicate checks; partial failure acceptable with per-client errors OR single transaction if all-or-nothing desired |
| Create version + update plan | **Optional** — two writes; MVP can be sequential without transaction |
| Archive plan + pause assignments | **Future** — transaction recommended when assignment lifecycle added |

**Recommendation:** No transactions for MVP plan CRUD. Consider transaction for bulk assignment if product requires atomic multi-client assign.

---

## 21. Migration

- Frontend workout data is **100% in-memory mock** — no production workout data to migrate.
- No MongoDB migration scripts required for launch.
- Frontend must switch from composables to API once backend ships.
- Exercise picker must migrate from `MOCK_EXERCISES` to **`GET /api/exercises`** (adapter for field shape differences documented in frontend spec §5.8).

---

## 22. MVP vs Future

### MVP (backend)

- WorkoutPlan embedded tree CRUD
- Trainer ownership enforcement
- Exercise Library references + snapshot
- List filters/sort matching current UI
- Archive (soft delete)
- PlanAssignment to real clients
- Optional: PlanVersion snapshot API

### Future

- WorkoutSession / completed set logging
- Week / periodization model
- Circuits (structured)
- Superset UI + validation
- System/global workout templates
- Auto-version on save
- Duplicate plan endpoint
- Progressive overload rules
- Alternative exercises
- Timed sets (duration), cardio (distance), RPE/RIR
- Denormalized assignment progress calculation
- Client-facing plan execution API

---

## 23. Open Decisions

| # | Topic | Options | Recommendation |
|---|-------|---------|----------------|
| 1 | Default status on create | `draft` vs `active` | `active` to match current frontend create |
| 2 | PATCH merge vs replace for `workoutDays` | deep merge vs full replace | **Full replace** when provided |
| 3 | `planVersionId` on assign | optional vs required | Optional MVP; required when compliance matters |
| 4 | Foreign plan GET error | 403 vs 404 | **404** (Exercise pattern) |
| 5 | Duplicate active assignment | allow vs block | Block duplicate active per (plan, client) |
| 6 | Admin edit all trainers' plans | yes vs no | **No** until admin UX defined |
| 7 | `expert` level on plan | keep vs map to `advanced` | **Keep** `expert` on plan metadata |
| 8 | Hydrate exercise on list/detail | always vs lazy | Hydrate on detail; snapshot only on list rows |
| 9 | API path | `/workouts` vs `/workout-plans` | **`/workout-plans`** (explicit) |
| 10 | Subdocument ids on save | client-provided vs server-generated | Accept client ids for stable supersets; generate if missing |

---

## 24. Recommended Implementation Order

1. **Constants** — `workout.constants.js` (goal, level, status, assignment status, weight unit)
2. **Models** — `WorkoutPlan` (embedded), `PlanAssignment`, optionally `WorkoutPlanVersion`
3. **Helpers** — `toPublicWorkoutPlan`, exercise hydration, visibility validation, denormalized counts
4. **Validators** — create, update, query, assignment
5. **Service** — CRUD + ownership + exercise validation
6. **Controller + routes** — plan CRUD
7. **Assignment service + routes**
8. **Version service + routes** (if in MVP scope)
9. **Integration tests / manual API verification**
10. **Frontend API integration** (separate phase — out of scope here)

---

## Appendix A — Frontend ↔ Backend field mapping

| Frontend | Backend |
|----------|---------|
| `WorkoutPlan.id` | `_id` |
| `WorkoutPlan.trainerId` | `trainerId` (server) |
| `WorkoutPlan.isActive` | `status: active \| draft` |
| `WorkoutPlan.startDate/endDate` | **Not on plan** — use assignment |
| `WorkoutExercise.id` | `PlanExercise._id` |
| `WorkoutExercise.exerciseId` | `exerciseId` (ObjectId) |
| `Exercise` populated | Response hydration from Exercise module |
| Mock `Exercise` categories | Exercise Library taxonomy (adapter required) |

---

## Appendix B — Reference files

### Backend (fitly-pro-backend)

```text
src/modules/clients/client.service.js      — trainer ownership
src/modules/exercises/exercise.service.js  — visibility filter
src/modules/exercises/exercise.helpers.js    — buildExerciseVisibilityFilter
src/middlewares/auth.middleware.js
src/middlewares/validate.js
src/utils/ApiResponse.js
src/utils/ApiError.js
docs/exercise-library/EXERCISE_MODULE_SPEC.md
```

### Frontend (fityl-pro)

```text
docs/workout/WORKOUT_MODULE_SPEC.md
app/features/dashboard/trainer/workouts/types/workout.types.ts
app/features/dashboard/trainer/workouts/types/circuit.types.ts
app/features/dashboard/trainer/workouts/composables/useWorkoutPlan.ts
app/features/dashboard/trainer/workouts/composables/usePlanAssignment.ts
app/features/dashboard/trainer/workouts/composables/usePlanVersioning.ts
```

---

## Appendix C — Module structure (planned)

```text
src/modules/workout-plans/
├── workout-plan.constants.js
├── workout-plan.model.js
├── plan-assignment.model.js
├── workout-plan-version.model.js      # if versioning in MVP
├── workout-plan.helpers.js
├── workout-plan.validator.js
├── workout-plan.service.js
├── workout-plan.controller.js
├── workout-plan.routes.js
└── index.js
```

Mount: `router.use('/workout-plans', workoutPlanRoutes);`

---

**Implementation status: NOT STARTED**
