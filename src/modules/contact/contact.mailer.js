import config from '../../config/index.js';
import { CONTACT_SUPPORT_EMAIL_DEFAULT } from './contact.constants.js';

/**
 * Escape user content for safe HTML email bodies.
 * @param {unknown} value
 * @returns {string}
 */
export const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/**
 * @param {{
 *   id: string,
 *   fullName: string,
 *   email: string,
 *   message: string,
 *   createdAt: Date|string,
 * }} message
 * @returns {{ subject: string, text: string, html: string }}
 */
export const buildContactNotificationContent = (message) => {
    const submittedAt = new Date(message.createdAt).toISOString();
    const subject = `[FitlyFlow Contact] Message from ${message.fullName}`;

    const text = [
        'New Contact Us submission',
        '',
        `ID: ${message.id}`,
        `Name: ${message.fullName}`,
        `Email: ${message.email}`,
        `Submitted: ${submittedAt}`,
        '',
        'Message:',
        message.message,
    ].join('\n');

    const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;line-height:1.5;color:#111">
  <h2 style="margin:0 0 12px">New Contact Us submission</h2>
  <p style="margin:0 0 8px"><strong>ID:</strong> ${escapeHtml(message.id)}</p>
  <p style="margin:0 0 8px"><strong>Name:</strong> ${escapeHtml(message.fullName)}</p>
  <p style="margin:0 0 8px"><strong>Email:</strong> ${escapeHtml(message.email)}</p>
  <p style="margin:0 0 16px"><strong>Submitted:</strong> ${escapeHtml(submittedAt)}</p>
  <p style="margin:0 0 4px"><strong>Message:</strong></p>
  <pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:8px">${escapeHtml(
      message.message
  )}</pre>
</body>
</html>`;

    return { subject, text, html };
};

/**
 * Send via Resend HTTP API (no extra npm dependency).
 * @param {{ to: string, from: string, subject: string, text: string, html: string, apiKey: string }}
 * @returns {Promise<{ ok: boolean, providerId?: string, error?: string }>}
 */
const sendViaResend = async ({ to, from, subject, text, html, apiKey }) => {
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: [to],
            subject,
            text,
            html,
        }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail =
            typeof body?.message === 'string'
                ? body.message
                : `Resend HTTP ${response.status}`;
        return { ok: false, error: detail.slice(0, 500) };
    }

    return {
        ok: true,
        providerId: typeof body?.id === 'string' ? body.id : undefined,
    };
};

/**
 * Deliver a contact notification email when a provider is configured.
 * Returns skipped when email is not configured (local/dev without keys).
 *
 * @param {{
 *   id: string,
 *   fullName: string,
 *   email: string,
 *   message: string,
 *   createdAt: Date|string,
 * }} contactMessage
 * @param {{ sendViaResendFn?: typeof sendViaResend }} [deps]
 * @returns {Promise<{ delivered: boolean, skipped: boolean, error: string|null }>}
 */
export const sendContactNotificationEmail = async (
    contactMessage,
    deps = {}
) => {
    const { subject, text, html } = buildContactNotificationContent(contactMessage);
    const to =
        config.email?.supportInbox || CONTACT_SUPPORT_EMAIL_DEFAULT;
    const from = config.email?.from;
    const provider = config.email?.provider;
    const apiKey = config.email?.resendApiKey;

    if (provider !== 'resend' || !apiKey || !from) {
        return {
            delivered: false,
            skipped: true,
            error: null,
        };
    }

    const sendFn = deps.sendViaResendFn || sendViaResend;

    try {
        const result = await sendFn({
            to,
            from,
            subject,
            text,
            html,
            apiKey,
        });

        if (!result.ok) {
            return {
                delivered: false,
                skipped: false,
                error: result.error || 'Email delivery failed',
            };
        }

        return { delivered: true, skipped: false, error: null };
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Email delivery failed';
        return {
            delivered: false,
            skipped: false,
            error: message.slice(0, 500),
        };
    }
};
