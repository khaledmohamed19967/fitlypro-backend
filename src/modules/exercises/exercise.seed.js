/**
 * System Exercise seed script (Phase 3A)
 *
 * Usage: pnpm run seed:exercises
 *
 * Behavior:
 * - Upserts by (ownership.type=system, slug)
 * - Never deletes exercises
 * - Never overwrites trainer-owned exercises
 * - Safe to re-run
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

import '../../config/index.js';
import Exercise from './exercise.model.js';
import {
    MUSCLES,
    EQUIPMENT,
    DIFFICULTIES,
    CATEGORIES,
} from './exercise.constants.js';
import { slugifyExerciseName, normalizeTags, sanitizeSecondaryMuscles } from './exercise.helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, 'data', 'exercises.seed.json');

/** Fields owned/managed by the seed for system exercises */
const SEED_OWNED_FIELDS = [
    'name',
    'description',
    'muscles',
    'equipment',
    'category',
    'difficulty',
    'instructions',
    'commonMistakes',
    'media',
    'tags',
    'status',
    'source',
    'ownership',
    'slug',
];

const muscleSet = new Set(MUSCLES);
const equipmentSet = new Set(EQUIPMENT);
const difficultySet = new Set(DIFFICULTIES);
const categorySet = new Set(CATEGORIES);

const emptyMedia = () => ({
    thumbnailUrl: null,
    imageUrls: [],
    videoUrl: null,
});

/**
 * Validate static dataset before any DB writes.
 */
const validateSeedDataset = (rawItems) => {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw new Error('Seed dataset must be a non-empty array');
    }

    const slugSeen = new Set();
    const nameSeen = new Set();
    const errors = [];

    rawItems.forEach((item, index) => {
        const label = item?.name || `index ${index}`;

        if (!item?.name || typeof item.name !== 'string' || item.name.trim().length < 2) {
            errors.push(`${label}: invalid name`);
            return;
        }

        const slug = slugifyExerciseName(item.name);
        if (!slug) {
            errors.push(`${label}: could not derive slug`);
        }
        if (slugSeen.has(slug)) {
            errors.push(`${label}: duplicate slug "${slug}"`);
        }
        slugSeen.add(slug);

        const nameKey = item.name.trim().toLowerCase();
        if (nameSeen.has(nameKey)) {
            errors.push(`${label}: duplicate name`);
        }
        nameSeen.add(nameKey);

        if (!item.muscles?.primary || !muscleSet.has(item.muscles.primary)) {
            errors.push(`${label}: invalid primary muscle`);
        }

        const secondary = item.muscles?.secondary || [];
        if (!Array.isArray(secondary)) {
            errors.push(`${label}: secondary muscles must be an array`);
        } else {
            for (const m of secondary) {
                if (!muscleSet.has(m)) {
                    errors.push(`${label}: invalid secondary muscle "${m}"`);
                }
                if (m === item.muscles.primary) {
                    errors.push(`${label}: secondary includes primary`);
                }
            }
        }

        if (!Array.isArray(item.equipment) || item.equipment.length < 1) {
            errors.push(`${label}: equipment requires at least one value`);
        } else {
            for (const eq of item.equipment) {
                if (!equipmentSet.has(eq)) {
                    errors.push(`${label}: invalid equipment "${eq}"`);
                }
            }
        }

        if (!categorySet.has(item.category)) {
            errors.push(`${label}: invalid category`);
        }
        if (!difficultySet.has(item.difficulty)) {
            errors.push(`${label}: invalid difficulty`);
        }
    });

    if (errors.length) {
        const message = ['Seed dataset validation failed:', ...errors.map((e) => `  - ${e}`)].join(
            '\n'
        );
        throw new Error(message);
    }
};

const toSeedDocument = (item) => {
    const slug = slugifyExerciseName(item.name);
    const primary = item.muscles.primary;
    const secondary = sanitizeSecondaryMuscles(primary, item.muscles.secondary || []);

    return {
        name: item.name.trim(),
        slug,
        description: item.description?.trim() || null,
        muscles: {
            primary,
            secondary,
        },
        equipment: item.equipment,
        category: item.category,
        difficulty: item.difficulty,
        instructions: item.instructions || [],
        commonMistakes: item.commonMistakes || [],
        media: item.media
            ? {
                  thumbnailUrl: item.media.thumbnailUrl ?? null,
                  imageUrls: item.media.imageUrls || [],
                  videoUrl: item.media.videoUrl ?? null,
              }
            : emptyMedia(),
        tags: normalizeTags(item.tags || []),
        ownership: {
            type: 'system',
            trainerId: null,
        },
        source: {
            type: 'seed',
            externalProvider: null,
            externalId: null,
            duplicatedFromId: null,
        },
        status: 'active',
    };
};

const applySeedFields = (doc, seedDoc) => {
    for (const field of SEED_OWNED_FIELDS) {
        doc[field] = seedDoc[field];
    }
};

const seedExercises = async () => {
    console.log('Exercise seed started...\n');

    const raw = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
    validateSeedDataset(raw);

    const uri = process.env.APP_DB_URL;
    if (!uri) {
        throw new Error('APP_DB_URL is not set');
    }

    await mongoose.connect(uri);
    console.log(`Connected to MongoDB: ${mongoose.connection.host}\n`);

    const stats = {
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        failures: [],
    };

    for (const item of raw) {
        const seedDoc = toSeedDocument(item);
        const { slug, name } = seedDoc;

        try {
            // Never overwrite trainer-owned exercises (even if slug matches).
            const trainerCollision = await Exercise.findOne({
                slug,
                'ownership.type': 'trainer',
            }).select('_id');

            if (trainerCollision) {
                const existingSystem = await Exercise.findOne({
                    slug,
                    'ownership.type': 'system',
                });

                if (existingSystem) {
                    // System row already exists — safe to refresh seed-owned fields only.
                    applySeedFields(existingSystem, seedDoc);
                    await existingSystem.save();
                    stats.updated += 1;
                } else {
                    stats.skipped += 1;
                    console.log(
                        `Skipped (trainer slug collision): ${slug}`
                    );
                }
                continue;
            }

            const existingSystem = await Exercise.findOne({
                slug,
                'ownership.type': 'system',
            });

            if (existingSystem) {
                applySeedFields(existingSystem, seedDoc);
                await existingSystem.save();
                stats.updated += 1;
                continue;
            }

            const created = new Exercise(seedDoc);
            await created.save();
            stats.created += 1;
        } catch (err) {
            stats.failed += 1;
            stats.failures.push({ slug: slug || name, reason: err.message });
            console.error(`Failed: ${slug || name}`);
            console.error(`  Reason: ${err.message}`);
        }
    }

    console.log('\nCreated:', stats.created);
    console.log('Updated:', stats.updated);
    console.log('Skipped:', stats.skipped);
    console.log('Failed:', stats.failed);

    if (stats.failures.length) {
        console.log('\nFailed details:');
        for (const failure of stats.failures) {
            console.log(`- ${failure.slug}`);
            console.log(`  Reason: ${failure.reason}`);
        }
    }

    console.log('\nExercise seed completed successfully.');

    await mongoose.connection.close();
    return stats;
};

seedExercises()
    .then((stats) => {
        process.exit(stats.failed > 0 ? 1 : 0);
    })
    .catch(async (err) => {
        console.error('\nExercise seed aborted:', err.message);
        try {
            await mongoose.connection.close();
        } catch {
            // ignore
        }
        process.exit(1);
    });
