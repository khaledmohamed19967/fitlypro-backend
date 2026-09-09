# Nutrition Assignments Implementation Report

> **Phase:** 6 — Nutrition plan assignments  
> **Status:** Implemented  
> **Date:** 2026-08-25  
> **Design reference:** `docs/nutrition/NUTRITION_BACKEND_DOMAIN_DESIGN.md`

---

## Phase

Phase 6 lets trainers assign trainer-owned NutritionPlans to their clients with schedule metadata. Assignments live in a separate `NutritionPlanAssignment` collection, mirroring the WorkoutPlan `PlanAssignment` architecture.

**Not implemented:** versions, food logging, adherence, progress tracking, notifications, frontend dashboard.

---

## Assignment Model

**Collection:** `nutritionplanassignments`

| Field | Type | Notes |
|-------|------|-------|
| `trainerId` | ObjectId | Server from JWT |
| `planId` | ObjectId → NutritionPlan | Trainer-owned plan only |
| `planVersionId` | ObjectId | Reserved, null in MVP |
| `clientId` | ObjectId → User | Trainer's client |
| `startDate` | Date | Required |
| `endDate` | Date | Optional; must be after startDate |
| `status` | enum | `active`, `completed`, `paused`, `cancelled` |
| `notes` | String | max 1000 |
| `createdAt` / `updatedAt` | Date | timestamps |

No `progress` / session counters (workout-specific; excluded per domain design).

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/nutrition-plans/:id/assignments` | Assign to one or more clients |
| GET | `/api/v1/nutrition-plans/:id/assignments` | List assignments for plan owner |

Routes mounted on existing nutrition-plans router with `protect` + `authorize('trainer', 'admin')`.

---

## Authorization

| Case | Result |
|------|--------|
| Own plan + own client | Allowed |
| Foreign plan | 404 |
| Foreign client | 400 |
| System template assign | 400 |
| System template list assignments | 403 |
| Archived plan assign | 400 |
| Admin | Same ownership rules as WorkoutPlan |

---

## Client Ownership

Clients validated with:

```js
User.findOne({ _id, role: 'client', trainer: trainerId })
```

Foreign clients return **400** with field error — no ownership leak.

---

## Plan Ownership

Assignable plan must:

- Exist and belong to current trainer (404 if foreign)
- Not be a system template (400)
- Not be archived (400)

System templates must be **cloned first**, then the trainer-owned copy is assigned.

---

## Date Rules

- `startDate` required (stored as Date)
- `endDate` optional
- If present: `endDate > startDate` (Joi + Mongoose pre-validate)
- Plan `duration` is independent of assignment dates

---

## Duplicate Rules

Unique partial index on `(planId, clientId)` where `status = 'active'`.

Duplicate active assignment → **409**.

Completed or cancelled historical assignments may coexist with a new active assignment.

---

## Bulk Behavior

`clientIds[]` supports bulk assign (min 1, unique).

Atomic from API perspective:

1. Validate all clients
2. Check duplicates for all
3. Create all — or fail with no partial creates

---

## Archive Behavior

- Archived plans cannot receive new assignments (400)
- Existing assignments remain when plan is archived
- Assignments are not auto-cancelled on plan archive

---

## Response Shape

```json
{
  "statusCode": 201,
  "success": true,
  "message": "Nutrition plan assigned successfully",
  "data": {
    "assignments": [
      {
        "id": "...",
        "planId": "...",
        "planVersionId": null,
        "clientId": "...",
        "client": { "id": "...", "firstName": "...", "email": "..." },
        "startDate": "...",
        "endDate": null,
        "status": "active",
        "notes": null,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ]
  }
}
```

Client profile via `getPublicProfile()` — no password or auth fields.

---

## Indexes

- `{ trainerId: 1, status: 1, startDate: -1 }`
- `{ planId: 1, clientId: 1, status: 1 }`
- `{ clientId: 1, status: 1 }`
- `{ trainerId: 1, clientId: 1 }`
- **Partial unique:** `{ planId: 1, clientId: 1 }` where `status: 'active'`

---

## Tests

**Script:** `node scripts/test-nutrition-assignments-phase6.mjs`

**Result:** 25/25 passed

**Regression:**

| Script | Result |
|--------|--------|
| Phase 3 foundation | 30/30 |
| Phase 4 CRUD | 36/36 |
| Phase 5 templates | 32/32 |

---

## Files

```
src/modules/nutrition-plan-assignments/
  nutrition-plan-assignment.model.js
  nutrition-plan-assignment.constants.js
  nutrition-plan-assignment.helpers.js
  nutrition-plan-assignment.validator.js
  nutrition-plan-assignment.service.js
  nutrition-plan-assignment.controller.js
  index.js

src/modules/nutrition-plans/nutrition-plan.routes.js  (assignment routes)

scripts/test-nutrition-assignments-phase6.mjs
docs/nutrition/NUTRITION_ASSIGNMENTS_IMPLEMENTATION_REPORT.md
```

---

## Known Limitations

- No plan version pinning (`planVersionId` rejected if sent)
- Live plan reference — edits affect assigned clients until versions ship
- No trainer-wide assignment dashboard endpoint
- No lifecycle automation (auto-complete, reminders)
- No client food logging or adherence metrics

---

## Next Phase

**Frontend Nutrition Plans Integration**

Wire list/detail/create/edit/clone/assign flows to the Nutrition API from the trainer frontend.
