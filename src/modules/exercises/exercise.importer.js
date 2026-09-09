/**
 * Free Exercise DB → FitlyPro Exercise importer (Phase 3B)
 *
 * Usage:
 *   pnpm run import:exercises -- --dry-run
 *   pnpm run import:exercises
 *   FREE_EXERCISE_DB_PATH=./path/to/exercises.json pnpm run import:exercises
 *
 * Identity: source.externalProvider + source.externalId
 * Never deletes exercises. Never updates trainer-owned documents.
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import mongoose from 'mongoose';

import config from '../../config/index.js';
import Exercise from './exercise.model.js';
import {
    EXTERNAL_PROVIDER,
    REJECTION,
    WARNING,
} from './import/freeExerciseDb.mappings.js';
import { normalizeExercise } from './import/freeExerciseDb.normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../..');
const DEFAULT_DATASET_PATH = join(
    PROJECT_ROOT,
    'data',
    'external',
    'free-exercise-db',
    'exercises.json'
);

const IMPORTER_OWNED_FIELDS = [
    'name',
    'slug',
    'description',
    'muscles',
    'equipment',
    'category',
    'difficulty',
    'instructions',
    'commonMistakes',
    'media',
    'tags',
    'source',
    'status',
    'ownership',
];

const BATCH_SIZE = 100;

const parseArgs = (argv) => {
    const args = argv.slice(2);
    let dryRun = false;
    let pathArg = null;

    for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (a === '--dry-run') dryRun = true;
        else if (a === '--path' && args[i + 1]) {
            pathArg = args[i + 1];
            i += 1;
        } else if (a.startsWith('--path=')) {
            pathArg = a.slice('--path='.length);
        }
    }

    return { dryRun, pathArg };
};

export const resolveDatasetPath = ({ pathArg } = {}) => {
    if (pathArg) {
        return isAbsolute(pathArg) ? pathArg : resolve(process.cwd(), pathArg);
    }
    if (process.env.FREE_EXERCISE_DB_PATH) {
        const envPath = process.env.FREE_EXERCISE_DB_PATH;
        return isAbsolute(envPath) ? envPath : resolve(process.cwd(), envPath);
    }
    return DEFAULT_DATASET_PATH;
};

export const loadSourceDataset = (datasetPath) => {
    if (!existsSync(datasetPath)) {
        throw new Error(
            `Free Exercise DB dataset not found at: ${datasetPath}\n` +
                'Download dist/exercises.json from https://github.com/yuhonas/free-exercise-db\n' +
                `Place it at ${DEFAULT_DATASET_PATH} or set FREE_EXERCISE_DB_PATH / pass --path`
        );
    }

    const raw = JSON.parse(readFileSync(datasetPath, 'utf8'));
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('Dataset must be a non-empty JSON array');
    }
    return raw;
};

/**
 * Resolve a unique system slug. Existing FEDB import keeps its current slug when still free.
 */
export const resolveUniqueSystemSlug = (
    preferredSlug,
    {
        reservedSystemSlugs,
        existingImportSlug = null,
        existingImportExternalId = null,
        externalId,
    }
) => {
    if (
        existingImportSlug &&
        (!reservedSystemSlugs.has(existingImportSlug) ||
            reservedSystemSlugs.get(existingImportSlug) === externalId)
    ) {
        return { slug: existingImportSlug, collided: false };
    }

    let slug = preferredSlug;
    let collided = false;

    const isFree = (candidate) => {
        // Map values: missing key = free; null = occupied by non-FEDB system; string = FEDB externalId
        if (!reservedSystemSlugs.has(candidate)) {
            return true;
        }
        return reservedSystemSlugs.get(candidate) === externalId;
    };

    if (!isFree(slug)) {
        collided = true;
        slug = `${preferredSlug}-fedb`;
        if (!isFree(slug)) {
            let n = 2;
            while (!isFree(`${preferredSlug}-fedb-${n}`)) {
                n += 1;
                if (n > 1000) {
                    throw new Error(`Unable to resolve unique slug for ${preferredSlug}`);
                }
            }
            slug = `${preferredSlug}-fedb-${n}`;
        }
    }

    return { slug, collided };
};

const createEmptyStats = () => ({
    sourceRecords: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    rejected: 0,
    warnings: 0,
    slugCollisions: 0,
    writes: 0,
    rejections: {
        [REJECTION.UNSUPPORTED_PRIMARY_MUSCLE]: 0,
        [REJECTION.UNSUPPORTED_EQUIPMENT]: 0,
        [REJECTION.NULL_EQUIPMENT]: 0,
        [REJECTION.INVALID_CATEGORY]: 0,
        [REJECTION.INVALID_DIFFICULTY]: 0,
        [REJECTION.MISSING_PRIMARY_MUSCLE]: 0,
        [REJECTION.INVALID_NAME]: 0,
        [REJECTION.INVALID_SLUG]: 0,
        [REJECTION.VALIDATION_FAILED]: 0,
        [REJECTION.TRAINER_EXERCISE_COLLISION]: 0,
    },
    normalization: {
        muscleMappings: 0,
        equipmentMappings: 0,
        categoryMappings: 0,
        difficultyMappings: 0,
        tagMappings: 0,
    },
});

const logWarn = (name, code, detail) => {
    console.log(`[WARN] ${name}`);
    console.log(code);
    if (detail) console.log(detail);
};

const logReject = (name, code, detail) => {
    console.log(`[REJECTED] ${name || '(unnamed)'}`);
    console.log(code);
    if (detail) console.log(detail);
};

const applyImporterFields = (target, doc) => {
    for (const field of IMPORTER_OWNED_FIELDS) {
        target[field] = doc[field];
    }
};

/**
 * Validate a plain document via Mongoose (full schema validation).
 */
export const validateImportRecord = async (doc) => {
    const model = new Exercise(doc);
    try {
        await model.validate();
        return { ok: true, error: null };
    } catch (err) {
        return { ok: false, error: err.message };
    }
};

const loadCollisionMaps = async () => {
    const systemExercises = await Exercise.find({ 'ownership.type': 'system' })
        .select('slug source ownership')
        .lean();

    /** @type {Map<string, string|null>} slug → externalId (null if not FEDB) */
    const reservedSystemSlugs = new Map();
    /** @type {Map<string, object>} externalId → lean doc */
    const existingByExternalId = new Map();

    for (const ex of systemExercises) {
        const isFedb =
            ex.source?.externalProvider === EXTERNAL_PROVIDER &&
            typeof ex.source?.externalId === 'string';
        const externalId = isFedb ? ex.source.externalId : null;
        reservedSystemSlugs.set(ex.slug, externalId);
        if (isFedb) {
            existingByExternalId.set(ex.source.externalId, ex);
        }
    }

    const trainerCount = await Exercise.countDocuments({ 'ownership.type': 'trainer' });

    return { reservedSystemSlugs, existingByExternalId, trainerCount };
};

/**
 * Persist one validated document (create or update).
 */
const persistOne = async (doc, existingLean) => {
    if (existingLean) {
        const existing = await Exercise.findById(existingLean._id);
        if (!existing) {
            const created = new Exercise(doc);
            await created.save();
            return 'created';
        }
        if (existing.ownership?.type === 'trainer') {
            return 'trainer_collision';
        }
        if (
            existing.source?.externalProvider !== EXTERNAL_PROVIDER ||
            existing.source?.externalId !== doc.source.externalId
        ) {
            return 'skip_non_import';
        }
        applyImporterFields(existing, doc);
        await existing.save();
        return 'updated';
    }

    const created = new Exercise(doc);
    await created.save();
    return 'created';
};

/**
 * Batch persistence with full Mongoose validation via save().
 * Validation safety > micro-optimization for 873 records.
 */
const persistBatch = async (items, dryRun) => {
    const results = [];
    if (dryRun) {
        for (const item of items) {
            results.push({ ...item, action: item.existing ? 'updated' : 'created' });
        }
        return results;
    }

    for (const item of items) {
        const action = await persistOne(item.doc, item.existing);
        results.push({ ...item, action });
    }
    return results;
};

export const runImport = async ({ dryRun = false, datasetPath } = {}) => {
    const path = datasetPath || resolveDatasetPath();
    console.log(dryRun ? 'Exercise import DRY RUN started...\n' : 'Exercise import started...\n');
    console.log(`Dataset: ${path}`);

    const sourceRecords = loadSourceDataset(path);
    const stats = createEmptyStats();
    stats.sourceRecords = sourceRecords.length;

    const uri = config.database.url || process.env.APP_DB_URL;
    if (!uri) {
        throw new Error('APP_DB_URL is not set');
    }

    await mongoose.connect(uri);
    console.log(`Connected to MongoDB: ${mongoose.connection.host}`);
    console.log(dryRun ? 'Mode: dry-run (no writes)\n' : 'Mode: import (writes enabled)\n');

    const { reservedSystemSlugs, existingByExternalId, trainerCount } =
        await loadCollisionMaps();
    const trainerCountBefore = trainerCount;
    const seedSystemBefore = await Exercise.countDocuments({
        'ownership.type': 'system',
        $or: [
            { 'source.type': 'seed' },
            {
                'source.externalProvider': { $ne: EXTERNAL_PROVIDER },
                'source.type': { $ne: 'import' },
            },
        ],
    });

    /** Track slugs reserved during this run (including new imports) */
    const runSlugOwners = new Map(reservedSystemSlugs);

    const pending = [];

    for (const source of sourceRecords) {
        const label = source?.name || source?.id || '(unknown)';
        const normalized = normalizeExercise(source);

        if (!normalized.ok) {
            stats.rejected += 1;
            if (stats.rejections[normalized.reject] != null) {
                stats.rejections[normalized.reject] += 1;
            } else {
                stats.rejections[REJECTION.VALIDATION_FAILED] += 1;
            }
            logReject(label, normalized.reject, normalized.detail);
            for (const w of normalized.warnings || []) {
                stats.warnings += 1;
                logWarn(label, w.code, w.message);
            }
            continue;
        }

        for (const w of normalized.warnings) {
            stats.warnings += 1;
            logWarn(label, w.code, w.message);
        }

        if (normalized.stats.muscleMapped) stats.normalization.muscleMappings += 1;
        if (normalized.stats.equipmentMapped) stats.normalization.equipmentMappings += 1;
        if (normalized.stats.categoryMapped) stats.normalization.categoryMappings += 1;
        if (normalized.stats.difficultyMapped) stats.normalization.difficultyMappings += 1;
        if (normalized.stats.tagsAdded > 0) stats.normalization.tagMappings += 1;

        const externalId = normalized.doc.source.externalId;
        const existing = existingByExternalId.get(externalId) || null;

        if (existing?.ownership?.type === 'trainer') {
            stats.skipped += 1;
            stats.rejections[REJECTION.TRAINER_EXERCISE_COLLISION] += 1;
            logReject(label, REJECTION.TRAINER_EXERCISE_COLLISION, `externalId=${externalId}`);
            continue;
        }

        let slugResult;
        try {
            slugResult = resolveUniqueSystemSlug(normalized.baseSlug, {
                reservedSystemSlugs: runSlugOwners,
                existingImportSlug: existing?.slug || null,
                externalId,
            });
        } catch (err) {
            stats.rejected += 1;
            stats.rejections[REJECTION.VALIDATION_FAILED] += 1;
            logReject(label, REJECTION.VALIDATION_FAILED, err.message);
            continue;
        }

        if (slugResult.collided) {
            stats.slugCollisions += 1;
            stats.warnings += 1;
            logWarn(
                label,
                WARNING.WARNING_SLUG_COLLISION,
                `${normalized.baseSlug} → ${slugResult.slug}`
            );
        }

        const doc = { ...normalized.doc, slug: slugResult.slug };

        const validation = await validateImportRecord(doc);
        if (!validation.ok) {
            stats.rejected += 1;
            stats.rejections[REJECTION.VALIDATION_FAILED] += 1;
            logReject(label, REJECTION.VALIDATION_FAILED, validation.error);
            continue;
        }

        runSlugOwners.set(doc.slug, externalId);
        pending.push({ doc, existing, label });

        if (pending.length >= BATCH_SIZE) {
            const batch = pending.splice(0, pending.length);
            const results = await persistBatch(batch, dryRun);
            for (const r of results) {
                if (r.action === 'created') {
                    stats.created += 1;
                    if (!dryRun) stats.writes += 1;
                } else if (r.action === 'updated') {
                    stats.updated += 1;
                    if (!dryRun) stats.writes += 1;
                } else if (r.action === 'trainer_collision') {
                    stats.skipped += 1;
                    stats.rejections[REJECTION.TRAINER_EXERCISE_COLLISION] += 1;
                    logReject(r.label, REJECTION.TRAINER_EXERCISE_COLLISION, '');
                } else {
                    stats.skipped += 1;
                }
            }
        }
    }

    if (pending.length) {
        const results = await persistBatch(pending, dryRun);
        for (const r of results) {
            if (r.action === 'created') {
                stats.created += 1;
                if (!dryRun) stats.writes += 1;
            } else if (r.action === 'updated') {
                stats.updated += 1;
                if (!dryRun) stats.writes += 1;
            } else if (r.action === 'trainer_collision') {
                stats.skipped += 1;
                stats.rejections[REJECTION.TRAINER_EXERCISE_COLLISION] += 1;
                logReject(r.label, REJECTION.TRAINER_EXERCISE_COLLISION, '');
            } else {
                stats.skipped += 1;
            }
        }
    }

    const trainerCountAfter = await Exercise.countDocuments({ 'ownership.type': 'trainer' });
    const fedbCount = await Exercise.countDocuments({
        'ownership.type': 'system',
        'source.externalProvider': EXTERNAL_PROVIDER,
    });

    console.log('\n---------- Import summary ----------');
    console.log(`Source records: ${stats.sourceRecords}`);
    console.log(`Imported (created): ${stats.created}`);
    console.log(`Updated: ${stats.updated}`);
    console.log(`Skipped: ${stats.skipped}`);
    console.log(`Rejected: ${stats.rejected}`);
    console.log(`Warnings: ${stats.warnings}`);
    console.log(`Slug collisions: ${stats.slugCollisions}`);
    console.log(`MongoDB writes: ${dryRun ? 0 : stats.writes}`);
    console.log('\nRejection breakdown:');
    for (const [code, count] of Object.entries(stats.rejections)) {
        if (count > 0) console.log(`  ${code}: ${count}`);
    }
    console.log('\nSafety:');
    console.log(`  Trainer exercises before: ${trainerCountBefore}`);
    console.log(`  Trainer exercises after:  ${trainerCountAfter}`);
    console.log(`  FEDB system docs in DB:   ${fedbCount}`);
    console.log(
        dryRun
            ? '\nExercise import dry-run completed (no writes).'
            : '\nExercise import completed successfully.'
    );

    await mongoose.connection.close();

    return {
        dryRun,
        datasetPath: path,
        stats,
        trainerCountBefore,
        trainerCountAfter,
        seedSystemBefore,
        fedbCount,
    };
};

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
    const { dryRun, pathArg } = parseArgs(process.argv);
    const datasetPath = resolveDatasetPath({ pathArg });

    runImport({ dryRun, datasetPath })
        .then(() => {
            process.exit(0);
        })
        .catch(async (err) => {
            console.error('Exercise import failed:', err.message);
            try {
                await mongoose.connection.close();
            } catch {
                /* ignore */
            }
            process.exit(1);
        });
}
