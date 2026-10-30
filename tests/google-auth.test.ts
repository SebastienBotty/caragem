import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import * as oidc from 'openid-client';
import { Store, passwordHash, passwordMatches, digest } from '../src/server/store.ts';
import { createApi } from '../src/server/api.ts';
import { createRealtime } from '../src/server/realtime.ts';
import { testDatabase } from './helpers/database.ts';
import type { SessionData } from '../src/lib/account.ts';
import { sealTotp } from '../src/lib/totp.ts';

test(
  'Google OIDC verifies signed tokens, browser binding, single use, invitations and explicit linking',
  { timeout: 30000 },
  async () => {
    const store = new Store(testDatabase());
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = {
      ...publicKey.export({ format: 'jwk' }),
      kid: 'test-google',
      alg: 'RS256',
      use: 'sig',
    };
    const codes = new Map<
      string,
      {
        nonce: string;
        challenge: string;
        sub: string;
        email: string;
        verified?: boolean;
        aud?: string;
        iss?: string;
        expired?: boolean;
        corrupt?: boolean;
      }
    >();
    let tokenExchanges = 0;
    const configuration = async () => {
      const config = new oidc.Configuration(
        {
          issuer: 'https://accounts.google.com',
          authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
          token_endpoint: 'https://oauth2.googleapis.com/token',
          jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          id_token_signing_alg_values_supported: ['RS256'],
        },
        'google-client',
        'google-secret',
      );
      config[oidc.customFetch] = async (url, options) => {
        if (String(url).endsWith('/certs')) return Response.json({ keys: [publicJwk] });
        assert.equal(String(url), 'https://oauth2.googleapis.com/token');
        tokenExchanges++;
        const params = new URLSearchParams(String(options?.body));
        assert.equal(params.get('client_secret'), 'google-secret');
        const code = codes.get(params.get('code')!);
        assert.ok(code);
        assert.equal(
          await oidc.calculatePKCECodeChallenge(params.get('code_verifier')!),
          code.challenge,
        );
        assert.equal(params.get('redirect_uri'), `${base}/api/auth/google/callback`);
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-google' })).toString(
          'base64url',
        );
        const payload = Buffer.from(
          JSON.stringify({
            iss: code.iss ?? 'https://accounts.google.com',
            aud: code.aud ?? 'google-client',
            sub: code.sub,
            nonce: code.nonce,
            iat: now - 2,
            exp: now + (code.expired ? -60 : 300),
            email: code.email,
            email_verified: code.verified ?? true,
            name: 'Google Person',
          }),
        ).toString('base64url');
        const input = header + '.' + payload;
        const signature = code.corrupt
          ? Buffer.alloc(256).toString('base64url')
          : sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
        return Response.json({
          access_token: 'test-access',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: `${input}.${signature}`,
        });
      };
      oidc.enableNonRepudiationChecks(config);
      return config;
    };
    let api: ReturnType<typeof createApi>;
    const server = createServer(async (req, res) => {
      await api(req, res);
    });
    const realtime = createRealtime(server, store);
    api = createApi(store, realtime, configuration);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const original = {
      origin: process.env.APP_ORIGIN,
      id: process.env.GOOGLE_CLIENT_ID,
      secret: process.env.GOOGLE_CLIENT_SECRET,
      encryption: process.env.ACCOUNT_ENCRYPTION_KEY,
    };
    process.env.APP_ORIGIN = base;
    process.env.GOOGLE_CLIENT_ID = 'google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
    const post = (path: string, body: unknown, cookie = '') =>
      fetch(`${base}/api/${path}`, {
        method: 'POST',
        headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    async function start(body: unknown = {}, session = '') {
      const res = await post('auth/google/start', body, session);
      assert.equal(res.status, 200, await res.clone().text());
      const cookie = res.headers.get('set-cookie')!.split(';')[0];
      assert.match(res.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax/);
      const url = new URL((await res.json()).url);
      assert.equal(url.origin, 'https://accounts.google.com');
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      return {
        cookie,
        state: url.searchParams.get('state')!,
        nonce: url.searchParams.get('nonce')!,
        challenge: url.searchParams.get('code_challenge')!,
      };
    }
    async function callback(
      request: Awaited<ReturnType<typeof start>>,
      profile: Partial<NonNullable<ReturnType<typeof codes.get>>> = {},
      cookie = request.cookie,
    ) {
      const code = 'code-' + codes.size;
      codes.set(code, { sub: 'google-new', email: 'new@gmail.com', ...request, ...profile });
      return fetch(`${base}/api/auth/google/callback?state=${request.state}&code=${code}`, {
        headers: { Cookie: cookie },
        redirect: 'manual',
      });
    }
    const sessionCookie = (res: Response) =>
      res.headers
        .getSetCookie()
        .find((c) => c.startsWith('caragem_session='))!
        .split(';')[0];
    const sessionData = async (res: Response) =>
      (await (
        await fetch(base + '/api/session', { headers: { Cookie: sessionCookie(res) } })
      ).json()) as SessionData;
    try {
      const initial = await start();
      const wrongBrowser = await callback(initial, {}, 'caragem_google=' + 'a'.repeat(64));
      assert.match(wrongBrowser.headers.get('location')!, /google_invalid_request/);
      assert.equal(tokenExchanges, 0);
      const first = await callback(initial);
      assert.equal(first.headers.get('location'), '/?google_result=success');
      const created = await sessionData(first);
      assert.equal(created.account!.email, 'new@gmail.com');
      assert.equal(created.account!.hasPassword, false);
      assert.equal(created.account!.googleLinked, true);
      assert.equal(created.state!.settings.name, 'Mon garage');
      assert.equal(created.garages.length, 1);
      assert.equal(
        await passwordMatches('anything', (await store.account('new@gmail.com'))!.hash),
        false,
      );
      assert.match((await callback(initial)).headers.get('location')!, /google_invalid_request/);
      const repeat = await callback(await start(), { email: 'changed@gmail.com' });
      assert.equal(
        (await sessionData(repeat)).state!.id,
        created.state!.id,
        'Google sub identifies the account despite a changed email claim',
      );
      assert.equal(await store.account('changed@gmail.com'), undefined);
      for (const bad of [
        { nonce: 'wrong' },
        { aud: 'foreign-client' },
        { iss: 'https://attacker.example' },
        { expired: true },
        { corrupt: true },
        { verified: false },
      ]) {
        const result = await callback(await start(), {
          sub: 'bad-' + codes.size,
          email: `bad-${codes.size}@gmail.com`,
          ...bad,
        });
        assert.match(result.headers.get('location')!, /google_signin_failed/);
      }
      const hash = await passwordHash('a long existing password');
      const local = await store.register({
        email: 'existing@gmail.com',
        name: 'Existing',
        hash,
        garage: 'Existing Garage',
      });
      const localCookie = `caragem_session=${await store.newSession(local.garageId, local.userId)}`;
      const localSession = (await store.session(localCookie))!;
      const secondGarage = await store.createGarage(localSession, 'Second Garage');
      const secondCookie = `caragem_session=${await store.newSession(secondGarage.garageId, secondGarage.userId)}`;
      const collision = await callback(await start(), {
        sub: 'existing-google',
        email: 'existing@gmail.com',
      });
      assert.match(collision.headers.get('location')!, /google_link_required/);
      assert.equal((await store.account('existing@gmail.com'))!.googleLinked, false);
      assert.equal(
        (await post('auth/google/start', { link: true, password: 'wrong' }, localCookie)).status,
        400,
      );
      const badLink = await callback(
        await start({ link: true, password: 'a long existing password' }, localCookie),
        { sub: 'different-google', email: 'different@gmail.com' },
      );
      assert.match(badLink.headers.get('location')!, /google_link_failed/);
      const staleLink = await start(
        { link: true, password: 'a long existing password' },
        localCookie,
      );
      await store.logout(localSession);
      assert.match(
        (
          await callback(staleLink, { sub: 'existing-google', email: 'existing@gmail.com' })
        ).headers.get('location')!,
        /google_link_failed/,
      );
      const linked = await callback(
        await start({ link: true, password: 'a long existing password' }, secondCookie),
        { sub: 'existing-google', email: 'existing@gmail.com' },
      );
      assert.equal(
        (await sessionData(linked)).state!.id,
        secondGarage.garageId,
        'linking preserves the active garage',
      );
      assert.equal((await store.account('existing@gmail.com'))!.googleLinked, true);
      assert.equal(
        await store.session(secondCookie),
        undefined,
        'OAuth completion revokes the initiating session even when Strict session cookie is absent at callback',
      );
      assert.equal((await store.account('existing@gmail.com'))!.hash, hash);
      assert.equal(
        (
          await sessionData(
            await callback(await start(), { sub: 'existing-google', email: 'existing@gmail.com' }),
          )
        ).state!.id,
        local.garageId,
      );
      const owner = (await store.session(sessionCookie(linked)))!;
      const invite = await store.invite(owner, 'invited@gmail.com', 'mechanic');
      const accepted = await callback(await start({ invitation: invite }), {
        sub: 'invited-google',
        email: 'invited@gmail.com',
      });
      const member = await sessionData(accepted);
      assert.equal(member.state!.id, secondGarage.garageId);
      assert.equal(member.state!.users.find((u) => u.id === member.userId)!.role, 'mechanic');
      assert.equal(member.garages.length, 1);
      assert.equal(await store.invitation(invite, 'invited@gmail.com'), undefined);
      const otherInvite = await store.invite(owner, 'right@gmail.com', 'mechanic');
      const wrongInvite = await callback(await start({ invitation: otherInvite }), {
        sub: 'wrong-invite',
        email: 'wrong@gmail.com',
      });
      assert.match(wrongInvite.headers.get('location')!, /google_signin_failed/);
      assert.equal(
        await store.account('wrong@gmail.com'),
        undefined,
        'invalid invitation rolls back social account creation',
      );
      process.env.ACCOUNT_ENCRYPTION_KEY = '91'.repeat(32);
      const recovery = 'a4'.repeat(16);
      await store.db.query(
        'INSERT INTO account_security(email,enabled,secret,recovery_hashes) VALUES($1,true,$2,$3::jsonb)',
        [
          'existing@gmail.com',
          sealTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'),
          JSON.stringify([digest(recovery)]),
        ],
      );
      const protectedLogin = await callback(await start(), {
        sub: 'existing-google',
        email: 'existing@gmail.com',
      });
      assert.equal(protectedLogin.headers.get('location'), '/?two_factor=required');
      assert.equal(
        protectedLogin.headers.getSetCookie().some((c) => c.startsWith('caragem_session=')),
        false,
        'Google cannot create a complete session before MFA',
      );
      const challenge = protectedLogin.headers
        .getSetCookie()
        .find((c) => c.startsWith('caragem_2fa='))!
        .split(';')[0];
      const mfaVerified = await post('auth/2fa/verify', { code: recovery }, challenge);
      assert.equal(mfaVerified.status, 200, await mfaVerified.clone().text());
      assert.equal((await sessionData(mfaVerified)).account!.email, 'existing@gmail.com');
      assert.equal((await store.session(sessionCookie(mfaVerified)))!.twoFactorVerified, true);
      const mfaOwner = (await store.session(sessionCookie(mfaVerified)))!;
      const orphanRecovery = 'b7'.repeat(16);
      await store.db.query(
        'INSERT INTO account_security(email,enabled,recovery_hashes) VALUES($1,true,$2::jsonb)',
        ['new@gmail.com', JSON.stringify([digest(orphanRecovery)])],
      );
      await store.db.query('DELETE FROM memberships WHERE email=$1', ['new@gmail.com']);
      const orphanInvitation = await store.invite(mfaOwner, 'new@gmail.com', 'mechanic');
      const orphanLogin = await callback(await start({ invitation: orphanInvitation }), {
        sub: 'google-new',
        email: 'new@gmail.com',
      });
      assert.equal(orphanLogin.headers.get('location'), '/?two_factor=required');
      assert.ok(await store.invitation(orphanInvitation, 'new@gmail.com'));
      const orphanChallenge = orphanLogin.headers
        .getSetCookie()
        .find((c) => c.startsWith('caragem_2fa='))!
        .split(';')[0];
      assert.equal(
        (await post('auth/2fa/verify', { code: orphanRecovery }, orphanChallenge)).status,
        200,
      );
      assert.equal(await store.invitation(orphanInvitation, 'new@gmail.com'), undefined);
      const expired = await start();
      await store.db.query('UPDATE google_auth_requests SET expires=$1 WHERE state_hash=$2', [
        Date.now() - 1,
        digest(expired.state),
      ]);
      assert.match((await callback(expired)).headers.get('location')!, /google_invalid_request/);
      delete process.env.GOOGLE_CLIENT_SECRET;
      assert.equal((await post('auth/google/start', {})).status, 503);
      assert.deepEqual(await (await fetch(base + '/api/auth/google/status')).json(), {
        enabled: false,
      });
    } finally {
      for (const [key, value] of Object.entries({
        APP_ORIGIN: original.origin,
        GOOGLE_CLIENT_ID: original.id,
        GOOGLE_CLIENT_SECRET: original.secret,
        ACCOUNT_ENCRYPTION_KEY: original.encryption,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await new Promise<void>((resolve) => realtime.close(() => resolve()));
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.close();
    }
  },
);
