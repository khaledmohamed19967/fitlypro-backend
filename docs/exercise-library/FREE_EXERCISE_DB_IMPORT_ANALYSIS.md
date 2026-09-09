# Free Exercise DB → FitlyPro Import Analysis

> **Analysis only.** No MongoDB writes. No importer. No model/API changes.  
> **Dataset source:** Upstream GitHub raw JSON  
> `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json`  
> **Local repo status:** `dist/exercises.json` was **not** present in `fitly-pro-backend`. The full dataset was fetched once for this analysis and **not** committed into the project.  
> **FitlyPro source of truth:** `exercise.model.js`, `exercise.constants.js`, `exercise.validator.js`, `exercise.helpers.js`  
> **Analyzed at:** 2026-08-22

---

## 1. Dataset Overview

| Item | Value |
|------|-------|
| Provider | [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db) |
| Combined file | `dist/exercises.json` |
| Records analyzed | **873** |
| License (upstream README) | Public domain / Unlicense |
| Images | Relative paths under `exercises/`; hostable via GitHub raw CDN |
| FitlyPro seed already present | Phase 3A system seed (~89 exercises) — **orthogonal** to this import analysis |

Source record shape:

```text
name, force, level, mechanic, equipment, primaryMuscles[],
secondaryMuscles[], instructions[], category, images[], id
```

---

## 2. Dataset Statistics

### Totals

```text
Total records: 873
Unique IDs: 873
Duplicate IDs: 0
Unique names: 873
Duplicate names: 0
```

### Missing / null / empty field presence

For arrays, **missing** = `null`/`undefined` **or** empty array `[]`.

| Source field | Present | Missing/null/empty | % present | % missing |
|--------------|---------|--------------------|-----------|-----------|
| `name` | 873 | 0 | 100.00% | 0.00% |
| `force` | 844 | 29 | 96.68% | 3.32% |
| `level` | 873 | 0 | 100.00% | 0.00% |
| `mechanic` | 786 | 87 | 90.03% | 9.97% |
| `equipment` | 796 | 77 | 91.18% | 8.82% |
| `primaryMuscles` | 873 | 0 | 100.00% | 0.00% |
| `secondaryMuscles` | 601 | 272 | 68.84% | 31.16% |
| `instructions` | 868 | 5 | 99.43% | 0.57% |
| `category` | 873 | 0 | 100.00% | 0.00% |
| `images` | 873 | 0 | 100.00% | 0.00% |
| `id` | 873 | 0 | 100.00% | 0.00% |

Notes:

- `equipment: null` accounts for all 77 equipment misses (scalar, not array).
- `secondaryMuscles` misses are empty arrays `[]` (0 nulls).
- `force` / `mechanic` misses are `null`.

---

## 3. Source Taxonomy

### `level` (873)

| Value | Count |
|-------|------:|
| beginner | 523 |
| intermediate | 293 |
| expert | 57 |

### `equipment` (873 including null)

| Value | Count |
|-------|------:|
| barbell | 170 |
| dumbbell | 123 |
| other | 122 |
| body only | 111 |
| cable | 81 |
| **null** | **77** |
| machine | 67 |
| kettlebells | 53 |
| bands | 20 |
| medicine ball | 17 |
| exercise ball | 12 |
| foam roll | 11 |
| e-z curl bar | 9 |

### `primaryMuscles` (unique values)

| Value | Count |
|-------|------:|
| quadriceps | 148 |
| shoulders | 127 |
| abdominals | 93 |
| chest | 84 |
| hamstrings | 79 |
| triceps | 71 |
| biceps | 53 |
| lats | 38 |
| middle back | 34 |
| calves | 28 |
| lower back | 27 |
| forearms | 25 |
| glutes | 22 |
| traps | 15 |
| adductors | 13 |
| abductors | 8 |
| neck | 8 |

### `secondaryMuscles` (unique values)

| Value | Count |
|-------|------:|
| glutes | 220 |
| shoulders | 209 |
| hamstrings | 201 |
| calves | 181 |
| triceps | 147 |
| lower back | 104 |
| forearms | 94 |
| quadriceps | 82 |
| traps | 82 |
| biceps | 74 |
| middle back | 64 |
| chest | 63 |
| abdominals | 56 |
| lats | 56 |
| adductors | 41 |
| abductors | 35 |
| neck | 1 |

### `category`

| Value | Count |
|-------|------:|
| strength | 581 |
| stretching | 123 |
| plyometrics | 61 |
| powerlifting | 38 |
| olympic weightlifting | 35 |
| strongman | 21 |
| cardio | 14 |

### `force`

| Value | Count |
|-------|------:|
| pull | 371 |
| push | 369 |
| static | 104 |
| null | 29 |

### `mechanic`

| Value | Count |
|-------|------:|
| compound | 489 |
| isolation | 297 |
| null | 87 |

### FitlyPro taxonomy (implementation)

From `exercise.constants.js`:

```text
MUSCLES: chest, back, shoulders, biceps, triceps, forearms,
         quadriceps, hamstrings, glutes, calves, core, full_body, other

EQUIPMENT: barbell, dumbbell, cable, machine, bodyweight, kettlebell,
           resistance_band, smith_machine, bench, pull_up_bar,
           medicine_ball, other

DIFFICULTIES: beginner, intermediate, advanced

CATEGORIES: strength, cardio, mobility, stretching, warmup, plyometric, other
```

---

## 4. Muscle Mapping

Status legend: `DIRECT MATCH` | `NORMALIZATION REQUIRED` | `UNSUPPORTED` | `AMBIGUOUS`

| Source value | FitlyPro value | Status | Reason |
|--------------|----------------|--------|--------|
| abdominals | core | NORMALIZATION REQUIRED | Equivalent to FitlyPro `core` |
| abductors | — | UNSUPPORTED | No hip-abductor value in FitlyPro `MUSCLES` |
| adductors | — | UNSUPPORTED | No hip-adductor value in FitlyPro `MUSCLES` |
| biceps | biceps | DIRECT MATCH | Exact |
| calves | calves | DIRECT MATCH | Exact |
| chest | chest | DIRECT MATCH | Exact |
| forearms | forearms | DIRECT MATCH | Exact |
| glutes | glutes | DIRECT MATCH | Exact |
| hamstrings | hamstrings | DIRECT MATCH | Exact |
| lats | back | NORMALIZATION REQUIRED | Latissimus dorsi ⊂ back |
| lower back | back | NORMALIZATION REQUIRED | Lower-back erectors ⊂ back |
| middle back | back | NORMALIZATION REQUIRED | Mid-back / rhomboids ⊂ back |
| neck | — | UNSUPPORTED | No neck value; not equivalent to shoulders/core |
| quadriceps | quadriceps | DIRECT MATCH | Exact |
| shoulders | shoulders | DIRECT MATCH | Exact |
| traps | back | AMBIGUOUS | Usually back; upper traps also shoulder-adjacent |
| triceps | triceps | DIRECT MATCH | Exact |

**Do not auto-map** `abductors` / `adductors` / `neck` → `other`. That would silently degrade filter quality.

**Optional future schema expansion (not implemented):** `abductors`, `adductors`, `neck` (and possibly split `upper_back` / `lower_back`).

---

## 5. Equipment Mapping

| Source | FitlyPro | Status | Reason |
|--------|----------|--------|--------|
| barbell | barbell | DIRECT MATCH | Exact |
| dumbbell | dumbbell | DIRECT MATCH | Exact |
| cable | cable | DIRECT MATCH | Exact |
| machine | machine | DIRECT MATCH | Exact |
| other | other | DIRECT MATCH | Exact |
| body only | bodyweight | NORMALIZATION REQUIRED | Equivalent concept |
| kettlebells | kettlebell | NORMALIZATION REQUIRED | Plural → singular |
| bands | resistance_band | NORMALIZATION REQUIRED | Equivalent concept |
| medicine ball | medicine_ball | NORMALIZATION REQUIRED | Spacing → snake_case |
| e-z curl bar | barbell | AMBIGUOUS | EZ bar is a barbell variant; `other` also defensible |
| exercise ball | — | UNSUPPORTED | Stability ball not in FitlyPro `EQUIPMENT` |
| foam roll | — | UNSUPPORTED | Foam roller not in FitlyPro `EQUIPMENT` |
| null | — | UNSUPPORTED (as-is) | FitlyPro requires `equipment.length >= 1` |

**Null equipment breakdown (77):**

| Category | Count |
|----------|------:|
| stretching | 62 |
| plyometrics | 8 |
| strength | 6 |
| cardio | 1 |

**Recommended null policy (importer policy only — no schema change):**

- Default `null` → `["bodyweight"]` with warning when `category ∈ {stretching, plyometrics}` or name clearly bodyweight (e.g. “Bodyweight Walking Lunge”).
- Remaining null strength/cardio → manual review or `["other"]` with warning.

**Optional future equipment values (not implemented):** `foam_roll`, `exercise_ball`, `ez_bar`.

FitlyPro also has unused-by-source values: `smith_machine`, `bench`, `pull_up_bar` — source never emits them; no conflict.

---

## 6. Category Mapping

| Source | FitlyPro | Status | Reason |
|--------|----------|--------|--------|
| strength | strength | DIRECT MATCH | Exact |
| stretching | stretching | DIRECT MATCH | Exact |
| cardio | cardio | DIRECT MATCH | Exact |
| plyometrics | plyometric | NORMALIZATION REQUIRED | Plural → singular |
| powerlifting | strength | AMBIGUOUS | Specialty lost; preserve via tag `powerlifting` |
| olympic weightlifting | strength | AMBIGUOUS | Specialty lost; preserve via tag `olympic-weightlifting` |
| strongman | strength | AMBIGUOUS | Specialty lost; preserve via tag `strongman` |

FitlyPro categories with **no** source equivalent: `mobility`, `warmup`, `other`.

---

## 7. Difficulty Mapping

Source field: `level` → FitlyPro `difficulty`.

| Source `level` | FitlyPro `difficulty` | Status | Reason |
|----------------|----------------------|--------|--------|
| beginner | beginner | DIRECT MATCH | Exact |
| intermediate | intermediate | DIRECT MATCH | Exact |
| expert | advanced | NORMALIZATION REQUIRED | FitlyPro has no `expert` |

No unexpected level values beyond these three.

---

## 8. Primary Muscle Analysis

FitlyPro requires singular `muscles.primary` (enum). Source provides `primaryMuscles[]`.

| Cardinality | Records |
|-------------|---------|
| Zero primary muscles | **0** |
| Exactly one | **873** |
| More than one | **0** |

**Recommended strategy:** use `primaryMuscles[0]` after taxonomy mapping. Multi-primary selection is not currently needed for this dataset. If multi-primary appears in a future dataset revision, **do not** silently take `[0]` without logging — prefer manual review or a documented priority list.

---

## 9. Secondary Muscle Analysis

| Check | Count |
|-------|------:|
| Empty array `[]` | 272 |
| `null` secondary | 0 |
| Internal duplicates within secondary | 0 |
| Secondary contains a primary muscle value | **9** |
| Records with ≥1 unsupported secondary value | 51 |

Unsupported secondary value occurrences:

| Value | Occurrences |
|-------|------------:|
| adductors | 41 |
| abductors | 35 |
| neck | 1 |

FitlyPro already sanitizes secondary via `sanitizeSecondaryMuscles()` and schema validation forbidding secondary ≡ primary. Importer should:

1. Map each secondary through the muscle map.
2. Drop UNSUPPORTED values (log warning).
3. Run `sanitizeSecondaryMuscles(primary, secondary)`.

---

## 10. Instructions Analysis

| Metric | Value |
|--------|------:|
| Records with no instructions | 5 |
| Records with instructions | 868 |
| Min steps | 0 |
| Max steps | 24 |
| Average steps | 4.26 |
| Non-string steps | 0 |
| Records with >30 steps | 0 |
| Instruction steps longer than 500 chars | 27 steps across **26** records |

FitlyPro constraints (`exercise.model.js`):

- Max **30** instruction items (OK for this dataset).
- Max **500** characters per step — **26 records would fail validation** unless truncated/split.

Empty instructions are allowed (`default: []`) — not a blocker.

---

## 11. Media Analysis

| Metric | Value |
|--------|------:|
| Records with no images | 0 |
| Records with images | 873 |
| Min images | 2 |
| Max images | 2 |
| Average images | 2.00 |
| Paths matching `{idFolder}/{n}.jpg` | 1746 / 1746 |

### Proposed URL transformation (document only — do not store yet)

Upstream README documents:

```text
https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/{relativePath}
```

Example:

```text
Alternate_Hammer_Curl/0.jpg
→ https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Alternate_Hammer_Curl/0.jpg
```

Proposed FitlyPro media mapping:

| Source | FitlyPro |
|--------|----------|
| `images[0]` (absolutized) | `media.thumbnailUrl` |
| `images[]` (absolutized) | `media.imageUrls[]` |
| — | `media.videoUrl = null` |

**Caveats (important):**

- Do **not** download binaries into the FitlyPro repo in an import phase.
- GitHub raw CDN is fine for demos; production should eventually mirror/CDN assets under FitlyPro control.
- Joi create validators require URI format for media URLs; Mongoose schema currently accepts plain strings. Import path must still produce valid absolute URLs if API validation is used later.
- Max 10 `imageUrls` — source max 2 is fine.

---

## 12. Source ID Analysis

| Check | Result |
|-------|--------|
| Unique | Yes (873 / 873) |
| Length | 5–58 chars (FitlyPro `externalId` max 128) |
| Stable-looking | Yes — deterministic folder-style IDs (`Barbell_Bench_Press_Medium_Grip`) |
| Suitable as `source.externalId` | **Yes** |

Recommended FitlyPro source metadata:

```json
{
  "source": {
    "type": "import",
    "externalProvider": "free-exercise-db",
    "externalId": "<source.id>"
  }
}
```

Notes:

- `SOURCE_TYPES` already includes `import`.
- Partial unique index on `(externalProvider, externalId)` already exists — good for idempotent re-import.
- Prefer `externalId = id`, not slug/name, for stability.

---

## 13. Slug Collision Analysis

Slugs generated with existing `slugifyExerciseName()` (unchanged).

```text
Total generated slugs: 873
Unique generated slugs: 873
Collisions: 0
Empty/invalid slugs: 0
Names too short (<2) / too long (>120): 0 / 0
```

Unusual name characters (still produced valid unique slugs):

| Pattern | Count | Examples |
|---------|------:|----------|
| `/` | 8 | `3/4 Sit-Up`, `Adductor/Groin` |
| `&` | 0 | — |
| parentheses | 15 | `Band Good Morning (Pull Through)` |
| apostrophe | 7 | `Child's Pose`, `Farmer's Walk` |
| digits | 6 | `90/90 Hamstring`, `Kettlebell Figure 8` |

**Collision risk with Phase 3A seed:** system seed also uses slug uniqueness within `ownership.type=system`. Import must either:

- skip when system slug already exists, or
- upsert by `externalProvider+externalId` and keep seed-owned rows separate, or
- disambiguate slug (`{slug}-fedb`) on collision with non-import system rows.

This analysis did not mutate MongoDB to measure live collisions against the seeded 89 exercises; expect some name overlap (e.g. common lifts). Treat slug collision with existing system catalog as an **import-time** concern.

---

## 14. Complete Field Mapping

| Free Exercise DB | FitlyPro | Notes |
|------------------|----------|-------|
| `name` | `name` | Direct |
| — | `nameAr` | Absent; leave unset |
| `name` via `slugifyExerciseName` | `slug` | Generate |
| — | `description` / `descriptionAr` | No source field; leave null |
| `primaryMuscles[0]` (mapped) | `muscles.primary` | Always length 1 in this dataset |
| `secondaryMuscles[]` (mapped + sanitized) | `muscles.secondary[]` | Drop unsupported |
| `equipment` (mapped → 1-item array) | `equipment[]` | Scalar → array |
| `category` (mapped) | `category` | Specialty cats → strength + tags |
| `level` (mapped) | `difficulty` | `expert` → `advanced` |
| `instructions[]` | `instructions[]` | Truncate steps >500 chars |
| — | `instructionsAr` | Absent |
| — | `commonMistakes` | Absent → `[]` |
| `images[0]` absolutized | `media.thumbnailUrl` | Proposed URL only |
| `images[]` absolutized | `media.imageUrls[]` | Proposed URL only |
| — | `media.videoUrl` | null |
| `force`, `mechanic`, specialty category | `tags[]` | Recommended (see below) |
| — | `ownership` | `{ type: "system", trainerId: null }` for system import |
| `id` | `source.externalId` | With provider below |
| — | `source.type` | `import` |
| — | `source.externalProvider` | `free-exercise-db` |
| — | `status` | `active` |

### `force` and `mechanic`

No dedicated FitlyPro fields.

| Option | Recommendation |
|--------|----------------|
| Discard | Acceptable but loses useful Workout Builder filters |
| **Convert to tags** | **Recommended** — e.g. `push`, `pull`, `static`, `compound`, `isolation` |
| Future schema fields | Optional later; **not required** for import |
| Ignore intentionally | Only if tags policy is deferred |

Also tag specialty categories when collapsing to `strength`: `powerlifting`, `olympic-weightlifting`, `strongman`.

---

## 15. Data Loss Analysis

### Preserved fields

- `name`
- primary muscle (after mapping)
- secondary muscles (subset after mapping/sanitization)
- equipment (when mappable)
- category (when direct / normalized)
- difficulty (after `expert`→`advanced`)
- instructions (after length clamp)
- images (as URLs, if adopted)
- `id` as `externalId`

### Partially preserved fields

| Source | How preserved | Loss |
|--------|---------------|------|
| `primaryMuscles` detail (`lats`, `lower back`, …) | Mapped to broader `back` / `core` | Regional specificity |
| `equipment` variants (`e-z curl bar`) | Likely → `barbell` | Bar subtype |
| `category` specialty | → `strength` + tags | First-class category filter |
| `force` / `mechanic` | Recommended tags only | No first-class fields |
| Long instruction steps | Truncate to 500 | Wording tail |

### Discarded fields (unless tagged)

| Field | Why discarded | Acceptable? |
|-------|---------------|-------------|
| `force` (if not tagged) | No model field | Prefer tags instead |
| `mechanic` (if not tagged) | No model field | Prefer tags instead |
| Unsupported muscles as primary | Cannot validate | Reject record or expand taxonomy |
| Unsupported equipment | Cannot validate | Reject or expand taxonomy |
| Relative image paths alone | Need absolutization policy | OK if media deferred |

**Schema change not required** for a useful partial import. Taxonomy expansion would reduce rejects for abductors/adductors/neck/foam roll/exercise ball.

---

## 16. Import Readiness

Classification used for this report (strict against **current** FitlyPro enums, with documented maps):

| Bucket | Definition | Count |
|--------|------------|------:|
| Fully importable | All required fields map with **DIRECT MATCH** only | **283** |
| Normalization required | Needs safe deterministic maps (muscles/equip/category/difficulty) and no hard reject/ambiguous blockers | **355** |
| Manual review | Ambiguous maps (`traps`, `e-z curl bar`, olympic/strongman/powerlifting) without hard reject | **115** |
| Rejected | Missing/unsupported required fields under current enums (`equipment` null/unsupported, unsupported primary muscle) | **120** |

```text
283 + 355 + 115 + 120 = 873
```

**Additional soft issues (not exclusive buckets):**

| Issue | Count | Handling |
|-------|------:|----------|
| Instruction step >500 chars | 26 records | Truncate/split before save |
| Unsupported secondary only | 51 | Drop secondary values; keep record |
| Secondary contains primary | 9 | Sanitize via helper |

**If recommended null-equipment → `bodyweight` policy is adopted**, many of the 77 null-equipment rejects become importable (mostly stretches). That policy is recommended but **not** counted as fully importable above until explicitly approved.

---

## 17. Import Blockers

| Issue | Count | Examples | Recommended handling |
|-------|------:|----------|----------------------|
| `equipment` null | 77 | Cat Stretch; Arm Circles; Bodyweight Walking Lunge | Policy: map to `bodyweight` (esp. stretching/plyometrics) **or** reject |
| Unsupported equipment | 23 | foam roll (11), exercise ball (12) | Reject **or** expand `EQUIPMENT` |
| Unsupported primary muscle | 29 | adductors (13), abductors (8), neck (8) | Reject **or** expand `MUSCLES` |
| Ambiguous equipment | 9 | EZ-Bar Curl (`e-z curl bar`) | Manual / map to `barbell` + tag `ez-bar` |
| Ambiguous category | 94 | olympic weightlifting (35), powerlifting (38), strongman (21) | Map to `strength` + specialty tags |
| Ambiguous primary (`traps`) | 15 | (primary traps exercises) | Prefer `back` + tag `traps`, or manual |
| Instruction >500 chars | 26 | Barbell Squat; Clean | Truncate to 500 or split steps |
| Multi primary | 0 | — | N/A |
| Duplicate slug (within FEDB) | 0 | — | N/A |
| Invalid difficulty | 0 | — | N/A |
| Missing primary | 0 | — | N/A |

Hard blockers under **current enums without null-equipment policy:** ~120 records.

---

## 18. Recommended Normalization Rules

Include **only** mappings supported by this dataset:

```text
# Muscles
abdominals     → core
lats           → back
lower back     → back
middle back    → back
# traps        → back   (recommended default; classify as warning)

# Equipment
body only      → bodyweight
kettlebells    → kettlebell
bands          → resistance_band
medicine ball  → medicine_ball
# e-z curl bar → barbell  (warning)
# null         → bodyweight (policy; warning) when stretching/plyometrics

# Category
plyometrics             → plyometric
powerlifting            → strength (+ tag powerlifting)
olympic weightlifting   → strength (+ tag olympic-weightlifting)
strongman               → strength (+ tag strongman)

# Difficulty
expert → advanced

# Tags (preserve force/mechanic)
force: pull|push|static → tags
mechanic: compound|isolation → tags
```

Unsupported (no silent `other` mapping for muscles):

```text
abductors, adductors, neck
foam roll, exercise ball   # unless EQUIPMENT expanded
```

---

## 19. Recommended Import Policy

### Automatic import

- Direct taxonomy matches.
- Safe normalizations above (abdominals→core, body only→bodyweight, kettlebells→kettlebell, bands→resistance_band, medicine ball→medicine_ball, plyometrics→plyometric, expert→advanced, lats/lower back/middle back→back).
- Secondary unsupported values dropped with warning.
- Secondary∩primary sanitized.
- Instructions empty OK; steps ≤500 OK.
- `source.type=import`, provider `free-exercise-db`, `externalId=id`.
- Idempotent upsert on `(externalProvider, externalId)`.

### Import with warnings

- `traps` → `back` + tag `traps`.
- Specialty categories → `strength` + specialty tag.
- `e-z curl bar` → `barbell` + tag `ez-bar`.
- `equipment: null` → `bodyweight` when stretching/plyometrics (and clear bodyweight names).
- Instruction steps truncated to 500 chars.
- Media URLs absolutized to GitHub raw (or deferred media with empty URLs).

### Manual review

- Remaining `equipment: null` strength/cardio rows if not auto-mapped.
- Any future multi-primary muscle records.
- Slug collisions against existing FitlyPro system/seed catalog.

### Reject

- Primary muscle ∈ {abductors, adductors, neck} until taxonomy expands.
- Equipment ∈ {foam roll, exercise ball} until taxonomy expands (or explicit `other` policy is approved — **not** recommended by default).
- Records failing name/slug/validation after normalization.

---

## 20. Final Recommendation

> Can we safely import this dataset into FitlyPro **without changing** the existing Exercise model?

### Answer: **YES, with normalization**

**Why YES (model unchanged is viable):**

- `source.type: import` + `externalProvider` + `externalId` already exist.
- Required fields (`name`, `slug`, `muscles.primary`, `equipment[]`, `category`, `difficulty`) can be populated for the majority of records via deterministic maps.
- Primary muscle is always exactly one element in this dataset.
- IDs are unique and stable for idempotent import.
- Slug generation works with zero intra-dataset collisions.
- `force` / `mechanic` can be preserved as tags without schema changes.

**Why not unconditional YES:**

- ~120 records cannot satisfy current enums without policy choices or taxonomy expansion (`equipment` null/unsupported; unsupported primaries).
- Specialty categories and `traps` / EZ-bar need explicit warning policies.
- 26 records need instruction truncation to pass the 500-char limit.
- Media URLs are optional for MVP; if used, prefer documented GitHub raw transform or deferred empty media.

**Optional model/taxonomy changes (document only — do not implement now):**

| Change | Benefit |
|--------|---------|
| Add muscles `abductors`, `adductors`, `neck` | Recover 29 primary + cleaner secondaries |
| Add equipment `foam_roll`, `exercise_ball` (and maybe `ez_bar`) | Recover 23–32 equipment rows |
| First-class `force` / `mechanic` | Avoid tags-only loss |

**None of the above are required** to start a useful partial import of Free Exercise DB into FitlyPro.

---

## Appendix A — FitlyPro validation constraints used

From current implementation:

- `muscles.primary` required enum `MUSCLES`
- `muscles.secondary` enum `MUSCLES`, must not include primary
- `equipment` required array, min 1, enum `EQUIPMENT`
- `category` / `difficulty` required enums
- `instructions` max 30 items, each max 500 chars
- `media.imageUrls` max 10
- `tags` max 20, lowercase
- Ownership consistency: system ⇒ `trainerId` null
- Unique: `(ownership.type, ownership.trainerId, slug)`
- Unique (partial): `(source.externalProvider, source.externalId)`

---

## Appendix B — Environment actions taken / not taken

| Action | Done? |
|--------|------:|
| Analyzed full upstream `exercises.json` (873 records) | Yes |
| Wrote this report | Yes |
| Modified MongoDB | **No** |
| Modified Exercise model / constants / validators / helpers | **No** |
| Created importer / seed of FEDB | **No** |
| Committed dataset into repo | **No** |
| Downloaded image binaries | **No** |
