/**
 * Passwordless User schema, login fail-closed, serialization, and admin-only POST /users.
 * Run: node scripts/test-passwordless-user-auth.mjs
 *
 * Prerequisites: dev server running with the latest code (HTTP cases).
 * Model and auth-service cases run in this process against APP_DB_URL.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../src/modules/users/user.model.js';
import ClientInvitation from '../src/modules/client-invitations/client-invitation.model.js';
import authService from '../src/modules/auth/auth.service.js';

const BASE = process.env.API_URL || 'http://localhost:8000';
const API = `${BASE}/api/v1`;
const LOGIN_ERROR = 'Invalid email or password';
const PASSWORD_UPDATE_ERROR = 'Current password is incorrect';

const results = [];
const createdIds = [];

const pass = (name) => {
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
};

const fail = (name, detail) => {
    results.push({ name, ok: false, detail });
    console.log(`FAIL: ${name} — ${detail}`);
};

const track = (id) => {
    if (id) createdIds.push(id);
};

async function request(method, path, { body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

const containsSecret = (payload, secrets) => {
    const text = JSON.stringify(payload);
    return secrets.some((secret) => secret && text.includes(secret));
};

const isBcryptHash = (value) =>
    typeof value === 'string' && /^\$2[aby]\$/.test(value);

async function waitForServer() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
            const res = await fetch(`${API}/health`);
            if (res.ok) return true;
        } catch {
            // Server is restarting or not up yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
}

async function main() {
    await mongoose.connect(process.env.APP_DB_URL);

    const originalHash = bcrypt.hash;
    const originalCompare = bcrypt.compare;
    let hashCalls = 0;
    let compareCalls = 0;

    bcrypt.hash = async (...args) => {
        hashCalls += 1;
        return originalHash(...args);
    };
    bcrypt.compare = async (...args) => {
        compareCalls += 1;
        return originalCompare(...args);
    };

    const suffix = Date.now();
    const plaintext = 'testpass123';
    const replacement = 'newpass456';

    try {
        hashCalls = 0;
        const passwordless = await User.create({
            firstName: 'No',
            lastName: 'Password',
            email: `pwless-${suffix}-none@test.com`,
            role: 'client',
        });
        track(passwordless._id);
        const storedPasswordless = await User.findById(passwordless._id).select('+password');
        if (
            passwordless &&
            hashCalls === 0 &&
            !isBcryptHash(storedPasswordless?.password)
        ) {
            pass('1. Creating a User without a password succeeds and does not hash');
        } else {
            fail(
                '1. Creating a User without a password succeeds and does not hash',
                `hashCalls=${hashCalls} stored=${storedPasswordless?.password}`
            );
        }

        hashCalls = 0;
        let nullHashed = false;
        try {
            const nullPasswordUser = await User.create({
                firstName: 'Null',
                lastName: 'Password',
                email: `pwless-${suffix}-null@test.com`,
                role: 'client',
                password: null,
            });
            track(nullPasswordUser._id);
            const storedNull = await User.findById(nullPasswordUser._id).select('+password');
            nullHashed = isBcryptHash(storedNull?.password);
        } catch {
            nullHashed = false;
        }
        if (hashCalls === 0 && !nullHashed) {
            pass('2. Null password does not trigger bcrypt hashing');
        } else {
            fail('2. Null password does not trigger bcrypt hashing', `hashCalls=${hashCalls}`);
        }

        hashCalls = 0;
        let emptySavedHash = false;
        try {
            const emptyPasswordUser = await User.create({
                firstName: 'Empty',
                lastName: 'Password',
                email: `pwless-${suffix}-empty@test.com`,
                role: 'client',
                password: '',
            });
            track(emptyPasswordUser._id);
            const storedEmpty = await User.findById(emptyPasswordUser._id).select('+password');
            emptySavedHash = isBcryptHash(storedEmpty?.password);
        } catch {
            emptySavedHash = false;
        }
        if (hashCalls === 0 && !emptySavedHash) {
            pass('3. Empty password does not trigger bcrypt hashing');
        } else {
            fail('3. Empty password does not trigger bcrypt hashing', `hashCalls=${hashCalls}`);
        }

        hashCalls = 0;
        let shortRejected = false;
        try {
            const shortUser = await User.create({
                firstName: 'Short',
                lastName: 'Password',
                email: `pwless-${suffix}-short@test.com`,
                role: 'client',
                password: 'abc',
            });
            track(shortUser._id);
        } catch (err) {
            shortRejected =
                hashCalls === 0 &&
                /at least 6/i.test(String(err?.message || ''));
        }
        if (shortRejected) {
            pass('4. A supplied password shorter than 6 characters is still rejected');
        } else {
            fail('4. A supplied password shorter than 6 characters is still rejected', `hashCalls=${hashCalls}`);
        }

        hashCalls = 0;
        const withPassword = await User.create({
            firstName: 'Has',
            lastName: 'Password',
            email: `pwless-${suffix}-hashed@test.com`,
            role: 'client',
            password: plaintext,
        });
        track(withPassword._id);
        const hashedOnce = withPassword.password;
        const matchesPlain = await originalCompare(plaintext, hashedOnce);
        if (hashCalls === 1 && isBcryptHash(hashedOnce) && hashedOnce !== plaintext && matchesPlain) {
            pass('5. Creating a User with a valid password still hashes it');
        } else {
            fail(
                '5. Creating a User with a valid password still hashes it',
                `hashCalls=${hashCalls} matches=${matchesPlain}`
            );
        }

        hashCalls = 0;
        withPassword.firstName = 'HasChanged';
        await withPassword.save();
        const reloadedHash = (await User.findById(withPassword._id).select('+password')).password;
        if (hashCalls === 0 && reloadedHash === hashedOnce) {
            pass('6. Saving an unchanged password does not hash it again');
        } else {
            fail(
                '6. Saving an unchanged password does not hash it again',
                `hashCalls=${hashCalls} same=${reloadedHash === hashedOnce}`
            );
        }

        hashCalls = 0;
        const withoutPasswordSelected = await User.findById(withPassword._id);
        withoutPasswordSelected.lastName = 'StillHashed';
        await withoutPasswordSelected.save();
        const hashAfterUnselectedSave = (
            await User.findById(withPassword._id).select('+password')
        ).password;
        if (hashCalls === 0 && hashAfterUnselectedSave === hashedOnce) {
            pass('7. Saving without the password selected does not clear or rehash it');
        } else {
            fail(
                '7. Saving without the password selected does not clear or rehash it',
                `hashCalls=${hashCalls} same=${hashAfterUnselectedSave === hashedOnce}`
            );
        }

        const selected = await User.findById(withPassword._id).select('+password');
        const selectedJson = selected.toJSON();
        const publicProfile = selected.getPublicProfile();
        const serialized = JSON.stringify(selected);
        const virtualKept = selectedJson.fullName === 'HasChanged StillHashed';
        if (
            selected.password === hashedOnce &&
            selectedJson.password === undefined &&
            !serialized.includes(hashedOnce) &&
            !JSON.stringify(publicProfile).includes(hashedOnce) &&
            publicProfile.password === undefined &&
            virtualKept
        ) {
            pass('8. Password hashes are removed from JSON and getPublicProfile keeps virtuals');
        } else {
            fail(
                '8. Password hashes are removed from JSON and getPublicProfile keeps virtuals',
                `jsonHasPassword=${selectedJson.password !== undefined} virtual=${selectedJson.fullName}`
            );
        }

        compareCalls = 0;
        const missingCompare = await storedPasswordless.comparePassword(plaintext);
        if (missingCompare === false && compareCalls === 0) {
            pass('9. comparePassword does not call bcrypt when the hash is missing');
        } else {
            fail(
                '9. comparePassword does not call bcrypt when the hash is missing',
                `result=${missingCompare} compareCalls=${compareCalls}`
            );
        }

        compareCalls = 0;
        let missingLoginStatus = null;
        let missingLoginMessage = null;
        try {
            await authService.login(passwordless.email, plaintext);
        } catch (err) {
            missingLoginStatus = err.statusCode;
            missingLoginMessage = err.message;
        }
        if (
            missingLoginStatus === 401 &&
            missingLoginMessage === LOGIN_ERROR &&
            compareCalls === 0
        ) {
            pass('10. Login with a passwordless User returns generic 401 and does not call bcrypt');
        } else {
            fail(
                '10. Login with a passwordless User returns generic 401 and does not call bcrypt',
                `status=${missingLoginStatus} message=${missingLoginMessage} compareCalls=${compareCalls}`
            );
        }

        compareCalls = 0;
        let wrongStatus = null;
        let wrongMessage = null;
        try {
            await authService.login(withPassword.email, 'wrongpass1');
        } catch (err) {
            wrongStatus = err.statusCode;
            wrongMessage = err.message;
        }
        if (wrongStatus === 401 && wrongMessage === LOGIN_ERROR && wrongMessage === missingLoginMessage && compareCalls === 1) {
            pass('11. Incorrect password returns the same generic 401');
        } else {
            fail(
                '11. Incorrect password returns the same generic 401',
                `status=${wrongStatus} message=${wrongMessage} compareCalls=${compareCalls}`
            );
        }

        compareCalls = 0;
        const loggedIn = await authService.login(withPassword.email, plaintext);
        if (
            loggedIn?.token &&
            loggedIn.user?.email === withPassword.email &&
            loggedIn.user?.password === undefined &&
            compareCalls === 1
        ) {
            pass('12. Login with a valid password still succeeds');
        } else {
            fail('12. Login with a valid password still succeeds', `compareCalls=${compareCalls}`);
        }

        compareCalls = 0;
        let updateStatus = null;
        let updateMessage = null;
        try {
            await authService.updatePassword(passwordless._id, plaintext, replacement);
        } catch (err) {
            updateStatus = err.statusCode;
            updateMessage = err.message;
        }
        if (updateStatus === 401 && updateMessage === PASSWORD_UPDATE_ERROR && compareCalls === 0) {
            pass('13. Password change cannot authenticate with a missing hash and is not a 500');
        } else {
            fail(
                '13. Password change cannot authenticate with a missing hash and is not a 500',
                `status=${updateStatus} message=${updateMessage} compareCalls=${compareCalls}`
            );
        }

        const serverUp = await waitForServer();
        if (!serverUp) {
            fail('14. HTTP cases', 'API server was not reachable');
        }

        if (serverUp) {

        const httpMissing = await request('POST', '/auth/login', {
            body: { email: passwordless.email, password: plaintext },
        });
        const httpWrong = await request('POST', '/auth/login', {
            body: { email: withPassword.email, password: 'wrongpass1' },
        });
        if (
            httpMissing.status === 401 &&
            httpWrong.status === 401 &&
            httpMissing.json?.message === LOGIN_ERROR &&
            httpWrong.json?.message === LOGIN_ERROR &&
            !String(httpMissing.json?.message || '').includes('Password comparison failed')
        ) {
            pass('14. HTTP login missing and incorrect passwords both return generic 401');
        } else {
            fail(
                '14. HTTP login missing and incorrect passwords both return generic 401',
                `missing=${httpMissing.status}:${httpMissing.json?.message} wrong=${httpWrong.status}:${httpWrong.json?.message}`
            );
        }

        const httpValid = await request('POST', '/auth/login', {
            body: { email: withPassword.email, password: plaintext },
        });
        if (
            httpValid.status === 200 &&
            httpValid.json?.data?.token &&
            !containsSecret(httpValid.json, [plaintext, hashedOnce])
        ) {
            pass('15. HTTP login with a valid password succeeds and does not return the hash');
        } else {
            fail('15. HTTP login with a valid password succeeds and does not return the hash', `status=${httpValid.status}`);
        }

        const passwordlessToken = passwordless.generateAuthToken();
        const httpUpdate = await request('PUT', '/auth/password', {
            token: passwordlessToken,
            body: {
                currentPassword: plaintext,
                newPassword: replacement,
                confirmPassword: replacement,
            },
        });
        if (httpUpdate.status === 401 && httpUpdate.json?.message === PASSWORD_UPDATE_ERROR) {
            pass('16. HTTP password change with a missing hash returns 401, not 500');
        } else {
            fail(
                '16. HTTP password change with a missing hash returns 401, not 500',
                `status=${httpUpdate.status} message=${httpUpdate.json?.message}`
            );
        }

        const registerMissing = await request('POST', '/auth/register', {
            body: {
                firstName: 'Reg',
                lastName: 'Missing',
                email: `pwless-${suffix}-register@test.com`,
                role: 'client',
            },
        });
        if (registerMissing.status === 400) {
            pass('17. Public registration still requires a password');
        } else {
            fail('17. Public registration still requires a password', `status=${registerMissing.status}`);
            track(registerMissing.json?.data?.user?.id);
        }

        const unauthCreate = await request('POST', '/users', {
            body: {
                firstName: 'Nope',
                lastName: 'Public',
                email: `pwless-${suffix}-public@test.com`,
                password: plaintext,
                role: 'admin',
            },
        });
        const publicCreated = await User.findOne({ email: `pwless-${suffix}-public@test.com` });
        track(publicCreated?._id);
        if (unauthCreate.status === 401 && !publicCreated) {
            pass('18. Unauthenticated POST /users is rejected');
        } else {
            fail(
                '18. Unauthenticated POST /users is rejected',
                `status=${unauthCreate.status} created=${Boolean(publicCreated)}`
            );
        }

        const trainer = await User.create({
            firstName: 'Pw',
            lastName: 'Trainer',
            email: `pwless-${suffix}-trainer@test.com`,
            password: plaintext,
            role: 'trainer',
        });
        track(trainer._id);
        const trainerLogin = await request('POST', '/auth/login', {
            body: { email: trainer.email, password: plaintext },
        });
        const trainerToken = trainerLogin.json?.data?.token;
        const trainerCreate = await request('POST', '/users', {
            token: trainerToken,
            body: {
                firstName: 'Nope',
                lastName: 'Trainer',
                email: `pwless-${suffix}-by-trainer@test.com`,
                password: plaintext,
                role: 'client',
            },
        });
        const trainerCreated = await User.findOne({ email: `pwless-${suffix}-by-trainer@test.com` });
        track(trainerCreated?._id);
        if (trainerLogin.status === 200 && trainerCreate.status === 403 && !trainerCreated) {
            pass('19. Authenticated non-admin POST /users is rejected');
        } else {
            fail(
                '19. Authenticated non-admin POST /users is rejected',
                `login=${trainerLogin.status} create=${trainerCreate.status}`
            );
        }

        const admin = await User.create({
            firstName: 'Pw',
            lastName: 'Admin',
            email: `pwless-${suffix}-admin@test.com`,
            password: plaintext,
            role: 'admin',
        });
        track(admin._id);
        const adminLogin = await request('POST', '/auth/login', {
            body: { email: admin.email, password: plaintext },
        });
        const adminToken = adminLogin.json?.data?.token;

        const adminMissingPassword = await request('POST', '/users', {
            token: adminToken,
            body: {
                firstName: 'Admin',
                lastName: 'NoPass',
                email: `pwless-${suffix}-admin-nopass@test.com`,
                role: 'client',
            },
        });
        const adminMissingUser = await User.findOne({
            email: `pwless-${suffix}-admin-nopass@test.com`,
        });
        track(adminMissingUser?._id);
        if (adminMissingPassword.status === 400 && !adminMissingUser) {
            pass('20. Admin creation still requires a password');
        } else {
            fail(
                '20. Admin creation still requires a password',
                `status=${adminMissingPassword.status} created=${Boolean(adminMissingUser)}`
            );
        }

        const adminCreate = await request('POST', '/users', {
            token: adminToken,
            body: {
                firstName: 'Admin',
                lastName: 'Created',
                email: `pwless-${suffix}-admin-created@test.com`,
                password: plaintext,
                role: 'trainer',
            },
        });
        const adminCreated = await User.findOne({
            email: `pwless-${suffix}-admin-created@test.com`,
        }).select('+password');
        track(adminCreated?._id);
        const createdHash = adminCreated?.password;
        if (
            adminCreate.status === 201 &&
            adminCreate.json?.data?.email === adminCreated?.email &&
            adminCreate.json?.data?.role === 'trainer' &&
            adminCreate.json?.data?.password === undefined &&
            isBcryptHash(createdHash) &&
            !containsSecret(adminCreate.json, [plaintext, createdHash])
        ) {
            pass('21. Admin POST /users returns a public profile and stores a hash');
        } else {
            fail(
                '21. Admin POST /users returns a public profile and stores a hash',
                `status=${adminCreate.status} body=${JSON.stringify(adminCreate.json)}`
            );
        }

        const addClientMissing = await request('POST', '/clients', {
            token: trainerToken,
            body: {
                firstName: 'Direct',
                lastName: 'Missing',
                email: `pwless-${suffix}-client-missing@test.com`,
                primaryFitnessGoal: 'general_fitness',
            },
        });
        const missingClient = await User.findOne({
            email: `pwless-${suffix}-client-missing@test.com`,
        });
        track(missingClient?._id);
        if (addClientMissing.status === 400 && !missingClient) {
            pass('22. Direct Add Client still requires a password');
        } else {
            fail(
                '22. Direct Add Client still requires a password',
                `status=${addClientMissing.status} created=${Boolean(missingClient)}`
            );
        }

        const addClient = await request('POST', '/clients', {
            token: trainerToken,
            body: {
                firstName: 'Direct',
                lastName: 'Client',
                email: `pwless-${suffix}-client@test.com`,
                password: plaintext,
                primaryFitnessGoal: 'general_fitness',
            },
        });
        const directClient = await User.findOne({
            email: `pwless-${suffix}-client@test.com`,
        }).select('+password');
        track(directClient?._id);
        const directLogin = await request('POST', '/auth/login', {
            body: { email: `pwless-${suffix}-client@test.com`, password: plaintext },
        });
        if (
            addClient.status === 201 &&
            addClient.json?.data?.role === 'client' &&
            !containsSecret(addClient.json, [plaintext, directClient?.password]) &&
            isBcryptHash(directClient?.password) &&
            directLogin.status === 200
        ) {
            pass('23. Direct Add Client still hashes the password and can log in');
        } else {
            fail(
                '23. Direct Add Client still hashes the password and can log in',
                `create=${addClient.status} login=${directLogin.status}`
            );
        }

        const invited = await User.create({
            firstName: 'Invite',
            lastName: 'Target',
            email: `pwless-${suffix}-invited@test.com`,
            password: plaintext,
            role: 'client',
            trainer: trainer._id,
        });
        track(invited._id);
        const invitation = await request('POST', `/clients/${invited._id}/invitation`, {
            token: trainerToken,
        });
        const invitationUrl = invitation.json?.data?.invitationUrl || '';
        let rawToken = null;
        try {
            rawToken = new URL(invitationUrl).searchParams.get('token');
        } catch {
            rawToken = null;
        }
        const accepted = rawToken
            ? await request('POST', `/client-invitations/${rawToken}/accept`, {
                  body: { password: replacement },
              })
            : { status: 0, json: {} };
        const invitedAfter = await User.findById(invited._id).select('+password');
        const oldLogin = await request('POST', '/auth/login', {
            body: { email: invited.email, password: plaintext },
        });
        const newLogin = await request('POST', '/auth/login', {
            body: { email: invited.email, password: replacement },
        });
        const inviteStillHashes =
            isBcryptHash(invitedAfter?.password) &&
            invitedAfter.password !== invited.password &&
            (await originalCompare(replacement, invitedAfter.password));
        if (
            invitation.status === 201 &&
            accepted.status === 200 &&
            inviteStillHashes &&
            oldLogin.status === 401 &&
            newLogin.status === 200
        ) {
            pass('24. Password invitation acceptance still assigns and hashes the new password');
        } else {
            fail(
                '24. Password invitation acceptance still assigns and hashes the new password',
                `invite=${invitation.status} accept=${accepted.status} old=${oldLogin.status} new=${newLogin.status}`
            );
        }

        const list = await request('GET', '/users?limit=5');
        if (list.status === 200 && !JSON.stringify(list.json).includes('"$2a$') && !JSON.stringify(list.json).includes('"$2b$')) {
            pass('25. GET /users does not serialize password hashes');
        } else {
            fail('25. GET /users does not serialize password hashes', `status=${list.status}`);
        }
        }
    } finally {
        bcrypt.hash = originalHash;
        bcrypt.compare = originalCompare;

        if (createdIds.length) {
            await ClientInvitation.deleteMany({ clientId: { $in: createdIds } });
            await User.deleteMany({ _id: { $in: createdIds } });
        }
        await mongoose.disconnect();
    }

    const failed = results.filter((item) => !item.ok);
    console.log('\n---');
    console.log(
        `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`
    );
    process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
