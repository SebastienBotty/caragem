import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server } from 'socket.io';
import nodemailer from 'nodemailer';
import sharp from 'sharp';
import { z } from 'zod';
import { Store, digest, passwordMatches, type Session } from './store.ts';
import type { Reply } from './http.ts';
import { UserError } from '../lib/errors.ts';
import { authAttemptAllowed } from './auth-rate-limit.ts';
import { broadcastGarage } from './realtime.ts';
import { requireAccountSecondFactor } from './account-security-api.ts';
import { cookie } from './http.ts';

export type AccountMail = { to: string; subject: string; text: string };
export type AccountMailer = (mail: AccountMail) => Promise<void>;
export const accountMailer: AccountMailer = async (mail) => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
    throw new UserError('Configurez le serveur SMTP avant de changer votre adresse mail.');
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_PORT === '465',
    requireTLS: true,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    connectionTimeout: 15000,
    socketTimeout: 30000,
  });
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      ...mail,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  } catch {
    throw new UserError(
      'Le mail de vérification n’a pas pu être envoyé. Votre adresse reste inchangée.',
    );
  }
};

const address = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const code = z.string().regex(/^\d{6}$/);
const profileInput = z
  .object({
    firstName: z.string().trim().min(1).max(50),
    lastName: z.string().trim().min(1).max(50),
    avatar: z
      .string()
      .max(3 * 1024 * 1024)
      .nullable()
      .optional(),
  })
  .strict();

export async function normalizedAvatar(image: string) {
  const match = /^data:image\/(jpeg|png|webp);base64,([a-zA-Z0-9+/]+={0,2})$/.exec(image);
  if (!match) throw new UserError('Choisissez une photo JPEG, PNG ou WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== match[2])
    throw new UserError('La photo doit faire au maximum 2 Mio.');
  try {
    const source = sharp(bytes, { limitInputPixels: 16_000_000, animated: false });
    const metadata = await source.metadata();
    if (metadata.format !== match[1] || (metadata.pages ?? 1) > 1)
      throw new Error('Invalid format');
    const output = await source
      .rotate()
      .resize(256, 256, { fit: 'cover', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    if (output.length > 64 * 1024) throw new Error('Too large');
    return `data:image/jpeg;base64,${output.toString('base64')}`;
  } catch {
    throw new UserError('Photo invalide ou trop volumineuse (maximum 16 mégapixels).');
  }
}

const matchesCode = (value: string, expected: string) => {
  const actual = Buffer.from(digest(value), 'hex');
  const hash = Buffer.from(expected, 'hex');
  return actual.length === hash.length && timingSafeEqual(actual, hash);
};

export async function accountProfileApi(
  store: Store,
  io: Server,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  body: unknown,
  session: Session | undefined,
  send: Reply,
  mailer: AccountMailer = accountMailer,
): Promise<boolean> {
  if (
    !['/api/account/profile', '/api/account/email/start', '/api/account/email/confirm'].includes(
      path,
    )
  )
    return false;
  if (!session?.email) {
    send(401, { error: 'Connectez-vous à votre compte personnel.' });
    return true;
  }
  const state = await store.get(session.garageId);
  if (state.demo)
    throw new UserError('Les changements de compte sont désactivés dans la démonstration.');
  const email = session.email;
  if (path === '/api/account/profile' && req.method === 'GET') {
    const { rows } = await store.db.query(
      'SELECT name,first_name AS "firstName",last_name AS "lastName",avatar FROM accounts WHERE email=$1',
      [email],
    );
    send(200, { profile: rows[0] });
    return true;
  }
  if (req.method !== 'POST') {
    send(405, { error: 'Méthode non autorisée.' });
    return true;
  }
  if (path === '/api/account/profile') {
    const input = profileInput.parse(body);
    const avatar =
      input.avatar === undefined
        ? undefined
        : input.avatar === null
          ? null
          : await normalizedAvatar(input.avatar);
    const name = `${input.firstName} ${input.lastName}`;
    const garageIds = await store.atomic(async (sql) => {
      const account = await sql.query('SELECT email FROM accounts WHERE email=$1 FOR UPDATE', [
        email,
      ]);
      if (!account.rows.length) throw new UserError('Compte introuvable.');
      await sql.query(
        'UPDATE accounts SET name=$2,first_name=$3,last_name=$4,avatar=CASE WHEN $5 THEN $6 ELSE avatar END WHERE email=$1',
        [email, name, input.firstName, input.lastName, avatar !== undefined, avatar ?? null],
      );
      const { rows } = await sql.query(
        "SELECT m.garage_id,m.user_id FROM memberships m JOIN garages g ON g.id=m.garage_id WHERE m.email=$1 AND g.state->>'demo'='false' ORDER BY m.garage_id",
        [email],
      );
      for (const row of rows) {
        const garage = await store.get(String(row.garage_id), sql, true);
        const member = garage.users.find((user) => user.id === row.user_id);
        if (!member) throw new UserError('Profil d’équipe introuvable.');
        member.name = name;
        if (avatar !== undefined) Object.assign(member, { avatar: avatar ?? undefined });
        garage.revision++;
        await store.save(garage, sql);
      }
      return rows.map((row) => String(row.garage_id));
    });
    for (const id of garageIds) await broadcastGarage(io, await store.get(id));
    io.in(`account:${email}`).emit('account:refresh');
    send(200, { ok: true });
    return true;
  }
  if (path === '/api/account/email/start') {
    const input = z
      .object({
        email: address,
        password: z.string().max(128).optional(),
        securityCode: z.string().max(100).optional(),
      })
      .strict()
      .parse(body);
    if (input.email === email) throw new UserError('Cette adresse est déjà celle de votre compte.');
    if (!authAttemptAllowed(`email-start:${email}`, 5))
      throw new UserError('Trop de demandes. Réessayez dans 15 minutes.');
    await requireAccountSecondFactor(store, email, input.securityCode);
    const newCode = String(randomInt(100000, 1000000));
    const oldCode = String(randomInt(100000, 1000000));
    const requestId = randomUUID();
    const oldRequired = await store.atomic(async (sql) => {
      await sql.query('SELECT email FROM accounts WHERE email=$1 FOR UPDATE', [email]);
      const account = await store.account(email, sql);
      if (!account) throw new UserError('Compte introuvable.');
      if (account.hash && !(await passwordMatches(input.password ?? '', account.hash)))
        throw new UserError('Mot de passe actuel incorrect.');
      if (await store.account(input.email, sql))
        throw new UserError('Cette adresse ne peut pas être utilisée.');
      const { rows } = await sql.query(
        'SELECT created::float8 AS created FROM account_email_changes WHERE account_email=$1',
        [email],
      );
      if (rows[0] && Number(rows[0].created) > Date.now() - 60000)
        throw new UserError('Attendez une minute avant de demander de nouveaux codes.');
      // ASVS 6.3.1: short-lived single-use proofs are hashed and bound to the initiating session.
      await sql.query(
        'INSERT INTO account_email_changes(account_email,request_id,session_hash,new_email,new_code_hash,old_code_hash,password_snapshot,expires,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(account_email) DO UPDATE SET request_id=excluded.request_id,session_hash=excluded.session_hash,new_email=excluded.new_email,new_code_hash=excluded.new_code_hash,old_code_hash=excluded.old_code_hash,password_snapshot=excluded.password_snapshot,expires=excluded.expires,created=excluded.created,attempts=0,ready=false',
        [
          email,
          requestId,
          session.tokenHash,
          input.email,
          digest(newCode),
          account.hash ? null : digest(oldCode),
          account.hash,
          Date.now() + 10 * 60000,
          Date.now(),
        ],
      );
      return !account.hash;
    });
    try {
      await mailer({
        to: input.email,
        subject: 'Caragem — Vérifier votre nouvelle adresse',
        text: `Votre code de vérification Caragem est ${newCode}. Il expire dans 10 minutes. Si vous n’avez pas demandé ce changement, ignorez ce mail.`,
      });
      await mailer({
        to: email,
        subject: 'Caragem — Changement d’adresse demandé',
        text: oldRequired
          ? `Un changement d’adresse Caragem vers ${input.email} a été demandé. Votre code de confirmation est ${oldCode}. Il expire dans 10 minutes. Si vous n’êtes pas à l’origine de cette demande, ne partagez pas ce code et déconnectez les autres sessions.`
          : `Un changement d’adresse Caragem vers ${input.email} a été demandé. Votre adresse actuelle reste utilisée tant que la nouvelle adresse n’a pas été vérifiée. Si vous n’êtes pas à l’origine de cette demande, changez votre mot de passe et déconnectez les autres sessions.`,
      });
      await store.db.query(
        'UPDATE account_email_changes SET ready=true WHERE account_email=$1 AND request_id=$2',
        [email, requestId],
      );
    } catch (error) {
      await store.db.query(
        'DELETE FROM account_email_changes WHERE account_email=$1 AND request_id=$2',
        [email, requestId],
      );
      throw error;
    }
    send(200, { ok: true, oldCodeRequired: oldRequired });
    return true;
  }
  const input = z.object({ code, oldCode: code.optional() }).strict().parse(body);
  if (!authAttemptAllowed(`email-confirm:${email}`, 20))
    throw new UserError('Trop de tentatives. Réessayez dans 15 minutes.');
  const replacementToken = randomBytes(32).toString('hex');
  const changed = await store.atomic(async (sql) => {
    await sql.query('SELECT email FROM accounts WHERE email=$1 FOR UPDATE', [email]);
    const { rows } = await sql.query(
      'SELECT *,expires::float8 AS expires FROM account_email_changes WHERE account_email=$1 FOR UPDATE',
      [email],
    );
    const pending = rows[0];
    if (
      !pending ||
      !pending.ready ||
      pending.session_hash !== session.tokenHash ||
      Number(pending.expires) <= Date.now() ||
      Number(pending.attempts) >= 5
    )
      return { error: 'Demande expirée ou invalide. Demandez de nouveaux codes.' };
    const account = await store.account(email, sql);
    if (!account || account.hash !== pending.password_snapshot)
      return { error: 'La sécurité du compte a changé. Recommencez la demande.' };
    if (
      !matchesCode(input.code, String(pending.new_code_hash)) ||
      (pending.old_code_hash && !matchesCode(input.oldCode ?? '', String(pending.old_code_hash)))
    ) {
      await sql.query(
        'UPDATE account_email_changes SET attempts=attempts+1 WHERE account_email=$1',
        [email],
      );
      return { error: 'Code de vérification incorrect.' };
    }
    if (await store.account(String(pending.new_email), sql))
      return { error: 'Cette adresse ne peut pas être utilisée.' };
    // ASVS 8.3.1: the account comes from the session; dependent identities and memberships cascade atomically.
    await sql.query('UPDATE accounts SET email=$2 WHERE email=$1', [email, pending.new_email]);
    await sql.query('DELETE FROM account_email_changes WHERE account_email=$1', [
      pending.new_email,
    ]);
    const rotated = await sql.query(
      'UPDATE sessions SET token_hash=$2,id=$3,created_at=$4,last_seen=$4 WHERE token_hash=$1 AND expires>$4 RETURNING token_hash',
      [session.tokenHash, digest(replacementToken), randomUUID(), Date.now()],
    );
    if (!rotated.rows.length)
      throw new UserError(
        'Votre session a expiré. Reconnectez-vous avant de changer votre adresse.',
      );
    await sql.query('DELETE FROM sessions WHERE account_email=$1 AND token_hash<>$2', [
      pending.new_email,
      digest(replacementToken),
    ]);
    return { email: String(pending.new_email) };
  });
  if (changed.error) throw new UserError(changed.error);
  res.setHeader('Set-Cookie', cookie(replacementToken));
  io.in(`account:${email}`).disconnectSockets();
  send(200, { ok: true });
  return true;
}
