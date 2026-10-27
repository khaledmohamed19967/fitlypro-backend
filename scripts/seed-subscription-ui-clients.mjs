/**
 * Seed 3 trainer clients for subscription expiry UI verification (dev/test only).
 *
 * Usage:
 *   SEED_TRAINER_EMAIL=coach@example.com node scripts/seed-subscription-ui-clients.mjs
 *   SEED_TRAINER_EMAIL=coach@example.com node scripts/seed-subscription-ui-clients.mjs --verify
 *
 * Idempotent: stable emails under test.subscription.ui.*@ex.co
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../src/modules/users/user.model.js';
import {
    classifySubscriptionPackage,
    utcCalendarDayMs,
} from '../src/modules/clients/client.subscription-attention.js';
import { resolveCoachingPackageEndDate } from '../src/modules/clients/client.package-dates.js';
import { buildClientListScopeQuery } from '../src/modules/clients/client.list-scope.js';
import { resolveSubscriptionNeedsAttention } from '../src/modules/clients/client.subscription-attention.js';

const SEED_TAG = 'SEED:subscription-ui-verify';
const TEST_PASSWORD = 'TestSeedPass123';
/** Must satisfy User email regex (TLD length 2–3). */
const EMAIL_DOMAIN = 'ex.co';

const BLOCKED_DB_URL_PATTERNS = [
    /production/i,
    /\.vercel\.app/i,
    /fitlypro-backend\.netlify/i,
];

const isLocalDbUrl = (url) =>
    /mongodb(\+srv)?:\/\/(localhost|127\.0\.0\.1)/i.test(url);

const CLIENTS = [
    {
        key: 'expired',
        firstName: 'TEST',
        lastName: 'Subscription Expired',
        email: `test.subscription.ui.expired@${EMAIL_DOMAIN}`,
        dayOffset: -1,
    },
    {
        key: 'ends-today',
        firstName: 'TEST',
        lastName: 'Subscription Ends Today',
        email: `test.subscription.ui.ends-today@${EMAIL_DOMAIN}`,
        dayOffset: 0,
    },
    {
        key: 'ends-in-2-days',
        firstName: 'TEST',
        lastName: 'Subscription Ends In 2 Days',
        email: `test.subscription.ui.ends-in-2-days@${EMAIL_DOMAIN}`,
        dayOffset: 2,
    },
];

/** Local calendar day at noon (matches frontend subscriptionCalendarDaysUntilEnd). */
function endDateForLocalDayOffset(offsetDays, now = new Date()) {
    return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + offsetDays,
        12,
        0,
        0,
        0
    );
}

function assertSafeEnvironment() {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing to seed: NODE_ENV=production');
    }

    const dbUrl = process.env.APP_DB_URL;
    if (!dbUrl) {
        throw new Error('APP_DB_URL is required (configure .env for local dev)');
    }

    for (const pattern of BLOCKED_DB_URL_PATTERNS) {
        if (pattern.test(dbUrl)) {
            throw new Error(
                'Refusing to seed: APP_DB_URL looks like a production deployment database'
            );
        }
    }

    if (!isLocalDbUrl(dbUrl) && process.env.SEED_ACK_REMOTE_DB !== '1') {
        throw new Error(
            'Refusing to seed: APP_DB_URL is not localhost. Set SEED_ACK_REMOTE_DB=1 only for a verified dev/test cluster.'
        );
    }

    const trainerEmail = process.env.SEED_TRAINER_EMAIL?.trim().toLowerCase();
    if (!trainerEmail) {
        throw new Error('SEED_TRAINER_EMAIL is required (trainer who will see these clients)');
    }

    return { dbUrl, trainerEmail };
}

async function resolveTrainer(trainerEmail) {
    const trainer = await User.findOne({ email: trainerEmail, role: 'trainer' });
    if (!trainer) {
        throw new Error(`Trainer not found for SEED_TRAINER_EMAIL=${trainerEmail}`);
    }
    return trainer;
}

function buildClientFields(trainerId, spec, now, passwordHash) {
    const endDate = endDateForLocalDayOffset(spec.dayOffset, now);
    return {
        firstName: spec.firstName,
        lastName: spec.lastName,
        password: passwordHash,
        phone: '5550001234',
        role: 'client',
        trainer: trainerId,
        isActive: true,
        packageDuration: '1_month',
        endDate,
        startDate: null,
        programType: 'online_coaching',
        primaryFitnessGoal: 'general_fitness',
        experienceLevel: 'beginner',
        additionalNotes: SEED_TAG,
    };
}

/**
 * Uses collection.updateOne to avoid slow/hanging User.create save hooks in some environments.
 */
async function upsertClient(trainer, spec, now, passwordHash) {
    const existing = await User.findOne({ email: spec.email });

    if (existing) {
        if (existing.role !== 'client') {
            throw new Error(`Email conflict: ${spec.email} belongs to a non-client user`);
        }
        if (
            existing.trainer &&
            existing.trainer.toString() !== trainer._id.toString()
        ) {
            throw new Error(
                `Email conflict: ${spec.email} is owned by another trainer — not overwriting`
            );
        }
    }

    const fields = buildClientFields(trainer._id, spec, now, passwordHash);
    await User.collection.updateOne(
        { email: spec.email },
        {
            $set: { ...fields, email: spec.email, updatedAt: new Date() },
            $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
    );

    const user = await User.findOne({ email: spec.email });
    return { action: existing ? 'updated' : 'created', user };
}

function summarizeClient(user, now) {
    const profile = user.getPublicProfile();
    const classified = classifySubscriptionPackage(
        {
            startDate: profile.startDate,
            packageDuration: profile.packageDuration,
            endDate: profile.endDate,
        },
        now
    );
    const effectiveEnd = resolveCoachingPackageEndDate({
        startDate: profile.startDate,
        packageDuration: profile.packageDuration,
        endDate: profile.endDate,
    });

    return {
        id: profile.id,
        name: profile.fullName,
        email: profile.email,
        endDate: profile.endDate,
        packageDuration: profile.packageDuration,
        effectiveEndUtcDay: effectiveEnd
            ? new Date(utcCalendarDayMs(effectiveEnd)).toISOString().slice(0, 10)
            : null,
        backendBucket: classified?.bucket ?? null,
        daysUntilEnd: classified?.daysUntilEnd ?? null,
    };
}

async function verifyHttp(trainerEmail, summaries) {
    const base = process.env.API_URL || 'http://localhost:8000';
    const api = `${base.replace(/\/+$/, '')}/api/v1`;

    const loginRes = await fetch(`${api}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trainerEmail, password: process.env.SEED_TRAINER_PASSWORD }),
    });

    if (!loginRes.ok) {
        console.log(
            'SKIP HTTP verify: login failed (set SEED_TRAINER_PASSWORD or start API on API_URL)'
        );
        return;
    }

    const loginJson = await loginRes.json();
    const token = loginJson?.data?.token;
    if (!token) {
        console.log('SKIP HTTP verify: no token in login response');
        return;
    }

    const listRes = await fetch(`${api}/clients?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const listJson = await listRes.json();
    const rows = listJson?.data?.clients ?? [];

    for (const summary of summaries) {
        const row = rows.find((c) => c.id === summary.id || c.email === summary.email);
        if (!row) {
            console.log(`FAIL HTTP: client not in list — ${summary.email}`);
            continue;
        }
        console.log(
            `HTTP OK: ${summary.email} endDate=${row.endDate} needsAttention=${JSON.stringify(row.needsAttention)}`
        );
    }
}

async function main() {
    const verify = process.argv.includes('--verify');
    const { dbUrl, trainerEmail } = assertSafeEnvironment();
    const now = new Date();

    console.log(`Target DB: ${dbUrl.replace(/\/\/[^@]+@/, '//***@')}`);
    console.log(`Trainer: ${trainerEmail}`);
    console.log(`Reference now (local): ${now.toString()}\n`);

    await mongoose.connect(dbUrl, {
        serverSelectionTimeoutMS: 20_000,
        connectTimeoutMS: 20_000,
    });
    console.log('Connected to MongoDB.\n');
    const trainer = await resolveTrainer(trainerEmail);
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

    const summaries = [];
    for (const spec of CLIENTS) {
        const { action, user } = await upsertClient(trainer, spec, now, passwordHash);
        const summary = summarizeClient(user, now);
        summaries.push(summary);
        console.log(
            `${action.toUpperCase()}: ${summary.name} <${summary.email}> endDate=${summary.endDate} bucket=${summary.backendBucket}`
        );
    }

    const dupCount = await User.countDocuments({
        email: { $in: CLIENTS.map((c) => c.email) },
    });
    if (dupCount !== CLIENTS.length) {
        throw new Error(`Expected ${CLIENTS.length} seed clients, found ${dupCount}`);
    }

    console.log('\nSummary (API profile / backend UTC classification):');
    for (const s of summaries) {
        console.log(JSON.stringify(s, null, 2));
    }

    const scope = buildClientListScopeQuery(trainer._id, {});
    const listed = await User.find({
        ...scope,
        email: { $in: CLIENTS.map((c) => c.email) },
    });
    console.log('\nRoster scope verification (same filter as GET /clients default):');
    for (const summary of summaries) {
        const doc = listed.find((u) => u.email === summary.email);
        if (!doc) {
            console.log(`FAIL LIST: missing ${summary.email}`);
            continue;
        }
        const profile = doc.getPublicProfile();
        const needsAttention = resolveSubscriptionNeedsAttention(
            {
                startDate: profile.startDate,
                packageDuration: profile.packageDuration,
                endDate: profile.endDate,
            },
            now
        );
        console.log(
            `OK LIST: ${summary.email} endDate=${profile.endDate} needsAttention=${JSON.stringify(needsAttention)}`
        );
    }

    if (verify) {
        await verifyHttp(trainerEmail, summaries);
    } else {
        console.log('\nTip: add --verify + SEED_TRAINER_PASSWORD for HTTP GET /clients');
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
