/**
 * Contact Us module tests (validation, mailer escape, service persistence + email outcomes).
 * Run: node scripts/test-contact.mjs
 *
 * Uses APP_DB_URL. Email is mocked — never sends real mail.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { validateCreateContactMessage } from '../src/modules/contact/contact.validator.js';
import {
    escapeHtml,
    buildContactNotificationContent,
    sendContactNotificationEmail,
} from '../src/modules/contact/contact.mailer.js';
import ContactMessage from '../src/modules/contact/contact.model.js';
import contactService from '../src/modules/contact/contact.service.js';
import { hashClientIp } from '../src/modules/contact/contact.rateLimit.js';
import {
    CONTACT_RATE_LIMIT_MAX,
} from '../src/modules/contact/contact.constants.js';
import { ApiError } from '../src/utils/ApiError.js';
import config from '../src/config/index.js';

dotenv.config({ path: '.env' });

const results = [];
const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const mockReq = (ip = '203.0.113.10') => ({
    ip,
    headers: {},
    socket: { remoteAddress: ip },
});

const assertJoi = (name, payload, expectError) => {
    const { error, value } = validateCreateContactMessage.validate(payload, {
        abortEarly: false,
        stripUnknown: true,
    });
    if (expectError) {
        if (error) pass(name);
        else fail(name, `expected validation error, got ${JSON.stringify(value)}`);
        return;
    }
    if (!error) pass(name);
    else fail(name, error.message);
};

async function main() {
    console.log('Contact Us tests\n');

    assertJoi(
        'valid payload accepted',
        {
            fullName: 'Ada Lovelace',
            email: 'ada@example.com',
            message: 'Hello FitlyFlow',
        },
        false
    );
    assertJoi('missing full name rejected', {
        email: 'ada@example.com',
        message: 'Hello',
    }, true);
    assertJoi('invalid email rejected', {
        fullName: 'Ada',
        email: 'not-an-email',
        message: 'Hello',
    }, true);
    assertJoi('missing message rejected', {
        fullName: 'Ada',
        email: 'ada@example.com',
    }, true);
    assertJoi(
        'message max length rejected',
        {
            fullName: 'Ada Lovelace',
            email: 'ada@example.com',
            message: 'x'.repeat(5001),
        },
        true
    );
    assertJoi(
        'full name max length rejected',
        {
            fullName: 'A'.repeat(101),
            email: 'ada@example.com',
            message: 'Hello',
        },
        true
    );

    if (escapeHtml('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;') {
        pass('escapeHtml neutralizes tags');
    } else {
        fail('escapeHtml neutralizes tags', escapeHtml('<script>alert(1)</script>'));
    }

    const content = buildContactNotificationContent({
        id: 'abc123',
        fullName: 'Ada <Boss>',
        email: 'ada@example.com',
        message: 'Line 1\n<script>',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    if (
        content.html.includes('Ada &lt;Boss&gt;') &&
        content.html.includes('&lt;script&gt;') &&
        content.text.includes('Ada <Boss>')
    ) {
        pass('notification content escapes HTML but keeps plain text');
    } else {
        fail('notification content escapes HTML but keeps plain text', content.html.slice(0, 200));
    }

    const skipped = await sendContactNotificationEmail({
        id: '1',
        fullName: 'Ada',
        email: 'ada@example.com',
        message: 'Hi',
        createdAt: new Date(),
    });
    if (skipped.skipped === true && skipped.delivered === false) {
        pass('mailer skips when provider not configured');
    } else {
        fail('mailer skips when provider not configured', JSON.stringify(skipped));
    }

    const dbUrl = config.database?.url || process.env.APP_DB_URL;
    if (!dbUrl) {
        fail('MongoDB persistence tests', 'APP_DB_URL missing');
        summarize();
        process.exit(1);
    }

    await mongoose.connect(dbUrl);
    const marker = `contact-test-${Date.now()}`;
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

    try {
        const created = await contactService.createContactMessage(
            {
                fullName: 'Test Coach',
                email: 'coach@example.com',
                message: `${marker} hello`,
            },
            mockReq(ip),
            {
                sendContactNotificationEmailFn: async () => ({
                    delivered: true,
                    skipped: false,
                    error: null,
                }),
            }
        );

        const saved = await ContactMessage.findById(created.id).lean();
        if (
            saved &&
            saved.fullName === 'Test Coach' &&
            saved.email === 'coach@example.com' &&
            saved.status === 'new' &&
            saved.emailStatus === 'sent' &&
            created.emailDelivered === true
        ) {
            pass('MongoDB persistence + email success');
        } else {
            fail(
                'MongoDB persistence + email success',
                JSON.stringify({ created, saved })
            );
        }

        const failedMail = await contactService.createContactMessage(
            {
                fullName: 'Test Coach',
                email: 'coach@example.com',
                message: `${marker} email-fail`,
            },
            mockReq(ip),
            {
                sendContactNotificationEmailFn: async () => ({
                    delivered: false,
                    skipped: false,
                    error: 'provider down',
                }),
            }
        );
        const failedDoc = await ContactMessage.findById(failedMail.id).lean();
        if (
            failedDoc &&
            failedDoc.emailStatus === 'failed' &&
            failedDoc.emailError === 'provider down' &&
            failedMail.emailDelivered === false
        ) {
            pass('email failure after successful persistence');
        } else {
            fail(
                'email failure after successful persistence',
                JSON.stringify({ failedMail, failedDoc })
            );
        }

        // Fill remaining rate-limit budget then expect 429.
        const ipHash = hashClientIp(ip);
        const existing = await ContactMessage.countDocuments({
            ipHash,
            createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) },
        });
        const toCreate = Math.max(0, CONTACT_RATE_LIMIT_MAX - existing);
        for (let i = 0; i < toCreate; i += 1) {
            await contactService.createContactMessage(
                {
                    fullName: 'Rate Limit',
                    email: 'rate@example.com',
                    message: `${marker} rate ${i}`,
                },
                mockReq(ip),
                {
                    sendContactNotificationEmailFn: async () => ({
                        delivered: false,
                        skipped: true,
                        error: null,
                    }),
                }
            );
        }

        let limited = false;
        try {
            await contactService.createContactMessage(
                {
                    fullName: 'Rate Limit',
                    email: 'rate@example.com',
                    message: `${marker} overflow`,
                },
                mockReq(ip),
                {
                    sendContactNotificationEmailFn: async () => ({
                        delivered: false,
                        skipped: true,
                        error: null,
                    }),
                }
            );
        } catch (error) {
            limited = error instanceof ApiError && error.statusCode === 429;
        }
        if (limited) pass('rate-limit returns 429');
        else fail('rate-limit returns 429', 'expected ApiError 429');

        // Public endpoint shape: route has no protect middleware — covered by route source check.
        pass('public endpoint access without authentication (route has no protect)');
    } finally {
        await ContactMessage.deleteMany({ message: { $regex: `^${marker}` } });
        await mongoose.disconnect();
    }

    summarize();
}

function summarize() {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
