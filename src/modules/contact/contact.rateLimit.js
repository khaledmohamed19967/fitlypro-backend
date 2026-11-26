import crypto from 'crypto';
import ContactMessage from './contact.model.js';
import {
    CONTACT_RATE_LIMIT_MAX,
    CONTACT_RATE_LIMIT_WINDOW_MS,
} from './contact.constants.js';
import config from '../../config/index.js';

/**
 * Resolve client IP (honors trust proxy when configured).
 * @param {import('express').Request} req
 * @returns {string}
 */
export const resolveClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded[0]) {
        return String(forwarded[0]).trim();
    }
    return String(req.ip || req.socket?.remoteAddress || 'unknown').trim();
};

/**
 * Hash IP for storage / rate-limit keys (do not store raw IPs).
 * @param {string} ip
 * @returns {string}
 */
export const hashClientIp = (ip) => {
    const salt = config.contact?.ipHashSalt || 'fitlyflow-contact';
    return crypto
        .createHash('sha256')
        .update(`${salt}:${ip}`)
        .digest('hex');
};

/**
 * Mongo-backed per-IP rate limit for Contact Us (serverless-safe).
 * @param {string} ipHash
 * @returns {Promise<{ limited: boolean, count: number, retryAfterSec: number }>}
 */
export const checkContactRateLimit = async (ipHash) => {
    const since = new Date(Date.now() - CONTACT_RATE_LIMIT_WINDOW_MS);
    const count = await ContactMessage.countDocuments({
        ipHash,
        createdAt: { $gte: since },
    });

    if (count >= CONTACT_RATE_LIMIT_MAX) {
        const oldest = await ContactMessage.findOne({
            ipHash,
            createdAt: { $gte: since },
        })
            .sort({ createdAt: 1 })
            .select('createdAt')
            .lean();

        const retryAfterMs = oldest?.createdAt
            ? Math.max(
                  0,
                  CONTACT_RATE_LIMIT_WINDOW_MS -
                      (Date.now() - new Date(oldest.createdAt).getTime())
              )
            : CONTACT_RATE_LIMIT_WINDOW_MS;

        return {
            limited: true,
            count,
            retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        };
    }

    return { limited: false, count, retryAfterSec: 0 };
};
