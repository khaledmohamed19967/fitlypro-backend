# Exercise Library Module Spec

> Status: **Discovery complete. Design complete. Phase 1 + Phase 2 + Phase 3A + Phase 3B + Phase 4C (trainer PATCH) implemented** (read API live; system seed; Free Exercise DB import; trainer create/update). Archive/delete/duplicate not started.
>
> This document is the source of truth for implementing the Exercise Library without rediscovering backend architecture.

---

# Existing Backend Architecture Findings

Findings below are derived from inspecting `fitly-pro-backend` source under `src/`. Where something could not be verified, it is marked explicitly.

---

### Runtime

- **Node.js**: version not pinned in repository (`package.json` has no `engines` field). **Not verified from current repository** beyond ES Module usage (`"type": "module"`).
- **Express**: `^5.2.1` (`package.json`).
- **Entry points**:
  - Primary: `src/server.js` → loads `src/app.js`, `src/config/index.js`, `src/config/database.js`.
  - Legacy/root `server.js` also exists at repo root; modules under `src/` are the active architecture.
- **Scripts**: `dev` (`nodemon src/server.js`), `start`, `env:production` / `start:production` (load `.env.production`).

---

### Database

- **MongoDB** via connection string `APP_DB_URL` (`src/config/database.js`, `src/config/index.js`).
- **Mongoose**: `^9.0.2`.
- Connection uses `mongoose.connect(process.env.APP_DB_URL)` with graceful `SIGINT` disconnect.
- **Only one Mongoose model exists in code**: `User` (`src/modules/users/user.model.js`), registered as `mongoose.model('User', userSchema)` → default collection name **`users`**.

---

### Authentication

Actual implementation:

| Concern | Location | Behavior |
|--------|----------|----------|
| JWT generation | `User` instance method `generateAuthToken()` in `user.model.js` | `jwt.sign({ id: this._id, email, role }, config.jwt.secret, { expiresIn })` |
| JWT verification | `protect` in `src/middlewares/auth.middleware.js` | Reads `Authorization: Bearer <token>`, `jwt.verify(token, config.jwt.secret)` |
| Current user load | `protect` | `User.findById(decoded.id)`; rejects missing/inactive users |
| Attach to request | `protect` | **`req.user = user`** (full Mongoose User document) |
| Password hashing | `userSchema.pre('save')` + `bcryptjs` | Salt rounds `10`; password `select: false` |
| Password compare | `user.comparePassword()` | Used by auth helpers |
| Login / register | `src/modules/auth/*` | Public login/register; token returned in response `data` |

Trainer identification on authenticated requests:

- Controllers use **`req.user.id`** (Mongoose document virtual `id`) and sometimes **`req.user._id`** (e.g. auth profile).
- Role is on the user document: `req.user.role` ∈ `['client', 'trainer', 'admin']`.
- There is **no separate Trainer model**. A trainer is a `User` with `role: 'trainer'`.

JWT config: `JWT_SECRET` / `JWT_EXPIRES_IN` (default `'7d'`), exposed via `config.jwt`.

---

### Authorization

Actual implementation:

1. **`protect`** — must be authenticated.
2. **`authorize(...roles)`** — checks `roles.includes(req.user.role)`; otherwise `403`.

Clients module pattern (`src/modules/clients/client.routes.js`):

```text
router.use(protect);
router.use(authorize('trainer', 'admin'));
```

Ownership (trainer → clients) is enforced **in the service layer**, not only by middleware:

- Clients are `User` documents with `role: 'client'` and `trainer: <ObjectId ref User>`.
- Queries / updates pass `trainerId` from `req.user.id` and compare `client.trainer` → `403` if mismatch (`client.service.js`).

Users module routes (`/users`) currently have **no `protect` / `authorize`** applied in `user.routes.js` (public CRUD surface as wired). Treat as an existing inconsistency when designing new modules.

---

### Validation

- Library: **Joi** `^17.13.3`.
- Middleware: `src/middlewares/validate.js` → `validate(schema)` validates **`req.body` only**.
  - Options: `abortEarly: false`, `stripUnknown: true`.
  - On failure: `ApiError(400, 'Validation failed', errors)` where each error is `{ field, message }`.
  - On success: replaces `req.body` with sanitized `value`.
- Schema location pattern: **colocated per module**, e.g.:
  - `src/modules/auth/auth.validator.js`
  - `src/modules/clients/client.validator.js`
  - `src/modules/users/user.validator.js`
- Naming: exported Joi objects like `validateCreateClient`, `validateLogin`, `validateRegister`.
- **Query / params validation**: Not verified as a shared middleware pattern; clients pagination/filter uses raw `req.query` in the controller.

---

### Uploads

Actual implementation (`src/middlewares/upload.js`):

- **Multer** with **`memoryStorage()`** only.
- Limit: **10MB** `fileSize`.
- Comment in code: intended for form-data fields now; disk/cloud deferred.
- Usage today: `upload.none()` on `POST /auth/register` (parse multipart fields, **no file persistence**).
- **No** disk destination, **no** generated public file URLs, **no** Cloudinary/S3/local `uploads/` pipeline found in this repository.
- Accepted MIME types / image endpoints: **Not verified from current repository** (no file-field upload routes found).

Body parsers also allow JSON/urlencoded up to **10mb** (`app.js`).

---

### API structure

Feature-based modules (not classic flat `controllers/` + `models/` at `src/` root):

```text
src/
├── server.js
├── app.js
├── config/           # index.js, database.js
├── middlewares/      # auth, validate, upload, errorHandler
├── routes/           # index.js mounts modules under /api/v1
├── utils/            # ApiError, ApiResponse, asyncHandler
└── modules/
    ├── auth/         # routes, controller, service, helpers, validator
    ├── users/        # model, routes, controller, service, helpers, validator, index
    └── clients/      # routes, controller, service, validator (+ docs); NO separate Client model
```

Flow used by clients (canonical private module pattern):

```text
routes → middlewares (protect / authorize / validate) → controller → service → User model
```

Mounting (`src/routes/index.js`):

- Prefix from config: default **`/api/v1`**
- `/health`, `/users`, `/auth`, `/clients`
- Commented placeholders: `/workouts`, `/nutrition` — **not implemented**

Recommended new-module shape is also documented in root `README.md` (`workout.model.js`, `workout.controller.js`, etc. under `src/modules/<name>/`).

---

### Relevant models

| Expected name | Present in backend? | Notes |
|---------------|---------------------|-------|
| **User** | Yes | Only Mongoose model. Roles: `client` \| `trainer` \| `admin`. Clients link via `trainer` ObjectId → `User`. |
| **Trainer** | No separate model | Trainer = `User` with `role: 'trainer'`. |
| **Client** | No separate model | Client = `User` with `role: 'client'` + fitness fields + `trainer`. |
| **Workout** | No | Only commented route placeholder / README guidance. |
| **WorkoutPlan** | No | Not verified in backend. |
| **WorkoutExercise** | No | Not verified in backend. |
| **Program** | No dedicated model | Client has optional `programType` / package fields on `User`. |
| **Exercise** | No | Not verified in backend. |

**User schema highlights** (verified):

- camelCase fields; `timestamps: true` → `createdAt` / `updatedAt`.
- Enums use **snake_case values** (e.g. `weight_loss`, `personal_training`).
- Indexes: unique `email`; `{ createdAt: -1 }`; `{ trainer: 1 }`.
- Public API shape via `getPublicProfile()`: uses **`id`** (not `_id`) plus camelCase fields.
- Embedded array: `progressNotes[]` with `recordedBy` → `User`.

---

### Workout architecture

**Not verified from current repository as a backend implementation.**

Evidence:

- No workout/exercise Mongoose models under `src/`.
- `src/routes/index.js` only comments future `workoutRoutes`.
- Clients README lists “Workout plan assignments” as a future checkbox.
- Therefore there is **no backend `exerciseId` relationship** and **no embedded workout-exercise documents** to integrate with yet.

Implication for Exercise Library design (discovery only): the module would be a **new domain**, with future Workout/WorkoutPlan modules expected to reference exercise IDs once those modules exist. Frontend workout shapes (outside this repo) are **out of scope for this backend discovery**.

---

### Response format

Success responses use `ApiResponse`:

```json
{
  "statusCode": 200,
  "success": true,
  "message": "Clients retrieved successfully",
  "data": { }
}
```

Controllers typically:

```js
res.status(200).json(new ApiResponse(200, result, '…successfully'));
```

List payloads nest resources under plural keys inside `data`, e.g. clients:

```json
{
  "data": {
    "clients": [ /* public profiles */ ],
    "pagination": { … }
  }
}
```

---

### Error handling

- Custom `ApiError(statusCode, message, errors = [])`.
- Controllers/services throw `ApiError`; wrapped by `asyncHandler` → `next(err)`.
- Global `errorHandler` returns:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [{ "field": "email", "message": "…" }],
  "stack": "…"  
}
```

`stack` only when `config.env === 'development'`.

Common status usage observed: `400` validation/conflict, `401` auth, `403` role/ownership, `404` not found, `500` fallback.

404 unknown routes: `notFoundHandler` → `Route ${req.originalUrl} not found`.

---

### Pagination

Implemented in services (not a shared pagination utility).

**Clients** (`client.service.js` / `client.controller.js`):

- Query: `page`, `limit` (defaults `1`, `10`).
- Optional `search` short-circuits to non-paginated search result with synthetic pagination.
- Optional `status` query is passed into Mongo filters as `filters.status` — **User schema has `isActive`, not `status`**; behavior of `?status=` is therefore unclear / likely ineffective as written.
- Pagination object shape:

```js
{ page, limit, total, pages }
```

**Users** (`user.service.js`) uses a **different** pagination shape:

```js
{ currentPage, totalPages, totalCount, hasNextPage, hasPrevPage }
```

There is **no single shared pagination convention** across modules. Clients module is the better reference for trainer-scoped listing APIs.

Sorting: typically `{ createdAt: -1 }`.

Filtering: ad hoc per service (`search` regex on name/email; role + trainer match).

---

### Naming conventions

| Area | Convention (verified) |
|------|------------------------|
| Folders | `src/modules/<plural-feature>/` (`auth`, `users`, `clients`); middleware folder is **`middlewares`** (plural) |
| Files | `<entity>.model.js`, `.controller.js`, `.service.js`, `.routes.js`, `.validator.js`, `.helpers.js` |
| Model name | PascalCase singular: `User` |
| Collection | Mongoose default pluralization: `users` |
| Route mount | Plural kebab/simple path: `/clients`, `/users`, `/auth` under `/api/v1` |
| Fields | **camelCase** (`firstName`, `isActive`, `createdAt`) |
| Enum string values | **snake_case** (`weight_loss`, `muscle_gain`) |
| Soft delete | `isActive: false` (not hard delete) for clients |
| Response IDs | Prefer `id` in public profiles |
| Success messages | Sentence case, often ending with “successfully” |
| Env vars | Mix of `APP_*` (`APP_DB_URL`, `APP_PORT`) and unprefixed (`PORT`, `JWT_SECRET`, `API_URL`, `CORS_ORIGIN`) |

---

### Module inventory (verified)

| Module | Auth | Model | Notes |
|--------|------|-------|-------|
| `auth` | Public + `protect` on me/password | Uses `User` | Register may use `upload.none()` |
| `users` | None on routes | `User` | Generic CRUD / stats |
| `clients` | `protect` + `authorize('trainer','admin')` | `User` as client | Ownership by `trainer` field |

---

### Gaps relevant to Exercise Library (discovery)

1. No Exercise / Workout models or routes yet — greenfield relative to workouts.
2. Upload pipeline is memory-only; image URLs for exercise media are not established.
3. Trainer identity = authenticated `User` with role `trainer` via `req.user`.
4. Ownership pattern to mirror: scope list/create by `trainerId` / `createdBy`-style field + optional system-owned records (system exercises would be a **new** concept; not present today).
5. Prefer clients-module layering, Joi validators, `ApiResponse` / `ApiError`, camelCase + snake_case enums, `createdAt`/`updatedAt`.

---

# Exercise Library Design

Design decisions below follow the verified conventions in **Existing Backend Architecture Findings**. No implementation code is included.

---

## 1. Design Goals

The Exercise Library is FitlyPro’s reusable exercise catalog.

### In scope (product)

| Capability | MVP? | Notes |
|------------|------|--------|
| Browse / list exercises | Yes | Trainer + admin |
| Search / filter | Yes | See §11–12 |
| Exercise detail | Yes | |
| Create trainer-owned exercise | Yes | |
| Update trainer-owned exercise | Yes | |
| Archive trainer-owned exercise | Yes | Soft status, not hard delete |
| Duplicate system → trainer exercise | Yes | Template workflow |
| Favorites | Future | Separate preference entity (§16) |
| Workout Builder integration | Future | Reference-by-id only (§15) |
| External provider import | Future | Source metadata reserved now (§8–9) |

### Out of scope for this module

- Workout plans, assigned workouts, sets/reps/rest programming
- Client-facing exercise CRUD
- Persistent media provider implementation (strategy only in §7)

---

## 2. Domain Model — Exercise Definition vs Workout Exercise

### Exercise (this module)

Canonical definition of a movement in the catalog:

```text
Bench Press
  muscles, equipment, difficulty, instructions, media, ownership…
```

**Does not store programming state.**

Forbidden on `Exercise` (belongs to future Workout domain):

| Field | Why excluded |
|-------|----------------|
| sets / reps / rest / RPE / tempo | Session programming |
| order / dayIndex / supersets | Plan structure |
| clientId / assignedAt | Assignment |
| load / targetWeight | Per-client programming |

### WorkoutExercise (future — not implemented)

A *usage* of an Exercise inside a workout:

```text
exerciseId → Exercise
sets, reps, restSeconds, rpe, tempo, notes, order
```

### Contract

```text
Exercise  (reusable catalog)
    ↓  referenced by ObjectId
WorkoutExercise  (programming instance)
    ↓  embedded or referenced in
Workout / WorkoutPlan
    ↓  assigned to
Client (User role=client)
```

Exercise Library **must not** depend on Workout models existing. Workout modules **must** depend on Exercise IDs when built.

---

## 3. Proposed Exercise Schema

Aligned with backend conventions:

- Model name: `Exercise` → collection `exercises`
- Field names: **camelCase**
- Enum values: **snake_case**
- Timestamps: Mongoose `{ timestamps: true }` → `createdAt` / `updatedAt`
- Public API `id` (string of `_id`), same spirit as `User.getPublicProfile()`

### Conceptual schema

```text
Exercise {
  name: String
  nameAr?: String                    // optional; see Open Decisions
  slug: String                       // unique per ownership scope (see below)
  description?: String
  descriptionAr?: String

  muscles: {
    primary: MuscleEnum              // required
    secondary: MuscleEnum[]          // optional, default []
  }

  equipment: EquipmentEnum[]         // required, min 1
  category: CategoryEnum             // required
  difficulty: DifficultyEnum         // required

  instructions: String[]             // optional, ordered steps
  instructionsAr?: String[]
  commonMistakes: String[]           // optional

  media: {
    thumbnailUrl?: String            // URL string, not binary
    imageUrls: String[]              // default []
    videoUrl?: String                // URL (upload or external)
  }

  tags: String[]                     // lowercase free tags, default []

  ownership: {
    type: 'system' | 'trainer'       // required
    trainerId: ObjectId | null       // ref User; null for system
  }

  source: {
    type: 'manual' | 'duplicated' | 'import' | 'seed'
    externalProvider?: String        // e.g. 'exercisedb' — free string, not enum locked to one vendor
    externalId?: String
    duplicatedFromId?: ObjectId      // ref Exercise when duplicated
  }

  status: 'active' | 'archived'      // default 'active'

  createdAt, updatedAt
}
```

### Field dictionary

| Field | Type | Required | Purpose | Validation | Index |
|-------|------|----------|---------|------------|-------|
| `name` | String | Yes | Display name (EN primary for MVP) | trim, 2–120 chars | text / regex search |
| `nameAr` | String | No | Arabic display name | trim, max 120 | future; optional text |
| `slug` | String | Yes | Stable URL/key within ownership scope | lowercase kebab, unique compound | **Yes** compound unique |
| `description` | String | No | Short overview | max 2000 | No |
| `descriptionAr` | String | No | Arabic overview | max 2000 | No |
| `muscles.primary` | Enum | Yes | Primary target muscle | see §6 | Filter index |
| `muscles.secondary` | Enum[] | No | Assisting muscles | subset of MuscleEnum, no duplicate of primary | No |
| `equipment` | Enum[] | Yes (≥1) | Required gear | see §6 | Filter (multikey) |
| `category` | Enum | Yes | Movement class | see §6 | Filter |
| `difficulty` | Enum | Yes | Skill level | beginner \| intermediate \| advanced | Filter |
| `instructions` | String[] | No | Ordered coaching cues | each max 500; array max 30 | No |
| `instructionsAr` | String[] | No | Arabic steps | same limits | No |
| `commonMistakes` | String[] | No | Form pitfalls | each max 500; array max 20 | No |
| `media.thumbnailUrl` | String | No | Card/list thumbnail URL | URI or empty | No |
| `media.imageUrls` | String[] | No | Gallery URLs | URI[]; max 10 | No |
| `media.videoUrl` | String | No | Demo video URL | URI | No |
| `tags` | String[] | No | Free labels | lowercase, trimmed, max 20 tags × 40 chars | Optional text |
| `ownership.type` | Enum | Yes | system \| trainer | | Compound with trainerId |
| `ownership.trainerId` | ObjectId→User | Cond. | Owner trainer | **required if type=trainer**; **null if system** | Compound |
| `source.type` | Enum | Yes | Provenance | default `manual` | No |
| `source.externalProvider` | String | No | Import vendor key | max 64 | Compound with externalId for dedupe |
| `source.externalId` | String | No | ID at provider | max 128 | Compound with provider |
| `source.duplicatedFromId` | ObjectId→Exercise | No | Template source | | No |
| `status` | Enum | Yes | active \| archived | default active | List filter |
| `createdAt` / `updatedAt` | Date | Auto | Audit | timestamps | createdAt sort |

### Slug uniqueness rule

Slug uniqueness is **scoped**, not global:

```text
unique( ownership.type, ownership.trainerId, slug )
```

- System: `('system', null, 'bench-press')`
- Trainer A: `('trainer', <A>, 'bench-press')` allowed even if system has same slug

Generation: from `name` (kebab-case); on collision append short suffix (`-2`, `-3`).

### Public response shape (recommended helper)

Mirror `getPublicProfile()` style:

```json
{
  "id": "...",
  "name": "Bench Press",
  "slug": "bench-press",
  "description": "...",
  "muscles": { "primary": "chest", "secondary": ["triceps", "shoulders"] },
  "equipment": ["barbell", "bench"],
  "category": "strength",
  "difficulty": "intermediate",
  "instructions": ["..."],
  "commonMistakes": ["..."],
  "media": { "thumbnailUrl": null, "imageUrls": [], "videoUrl": null },
  "tags": ["compound", "push"],
  "ownership": { "type": "system", "trainerId": null },
  "source": { "type": "seed", "externalProvider": null, "externalId": null, "duplicatedFromId": null },
  "status": "active",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Arabic fields included in API when present; omitted or `null` when unused (Open Decision on i18n).

---

## 4. Ownership Model

### Types

| `ownership.type` | `ownership.trainerId` | Meaning |
|------------------|----------------------|---------|
| `system` | `null` | Shared FitlyPro catalog |
| `trainer` | `ObjectId` of User with role trainer | Private to that trainer |

Aligned with existing pattern: clients use `trainer: ObjectId` on `User`; exercises nest ownership for clarity when `type` is also required.

### Authorization matrix

| Action | System exercise | Own trainer exercise | Another trainer’s exercise |
|--------|-----------------|----------------------|----------------------------|
| List / read (active) | Allowed (trainer, admin) | Allowed | **Denied** (never returned in queries) |
| Read archived (own) | Admin only (MVP) | Allowed for owner | Denied |
| Create | Admin only (seed/import path) | Trainer creates `type=trainer` | N/A |
| Update | **Denied** for trainers; admin optional (Open Decision) | Allowed if owner | Denied |
| Archive | **Denied** for trainers | Allowed if owner | Denied |
| Hard delete | Not in MVP | Not in MVP | Denied |
| Duplicate | Allowed → creates new trainer exercise | Allowed → new trainer copy | Denied |

### Service-layer enforcement (match Clients)

Same pattern as `client.service.js`:

1. Routes: `protect` + `authorize('trainer', 'admin')`.
2. Service receives `trainerId = req.user.id`.
3. List query always constrained to:

```text
{
  status: …,
  $or: [
    { 'ownership.type': 'system' },
    { 'ownership.type': 'trainer', 'ownership.trainerId': trainerId }
  ]
}
```

4. Mutations: load by id → if `ownership.type === 'system'` → `403`; if trainer and `trainerId` mismatch → `403`.
5. Never trust `ownership` from client body on create: set server-side from `req.user.id`.

---

## 5. System Exercise Duplication

### Workflow

```text
GET /exercises/:id          (system, active)
        ↓
POST /exercises/:id/duplicate
        ↓
New Exercise (ownership.type=trainer, trainerId=caller)
```

### Copied

- `name`, optional `nameAr` / descriptions / instructions / mistakes
- `muscles`, `equipment`, `category`, `difficulty`, `tags`
- `media` URLs **by reference** (same URL strings; no binary copy)
- New `slug` generated in trainer scope (may equal system slug)

### Not copied

- `_id` → new ObjectId
- `ownership` → always trainer + caller id
- `status` → always `active`
- System `source` as-is

### New `source` on duplicate

```text
source: {
  type: 'duplicated',
  externalProvider: null,          // unless template itself was import; may copy provider metadata as informational
  externalId: null,                // do not claim same externalId as owned import
  duplicatedFromId: <systemExerciseId>
}
```

If the source exercise had import metadata, **optional** copy of `externalProvider` / `externalId` as provenance hints is allowed, but `source.type` remains `duplicated` and `duplicatedFromId` is authoritative for FitlyPro lineage.

### Rules

- Source must be readable by caller (system or own).
- Duplicating another trainer’s exercise: **forbidden**.
- Duplicating archived system exercise: **forbidden** in MVP (only active templates).

---

## 6. Taxonomy (canonical)

All enums are **snake_case**, singular, one concept each (no `quad` / `quads` / `quadriceps` aliases).

### `muscles.primary` / `muscles.secondary` — `MuscleEnum`

```text
chest
back
shoulders
biceps
triceps
forearms
quadriceps
hamstrings
glutes
calves
core
full_body
other
```

**Why:** Matches User fitness enums style (`weight_loss`). `full_body` and `other` cover compound/uncategorized without inventing duplicate muscle names. Secondary must not include primary.

### `equipment` — `EquipmentEnum`

```text
barbell
dumbbell
cable
machine
bodyweight
kettlebell
resistance_band
smith_machine
bench
pull_up_bar
medicine_ball
other
```

**Why:** Covers gym + home MVP; `resistance_band` / `smith_machine` / `pull_up_bar` as single tokens. Multiple values allowed (e.g. barbell + bench).

### `difficulty` — `DifficultyEnum`

```text
beginner
intermediate
advanced
```

**Why:** Matches User `experienceLevel` vocabulary already in the product (`beginner` / `intermediate` / `advanced`). Omit `expert` for exercises to avoid over-granularity in filters.

### `category` — `CategoryEnum`

```text
strength
cardio
mobility
stretching
warmup
plyometric
other
```

**Why:** Separates intent from muscle (a chest stretch is `stretching` + primary `chest`). Avoids overlapping “hypertrophy” vs “strength” in MVP.

Constants should live in module file e.g. `exercise.constants.js` and be reused by Joi + Mongoose enums.

---

## 7. Media Strategy

### Constraint (verified)

- Multer: `memoryStorage`, 10MB.
- No disk/cloud provider in repo.
- MongoDB must **not** store exercise binaries.

### Design (no provider installed yet)

Store **URLs only** on `Exercise.media`:

| Asset | MVP approach |
|-------|----------------|
| Thumbnail | Optional URL string |
| Images | Array of URL strings |
| Video | Optional URL (YouTube/Vimeo/CDN or later uploaded object URL) |

### Recommended abstraction (future Phase 5)

```text
ExerciseService
    ↓
MediaStoragePort.upload(buffer, meta) → { url }
    ↓
Provider adapter (S3 / Cloudinary / local disk)  ← chosen later
```

Until a provider is chosen:

- Create/update accept **URLs** in JSON body (trainer pastes CDN/YouTube links).
- File upload endpoints are **out of MVP**.
- Do not expand Multer to disk “temporarily” without a retention/cleanup story.

### Open dependency

**Media storage provider** remains an Open Decision (§21). Schema is provider-agnostic via URLs.

---

## 8. External Exercise Provider Strategy

### Goal

Core `Exercise` schema is FitlyPro-owned. External APIs never dictate field names.

### Reserved metadata

```text
source.type = 'import' | 'seed' | …
source.externalProvider = 'exercisedb' | 'free_exercise_db' | …
source.externalId = '<provider id>'
```

### Behaviors (design only)

| Concern | Approach |
|---------|----------|
| Provider ID | Free string `externalProvider`, not hard-coded enum of vendors |
| Duplicate detection | Unique sparse compound index on `(externalProvider, externalId)` when both set |
| Import | Map → normalize → validate → upsert by external key or create |
| Update from provider | Re-import overwrites mapped fields; preserve trainer overrides only on trainer copies |
| Switching provider | New imports get new provider key; no automatic merge across providers |
| Licensing | Seed/import must use a licensed/allowed dataset; legal review outside code |

System exercises from seed use `source.type: 'seed'` without requiring a commercial API.

---

## 9. Normalization Layer (future import)

```text
External Provider HTTP/API
        ↓
Provider Client          (vendor SDK / fetch; vendor-specific)
        ↓
Provider Mapper          (vendor DTO → intermediate DTO)
        ↓
Normalizer               (muscles/equipment synonyms → FitlyPro enums)
        ↓
Joi / domain validation
        ↓
Exercise model / service upsert
```

**Why:** Keeps `exercise.model.js` free of `gifUrlExdb`, `bodyPart`, etc. Synonym maps (`quads` → `quadriceps`) live only in Normalizer.

Not implemented in MVP phases 1–3.

---

## 10. API Contract

### Mounting

Follow existing mounts (`/clients`, `/users`, `/auth`):

```text
/api/v1/exercises
```

Registered in `src/routes/index.js` as `router.use('/exercises', exerciseRoutes)`.

All endpoints below (unless noted): **`protect` + `authorize('trainer', 'admin')`**.

Success envelope: `ApiResponse`. Errors: `ApiError` (+ `errors[]` for validation).

Pagination metadata for lists: **clients-style**

```text
{ page, limit, total, pages }
```

(Prefer this over users-module’s alternate shape.)

### Endpoints

#### `GET /api/v1/exercises`

- **Auth:** trainer | admin  
- **Purpose:** List visible exercises (system + own trainer), default `status=active`  
- **Query:** see §11  
- **Response `data`:**

```json
{
  "exercises": [ /* public shapes */ ],
  "pagination": { "page": 1, "limit": 24, "total": 120, "pages": 5 }
}
```

- **Errors:** `401`, `403`, `400` (invalid query)

#### `GET /api/v1/exercises/:id`

- **Purpose:** Detail if visible  
- **Errors:** `404` not found or not visible (do not leak foreign trainer existence — same `404` as missing)

#### `POST /api/v1/exercises`

- **Purpose:** Create trainer-owned exercise  
- **Body:** create schema (§17); server sets `ownership`, `source.type='manual'`, `status='active'`  
- **Response:** `201` + exercise  
- **Errors:** `400` validation, `403` if non-trainer (middleware)

#### `PATCH /api/v1/exercises/:id`

- **Purpose:** Update mutable fields on **own** trainer exercise  
- **Body:** partial update schema  
- **Forbidden:** changing `ownership`, forging `source.externalId` to hijack imports (ignore or strip)  
- **Errors:** `403` system or not owner, `404`

#### `DELETE /api/v1/exercises/:id`

- **Purpose:** **Archive** (set `status='archived'`), not hard delete — naming matches REST clients soft-delete pattern (`isActive`)  
- **Errors:** `403` / `404`  
- Document in API message: `"Exercise archived successfully"`

#### `POST /api/v1/exercises/:id/duplicate`

- **Purpose:** Duplicate readable exercise into caller’s library (§5)  
- **Body:** optional `{ name? }` override  
- **Response:** `201` new exercise  
- **Errors:** `404`, `403`, `400`

### Admin-only (design reserved, not MVP required)

- Seed/import system exercises  
- Update/archive system exercises  

If needed later: same routes with `authorize('admin')` branches in service, or `/api/v1/admin/exercises`. **Open Decision** for admin UX.

---

## 11. List / Search API (filters)

### Supported query params (MVP)

| Param | Maps to | Notes |
|-------|---------|--------|
| `search` | name / tags (and nameAr if enabled) | Case-insensitive partial |
| `primaryMuscle` | `muscles.primary` | Prefer this name over ambiguous `muscle` |
| `equipment` | `equipment` contains | Single value MVP; multi later |
| `difficulty` | `difficulty` | |
| `category` | `category` | |
| `ownership` | `system` \| `trainer` \| `all` | Default `all` = system + own |
| `status` | `active` \| `archived` | Default `active`; trainers may pass `archived` for own only |
| `page` | pagination | Default `1` |
| `limit` | pagination | Default `24`, max `100` |

Example:

```text
GET /api/v1/exercises?search=bench&primaryMuscle=chest&equipment=barbell&difficulty=intermediate&page=1&limit=24
```

Filters combine with **AND**. Visibility `$or` (system ∪ own) always applied for trainers.

---

## 12. Search Strategy

### Recommendation (MVP)

**Case-insensitive regex** on `name` (and `nameAr` if present) + optional `tags` match, consistent with `client.service.js` `searchClients` (`$regex` / `$options: 'i'`).

### Not chosen for MVP

| Option | Why deferred |
|--------|----------------|
| Mongo text index | Good later; needs language/weights; regex matches clients pattern now |
| Atlas Search | Requires Atlas Search setup — **not verified** in current repo; treat as future infra |

### Expected behavior

- Partial: `ben` matches `Bench Press`
- Case-insensitive
- Tags: if `search` provided, also match any tag containing term (OR within name/tags)
- Filters: applied after visibility scope

---

## 13. Database Indexes

| Index | Type | Supports | Why |
|-------|------|----------|-----|
| `{ 'ownership.type': 1, 'ownership.trainerId': 1, slug: 1 }` | **Unique** | Slug uniqueness per owner | Prevent collisions; trainer can reuse system slug |
| `{ 'ownership.type': 1, 'ownership.trainerId': 1, status: 1, createdAt: -1 }` | Compound | Default list for trainer | Hottest path: visible + active + sort |
| `{ 'muscles.primary': 1, status: 1 }` | Compound | Muscle filter | Common filter |
| `{ category: 1, difficulty: 1, status: 1 }` | Compound | Taxonomy filters | Combined filters |
| `{ equipment: 1, status: 1 }` | Multikey + status | Equipment filter | |
| `{ 'source.externalProvider': 1, 'source.externalId': 1 }` | Unique **sparse** | Import dedupe | Only when both fields set |

**Not indexed (MVP):** `description`, `instructions`, media URLs — not filter keys.

Text index: optional Phase 2+ if regex performance insufficient.

---

## 14. Archive vs Delete

### Decision (now)

Use **`status: 'active' | 'archived'`**.

- `DELETE /exercises/:id` → archive.
- Archived trainer exercises: hidden from default picker lists; still readable by owner via `status=archived` or direct id.
- System exercises: trainers cannot archive; admin policy Open Decision.

### Future Workout reconciliation (documented, not implemented)

| Concern | Decision now | Future Workout decision |
|---------|--------------|-------------------------|
| New workout selection | Only `active` + visible | Workout Builder must filter archived |
| Historical workouts | Exercise id remains valid | WorkoutExercise should store **snapshot** of name (and maybe media URL) **or** tolerate archived definition — **Open Decision** |
| Hard delete | Not supported in MVP | Avoid once workouts reference ids |

---

## 15. Future Workout Integration

```text
Exercise (catalog)
    ↓ exerciseId
WorkoutExercise (sets, reps, rest, order, …)
    ↓
Workout / WorkoutPlan
    ↓
Client (User)
```

Rules:

1. WorkoutExercise references `Exercise` by ObjectId.
2. Programming fields live only on WorkoutExercise.
3. Exercise module has zero imports from workouts.
4. Builder lists only `status=active` exercises visible to trainer.
5. Historical behavior (snapshot vs live join) is a **Workout-domain Open Decision**.

---

## 16. Favorites (future)

Do **not** put `isFavorite` on shared `Exercise`.

### Recommended future entity

```text
TrainerExercisePreference {
  trainerId: ObjectId → User
  exerciseId: ObjectId → Exercise
  isFavorite: Boolean
  createdAt, updatedAt
}
unique(trainerId, exerciseId)
```

Alternative (less clean): embed `favoriteExerciseIds[]` on User — rejected for now to avoid bloating the only existing model and mixing concerns.

**MVP:** omit favorites API.

---

## 17. Validation (Joi design)

Follow `validate(schema)` on **body**; add a small `validateQuery(schema)` middleware pattern for list queries (new but same error shape) — or validate query inside controller/service. Prefer a shared `validateQuery` next to `validate` for consistency (design note; implement in Phase 2).

### Create body (`validateCreateExercise`)

Required: `name`, `muscles.primary`, `equipment` (≥1), `category`, `difficulty`  
Optional: descriptions, secondary muscles, instructions, mistakes, media URLs, tags  
Forbidden in body: `ownership`, `source`, `status`, `slug` (server-generated)

### Update body (`validateUpdateExercise`)

All create fields optional (partial); same forbidden server fields.

### Query (`validateExerciseQuery`)

`search` string max 100; enums for filters; `ownership` in `system|trainer|all`; `status` in `active|archived`; `page` ≥1; `limit` 1–100.

### Duplicate body (`validateDuplicateExercise`)

Optional `{ name: string }` only.

---

## 18. Security

### Authentication

All Exercise Library management endpoints require JWT via `protect`.

### Authorization

- Role gate: `authorize('trainer', 'admin')` (clients pattern).
- Data gate: service-layer ownership checks (§4), identical spirit to `getClientById(clientId, trainerId)`.

### Threats mitigated

| Threat | Mitigation |
|--------|------------|
| Read other trainer’s private exercise | Visibility query + 404 on getById |
| Patch/delete system exercise as trainer | 403 in service |
| Spoof `ownership.trainerId` on create | Ignore body ownership; set from `req.user.id` |
| IDOR on duplicate | Source must pass visibility check |

Clients/role `client` have **no** access in MVP.

---

## 19. Module Structure

Match `clients` / `users` naming (`*.validator.js` not `*.validation.js`):

```text
src/modules/exercises/
├── exercise.model.js
├── exercise.constants.js      # enums / taxonomy
├── exercise.controller.js
├── exercise.service.js
├── exercise.helpers.js        # slugify, visibility query, toPublic
├── exercise.routes.js
├── exercise.validator.js
└── index.js                   # barrel exports (like clients/users)
```

Mount:

```text
src/routes/index.js
  router.use('/exercises', exerciseRoutes);
```

Optional later (not MVP):

```text
src/modules/exercises/importers/   # provider client + mapper + normalizer
```

---

## 20. Implementation Phases

Adjusted for greenfield workouts and missing media provider:

| Phase | Scope |
|-------|--------|
| **1** | `exercise.constants`, model, indexes, Joi create/update, helpers (slug, toPublic) |
| **2** | Read APIs: list + query validation + detail; regex search + filters + pagination |
| **3** | Trainer CRUD: create, patch, archive (`DELETE`) |
| **4** | Duplicate endpoint; minimal system seed script/data (manual JSON seed) |
| **5** | Media: choose provider + upload port + optional upload routes |
| **6** | Workout module integration (separate epic) |
| **7** | Favorites (`TrainerExercisePreference`) |
| **8** | External provider import pipeline |
| **9** | Tests, rate limits, admin system-exercise management, hardening |

**MVP backend = Phases 1–4** (without cloud media; URL-only media fields).

---

## 21. Open Decisions

Decisions that need product/engineering approval before or during implementation:

1. **Media storage provider** — S3, Cloudinary, local disk, or URL-only indefinitely for MVP.
2. **Initial system dataset** — hand-authored seed JSON vs licensed external DB (which license?).
3. **i18n** — ship `nameAr` / `instructionsAr` in Phase 1, or EN-only until frontend needs AR.
4. **Admin management of system exercises** — same `/exercises` with admin bypass vs dedicated admin routes.
5. **Historical workouts + archived exercises** — live reference vs name/media snapshot on WorkoutExercise (Workout epic).
6. **Atlas Search** — only if/when Atlas Search is provisioned; not assumed.
7. **Hard delete policy** — remain archive-only permanently, or allow admin purge later.
8. **Favorites timing** — defer entirely until after Workout Builder, or insert earlier.

Resolved by this design (not open):

- Ownership model (`system` \| `trainer` + `trainerId`)
- Archive over hard delete for MVP
- Regex search for MVP
- Clients-style pagination
- No programming fields on Exercise
- Favorites not on Exercise document
- Module path `/api/v1/exercises` and file naming like `clients`

---

## 22. Design Summary for Implementers

1. New module `src/modules/exercises/` following clients layering.
2. Single `Exercise` model; visibility = system ∪ `ownership.trainerId === req.user.id`.
3. Mutations only on own trainer exercises; duplicate clones system → trainer.
4. Enums in `exercise.constants.js`; Joi in `exercise.validator.js`.
5. Responses via `ApiResponse`; errors via `ApiError`.
6. Media = URLs until provider chosen.
7. Workouts / favorites / imports are explicitly later phases.

---

## Phase 1 Implementation Notes

**Status:** Phase 1 complete (model / constants / Joi / helpers / indexes only). No routes, controllers, services, or seeds.

### Files created

```text
src/modules/exercises/exercise.constants.js
src/modules/exercises/exercise.model.js
src/modules/exercises/exercise.validator.js
src/modules/exercises/exercise.helpers.js
```

Not created (later phases): `exercise.controller.js`, `exercise.service.js`, `exercise.routes.js`, `index.js`.

### Important implementation decisions

1. **`ownership` / `source` / `media` as nested sub-schemas** (`_id: false`) so Mongoose does not mis-parse a nested field named `type` as a SchemaType shortcut.
2. **Ownership consistency** enforced in a `pre('validate')` hook: system ⇒ `trainerId == null`; trainer ⇒ `trainerId` required.
3. **Slug** is required on the model but not accepted via Joi create/update (server-generated later). Collision suffixes are **not** in Phase 1 helpers — only `slugifyExerciseName`.
4. **Extra helpers** (not forbidden by Phase 1): `normalizeTags`, `sanitizeSecondaryMuscles` for future service use.
5. **Joi** exports: `validateCreateExercise`, `validateUpdateExercise`, `validateDuplicateExercise`, `validateExerciseQuery`. Query schema is ready; no query middleware wired.
6. **Constants** also export `OWNERSHIP_FILTERS` (`system|trainer|all`) for list query validation.

### Index strategy

| Index | Notes |
|-------|--------|
| Unique `(ownership.type, ownership.trainerId, slug)` | System rows share `trainerId: null`; uniqueness is per slug within that scope — multiple system exercises are fine with distinct slugs. |
| `(ownership.type, ownership.trainerId, status, createdAt)` | Default listing |
| `(muscles.primary, status)` | Muscle filter |
| `(category, difficulty, status)` | Taxonomy filters |
| `(equipment, status)` | Multikey |
| Unique partial `(source.externalProvider, source.externalId)` | Only when both fields are strings — avoids null collisions for manual exercises |

No text index (MVP search remains regex in Phase 2).

### Deviations from design

- None material. Nested sub-schemas are a Mongoose technical necessity for fields named `type`, not a domain change.
- Spec listed optional `index.js`; omitted because Phase 1 does not register routes.

### Unresolved / deferred

- Slug collision resolution on create (Phase 3 service).
- Wiring `validateExerciseQuery` (Phase 2).
- Seed data, media provider, routes/controllers/services.

---

## Phase 2 Implementation Notes

**Status:** Phase 2 complete — read API only.

### Files created

```text
src/modules/exercises/exercise.service.js
src/modules/exercises/exercise.controller.js
src/modules/exercises/exercise.routes.js
```

### Files modified

```text
src/routes/index.js                          # mount /exercises
src/middlewares/validate.js                  # added validateQuery()
src/modules/exercises/exercise.helpers.js    # added escapeRegex()
src/modules/exercises/exercise.model.js      # fixed pre('validate') for Mongoose 9 (no next callback)
```

### Endpoint paths

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/v1/exercises` | `protect` + `authorize('trainer','admin')` |
| GET | `/api/v1/exercises/:id` | same |

### Query parameters (`validateExerciseQuery` via `validateQuery`)

`search`, `primaryMuscle`, `equipment`, `difficulty`, `category`, `ownership` (`system`\|`trainer`\|`all`), `status` (default `active`), `page` (default 1), `limit` (default 24, max 100).

### Search

Case-insensitive regex on `name`, `nameAr`, and `tags`, with `escapeRegex` to prevent regex injection. No text index.

### Pagination

Clients-style: `{ page, limit, total, pages }`. Sort: `{ createdAt: -1 }`. Skip/limit in MongoDB.

### Visibility

`buildExerciseVisibilityFilter(trainerId)` for `ownership=all` and detail lookups. `ownership=system` / `trainer` narrows without allowing foreign trainer IDs. Non-visible detail → **404** (no leak).

### List serialization

Full `toPublicExercise()` per item (matches Clients returning full public profiles). Documented alternative of card-only projection deferred.

### Deviations

- Added `validateQuery` beside existing `validate` (project had body-only validation).
- Mongoose 9: ownership `pre('validate')` no longer uses `next` (Phase 1 hook fix discovered during Phase 2 verification).

### Verification notes

- Service-level checks (list, search, muscle/equipment filters, ownership isolation, pagination, detail, invalid id): **PASS** (temporary inserts cleaned up).
- HTTP unauthenticated `GET /exercises`: **401 PASS**.
- Authenticated HTTP against running server: not fully re-verified in the same session due to Mongo connection hang while the server held a pool; logic path covered by service tests calling the same service methods the controllers use.

---

## Phase 3A — System Exercise Seed

**Status:** Phase 3A complete — local system catalog seed only (no media provider, no external APIs, no trainer CRUD).

### Files created

```text
src/modules/exercises/exercise.seed.js
src/modules/exercises/data/exercises.seed.json
src/modules/exercises/scripts/generate-seed-json.mjs   # maintainer helper to rebuild JSON
```

### Files modified

```text
package.json   # added "seed:exercises"
```

### Seed command

```text
npm run seed:exercises
# or
pnpm run seed:exercises
```

Runs: `node src/modules/exercises/exercise.seed.js`

Uses existing `.env` / `APP_DB_URL` via `src/config/index.js`. No hardcoded Mongo URI.

### Dataset

- Approximately **89** system exercises in `exercises.seed.json`
- Coverage across major muscle groups and common equipment from `exercise.constants.js`
- Coherent metadata (muscles / equipment / category / difficulty / instructions / tags)
- No Arabic fields in the initial dataset (avoid low-quality translations)

### Ownership / source / status rules

Every seeded document:

```json
{
  "ownership": { "type": "system", "trainerId": null },
  "source": { "type": "seed" },
  "status": "active"
}
```

No `trainerId`, no `externalProvider` / `externalId`.

### Upsert behavior

- Primary key: system scope + `slug` (`{ ownership.type: 'system', slug }`)
- Missing system slug → **create** (full Mongoose validation via `save()`)
- Existing system slug → **update seed-owned fields only** (not a blind document replace)
- Never uses `deleteMany()`, `drop()`, or `dropCollection()`
- Never wipes or converts trainer exercises

### Seed-owned fields

`name`, `description`, `muscles`, `equipment`, `category`, `difficulty`, `instructions`, `commonMistakes`, `media`, `tags`, `status`, `source`, `ownership`, `slug`

### Trainer collision behavior

If a **trainer**-owned exercise already uses the same slug:

- Existing system exercise for that slug → refresh seed-owned fields on the **system** row only
- No system exercise yet → **log + skip** (do not create / do not overwrite trainer)

### Dataset pre-validation

Before any DB writes, the seed validates:

- required fields
- canonical taxonomy (muscles, equipment, category, difficulty)
- unique names/slugs within the JSON
- system ownership, seed source, active status

Invalid static dataset → fail before partial seeding.

### Media

```json
"media": {
  "thumbnailUrl": null,
  "imageUrls": [],
  "videoUrl": null
}
```

Exercise **metadata** is seeded. Exercise **media** is deferred pending a licensed media source. No downloads, Cloudinary, S3, R2, Multer, or GridFS in this phase.

### External providers

Not implemented in Phase 3A. Free Exercise DB import landed in **Phase 3B**.

### Verification (Phase 3A)

- Initial seed created 89 system exercises: **PASS**
- Re-run: Created 0 / Updated 89 / no duplicate slugs: **PASS**
- Authenticated `GET /api/v1/exercises?page=1&limit=24&status=active` returns `exercises.length === 24`, `pagination.total === 89`: **PASS**
- Trainer exercise with colliding slug remains trainer-owned; system count unchanged on re-seed: **PASS**
- Seeded ownership `system` + `trainerId: null`, `status: active`, `source.type: seed`: **PASS**

---

## Phase 3B — Free Exercise DB Import

**Status:** Phase 3B complete — Free Exercise DB → FitlyPro system import (no schema changes, no trainer CRUD).

### Source

- Provider: [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db)
- Dataset: `dist/exercises.json` (873 records)
- Local default path: `data/external/free-exercise-db/exercises.json`
- Override: `FREE_EXERCISE_DB_PATH` or `--path`

See also: `docs/exercise-library/FREE_EXERCISE_DB_IMPORT_ANALYSIS.md` and `FREE_EXERCISE_DB_IMPORT_REPORT.md`.

### Files created

```text
src/modules/exercises/exercise.importer.js
src/modules/exercises/import/freeExerciseDb.mappings.js
src/modules/exercises/import/freeExerciseDb.normalize.js
data/external/free-exercise-db/exercises.json
data/external/free-exercise-db/README.md
docs/exercise-library/FREE_EXERCISE_DB_IMPORT_REPORT.md
```

### Commands

```text
pnpm run import:exercises -- --dry-run   # normalize + validate + collision detect; MongoDB writes = 0
pnpm run import:exercises               # upsert into MongoDB
```

### Ownership / source

Every imported document:

```json
{
  "ownership": { "type": "system", "trainerId": null },
  "source": {
    "type": "import",
    "externalProvider": "free-exercise-db",
    "externalId": "<original source id>"
  },
  "status": "active"
}
```

### Idempotency

Upsert identity: `(source.externalProvider, source.externalId)` — matches existing partial unique index.

### Normalization (approved rules only)

- Muscles: `abdominals→core`, `lats|lower back|middle back→back`, `traps→back` + tag `traps`
- Unsupported primary (`abductors|adductors|neck`): **reject** (never map to `other`)
- Unsupported secondary: drop + warn
- Equipment maps: `body only→bodyweight`, `kettlebells→kettlebell`, `bands→resistance_band`, `medicine ball→medicine_ball`, `e-z curl bar→barbell` + tag `ez-bar`
- Unsupported equipment (`foam roll|exercise ball`): **reject**
- Null equipment: auto `bodyweight` for stretching/plyometrics and clear bodyweight names; else reject
- Category: `plyometrics→plyometric`; specialty → `strength` + tags
- Difficulty: `expert→advanced`
- Tags: force / mechanic / specialty / traps / ez-bar via `normalizeTags`
- Instructions: preserve wording; split long steps; truncate only if needed (≤500)
- Description / Arabic / commonMistakes: unset / empty (not invented)

### Media strategy

Absolute GitHub raw URLs only (no binary download):

```text
https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/<relativePath>
```

`thumbnailUrl` = images[0]; `imageUrls` = all images; `videoUrl` = null.

**Production caveat:** mirror to FitlyPro-controlled CDN later; GitHub raw is MVP-acceptable.

### Collision behavior

- Existing FEDB import → update importer-owned fields
- Slug collision with non-FEDB system exercise (e.g. Phase 3A seed) → keep seed; import as `{slug}-fedb` (+ numeric suffix if needed)
- Never overwrite trainer-owned documents
- Never delete / wipe collection
- Phase 3A seed rows are never converted to `source.type=import`

### Rejection policy

Continue on independent records. Structured reasons:

`UNSUPPORTED_PRIMARY_MUSCLE`, `UNSUPPORTED_EQUIPMENT`, `NULL_EQUIPMENT`, `INVALID_CATEGORY`, `INVALID_DIFFICULTY`, `VALIDATION_FAILED`, …

### Runtime result (summary)

- Imported: **820** FEDB system exercises
- Rejected: **53**
- Phase 3A seed retained: **89**
- Dry-run writes: **0** (verified)
- Re-run creates no duplicates (verified)

### Model changes

**None.** Taxonomy not expanded in this phase.

---

## Trainer Exercise Update (Phase 4C)

**Status:** Implemented — trainer-owned PATCH only.

### Endpoint

```text
PATCH /api/v1/exercises/:id
```

Auth: `protect` + `authorize('trainer', 'admin')` + `validate(validateUpdateExercise)`

### Access

- **Trainer-owned** exercises where `ownership.type === 'trainer'` **and** `ownership.trainerId === req.user.id`
- **System exercises** (Phase 3A seed + Free Exercise DB import): **read-only** → `403`
- **Another trainer's exercise**: `403` (same message as foreign trainer; no leak)
- **Missing id**: `404`
- **Admin**: same ownership rule as trainer — may only edit exercises they own (`trainerId === req.user.id`); no special system-edit behavior defined

### Editable fields (partial PATCH)

`name`, `nameAr`, `description`, `descriptionAr`, `muscles`, `equipment`, `category`, `difficulty`, `instructions`, `instructionsAr`, `commonMistakes`, `media`, `tags`

When `muscles` is sent, the whole muscles subdocument is replaced (primary required; secondary optional → defaults to `[]` then sanitized).

When `media` is sent, only provided media keys are merged onto the existing media subdocument.

### Server-owned fields (forbidden in body)

`slug`, `ownership`, `source`, `status` — rejected by Joi (`validateUpdateExercise`).

Also never modified: `_id`, `createdAt`, `updatedAt`.

### Slug behavior

- Slug is **not** accepted from the client.
- When `name` changes, slug is regenerated via `slugifyExerciseName(name)`.
- Collision within trainer scope: append `-2`, `-3`, … (same convention as create).
- Current document is excluded from collision check.
- Duplicate key → `409`.

### Normalization

- `sanitizeSecondaryMuscles()` on muscles updates
- `normalizeTags()` on tags updates
- Optional strings: empty string → `null`

### Response

`200` + `ApiResponse` with updated public exercise shape (same as GET/POST).

### Files modified

```text
src/modules/exercises/exercise.service.js   # updateExercise, loadOwnedTrainerExercise
src/modules/exercises/exercise.controller.js
src/modules/exercises/exercise.routes.js
```
