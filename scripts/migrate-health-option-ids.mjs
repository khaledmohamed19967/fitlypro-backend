/**
 * Migrate legacy allergy/dietary strings on NutritionProfile to catalog option IDs.
 * Does not auto-map User.injuries narrative text to body areas.
 *
 * Usage:
 *   node scripts/migrate-health-option-ids.mjs --dry-run
 *   node scripts/migrate-health-option-ids.mjs
 */

import 'dotenv/config';
import mongoose from 'mongoose';

import HealthReferenceOption from '../src/modules/health-reference/health-reference.model.js';
import NutritionProfile from '../src/modules/nutrition-profiles/nutrition-profile.model.js';

const parseArgs = (argv) => {
    const options = { dryRun: false };
    for (const arg of argv) {
        if (arg === '--' || arg === '') continue;
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }
        if (arg.startsWith('--')) {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
};

/**
 * @param {string} value
 * @param {Array<{ _id, code, label }>} catalog
 */
const matchLegacyValue = (value, catalog) => {
    const trimmed = String(value).trim();
    if (!trimmed) {
        return { id: null, ambiguous: false, skipped: true };
    }

    const lower = trimmed.toLowerCase();
    const asCode = lower.replace(/\s+/g, '_').replace(/-/g, '_');

    const codeHit = catalog.find((o) => o.code.toLowerCase() === asCode);
    if (codeHit) {
        return { id: codeHit._id, ambiguous: false, skipped: false };
    }

    const labelHits = catalog.filter((o) => o.label.toLowerCase() === lower);
    if (labelHits.length === 1) {
        return { id: labelHits[0]._id, ambiguous: false, skipped: false };
    }
    if (labelHits.length > 1) {
        return { id: null, ambiguous: true, skipped: false };
    }

    return { id: null, ambiguous: false, skipped: false };
};

const migrateProfileField = ({
    profile,
    stringField,
    idField,
    catalog,
    report,
    dryRun,
}) => {
    const existingIds = profile[idField] ?? [];
    if (existingIds.length > 0) {
        report.skippedProfilesWithExistingIds += 1;
        return false;
    }

    const strings = profile[stringField] ?? [];
    if (!strings.length) {
        return false;
    }

    let changed = false;
    const nextIds = [...existingIds.map((id) => id.toString())];

    for (const raw of strings) {
        const { id, ambiguous, skipped } = matchLegacyValue(raw, catalog);
        if (skipped) {
            continue;
        }
        if (ambiguous) {
            report.ambiguous.push({
                profileId: profile._id.toString(),
                field: stringField,
                value: raw,
            });
            continue;
        }
        if (!id) {
            report.unmatched.push({
                profileId: profile._id.toString(),
                field: stringField,
                value: raw,
            });
            continue;
        }
        const idStr = id.toString();
        if (!nextIds.includes(idStr)) {
            nextIds.push(idStr);
            changed = true;
            report.matched.push({
                profileId: profile._id.toString(),
                field: stringField,
                value: raw,
                optionId: idStr,
            });
        }
    }

    if (changed && !dryRun) {
        profile[idField] = nextIds.map((id) => new mongoose.Types.ObjectId(id));
        // Legacy strings intentionally preserved
    }

    return changed;
};

const main = async () => {
    const { dryRun } = parseArgs(process.argv.slice(2));
    if (!process.env.APP_DB_URL) {
        throw new Error('APP_DB_URL is required');
    }

    await mongoose.connect(process.env.APP_DB_URL);

    const [allergyCatalog, dietaryCatalog] = await Promise.all([
        HealthReferenceOption.find({ category: 'allergy' }).lean(),
        HealthReferenceOption.find({ category: 'dietary_restriction' }).lean(),
    ]);

    const profiles = await NutritionProfile.find({});
    const report = {
        dryRun,
        profilesScanned: profiles.length,
        profilesUpdated: 0,
        skippedProfilesWithExistingIds: 0,
        matched: [],
        unmatched: [],
        ambiguous: [],
        userInjuriesNote:
            'User.injuries free text was not auto-mapped to body_area IDs (by design).',
    };

    for (const profile of profiles) {
        const allergyChanged = migrateProfileField({
            profile,
            stringField: 'allergies',
            idField: 'allergyOptionIds',
            catalog: allergyCatalog,
            report,
            dryRun,
        });
        const dietaryChanged = migrateProfileField({
            profile,
            stringField: 'dietaryRestrictions',
            idField: 'dietaryRestrictionOptionIds',
            catalog: dietaryCatalog,
            report,
            dryRun,
        });

        if ((allergyChanged || dietaryChanged) && !dryRun) {
            await profile.save();
            report.profilesUpdated += 1;
        } else if ((allergyChanged || dietaryChanged) && dryRun) {
            report.profilesUpdated += 1;
        }
    }

    console.log(JSON.stringify(report, null, 2));

    await mongoose.disconnect();
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
