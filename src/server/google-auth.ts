import { UserError } from '../lib/errors.ts';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from 'socket.io';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { Store, passwordMatches, type Session, type GoogleProfile } from './store.ts';
import { appOrigin, cookie, type Reply } from './http.ts';
import { authAttemptAllowed } from './auth-rate-limit.ts';
import { broadcastGarage } from './realtime.ts';
import { securityEvent } from './security-log.ts';
import { beginGoogleTwoFactorLogin } from './account-security-api.ts';

const callbackPath = '/api/auth/google/callback';
const callbackUrl = () => new URL(callbackPath, appOrigin()).href;
export const googleEnabled = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export async function googleConfiguration() {
  if (!googleEnabled()) throw new UserError('google_unavailable');
  const config = await oidc.discovery(
    new URL('https://accounts.google.com'),
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
  );
  oidc.enableNonRepudiationChecks(config);
  return config;
}
function transactionCookie(value: string, age = 600) {
  return `carm_google=${value}; HttpOnly; SameSite=Lax; Path=${callbackPath}; Max-Age=${age}${appOrigin().startsWith('https:') ? '; Secure' : ''}`;
}
export function googleProfile(claims: oidc.IDToken): GoogleProfile {
  const input = z
    .object({
      sub: z.string().min(1).max(255),
      email: z.email().max(254),
      email_verified: z.literal(true),
      name: z.string().trim().min(1).max(100).optional(),
    })
    .parse(claims);
  return {
    sub: input.sub,
    email: input.email.toLowerCase(),
    name: input.name ?? input.email.split('@')[0],
    emailVerified: true,
  };
}

export function createGoogleApi(store: Store, io: Server, configuration = googleConfiguration) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    body: unknown,
    session: Session | undefined,
    send: Reply,
  ) => {
    if (req.method === 'GET' && path === '/api/auth/google/status') {
      send(200, { enabled: googleEnabled() });
      return true;
    }
    if (req.method === 'POST' && path === '/api/auth/google/start') {
      if (!googleEnabled()) {
        send(503, {
          error:
            'La connexion Google est indisponible pour le moment. Utilisez votre adresse mail.',
        });
        return true;
      }
      if (!authAttemptAllowed(req.socket.remoteAddress)) {
        send(429, { error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
        return true;
      }
      const input = z
        .object({
          invitation: z.string().min(20).max(100).optional(),
          link: z.boolean().optional(),
          password: z.string().max(128).optional(),
        })
        .parse(body);
      let linkSessionHash: string | undefined;
      if (input.link) {
        if (session && !authAttemptAllowed(`reauth:${session.email ?? session.tokenHash}`, 10)) {
          send(429, { error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
          return true;
        }
        const account = session?.email ? await store.account(session.email) : undefined;
        if (
          !session ||
          !account?.hash ||
          !(await passwordMatches(input.password ?? '', account.hash))
        )
          throw new UserError('Confirmez le mot de passe de votre compte avant d’associer Google.');
        linkSessionHash = session.tokenHash;
      }
      const config = await configuration();
      const state = oidc.randomState(),
        nonce = oidc.randomNonce(),
        verifier = oidc.randomPKCECodeVerifier();
      const browser = randomBytes(32).toString('hex');
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: callbackUrl(),
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      await store.saveGoogleRequest(state, browser, {
        nonce,
        verifier,
        invitation: input.invitation,
        linkSessionHash,
        previousSessionHash: session?.tokenHash,
      });
      res.setHeader('Set-Cookie', transactionCookie(browser));
      send(200, { url: url.href });
      return true;
    }
    if (req.method !== 'GET' || path !== callbackPath) return false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(req.url!, appOrigin());
      const state = url.searchParams.get('state');
      const browser = /(?:^|;\s*)carm_google=([a-f0-9]{64})(?:;|$)/.exec(
        req.headers.cookie ?? '',
      )?.[1];
      if (!state || state.length > 200 || !browser) throw new UserError('google_invalid_request');
      const request = await store.consumeGoogleRequest(state, browser);
      if (!request) throw new UserError('google_invalid_request');
      if (url.searchParams.get('error')) throw new UserError('google_cancelled');
      const config = await configuration();
      const tokens = await oidc.authorizationCodeGrant(config, url, {
        pkceCodeVerifier: request.verifier,
        expectedState: state,
        expectedNonce: request.nonce,
        idTokenExpected: true,
      });
      const profile = googleProfile(tokens.claims()!);
      if (await beginGoogleTwoFactorLogin(store, req, res, profile, request)) {
        const existingCookies = res.getHeader('Set-Cookie');
        res.setHeader('Set-Cookie', [
          ...(Array.isArray(existingCookies)
            ? existingCookies
            : existingCookies
              ? [String(existingCookies)]
              : []),
          transactionCookie('', 0),
        ]);
        res.writeHead(303, { Location: '/?two_factor=required' });
        res.end();
        return true;
      }
      const target = await store.googleAccount(profile, request);
      const token = await store.newSession(
        target.garageId,
        target.userId,
        String(req.headers['user-agent'] ?? '').slice(0, 300),
        Date.now(),
      );
      await store.logout(session);
      if (session) io.in(`session:${session.tokenHash}`).disconnectSockets();
      if (request.previousSessionHash) {
        await store.revokeSessionHash(request.previousSessionHash);
        io.in(`session:${request.previousSessionHash}`).disconnectSockets();
      }
      await broadcastGarage(io, await store.get(target.garageId));
      res.setHeader('Set-Cookie', [cookie(token), transactionCookie('', 0)]);
      securityEvent({
        event: 'google.callback',
        outcome: 'success',
        userId: target.userId,
        garageId: target.garageId,
        requestId: String(res.getHeader('X-Request-Id') ?? ''),
      });
      res.writeHead(303, { Location: '/?google_result=success' });
      res.end();
    } catch (error) {
      securityEvent({
        event: 'google.callback',
        outcome: 'failure',
        requestId: String(res.getHeader('X-Request-Id') ?? ''),
      });
      const code =
        error instanceof Error &&
        [
          'google_link_required',
          'google_link_failed',
          'google_invalid_request',
          'google_cancelled',
        ].includes(error.message)
          ? error.message
          : 'google_signin_failed';
      res.setHeader('Set-Cookie', transactionCookie('', 0));
      res.writeHead(303, { Location: `/?google_error=${code}` });
      res.end();
    }
    return true;
  };
}
