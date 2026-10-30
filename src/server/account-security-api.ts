import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { UserError } from '../lib/errors.ts';
import {
  newTotpSecret,
  openTotp,
  sealTotp,
  totpEncryptionAvailable,
  validTotp,
} from '../lib/totp.ts';
import {
  Store,
  digest,
  passwordMatches,
  type Session,
  type GoogleProfile,
  type GoogleAuthRequest,
} from './store.ts';
import type { Sql } from './database.ts';
import { appOrigin, cookie, type Reply } from './http.ts';
import { authAttemptAllowed } from './auth-rate-limit.ts';
import { broadcastGarage } from './realtime.ts';

type Security = {
  enabled: boolean;
  secret: string | null;
  pending_secret: string | null;
  pending_expires: string | null;
  last_step: string;
  recovery_hashes: string[];
};
type LoginTarget = {
  garageId?: string;
  userId?: string;
  email?: string;
  invitation?: string;
  google?: { profile: GoogleProfile; request: GoogleAuthRequest };
};
const userAgent = (req: IncomingMessage) => String(req.headers['user-agent'] ?? '').slice(0, 300);
const challengeCookie = (value: string, age = 300) =>
  `carm_2fa=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/2fa; Max-Age=${age}${appOrigin().startsWith('https:') ? '; Secure' : ''}`;
const appendCookie = (res: ServerResponse, value: string) => {
  const old = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(old) ? old : old ? [String(old)] : []), value]);
};
const challengeToken = (req: IncomingMessage) =>
  /(?:^|;\s*)carm_2fa=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
const codeSchema = z.string().trim().min(6).max(80);
const securityRow = async (sql: Sql, email: string, lock = false) =>
  (
    await sql.query(`SELECT * FROM account_security WHERE email=$1${lock ? ' FOR UPDATE' : ''}`, [
      email,
    ])
  ).rows[0] as Security | undefined;

async function consumeFactor(sql: Sql, email: string, code: string) {
  const row = await securityRow(sql, email, true);
  if (!row?.enabled) return false;
  const canonical = code.replaceAll('-', '').toLowerCase();
  if (/^[a-f0-9]{32}$/.test(canonical)) {
    const hash = digest(canonical);
    if (!row.recovery_hashes.includes(hash)) return false;
    await sql.query('UPDATE account_security SET recovery_hashes=$2::jsonb WHERE email=$1', [
      email,
      JSON.stringify(row.recovery_hashes.filter((h) => h !== hash)),
    ]);
    return true;
  }
  if (!totpEncryptionAvailable())
    throw new UserError(
      'La double authentification est temporairement indisponible. Contactez le support ou utilisez un code de secours.',
    );
  const step = validTotp(openTotp(row.secret!), code, Number(row.last_step));
  if (step === undefined) return false;
  // ASVS 6.5.1: the counter is consumed under a row lock, including concurrent challenges.
  await sql.query('UPDATE account_security SET last_step=$2 WHERE email=$1', [email, step]);
  return true;
}
export async function requireAccountSecondFactor(store: Store, email: string, code?: string) {
  if (!(await securityRow(store.db, email))?.enabled) return;
  if (!authAttemptAllowed(`2fa-reauth:${email}`, 10))
    throw new UserError('Trop de tentatives. Réessayez dans 15 minutes.');
  if (!code || !(await store.atomic((sql) => consumeFactor(sql, email, code))))
    throw new UserError('Confirmez le code de votre application ou un code de secours.');
}
export async function beginTwoFactorLogin(
  store: Store,
  req: IncomingMessage,
  res: ServerResponse,
  target: LoginTarget,
) {
  const { rows } = target.email
    ? { rows: [{ email: target.email }] }
    : await store.db.query('SELECT email FROM memberships WHERE garage_id=$1 AND user_id=$2', [
        target.garageId,
        target.userId,
      ]);
  const email = rows[0]?.email as string | undefined;
  if (!email || !(await securityRow(store.db, email))?.enabled) return false;
  const token = randomBytes(32).toString('hex');
  await store.db.query('DELETE FROM two_factor_challenges WHERE expires<$1', [Date.now()]);
  await store.db.query(
    'INSERT INTO two_factor_challenges(token_hash,email,target,expires) VALUES($1,$2,$3::jsonb,$4)',
    [digest(token), email, JSON.stringify(target), Date.now() + 300000],
  );
  appendCookie(res, challengeCookie(token));
  return true;
}
export async function beginGoogleTwoFactorLogin(
  store: Store,
  req: IncomingMessage,
  res: ServerResponse,
  profile: GoogleProfile,
  request: GoogleAuthRequest,
) {
  const { rows } = request.linkSessionHash
    ? await store.db.query(
        'SELECT account_email AS email FROM sessions WHERE token_hash=$1 AND expires>$2',
        [request.linkSessionHash, Date.now()],
      )
    : await store.db.query('SELECT email FROM google_identities WHERE subject=$1', [profile.sub]);
  const email = rows[0]?.email as string | undefined;
  if (!email || !(await securityRow(store.db, email))?.enabled) return false;
  const garages = await store.garages(email);
  if (!garages.length && !request.invitation)
    throw new UserError('Aucun garage associé à ce compte.');
  return beginTwoFactorLogin(store, req, res, {
    email,
    garageId: garages[0]?.id,
    userId: garages[0]?.userId,
    google: { profile, request },
  });
}
async function requireReauthentication(
  store: Store,
  session: Session,
  password: string | undefined,
) {
  const account = await store.account(session.email!);
  if (account?.hash) {
    if (!(await passwordMatches(password ?? '', account.hash)))
      throw new UserError('Confirmez votre mot de passe actuel.');
  } else if (!session.authenticatedAt || session.authenticatedAt < Date.now() - 600000) {
    throw new UserError(
      'Reconnectez-vous avec Google avant de modifier la double authentification.',
    );
  }
}

export async function accountSecurityApi(
  store: Store,
  io: Server,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  body: unknown,
  session: Session | undefined,
  send: Reply,
): Promise<boolean> {
  if (path === '/api/auth/2fa/status' && req.method === 'GET') {
    const token = challengeToken(req);
    const { rows } = await store.db.query(
      'SELECT 1 FROM two_factor_challenges WHERE token_hash=$1 AND expires>$2 AND attempts<5',
      [token ? digest(token) : '', Date.now()],
    );
    send(200, { required: Boolean(rows.length) });
    return true;
  }
  if (path === '/api/auth/2fa/verify' && req.method === 'POST') {
    const { code } = z.object({ code: codeSchema }).strict().parse(body);
    const token = challengeToken(req);
    if (!token || !authAttemptAllowed(`2fa-login:${req.socket.remoteAddress}`, 40))
      throw new UserError('Vérification expirée ou trop de tentatives. Reconnectez-vous.');
    const result = await store.atomic(async (sql) => {
      const { rows } = await sql.query(
        'SELECT email,target,attempts FROM two_factor_challenges WHERE token_hash=$1 AND expires>$2 FOR UPDATE',
        [digest(token), Date.now()],
      );
      const row = rows[0] as { email: string; target: LoginTarget; attempts: number } | undefined;
      if (!row || row.attempts >= 5) return undefined;
      if (!authAttemptAllowed(`2fa-verify:${row.email}`, 40)) return undefined;
      await sql.query('UPDATE two_factor_challenges SET attempts=attempts+1 WHERE token_hash=$1', [
        digest(token),
      ]);
      if (!(await consumeFactor(sql, row.email, code))) return undefined;
      await sql.query('DELETE FROM two_factor_challenges WHERE token_hash=$1', [digest(token)]);
      return row;
    });
    if (!result) throw new UserError('Code invalide, déjà utilisé ou vérification expirée.');
    const target = result.target.google
      ? await store.googleAccount(result.target.google.profile, result.target.google.request)
      : result.target.invitation
        ? await store.joinGarage(result.email, result.target.invitation)
        : await store.membership(result.email, result.target.garageId!);
    const loginToken = await store.newSession(
      target.garageId,
      target.userId,
      userAgent(req),
      Date.now(),
      true,
    );
    await store.logout(session);
    if (session) io.in(`session:${session.tokenHash}`).disconnectSockets();
    const previousSessionHash = result.target.google?.request.previousSessionHash;
    if (previousSessionHash) {
      await store.revokeSessionHash(previousSessionHash);
      io.in(`session:${previousSessionHash}`).disconnectSockets();
    }
    appendCookie(res, cookie(loginToken));
    appendCookie(res, challengeCookie('', 0));
    if (result.target.invitation || result.target.google)
      await broadcastGarage(io, await store.get(target.garageId));
    send(200, { ok: true });
    return true;
  }
  if (!path.startsWith('/api/account/security')) return false;
  if (!session?.email) {
    send(401, { error: 'Connectez-vous à votre compte personnel.' });
    return true;
  }
  if (path === '/api/account/security' && req.method === 'GET') {
    const row = await securityRow(store.db, session.email);
    const { rows } = await store.db.query(
      'SELECT s.id,s.token_hash,s.created_at::float8 AS "createdAt",s.last_seen::float8 AS "lastSeen",s.expires::float8 AS expires,s.user_agent AS "userAgent",g.state->\'settings\'->>\'name\' AS garage FROM sessions s JOIN garages g ON g.id=s.garage_id WHERE s.account_email=$1 AND s.expires>$2 ORDER BY s.last_seen DESC',
      [session.email, Date.now()],
    );
    send(200, {
      enabled: row?.enabled ?? false,
      configured: totpEncryptionAvailable(),
      recoveryCount: row?.recovery_hashes.length ?? 0,
      sessions: rows.map(({ token_hash, ...info }) => ({
        ...info,
        current: token_hash === session.tokenHash,
      })),
    });
    return true;
  }
  if (req.method !== 'POST') {
    send(405, { error: 'Méthode non autorisée.' });
    return true;
  }
  if (path === '/api/account/security/sessions/revoke') {
    const input = z
      .union([
        z.object({ id: z.string().uuid() }).strict(),
        z.object({ others: z.literal(true) }).strict(),
      ])
      .parse(body);
    const { rows } = await store.db.query(
      `DELETE FROM sessions WHERE account_email=$1 AND ${'id' in input ? 'id=$2' : 'token_hash<>$2'} RETURNING token_hash`,
      [session.email, 'id' in input ? input.id : session.tokenHash],
    );
    for (const row of rows) io.in(`session:${row.token_hash}`).disconnectSockets();
    const loggedOut = rows.some((r) => r.token_hash === session.tokenHash);
    if (loggedOut) appendCookie(res, cookie('').replace('Max-Age=604800', 'Max-Age=0'));
    send(200, { ok: true, loggedOut });
    return true;
  }
  if (!authAttemptAllowed(`2fa-manage:${session.email}`, 10))
    throw new UserError('Trop de tentatives. Réessayez dans 15 minutes.');
  if (path === '/api/account/security/2fa/setup') {
    const input = z
      .object({ password: z.string().max(128).optional() })
      .strict()
      .parse(body);
    await requireReauthentication(store, session, input.password);
    if (!totpEncryptionAvailable())
      throw new UserError(
        'La double authentification doit être configurée par le responsable de la plateforme.',
      );
    const secret = newTotpSecret();
    await store.atomic(async (sql) => {
      await sql.query('INSERT INTO account_security(email) VALUES($1) ON CONFLICT DO NOTHING', [
        session.email,
      ]);
      if ((await securityRow(sql, session.email!, true))!.enabled)
        throw new UserError('La double authentification est déjà activée.');
      await sql.query(
        'UPDATE account_security SET pending_secret=$2,pending_expires=$3 WHERE email=$1',
        [session.email, sealTotp(secret), Date.now() + 600000],
      );
    });
    send(200, {
      secret,
      uri: `otpauth://totp/${encodeURIComponent(`CaRM:${session.email}`)}?secret=${secret}&issuer=CaRM&algorithm=SHA1&digits=6&period=30`,
    });
    return true;
  }
  if (path === '/api/account/security/2fa/enable') {
    const { code } = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(body);
    const recoveryCodes = Array.from({ length: 8 }, () =>
      randomBytes(16).toString('hex').match(/.{8}/g)!.join('-'),
    );
    await store.atomic(async (sql) => {
      const row = await securityRow(sql, session.email!, true);
      if (!row || row.enabled || !row.pending_secret || Number(row.pending_expires) <= Date.now())
        throw new UserError('La configuration a expiré. Recommencez.');
      const step = validTotp(openTotp(row.pending_secret), code, -1);
      if (step === undefined) throw new UserError('Code de vérification invalide.');
      await sql.query(
        'UPDATE account_security SET enabled=true,secret=pending_secret,pending_secret=NULL,pending_expires=NULL,last_step=$2,recovery_hashes=$3::jsonb WHERE email=$1',
        [
          session.email,
          step,
          JSON.stringify(recoveryCodes.map((c) => digest(c.replaceAll('-', '')))),
        ],
      );
      await sql.query('UPDATE sessions SET mfa_verified=true WHERE token_hash=$1', [
        session.tokenHash,
      ]);
      await sql.query('DELETE FROM sessions WHERE account_email=$1 AND token_hash<>$2', [
        session.email,
        session.tokenHash,
      ]);
      await sql.query('DELETE FROM two_factor_challenges WHERE email=$1', [session.email]);
    });
    io.in(`account:${session.email}`).except(`session:${session.tokenHash}`).disconnectSockets();
    send(200, { recoveryCodes });
    return true;
  }
  if (path === '/api/account/security/2fa/disable') {
    const input = z
      .object({ password: z.string().max(128).optional(), code: codeSchema })
      .strict()
      .parse(body);
    await requireReauthentication(store, session, input.password);
    await store.atomic(async (sql) => {
      if (!(await consumeFactor(sql, session.email!, input.code)))
        throw new UserError('Code invalide ou déjà utilisé.');
      await sql.query('DELETE FROM account_security WHERE email=$1', [session.email]);
      await sql.query('DELETE FROM two_factor_challenges WHERE email=$1', [session.email]);
    });
    send(200, { ok: true });
    return true;
  }
  send(404, { error: 'Route introuvable.' });
  return true;
}
