import ContactMessage from './contact.model.js';
import { sendContactNotificationEmail } from './contact.mailer.js';
import {
    checkContactRateLimit,
    hashClientIp,
    resolveClientIp,
} from './contact.rateLimit.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Persist a Contact Us message, then attempt support notification email.
 * Persistence always wins over email — temporary mailer failures keep the row.
 *
 * @param {{ fullName: string, email: string, message: string }} payload
 * @param {import('express').Request} req
 * @param {{ sendContactNotificationEmailFn?: typeof sendContactNotificationEmail }} [deps]
 * @returns {Promise<{ id: string, emailDelivered: boolean, emailSkipped: boolean }>}
 */
export const createContactMessage = async (payload, req, deps = {}) => {
    const ip = resolveClientIp(req);
    const ipHash = hashClientIp(ip);

    const rate = await checkContactRateLimit(ipHash);
    if (rate.limited) {
        throw new ApiError(
            429,
            'Too many contact submissions. Please try again later.',
            [
                {
                    field: 'rateLimit',
                    message: `Retry after approximately ${rate.retryAfterSec} seconds`,
                },
            ]
        );
    }

    const doc = await ContactMessage.create({
        fullName: payload.fullName,
        email: payload.email,
        message: payload.message,
        status: 'new',
        emailStatus: 'pending',
        ipHash,
    });

    const sendFn =
        deps.sendContactNotificationEmailFn || sendContactNotificationEmail;

    const mailResult = await sendFn({
        id: String(doc._id),
        fullName: doc.fullName,
        email: doc.email,
        message: doc.message,
        createdAt: doc.createdAt,
    });

    if (mailResult.skipped) {
        doc.emailStatus = 'skipped';
        doc.emailError = null;
    } else if (mailResult.delivered) {
        doc.emailStatus = 'sent';
        doc.emailError = null;
    } else {
        doc.emailStatus = 'failed';
        doc.emailError = mailResult.error || 'Email delivery failed';
        console.error('[contact] support email delivery failed', {
            id: String(doc._id),
            error: doc.emailError,
        });
    }

    await doc.save();

    return {
        id: String(doc._id),
        emailDelivered: mailResult.delivered === true,
        emailSkipped: mailResult.skipped === true,
    };
};

export default {
    createContactMessage,
};
