/**
 * Phase 0–1: International phone utility unit tests (no DB / HTTP).
 * Run: node scripts/test-phone-util.mjs
 */
import {
    DEFAULT_PHONE_COUNTRY_ISO,
    assertNormalizedPhone,
    derivePhoneCountryCode,
    isLegacyDigitsOnlyPhone,
    normalizeInternationalPhone,
    resolvePhoneCountryIso,
} from '../src/utils/phone.js';
import { ApiError } from '../src/utils/ApiError.js';

const results = [];
const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};
const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const expectOk = (name, result, expected) => {
    if (!result.ok) {
        fail(name, `expected ok, got error ${JSON.stringify(result.error)}`);
        return;
    }
    if (expected === null) {
        if (result.value === null) pass(name);
        else fail(name, `expected null, got ${JSON.stringify(result.value)}`);
        return;
    }
    const v = result.value;
    if (
        v &&
        v.phoneCountryIso === expected.phoneCountryIso &&
        v.phoneCountryCode === expected.phoneCountryCode &&
        v.phone === expected.phone
    ) {
        pass(name);
    } else {
        fail(name, JSON.stringify(v));
    }
};

const expectFail = (name, result, field) => {
    if (!result.ok && (!field || result.error?.field === field)) {
        pass(name);
    } else {
        fail(name, JSON.stringify(result));
    }
};

// --- Egypt ---
expectOk(
    'EG trunk 01004500580 → E.164 without duplicated 0',
    normalizeInternationalPhone({ phone: '01004500580', phoneCountryIso: 'EG' }),
    {
        phoneCountryIso: 'EG',
        phoneCountryCode: '+20',
        phone: '+201004500580',
    }
);

expectOk(
    'EG national 1004500580 (library national parse)',
    normalizeInternationalPhone({ phone: '1004500580', phoneCountryIso: 'EG' }),
    {
        phoneCountryIso: 'EG',
        phoneCountryCode: '+20',
        phone: '+201004500580',
    }
);

expectOk(
    'EG already E.164 +201004500580',
    normalizeInternationalPhone({
        phone: '+201004500580',
        phoneCountryIso: 'EG',
    }),
    {
        phoneCountryIso: 'EG',
        phoneCountryCode: '+20',
        phone: '+201004500580',
    }
);

expectFail(
    'Invalid Egyptian number rejected',
    normalizeInternationalPhone({ phone: '12345', phoneCountryIso: 'EG' }),
    'phone'
);

{
    const trunk = normalizeInternationalPhone({
        phone: '01004500580',
        phoneCountryIso: 'EG',
    });
    if (
        trunk.ok &&
        trunk.value.phone === '+201004500580' &&
        !trunk.value.phone.startsWith('+200')
    ) {
        pass('EG trunk 0 not duplicated in E.164');
    } else {
        fail('EG trunk 0 not duplicated in E.164', JSON.stringify(trunk));
    }
}

// --- International ---
expectOk(
    'Valid US number with US',
    normalizeInternationalPhone({ phone: '2025550123', phoneCountryIso: 'US' }),
    {
        phoneCountryIso: 'US',
        phoneCountryCode: '+1',
        phone: '+12025550123',
    }
);

expectOk(
    'Valid Saudi number with SA (trunk 0)',
    normalizeInternationalPhone({ phone: '0512345678', phoneCountryIso: 'SA' }),
    {
        phoneCountryIso: 'SA',
        phoneCountryCode: '+966',
        phone: '+966512345678',
    }
);

{
    const ca = normalizeInternationalPhone({
        phone: '4165550123',
        phoneCountryIso: 'CA',
    });
    if (
        ca.ok &&
        ca.value.phoneCountryIso === 'CA' &&
        ca.value.phoneCountryCode === '+1' &&
        ca.value.phone === '+14165550123'
    ) {
        pass('Valid CA number keeps selected ISO with shared +1');
    } else {
        fail('Valid CA number keeps selected ISO with shared +1', JSON.stringify(ca));
    }
}

{
    // NANP: US-classified area code entered under CA — calling codes match; selected ISO preserved
    const caUsArea = normalizeInternationalPhone({
        phone: '2025550123',
        phoneCountryIso: 'CA',
    });
    if (
        caUsArea.ok &&
        caUsArea.value.phoneCountryIso === 'CA' &&
        caUsArea.value.phoneCountryCode === '+1' &&
        caUsArea.value.phone === '+12025550123'
    ) {
        pass('Shared +1 US/CA: selected CA preserved when calling codes match');
    } else {
        fail(
            'Shared +1 US/CA: selected CA preserved when calling codes match',
            JSON.stringify(caUsArea)
        );
    }
}

expectFail(
    'Invalid number for selected country (US digits as EG)',
    normalizeInternationalPhone({ phone: '2025550123', phoneCountryIso: 'EG' }),
    'phone'
);

{
    // Intended behavior: E.164 for EG with selected US → reject (calling code mismatch)
    const inconsistent = normalizeInternationalPhone({
        phone: '+201004500580',
        phoneCountryIso: 'US',
    });
    expectFail(
        'International number inconsistent with selected country is rejected',
        inconsistent,
        'phone'
    );
}

// --- Contract ---
{
    const v = normalizeInternationalPhone({
        phone: '01004500580',
        phoneCountryIso: 'eg',
        phoneCountryCode: '+999', // must be ignored
    });
    if (
        v.ok &&
        v.value.phoneCountryIso === 'EG' &&
        v.value.phoneCountryCode === '+20' &&
        v.value.phone === '+201004500580' &&
        v.value.phoneCountryCode === derivePhoneCountryCode('EG') &&
        v.value.phone.startsWith(v.value.phoneCountryCode)
    ) {
        pass('Contract: ISO, calling code, E.164 consistent; calling code derived');
    } else {
        fail(
            'Contract: ISO, calling code, E.164 consistent; calling code derived',
            JSON.stringify(v)
        );
    }
}

expectFail(
    'Missing country rejected when defaulting not permitted',
    normalizeInternationalPhone({ phone: '01004500580' }),
    'phoneCountryIso'
);

expectOk(
    'Missing country uses EG only when allowDefaultCountry',
    normalizeInternationalPhone(
        { phone: '01004500580' },
        { allowDefaultCountry: true }
    ),
    {
        phoneCountryIso: 'EG',
        phoneCountryCode: '+20',
        phone: '+201004500580',
    }
);

if (DEFAULT_PHONE_COUNTRY_ISO === 'EG') {
    pass('DEFAULT_PHONE_COUNTRY_ISO is EG');
} else {
    fail('DEFAULT_PHONE_COUNTRY_ISO is EG', DEFAULT_PHONE_COUNTRY_ISO);
}

expectOk(
    'Missing optional phone remains optional (null)',
    normalizeInternationalPhone({ phone: '', phoneCountryIso: 'EG' }),
    null
);

expectOk(
    'Null optional phone remains optional',
    normalizeInternationalPhone({ phone: null, phoneCountryIso: 'EG' }),
    null
);

expectFail(
    'Required empty phone rejected',
    normalizeInternationalPhone(
        { phone: '  ', phoneCountryIso: 'EG' },
        { required: true }
    ),
    'phone'
);

expectFail(
    'Malformed country ISO rejected (Egypt)',
    normalizeInternationalPhone({ phone: '01004500580', phoneCountryIso: 'Egypt' }),
    'phoneCountryIso'
);

expectFail(
    'Unsupported country ISO rejected (XX)',
    resolvePhoneCountryIso('XX'),
    'phoneCountryIso'
);

if (isLegacyDigitsOnlyPhone('01004500580') && !isLegacyDigitsOnlyPhone('+201004500580')) {
    pass('Legacy digits-only detector distinguishes E.164');
} else {
    fail('Legacy digits-only detector distinguishes E.164', '');
}

{
    try {
        assertNormalizedPhone({ phone: '123', phoneCountryIso: 'EG' });
        fail('assertNormalizedPhone throws ApiError on invalid', 'no throw');
    } catch (err) {
        if (
            err instanceof ApiError &&
            err.statusCode === 400 &&
            Array.isArray(err.errors) &&
            err.errors[0]?.field === 'phone'
        ) {
            pass('assertNormalizedPhone throws ApiError on invalid');
        } else {
            fail('assertNormalizedPhone throws ApiError on invalid', String(err));
        }
    }
}

{
    const value = assertNormalizedPhone({
        phone: '1004500580',
        phoneCountryIso: 'EG',
    });
    if (value?.phone === '+201004500580') {
        pass('assertNormalizedPhone returns normalized value');
    } else {
        fail('assertNormalizedPhone returns normalized value', JSON.stringify(value));
    }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
    process.exit(1);
}
