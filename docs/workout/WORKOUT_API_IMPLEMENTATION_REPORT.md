# FitlyPro Workout Plan — API Implementation Report (Phase 2)

> **Phase:** Service / controller / routes  
> **Date:** 2026-08-23  
> **Base path:** `/api/v1/workout-plans`  
> **Design reference:** [WORKOUT_BACKEND_DOMAIN_DESIGN.md](./WORKOUT_BACKEND_DOMAIN_DESIGN.md)

Phase 2 implements trainer-scoped Workout Plan CRUD, list/filter/pagination, nested plan replacement, exercise visibility validation, snapshots, archive semantics, and plan assignments. Version create/list endpoints are **not** implemented.

---

## Player endpoint (active workout)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/me/workout-plan` | Authenticated **client** retrieves their active workout assignment + live plan content |

Auth:

```http
Authorization: Bearer <client-jwt>
```

Role gate: `client` only (`protect` + `authorize('client')`). Trainers and admins receive **403**.

Ownership: always `clientId = req.user.id`. No `clientId` query/body parameter is accepted.

Behavior:

- Only `status: 'active'` assignments are returned.
- `paused` / `completed` / `cancelled` are ignored.
- No active assignment → `200` with `{ "assignment": null }`.
- Content is resolved from the **live** `WorkoutPlan` via `assignment.planId`.
- `planVersionId` is **not** used for retrieval yet (version create/list APIs are still unimplemented). The service isolates resolution in `resolveAssignedPlan` so version pinning can be added later without changing the route.
- If multiple active assignments exist for one client (allowed today across different plans; uniqueness is only `{ planId, clientId }` active), the endpoint returns the **newest** by `startDate` desc, then `createdAt` desc, and logs a warning. Indexes are not changed in this phase.
- Archived plans remain readable to the player when an active assignment still points at them (assignments survive archive). Draft plans are treated as unavailable (`404`).
- Missing plan → `404` with a safe message (no Mongo internals).

Player DTO omits trainer/admin fields (`trainerId`, `ownership`, `templateKey`, `isTemplate`, plan `status`/`notes`, assignment `clientId`/`planId`/`planVersionId`, etc.). Executable `workoutDays` / exercises / sets come from `mapWorkoutPlanToDetail`, then are projected through `mapPlayerWorkoutAssignment`.

Trainer routes under `/api/v1/workout-plans` are unchanged and remain `trainer`/`admin` only.

---

## Trainer Client Details endpoint (active workout summary)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/clients/:id/workout-plan-assignment` | Trainer retrieves a client's **active** workout assignment + plan summary |

Auth: same as other Client Details nests — `protect` + `authorize('trainer','admin')` on `/clients` (admin uses `req.user.id` as trainerId, same as nutrition).

Ownership:

- `:id` is the client ID.
- Client access uses the same 400/404/403 rules as client CRUD (`Invalid client ID` / `Client not found` / `You do not have access to this client`).
- Assignment query is scoped by `{ clientId, trainerId: req.user.id, status: 'active' }`.
- Foreign trainer / foreign client → no assignment leakage.

Behavior:

- Active-only; paused/completed/cancelled → `assignment: null`.
- No active assignment → `200` + `assignment: null`.
- Multiple actives → same deterministic rule as `/me/workout-plan` (newest `startDate`, then `createdAt`); warning logged. Indexes unchanged.
- Live plan via `planId` (`resolveAssignedPlan`); `planVersionId` unused.
- Archived plan with active assignment → summary still returned (assignments survive archive).
- Missing/draft plan → `assignment: null` (safe; no crash).

Response is a **summary** DTO (`mapTrainerClientWorkoutAssignment`): assignment metadata + `plan: { id, name, description, goal, level }`. No `workoutDays` / exercises / sets (player endpoint owns executable content). Omits `trainerId`, ownership, nested client profile, and plan admin fields.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/workout-plans` | List trainer plans (filter, sort, pagination) |
| GET | `/api/v1/workout-plans/:id` | Plan detail with hydrated exercises |
| POST | `/api/v1/workout-plans` | Create plan |
| PATCH | `/api/v1/workout-plans/:id` | Partial metadata or full `workoutDays[]` replace |
| DELETE | `/api/v1/workout-plans/:id` | Archive plan (`status: archived`) |
| POST | `/api/v1/workout-plans/:id/assignments` | Assign plan to one or more clients |
| GET | `/api/v1/workout-plans/:id/assignments` | List assignments for a plan |
| GET | `/api/v1/me/workout-plan` | **Client** active assignment + executable plan |
| GET | `/api/v1/clients/:id/workout-plan-assignment` | **Trainer** Client Details active assignment summary |
| PATCH | `/api/v1/workout-plans/:id/assignments/:assignmentId` | **Trainer** cancel assignment (`active` → `cancelled`) |
| POST | `/api/v1/me/workout-sessions` | **Client** start/resume session for a workout day |
| GET | `/api/v1/me/workout-sessions` | **Client** session history (paginated) |
| GET | `/api/v1/me/workout-sessions/:sessionId` | **Client** session detail + set logs |
| POST | `/api/v1/me/workout-sessions/:sessionId/sets` | **Client** log a prescribed set |
| PATCH | `/api/v1/me/workout-sessions/:sessionId/sets/:setLogId` | **Client** update a set log |
| POST | `/api/v1/me/workout-sessions/:sessionId/complete` | **Client** complete session |
| POST | `/api/v1/me/workout-sessions/:sessionId/abandon` | **Client** abandon session |

### Player workout execution

**Models**

- `WorkoutSession` (`workoutsessions`) — performance attempt for one assignment + workout day
- `WorkoutSetLog` (`workoutsetlogs`) — performed set data (does **not** mutate `WorkoutPlan` prescribed sets)

**Ownership chain (enforced on every mutation):**

```
authenticated client (req.user.id)
  → active PlanAssignment
  → assignment.planId → live WorkoutPlan
  → selected workoutDay
  → prescribed exercise + setNumber
  → WorkoutSetLog
```

`clientId` / `trainerId` / `planId` / `assignmentId` are never accepted from the player body.

**Session lifecycle:** `in_progress` → `completed` | `abandoned`

**Start** (`POST /me/workout-sessions`): body `{ workoutDayId }` or `{ workoutDayNumber }`. Resolves newest active assignment (same rule as `/me/workout-plan`). If an `in_progress` session already exists for that assignment + day, returns it (resume). Unique partial index enforces at most one in-progress session per `(assignmentId, workoutDayId)`.

**Set logging:** only prescribed `exerciseId` + `setNumber` for the session’s day. Unique `(sessionId, exerciseId, setNumber)`. Duplicate → **409**. Only while `in_progress`.

**Session progress (server-calculated):** `completedSets` = count of set logs with `status: completed`; `totalSets` = prescribed set count on day; `progress` = round(`completedSets / totalSets * 100`) (0 if totalSets = 0).

**Assignment progress (v1 after session complete):** `completedSessions` = count of completed sessions for the assignment; `totalSessions` = `workoutDays.length` on the live plan; `progress` = round ratio. Abandon does **not** increment completedSessions. Version snapshotting is **not** implemented — execution uses live `planId`.

**Known limitations:** no trainer session APIs yet; no RPE; no version pin; multiple active assignments still allowed (newest wins for start).

### Cancel assignment ("Remove from Client")

```http
PATCH /api/v1/workout-plans/:id/assignments/:assignmentId
Authorization: Bearer <trainer-jwt>
Content-Type: application/json

{ "status": "cancelled" }
```

- Auth: `protect` + `authorize('trainer','admin')` (router-level).
- Ownership: `loadOwnedTrainerPlan` + assignment scoped by `{ _id, planId, trainerId }`.
- Lifecycle: only `active` → `cancelled` (`CANCELLABLE_ASSIGNMENT_STATUSES`). Other statuses → **409**.
- Mutates only `status` (and Mongoose `updatedAt`). Does not change `endDate`, progress fields, or the WorkoutPlan document.
- After cancel, `/me/workout-plan` and `/clients/:id/workout-plan-assignment` ignore the row (active-only filters). Other active assignments for the same client (other plans) remain available.

All `/workout-plans` routes require:

```http
Authorization: Bearer <jwt>
```

Role gate: `trainer` or `admin` (same ownership rules as trainer; no impersonation).

---

## Request examples

### Create plan

```http
POST /api/v1/workout-plans
Content-Type: application/json
```

```json
{
  "name": "Upper / Lower Split",
  "description": "8-week hypertrophy block",
  "duration": 8,
  "daysPerWeek": 4,
  "goal": "muscle_gain",
  "level": "intermediate",
  "isTemplate": false,
  "workoutDays": [
    {
      "dayNumber": 1,
      "name": "Upper A",
      "exercises": [
        {
          "exerciseId": "674abc1234567890abcdef01",
          "order": 1,
          "restBetweenSets": 90,
          "sets": [
            {
              "setNumber": 1,
              "reps": 10,
              "weight": 60,
              "weightUnit": "kg"
            }
          ]
        }
      ]
    }
  ]
}
```

Server sets: `trainerId`, default `status: active`, timestamps, subdocument `_id`s, `exerciseSnapshot` from Exercise Library.

### Update metadata only

```http
PATCH /api/v1/workout-plans/:id
```

```json
{
  "name": "Renamed Plan",
  "goal": "strength"
}
```

### Replace full nested tree

When `workoutDays` is present, the array is an **authoritative replace** (not deep merge):

```http
PATCH /api/v1/workout-plans/:id
```

```json
{
  "workoutDays": [ /* complete day/exercise/set tree */ ]
}
```

### List plans

```http
GET /api/v1/workout-plans?status=active&page=1&limit=24&sort=newest&search=upper
```

Query params: `search`, `status` (default `active`), `isTemplate`, `goal`, `level`, `page`, `limit` (max 100), `sort`.

Sort values: `name`, `name-desc`, `newest`, `oldest`, `exercises-high`, `exercises-low`.

### Assign plan

```http
POST /api/v1/workout-plans/:id/assignments
```

```json
{
  "clientIds": ["674abc1234567890abcdef02"],
  "startDate": "2026-08-23T00:00:00.000Z",
  "endDate": "2026-11-23T00:00:00.000Z",
  "planVersionId": null,
  "notes": "Start with RPE 7"
}
```

---

## Response examples

### List

```json
{
  "statusCode": 200,
  "success": true,
  "message": "Workout plans retrieved successfully",
  "data": {
    "workoutPlans": [
      {
        "id": "...",
        "name": "Upper / Lower Split",
        "goal": "muscle_gain",
        "level": "intermediate",
        "duration": 8,
        "daysPerWeek": 4,
        "isTemplate": false,
        "status": "active",
        "totalExercises": 12,
        "totalDays": 4,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 24,
      "total": 1,
      "pages": 1
    }
  }
}
```

### Detail

```json
{
  "statusCode": 200,
  "success": true,
  "message": "Workout plan retrieved successfully",
  "data": {
    "workoutPlan": {
      "id": "...",
      "trainerId": "...",
      "name": "Upper / Lower Split",
      "workoutDays": [
        {
          "id": "...",
          "dayNumber": 1,
          "name": "Upper A",
          "exercises": [
            {
              "id": "...",
              "exerciseId": "...",
              "order": 1,
              "restBetweenSets": 90,
              "sets": [ { "id": "...", "setNumber": 1, "reps": 10, "weight": 60, "weightUnit": "kg", "isWarmup": false, "isDropset": false } ],
              "exerciseSnapshot": { "name": "Bench Press", "thumbnailUrl": null },
              "exercise": { "id": "...", "name": "Bench Press", "thumbnailUrl": null, "status": "active" }
            }
          ]
        }
      ],
      "totalExercises": 1,
      "totalDays": 1
    }
  }
}
```

### Assignments

```json
{
  "statusCode": 201,
  "success": true,
  "message": "Workout plan assigned successfully",
  "data": {
    "assignments": [
      {
        "id": "...",
        "planId": "...",
        "clientId": "...",
        "client": { "id": "...", "firstName": "...", "email": "..." },
        "startDate": "...",
        "status": "active",
        "progress": 0
      }
    ]
  }
}
```

---

## Authorization rules

| Action | Rule |
|--------|------|
| All routes | JWT required; role `trainer` or `admin` |
| Plan CRUD | `plan.trainerId === req.user.id` |
| Foreign plan access | **404** (no ownership leak) |
| Exercise reference on write | System ∪ own trainer via `buildExerciseVisibilityFilter` |
| Assignment | Own plan (non-archived) + own client (`User.role=client`, `trainer=req.user.id`) |
| `trainerId` | Always server-set; forbidden in request body |

---

## Exercise validation

On create and when `workoutDays` is included in PATCH:

1. Each `exerciseId` must be a valid ObjectId.
2. Exercise must exist and match `buildExerciseVisibilityFilter(trainerId)`.
3. Inaccessible exercise → **400** with field path (e.g. `workoutDays.0.exercises.0.exerciseId`).
4. Server loads Exercise and writes `exerciseSnapshot: { name, thumbnailUrl }`.
5. Same `exerciseId` may appear multiple times (distinct `PlanExercise` instances).

On detail read, exercises are batch-loaded by id. Missing catalog row falls back to `exerciseSnapshot` with `status: 'archived'`.

---

## Nested save behavior

- **Renumbering:** `dayNumber`, `order`, `setNumber` sorted then assigned sequentially `1..n`.
- **Subdocument `_id`:** Preserved when valid ObjectId provided; otherwise generated.
- **Superset:** `supersetWith` must reference another exercise `_id` on the **same day**; cross-day or self-reference → **400**.
- **Full replace:** Including `workoutDays` in PATCH replaces the entire embedded tree.

---

## Assignment behavior

- Bulk assign via `clientIds[]` (min 1).
- Default assignment `status: active`.
- Duplicate active assignment for same `(planId, clientId)` → **409**.
- Archived plans cannot receive new assignments → **400**.
- Optional `planVersionId`: validated if present (must belong to plan + trainer); version APIs not exposed yet.
- GET assignments: scoped to plan owner; client populated via `getPublicProfile()`.

---

## Errors

| Code | When |
|------|------|
| 400 | Validation, invalid ObjectId, inaccessible exercise/client, archived plan assign, invalid superset/version |
| 404 | Plan not found or not owned by trainer |
| 409 | Duplicate active assignment |
| 500 | Unexpected (global handler) |

Validation errors use `ApiError` with `errors: [{ field, message }]`.

---

## Files added / modified (Phase 2)

**Added**

- `src/modules/workout-plans/workout-plan.service.js`
- `src/modules/workout-plans/workout-plan.controller.js`
- `src/modules/workout-plans/workout-plan.routes.js`
- `src/modules/workout-plans/index.js`
- `scripts/test-workout-plans-phase2.mjs` (manual verification)
- `docs/workout/WORKOUT_API_IMPLEMENTATION_REPORT.md`

**Modified**

- `src/modules/workout-plans/workout-plan.helpers.js` — detail hydration, assignment mapper
- `src/modules/workout-plans/workout-plan.validator.js` — query boolean coercion for `isTemplate`
- `src/routes/index.js` — mount `/workout-plans`

**Not implemented (Phase 2)**

- Version list/create/restore endpoints
- `GET /assignments` (trainer-wide dashboard)
- Denormalized `totalExerciseCount` on plan document (computed at read time)

---

## Tests performed

Automated test suite: **not configured** (`pnpm test` exits with placeholder).

Manual verification via `node scripts/test-workout-plans-phase2.mjs` against running dev server — **23/23 passed**:

1. Create valid plan  
2. Get own plan  
3. List own plans  
4. Update metadata  
5. Replace workoutDays  
6. Archive plan  
7. Archived excluded from default list  
8. Archived plan cannot be assigned  
9. System exercise allowed  
10. Own trainer exercise allowed  
11. Other trainer exercise rejected  
12. Invalid exercise rejected  
13. Duplicate exercise allowed  
14. Superset same-day allowed  
15. Cross-day superset rejected  
16. Assign to own client  
17. Foreign client rejected  
18. Duplicate active assignment rejected  
19. Get assignments  
20. Foreign plan read → 404  
21. Foreign plan update → 404  
22. Foreign plan archive → 404  

`pnpm lint`: **not configured** (no lint script).

---

## Known limitations

- No version create/list/restore APIs (reference validation only on assign).
- Exercise count sort uses aggregation; other sorts use standard Mongo queries.
- List responses do not hydrate Exercise catalog (by design).
- Admin follows trainer ownership rules; no cross-trainer admin access.
- Bulk assignment fails entirely on first duplicate active assignment conflict (409).
