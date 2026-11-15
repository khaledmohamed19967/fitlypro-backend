/**
 * International phone normalization (Phase 0–1 foundation).
 *
 * Approved contract (structured):
 *   {
 *     phoneCountryIso: "EG",       // ISO 3166-1 alpha-2 — selected country (source of truth)
 *     phoneCountryCode: "+20",     // derived from ISO via libphonenumber-js (never trusted from client)
 *     phone: "+201100450580"       // E.164 — canonical for matching / WhatsApp / lookups
 *   }
 *
 * Default country: EG / +20 when `allowDefaultCountry: true` and ISO is omitted.
 * Never assume every number is Egyptian; never strip-all-digits as “validation”.
 *
 * --- Legacy transition (compatibility — no schema/API cutover in this phase) ---
 *
 * Today’s persisted/API shape is a single digits-only `phone` (`/^[0-9]{10,15}$/`) on
 * User, ClientProspectInvitation, and ClientRegistrationRequest. Callers still send that
 * legacy field without `phoneCountryIso`.
 *
 * Intended transition:
 * 1. This utility is the single normalize/validate entry point for structured payloads.
 * 2. Phase 2 dual-write: structured `{ phone, phoneCountryIso }` → E.164 + ISO + calling code.
 *    Legacy-only `{ phone }` digits still accepted; ISO/code left unset (never guessed as EG).
 * 3. Distinction: E.164 values always start with `+`; legacy values never do.
 * 4. Conflicting caller-supplied `phoneCountryCode` is rejected; matching codes are accepted.
 * 5. No uniqueness indexes; ClientInvitation (password) stays phone-free.
 * 6. Migration/backfill of existing Mongo rows remains out of scope.
 *
 * @module utils/phone
 */

import {
    getCountryCallingCode,
    isSupportedCountry,
    parsePhoneNumberFromString,
} from 'libphonenumber-js';
import { ApiError } from './ApiError.js';

/** Application default ISO when defaulting is explicitly permitted. */
export const DEFAULT_PHONE_COUNTRY_ISO = 'EG';

/** Legacy digits-only rule used by current Mongoose/Joi phone fields. */
export const LEGACY_DIGITS_ONLY_PHONE_PATTERN = /^[0-9]{10,15}$/;

/**
 * Canonical E.164 stored form when structured phone contract is used.
 * Distinction strategy: E.164 always starts with `+`; legacy never does.
 */
export const E164_PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * @typedef {object} NormalizedPhone
 * @property {string} phoneCountryIso  ISO 3166-1 alpha-2 (selected)
 * @property {string} phoneCountryCode E.g. "+20" — derived from ISO
 * @property {string} phone            E.164, e.g. "+201004500580"
 */

/**
 * @typedef {object} PhoneFieldError
 * @property {string} field
 * @property {string} message
 */

/**
 * @typedef {{ ok: true, value: NormalizedPhone | null } | { ok: false, error: PhoneFieldError }} PhoneNormalizeResult
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export const isLegacyDigitsOnlyPhone = (value) => {
    if (value == null) return false;
    return LEGACY_DIGITS_ONLY_PHONE_PATTERN.test(String(value).trim());
};

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export const isE164Phone = (value) => {
    if (value == null) return false;
    return E164_PHONE_PATTERN.test(String(value).trim());
};

/**
 * Stored `phone` may be legacy digits-only or E.164. Never treat legacy as E.164.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isStoredPhoneValue = (value) =>
    isLegacyDigitsOnlyPhone(value) || isE164Phone(value);

/**
 * Escape a string for safe RegExp use.
 *
 * @param {unknown} value
 * @returns {string}
 */
export const escapePhoneSearchRegex = (value) =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Inbox / list phone search clauses that support legacy and E.164 without
 * short cross-country false positives.
 *
 * - E.164 query (`+…`): exact match (and exact prefix only for longer queries).
 * - Full legacy digit string (10–15): exact legacy match only (not substring of E.164).
 * - Shorter digit fragments: match legacy phones that do not start with `+` only.
 *
 * @param {string} term
 * @returns {object[]}
 */
export const buildPhoneInboxSearchClauses = (term) => {
    const trimmed = typeof term === 'string' ? term.trim() : '';
    if (!trimmed) return [];

    const escaped = escapePhoneSearchRegex(trimmed);

    if (trimmed.startsWith('+')) {
        const clauses = [{ phone: trimmed }];
        if (trimmed.length >= 8) {
            clauses.push({ phone: new RegExp(`^${escaped}`) });
        }
        return clauses;
    }

    if (LEGACY_DIGITS_ONLY_PHONE_PATTERN.test(trimmed)) {
        // Exact legacy only — do not substring-match E.164 national tails across countries.
        return [{ phone: trimmed }];
    }

    if (/^[0-9]{3,9}$/.test(trimmed)) {
        // Partial legacy search: digits-only stored values (no leading +).
        return [
            {
                $and: [
                    { phone: { $regex: escaped } },
                    { phone: { $not: /^\+/ } },
                ],
            },
        ];
    }

    return [{ phone: new RegExp(escaped, 'i') }];
};

/**
 * Apply structured-or-legacy phone contract onto a Joi-validated object.
 * Mutates field values in the returned object (does not trust phoneCountryCode).
 *
 * @param {Record<string, unknown>} value
 * @param {import('joi').CustomHelpers} helpers
 * @param {{ required?: boolean, allowDefaultCountry?: boolean, legacyStripNonDigits?: boolean }} [options]
 * @returns {Record<string, unknown> | ReturnType<import('joi').CustomHelpers['error']> | ReturnType<import('joi').CustomHelpers['message']>}
 */
export const applyPhoneContractToValue = (
    value,
    helpers,
    {
        required = false,
        allowDefaultCountry = false,
        legacyStripNonDigits = false,
    } = {}
) => {
    const phoneRaw = value.phone;
    const isoRaw = value.phoneCountryIso;
    const codeRaw = value.phoneCountryCode;

    const phoneEmpty = phoneRaw == null || phoneRaw === '';
    const hasIso = isoRaw != null && String(isoRaw).trim() !== '';
    const hasSuppliedCode = codeRaw != null && String(codeRaw).trim() !== '';

    if (phoneEmpty) {
        if (hasIso || hasSuppliedCode) {
            return helpers.message(
                'phone is required when phoneCountryIso or phoneCountryCode is provided'
            );
        }
        if (required) {
            return helpers.message('Phone number is required');
        }
        return {
            ...value,
            phone: undefined,
            phoneCountryIso: undefined,
            phoneCountryCode: undefined,
        };
    }

    if (hasIso) {
        const result = normalizeInternationalPhone(
            { phone: phoneRaw, phoneCountryIso: isoRaw },
            { required: true, allowDefaultCountry }
        );
        if (!result.ok) {
            return helpers.message(result.error.message);
        }

        if (codeRaw != null && String(codeRaw).trim() !== '') {
            const supplied = String(codeRaw).trim();
            if (supplied !== result.value.phoneCountryCode) {
                return helpers.message(
                    'phoneCountryCode does not match the selected country'
                );
            }
        }

        return {
            ...value,
            phone: result.value.phone,
            phoneCountryIso: result.value.phoneCountryIso,
            phoneCountryCode: result.value.phoneCountryCode,
        };
    }

    // Legacy path — no ISO → no fabricated country fields; no EG guessing.
    const trimmed = String(phoneRaw).trim();

    if (legacyStripNonDigits) {
        // Preserve prior prospect behavior: strip formatting to digits-only.
        // Do not invent ISO/calling-code for these rows.
        const legacyPhone = trimmed.replace(/\D/g, '');
        if (!isLegacyDigitsOnlyPhone(legacyPhone)) {
            return helpers.message(
                'Please provide a valid phone number (10-15 digits) or include phoneCountryIso'
            );
        }
        return {
            ...value,
            phone: legacyPhone,
            phoneCountryIso: undefined,
            phoneCountryCode: undefined,
        };
    }

    if (trimmed.startsWith('+') || isE164Phone(trimmed)) {
        return helpers.message(
            'phoneCountryIso is required when phone is in international format'
        );
    }

    if (!isLegacyDigitsOnlyPhone(trimmed)) {
        return helpers.message(
            'Please provide a valid phone number (10-15 digits) or include phoneCountryIso'
        );
    }

    return {
        ...value,
        phone: trimmed,
        phoneCountryIso: undefined,
        phoneCountryCode: undefined,
    };
};

/**
 * Pick normalized phone fields for persistence / DTO copy.
 *
 * @param {{ phone?: unknown, phoneCountryIso?: unknown, phoneCountryCode?: unknown }} source
 * @returns {{ phone?: string, phoneCountryIso?: string, phoneCountryCode?: string }}
 */
export const pickPersistedPhoneFields = (source = {}) => {
    const out = {};
    if (source.phone != null && source.phone !== '') {
        out.phone = String(source.phone);
    }
    if (source.phoneCountryIso != null && source.phoneCountryIso !== '') {
        out.phoneCountryIso = String(source.phoneCountryIso);
    }
    if (source.phoneCountryCode != null && source.phoneCountryCode !== '') {
        out.phoneCountryCode = String(source.phoneCountryCode);
    }
    return out;
};

/**
 * Public/API phone fields — never fabricate ISO/code for legacy rows.
 *
 * @param {{ phone?: unknown, phoneCountryIso?: unknown, phoneCountryCode?: unknown } | null | undefined} doc
 * @returns {{ phone: string | null, phoneCountryIso: string | null, phoneCountryCode: string | null }}
 */
export const toPhoneResponseFields = (doc) => {
    if (!doc) {
        return { phone: null, phoneCountryIso: null, phoneCountryCode: null };
    }
    const phone =
        doc.phone == null || doc.phone === '' ? null : String(doc.phone);
    const phoneCountryIso =
        doc.phoneCountryIso == null || doc.phoneCountryIso === ''
            ? null
            : String(doc.phoneCountryIso);
    const phoneCountryCode =
        doc.phoneCountryCode == null || doc.phoneCountryCode === ''
            ? null
            : String(doc.phoneCountryCode);
    return { phone, phoneCountryIso, phoneCountryCode };
};

/**
 * Resolve and validate ISO country selection.
 *
 * @param {unknown} phoneCountryIso
 * @param {{ allowDefaultCountry?: boolean }} [options]
 * @returns {{ ok: true, iso: string } | { ok: false, error: PhoneFieldError }}
 */
export const resolvePhoneCountryIso = (
    phoneCountryIso,
    { allowDefaultCountry = false } = {}
) => {
    const raw =
        phoneCountryIso == null ? '' : String(phoneCountryIso).trim().toUpperCase();

    if (!raw) {
        if (allowDefaultCountry) {
            return { ok: true, iso: DEFAULT_PHONE_COUNTRY_ISO };
        }
        return {
            ok: false,
            error: {
                field: 'phoneCountryIso',
                message: 'Phone country is required',
            },
        };
    }

    if (!/^[A-Z]{2}$/.test(raw) || !isSupportedCountry(raw)) {
        return {
            ok: false,
            error: {
                field: 'phoneCountryIso',
                message: 'Phone country must be a supported ISO 3166-1 alpha-2 code',
            },
        };
    }

    return { ok: true, iso: raw };
};

/**
 * Derive display calling code (`+NN`) from a selected ISO. Never from user input.
 *
 * @param {string} phoneCountryIso
 * @returns {string}
 */
export const derivePhoneCountryCode = (phoneCountryIso) =>
    `+${getCountryCallingCode(phoneCountryIso)}`;

/**
 * Normalize a phone number into the approved international contract.
 *
 * - Requires an explicit ISO unless `allowDefaultCountry` is true (then EG).
 * - Ignores any supplied `phoneCountryCode` (derived from ISO only).
 * - Rejects invalid numbers and international inputs whose calling code does not
 *   match the selected country (shared NANP codes like US/CA are allowed when
 *   the selected ISO’s calling code matches the parsed number).
 * - Empty / null / whitespace `phone` → `{ ok: true, value: null }` (optional phone).
 *
 * @param {object} input
 * @param {unknown} [input.phone]
 * @param {unknown} [input.phoneCountryIso]
 * @param {unknown} [input.phoneCountryCode] Ignored if present — never trusted
 * @param {object} [options]
 * @param {boolean} [options.allowDefaultCountry=false]
 * @param {boolean} [options.required=false] When true, empty phone is a validation error
 * @returns {PhoneNormalizeResult}
 */
export const normalizeInternationalPhone = (
    { phone, phoneCountryIso, phoneCountryCode: _ignoredCallingCode } = {},
    { allowDefaultCountry = false, required = false } = {}
) => {
    void _ignoredCallingCode;

    const phoneRaw = phone == null ? '' : String(phone).trim();

    if (!phoneRaw) {
        if (required) {
            return {
                ok: false,
                error: {
                    field: 'phone',
                    message: 'Phone number is required',
                },
            };
        }
        return { ok: true, value: null };
    }

    const country = resolvePhoneCountryIso(phoneCountryIso, {
        allowDefaultCountry,
    });
    if (!country.ok) {
        return country;
    }

    const { iso } = country;
    const selectedCallingCode = String(getCountryCallingCode(iso));

    const parsed = parsePhoneNumberFromString(phoneRaw, iso);
    if (!parsed || !parsed.isValid()) {
        return {
            ok: false,
            error: {
                field: 'phone',
                message: 'Please provide a valid phone number for the selected country',
            },
        };
    }

    // Reject when the number’s international calling code disagrees with the selected ISO.
    // Shared calling codes (e.g. US/CA under +1) remain valid; selected ISO is preserved.
    if (String(parsed.countryCallingCode) !== selectedCallingCode) {
        return {
            ok: false,
            error: {
                field: 'phone',
                message:
                    'Phone number country calling code does not match the selected country',
            },
        };
    }

    /** @type {NormalizedPhone} */
    const value = {
        phoneCountryIso: iso,
        phoneCountryCode: derivePhoneCountryCode(iso),
        phone: parsed.format('E.164'),
    };

    return { ok: true, value };
};

/**
 * Throw ApiError(400) with Joi-compatible `{ field, message }[]` on failure.
 * Returns `null` for optional empty phone, otherwise the normalized contract.
 *
 * @param {Parameters<typeof normalizeInternationalPhone>[0]} input
 * @param {Parameters<typeof normalizeInternationalPhone>[1]} [options]
 * @returns {NormalizedPhone | null}
 */
export const assertNormalizedPhone = (input, options) => {
    const result = normalizeInternationalPhone(input, options);
    if (!result.ok) {
        throw new ApiError(400, 'Validation failed', [result.error]);
    }
    return result.value;
};

export default {
    DEFAULT_PHONE_COUNTRY_ISO,
    LEGACY_DIGITS_ONLY_PHONE_PATTERN,
    E164_PHONE_PATTERN,
    isLegacyDigitsOnlyPhone,
    isE164Phone,
    isStoredPhoneValue,
    escapePhoneSearchRegex,
    buildPhoneInboxSearchClauses,
    applyPhoneContractToValue,
    pickPersistedPhoneFields,
    toPhoneResponseFields,
    resolvePhoneCountryIso,
    derivePhoneCountryCode,
    normalizeInternationalPhone,
    assertNormalizedPhone,
};
