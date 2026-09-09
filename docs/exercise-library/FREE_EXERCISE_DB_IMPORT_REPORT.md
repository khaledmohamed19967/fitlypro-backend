# Free Exercise DB Import Report (Phase 3B)

> Runtime results from the FitlyPro importer.  
> Source analysis: `FREE_EXERCISE_DB_IMPORT_ANALYSIS.md`  
> Importer: `src/modules/exercises/exercise.importer.js`

---

## Dataset

| Item | Value |
|------|-------|
| Provider | Free Exercise DB (`yuhonas/free-exercise-db`) |
| Local path | `data/external/free-exercise-db/exercises.json` |
| Source records | **873** |
| Unique source IDs | 873 |

Override path with `FREE_EXERCISE_DB_PATH` or `--path`.

---

## Commands

```text
pnpm run import:exercises -- --dry-run
pnpm run import:exercises
```

---

## Dry run (verified)

```text
Source records: 873
Imported (created): 817
Updated: 0
Skipped: 0
Rejected: 56
Warnings: 367
Slug collisions: 0
MongoDB writes: 0
```

Rejection breakdown (dry run):

```text
UNSUPPORTED_PRIMARY_MUSCLE: 29
UNSUPPORTED_EQUIPMENT: 21
NULL_EQUIPMENT: 6
```

---

## Real import (verified)

After a partial failure (slug-collision bug against Phase 3A seed), the collision check was fixed and import completed.

### Completing import run

```text
Source records: 873
Created: 782
Updated: 35
Skipped: 0
Rejected: 56
Warnings: 392
Slug collisions: 25
MongoDB writes: 817
FEDB system docs: 817
```

### Bodyweight-name heuristic refinement

Null-equipment names that clearly indicate bodyweight (`push-up`, `pull-up`, `inverted row`) were then auto-mapped to `bodyweight`. Follow-up import:

```text
Created: 3
Updated: 817
Rejected: 53
Slug collisions: 2
MongoDB writes: 820
FEDB system docs: 820
```

### Final database totals (post-import)

```text
Total exercises: 909
System exercises: 909
Trainer exercises: 0
Phase 3A seed (source.type=seed): 89
Free Exercise DB imports: 820
```

```text
Created (FEDB cumulative): 820
Updated (last full re-run identity): see idempotency
Skipped: 0
Rejected: 53
```

---

## Idempotency re-run (verified)

```text
Created: 0
Updated: 817
Rejected: 56
MongoDB writes: 817
No duplicate FEDB documents
FEDB count unchanged at time of that re-run (817); later +3 bodyweight fixes → 820
```

Identity used: `source.externalProvider=free-exercise-db` + `source.externalId`.

---

## Rejection breakdown (final)

```text
UNSUPPORTED_PRIMARY_MUSCLE: 29
UNSUPPORTED_EQUIPMENT: 21
NULL_EQUIPMENT: 3
```

### Remaining NULL_EQUIPMENT (3)

Strength/cardio with `equipment: null` and name not clearly bodyweight:

- Floor Glute-Ham Raise
- Prone Manual Hamstring
- Trail Running/Walking

### Unsupported primary muscles (29)

`abductors`, `adductors`, `neck` — not mapped to `other`.

### Unsupported equipment (21)

`foam roll`, `exercise ball` — not mapped to `other`.

(Analysis expected 23 equipment rejects; 2 overlap with unsupported primary and are counted under primary.)

---

## Normalization (runtime)

Applied rules from the analysis (no schema changes):

| Area | Behavior |
|------|----------|
| Muscles | abdominals→core; lats/lower back/middle back→back; traps→back + tag `traps` |
| Equipment | body only→bodyweight; kettlebells→kettlebell; bands→resistance_band; medicine ball→medicine_ball; e-z curl bar→barbell + tag `ez-bar` |
| Null equipment | stretching/plyometrics → bodyweight; clear bodyweight names → bodyweight; else reject |
| Category | plyometrics→plyometric; specialty → strength + tags |
| Difficulty | expert→advanced |
| Tags | force, mechanic, specialty, traps, ez-bar |
| Instructions | split long steps; truncate only if unavoidable (≤500 chars) |
| Media | absolute GitHub raw URLs (no binary download) |

---

## Slug collisions

25 collisions with existing Phase 3A system seed on first successful write.

Strategy: keep seed row; import FEDB as `{slug}-fedb` (then `-fedb-2` if needed).

Phase 3A seed documents were **not** deleted or converted to `source.type=import`.

---

## Safety

| Check | Result |
|-------|--------|
| Trainer exercises modified | **NO** (count 0→0) |
| Phase 3A seed deleted | **NO** (89 remain) |
| Collection wiped / deleteMany | **NO** |
| Upsert identity | externalProvider + externalId |
| Validation | full Mongoose `validate()` + `save()` |

---

## Media

| Check | Result |
|-------|--------|
| Images as absolute URLs | **YES** |
| Binary images downloaded into repo | **NO** |
| Example | `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/3_4_Sit-Up/0.jpg` |

**Production note:** GitHub raw URLs are acceptable for MVP. Production should eventually mirror assets to FitlyPro-controlled storage/CDN.

---

## API verification

Authenticated `GET /api/v1/exercises?page=1&limit=24&status=active`:

```text
success: true
exercises.length: 24
pagination.total: 906+ (909 after final +3)
media.thumbnailUrl / imageUrls: absolute https URLs
ownership.type: system
```

Sample imported document:

```json
{
  "ownership": { "type": "system", "trainerId": null },
  "source": {
    "type": "import",
    "externalProvider": "free-exercise-db",
    "externalId": "3_4_Sit-Up"
  }
}
```

---

## Files

```text
src/modules/exercises/exercise.importer.js
src/modules/exercises/import/freeExerciseDb.mappings.js
src/modules/exercises/import/freeExerciseDb.normalize.js
data/external/free-exercise-db/exercises.json
data/external/free-exercise-db/README.md
```
