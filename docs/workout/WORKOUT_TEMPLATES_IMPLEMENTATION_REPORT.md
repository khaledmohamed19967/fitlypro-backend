# FitlyPro Workout Templates — Implementation Report (Phase 4A)

> **Phase:** System workout templates  
> **Date:** 2026-08-24  
> **Base path:** `/api/v1/workout-plans`  
> **Design reference:** [WORKOUT_BACKEND_DOMAIN_DESIGN.md](./WORKOUT_BACKEND_DOMAIN_DESIGN.md)

Phase 4A adds system-owned templates on the existing `WorkoutPlan` model (no separate template collection), ownership filtering, clone endpoint, and an idempotent seed of 8 starter templates.

---

## Schema changes

### Ownership (canonical)

```js
ownership: {
  type: 'system' | 'trainer',
  trainerId: ObjectId | null
}
```

### Compatibility field

`trainerId` is **kept**:

| Plan kind | ownership.type | ownership.trainerId | trainerId |
|-----------|----------------|---------------------|-----------|
| System template | system | null | null |
| Trainer plan/template | trainer | owner id | same owner id |

**Migration decision:** Do not drop `trainerId`. Model pre-validate syncs `trainerId` ↔ `ownership`. Seed backfills legacy Phase 2 docs missing `ownership` from existing `trainerId` (no wipe, trainer content unchanged).

### Additional fields

| Field | Purpose |
|-------|---------|
| `templateKey` | Stable seed identity for system templates (`full-body-beginner`, …). Null for trainer plans. |

### Indexes

- `{ ownership.type, ownership.trainerId, status, createdAt }`
- `{ ownership.type, isTemplate, status }`
- Unique partial: `{ templateKey }` where `ownership.type=system`, `isTemplate=true`, `templateKey` is string

---

## Endpoints

| Method | Path | Change |
|--------|------|--------|
| GET | `/workout-plans` | New query: `ownership=system\|trainer\|all` (default **`trainer`**) |
| GET | `/workout-plans/:id` | Readable for system templates + own plans |
| PATCH / DELETE | `/workout-plans/:id` | System templates → **403** |
| POST | `/workout-plans/:id/clone` | **New** — clone active template |

Template browse:

```http
GET /api/v1/workout-plans?ownership=system&isTemplate=true
```

Clone:

```http
POST /api/v1/workout-plans/:id/clone
Content-Type: application/json

{ "name": "optional override" }
```

Response `201`:

```json
{
  "success": true,
  "message": "Workout plan cloned successfully",
  "data": { "workoutPlan": { /* trainer-owned clone */ } }
}
```

---

## Ownership / visibility rules

| Actor | System template | Own plan/template | Other trainer plan |
|-------|-----------------|-------------------|--------------------|
| Read | ✅ | ✅ | ❌ 404 |
| Create via POST | ❌ (seed only) | ✅ | — |
| PATCH / DELETE | ❌ 403 | ✅ | ❌ 404 |
| Clone (active template) | ✅ | ✅ | ❌ 404 |
| Assign | ❌ | ✅ (non-archived) | ❌ |

List `ownership` translation (always scoped to JWT trainer):

- `trainer` (default): own plans only  
- `system`: system plans only  
- `all`: system ∪ own  

---

## Clone behavior

1. Source must be readable, `isTemplate=true`, `status=active`
2. Deep-clone `workoutDays → exercises → sets` with **new** nested `_id`s
3. Preserve `exerciseId` + `exerciseSnapshot` (no Exercise Library duplication)
4. Remap same-day `supersetWith` to new ids
5. Set `ownership.type=trainer`, `trainerId=req.user.id`, `isTemplate=false`, `status=active`
6. Name: body `name` or `"{source} Copy"` / `"… Copy 2"` collision handling

---

## Seed

```bash
pnpm run seed:workout-templates
```

Script: `scripts/seed-workout-templates.mjs`

| templateKey | Name |
|-------------|------|
| full-body-beginner | Full Body — Beginner |
| full-body-intermediate | Full Body — Intermediate |
| upper-lower-4 | Upper / Lower — 4 Days |
| ppl-3 | Push / Pull / Legs — 3 Days |
| ppl-6 | Push / Pull / Legs — 6 Days |
| upper-lower-hypertrophy | Upper / Lower — Hypertrophy |
| strength-4 | Strength — 4 Days |
| general-fitness-3 | General Fitness — 3 Days |

- Uses only `ownership.type=system` + `status=active` exercises  
- Upserts by `templateKey` — never deletes trainer plans  
- Idempotent: second run updates the same 8 docs  

Verified seed runs:

1. Created: **8**, Updated: **0**, Errors: **0** (+ backfilled 7 legacy ownership docs)  
2. Created: **0**, Updated: **8**, Errors: **0** (still 8 system templates)

---

## Authorization & validation

- Forbidden in create/update/clone body: `ownership`, `trainerId`, `templateKey`
- Clone body accepts only optional `name`
- Query `ownership` enum: `system | trainer | all`

---

## Files

**Modified**

- `src/modules/workout-plans/workout-plan.model.js`
- `src/modules/workout-plans/workout-plan.constants.js`
- `src/modules/workout-plans/workout-plan.helpers.js`
- `src/modules/workout-plans/workout-plan.validator.js`
- `src/modules/workout-plans/workout-plan.service.js`
- `src/modules/workout-plans/workout-plan.controller.js`
- `src/modules/workout-plans/workout-plan.routes.js`
- `package.json` (`seed:workout-templates`)
- `docs/workout/WORKOUT_BACKEND_DOMAIN_DESIGN.md`

**Added**

- `scripts/seed-workout-templates.mjs`
- `scripts/test-workout-templates-phase4a.mjs`
- `docs/workout/WORKOUT_TEMPLATES_IMPLEMENTATION_REPORT.md`

**Unchanged**

- Exercise Library module / collection data (read-only lookup for seed)
- Trainer plan content (ownership backfill only)

---

## Tests performed

| Suite | Result |
|-------|--------|
| `node scripts/test-workout-templates-phase4a.mjs` | **21/21 passed** |
| `node scripts/test-workout-plans-phase2.mjs` | **23/23 passed** |
| Seed ×2 | Idempotent (8 templates) |
| `pnpm test` | Placeholder only (not configured) |
| `pnpm lint` | Not configured |
| `pnpm build` | Not configured |

Phase 4A checks covered: system list/detail, 403 modify/archive, clone ownership/ids/snapshots, own vs foreign template clone, archived/non-template rejection, name collision, seed idempotency, trainer plans not wiped, default list excludes system.

---

## Known limitations

- No admin UI/API to create system templates (seed only)
- No “save as template” dedicated endpoint (trainer can set `isTemplate` via PATCH on own plans)
- Plank/core holds use `reps` as a stand-in (no duration field in MVP schema)
- Exercise substitutions in seed are name/alias based; catalog renames may require alias updates
- Version APIs still not implemented
