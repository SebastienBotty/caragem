import { UserError } from '../lib/errors.ts';
import { requireWritable, type Billing } from '../lib/billing.ts';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import {
  applyAction,
  createSeed,
  log,
  uid,
  type Action,
  type GarageState,
  type User,
} from '../lib/domain.ts';
import { postgresDatabase, type Database, type Sql } from './database.ts';
import { can, permissions, requirePermission } from '../lib/permissions.ts';
function scryptAsync(password: string, salt: string, length: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, length, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
const passwordOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$32768$8$3$${salt}$${((await scryptAsync(password, salt, 64, passwordOptions)) as Buffer).toString('hex')}`;
}
export async function passwordMatches(password: string, hash: string | null) {
  if (!hash) return false;
  const current = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(hash);
  const legacy = /^([a-f0-9]{32}):([a-f0-9]{128})$/.exec(hash);
  const match = current ?? legacy;
  if (!match) return false;
  const [, salt, key] = match;
  const actual = (await scryptAsync(password, salt, 64, current ? passwordOptions : {})) as Buffer;
  const expected = Buffer.from(key, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export type Session = {
  garageId: string;
  userId: string;
  email?: string;
  expires: number;
  tokenHash: string;
};
type Account = {
  email: string;
  hash: string | null;
  name: string;
  googleLinked: boolean;
  onboardingSeen: boolean;
  demoExpires?: number;
};
export type GoogleProfile = { sub: string; email: string; name: string; emailVerified: boolean };
export type GoogleAuthRequest = {
  verifier: string;
  nonce: string;
  invitation?: string;
  linkSessionHash?: string;
  previousSessionHash?: string;
};
type Membership = { garage_id: string; user_id: string; role: User['role'] };
type Invitation = {
  id: string;
  garage_id: string;
  email: string;
  role: 'mechanic' | 'reception';
  custom_role_id: string | null;
  inviter_id: string | null;
  expires: number;
};
export type GarageAccess = { id: string; name: string; userId: string; role: User['role'] };
export class Store {
  readonly ready: Promise<void>;
  readonly db: Database;
  constructor(db: Database = postgresDatabase()) {
    this.db = db;
    this.ready = db.transaction(async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock(73190421)');
      await sql.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    });
  }
  private async rows<T>(text: string, values: unknown[] = [], sql: Sql = this.db): Promise<T[]> {
    return (await sql.query(text, values)).rows as T[];
  }
  async atomic<T>(work: (sql: Sql) => Promise<T>) {
    await this.ready;
    return this.db.transaction(work);
  }
  async create(demo: boolean) {
    await this.ready;
    const state = createSeed(uid(), demo);
    if (demo) state.demoExpires = Date.now() + 86400000;
    if (!demo) {
      state.settings.address = '';
      state.settings.name = 'Mon garage';
    }
    await this.save(state);
    return state;
  }
  async get(id: string, sql: Sql = this.db, lock = false): Promise<GarageState> {
    await this.ready;
    const [row] = await this.rows<{ state: GarageState; created: number }>(
      `SELECT state, extract(epoch FROM created_at)*1000 AS created FROM garages WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [id],
      sql,
    );
    if (!row) throw new UserError('Garage introuvable.');
    if (row.state.demo) {
      row.state.demoExpires ??= Math.floor(Number(row.created)) + 86400000;
      if (row.state.demoExpires <= Date.now())
        throw new UserError('Le garage de démonstration a expiré.');
    }
    if (!row.state.demo) {
      const [billing] = await this.rows<Billing>(
        'SELECT trial_ends_at::float8 AS "trialEndsAt", paid_until::float8 AS "paidUntil", status, cancel_at_period_end AS "cancelAtPeriodEnd" FROM garage_billing WHERE garage_id=$1',
        [id],
        sql,
      );
      row.state.billing = billing;
    }
    return row.state;
  }
  async save(state: GarageState, sql: Sql = this.db) {
    await this.ready;
    const { billing: _billing, ...businessState } = state;
    const serialized = JSON.stringify(businessState);
    if (Buffer.byteLength(serialized) > 10 * 1024 * 1024)
      throw new UserError(
        'Le garage atteint la limite de 10 Mio. Contactez le responsable de l’hébergement.',
      );
    await sql.query(
      'INSERT INTO garages(id,state) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET state=excluded.state',
      [state.id, serialized],
    );
    if (!state.demo)
      await sql.query('INSERT INTO garage_billing(garage_id) VALUES($1) ON CONFLICT DO NOTHING', [
        state.id,
      ]);
  }
  async updateGarage<T>(
    id: string,
    change: (state: GarageState, sql: Sql) => T | Promise<T>,
    finishPendingMail = false,
  ) {
    return this.atomic(async (sql) => {
      const state = await this.get(id, sql, true);
      // ASVS 8.3.1 / 2.3.3: expiry is checked under the same lock as the business write.
      if (!finishPendingMail) requireWritable(state);
      const result = await change(state, sql);
      await this.save(state, sql);
      return { state, result };
    });
  }
  async act(session: Session, action: Action) {
    const { state } = await this.updateGarage(session.garageId, async (s, sql) => {
      const user = s.users.find((u) => u.id === session.userId);
      if (!user) throw new UserError('Session invalide.');
      Object.assign(s, applyAction(s, action, user));
      if (action.type === 'assignRole' || action.type === 'customRole')
        await sql.query(
          'UPDATE memberships m SET role=u.role FROM jsonb_to_recordset($2::jsonb) AS u(id text, role text) WHERE m.garage_id=$1 AND m.user_id=u.id AND m.role<>u.role',
          [s.id, JSON.stringify(s.users)],
        );
    });
    return state;
  }
  async account(email: string, sql: Sql = this.db) {
    await this.ready;
    return (
      await this.rows<Account>(
        'SELECT email,hash,name,onboarding_seen AS "onboardingSeen",demo_expires::float8 AS "demoExpires",EXISTS(SELECT 1 FROM google_identities g WHERE g.email=accounts.email) AS "googleLinked" FROM accounts WHERE email=$1',
        [email.toLowerCase()],
        sql,
      )
    )[0];
  }
  async upgradePassword(email: string, previous: string, hash: string) {
    // Do not overwrite a concurrent password change with the legacy login's hash.
    return (
      (
        await this.rows('UPDATE accounts SET hash=$1 WHERE email=$2 AND hash=$3 RETURNING email', [
          hash,
          email,
          previous,
        ])
      ).length === 1
    );
  }
  async garages(email: string): Promise<GarageAccess[]> {
    await this.ready;
    return this.rows<GarageAccess>(
      `SELECT g.id, g.state->'settings'->>'name' AS name, m.user_id AS "userId", m.role FROM memberships m JOIN garages g ON g.id=m.garage_id WHERE m.email=$1 AND (g.state->>'demo'<>'true' OR COALESCE((g.state->>'demoExpires')::bigint, floor(extract(epoch FROM g.created_at)*1000)::bigint+86400000)>$2) ORDER BY g.created_at,g.id`,
      [email, Date.now()],
    );
  }
  private async createOwned(sql: Sql, email: string, garageName: string) {
    await sql.query('SELECT email FROM accounts WHERE email=$1 FOR UPDATE', [email]);
    const [{ count }] = await this.rows<{ count: number }>(
      "SELECT count(*)::int AS count FROM memberships m JOIN garages g ON g.id=m.garage_id WHERE m.email=$1 AND m.role='owner' AND g.state->>'demo'='false'",
      [email],
      sql,
    );
    if (count >= 10) throw new UserError('La limite de 10 garages personnels est atteinte.');
    const account = await this.account(email, sql);
    if (!account) throw new UserError('Compte introuvable.');
    const state = createSeed(uid(), false);
    state.settings.name = garageName;
    state.settings.address = '';
    state.users[0].name = account.name;
    await this.save(state, sql);
    await sql.query('INSERT INTO memberships(email,garage_id,user_id,role) VALUES($1,$2,$3,$4)', [
      email,
      state.id,
      state.users[0].id,
      'owner',
    ]);
    return { garageId: state.id, userId: state.users[0].id };
  }
  async register(input: {
    email: string;
    hash: string;
    name: string;
    garage?: string;
    invitation?: string;
  }) {
    return this.atomic(async (sql) => {
      if (await this.account(input.email, sql))
        throw new UserError('Cette adresse possède déjà un compte. Connectez-vous.');
      await sql.query('INSERT INTO accounts(email,hash,name) VALUES($1,$2,$3)', [
        input.email,
        input.hash,
        input.name,
      ]);
      if (input.invitation) return this.join(sql, input.email, input.invitation);
      if (!input.garage) throw new UserError('Renseignez le nom de votre garage.');
      return this.createOwned(sql, input.email, input.garage);
    });
  }
  async createGarage(session: Session, name: string) {
    if (!session.email) throw new UserError('Créez un compte personnel pour créer un garage.');
    return this.atomic((sql) => this.createOwned(sql, session.email!, name));
  }
  async createDemo(session: Session) {
    if (!session.email)
      throw new UserError('Connectez-vous à votre compte pour ouvrir la démonstration.');
    await this.purgeExpiredDemos();
    return this.atomic(async (sql) => {
      const [account] = await this.rows<{ expires: number | null }>(
        'SELECT demo_expires::float8 AS expires FROM accounts WHERE email=$1 FOR UPDATE',
        [session.email],
        sql,
      );
      if (!account) throw new UserError('Compte introuvable.');
      if (account.expires !== null && account.expires <= Date.now())
        throw new UserError('Votre essai de démonstration de 24 h est terminé.');
      const [existing] = await this.rows<{ id: string }>(
        'SELECT id FROM garages WHERE demo_account_email=$1',
        [session.email],
        sql,
      );
      if (existing) {
        const state = await this.get(existing.id, sql);
        return { garageId: state.id, userId: state.users[0].id };
      }
      const state = createSeed(uid(), true);
      state.demoExpires = account.expires ?? Date.now() + 86400000;
      state.settings.name = 'Garage de démonstration';
      await this.save(state, sql);
      await sql.query('UPDATE garages SET demo_account_email=$1 WHERE id=$2', [
        session.email,
        state.id,
      ]);
      await sql.query('UPDATE accounts SET demo_expires=$1 WHERE email=$2', [
        state.demoExpires,
        session.email,
      ]);
      await sql.query('INSERT INTO memberships(email,garage_id,user_id,role) VALUES($1,$2,$3,$4)', [
        session.email,
        state.id,
        state.users[0].id,
        'owner',
      ]);
      return { garageId: state.id, userId: state.users[0].id };
    });
  }
  async purgeExpiredDemos() {
    return this.atomic(async (sql) => {
      const expired = await this.rows<{ id: string }>(
        "SELECT id FROM garages WHERE state->>'demo'='true' AND COALESCE((state->>'demoExpires')::bigint, (extract(epoch FROM created_at)*1000)::bigint+86400000)<=$1 FOR UPDATE",
        [Date.now()],
        sql,
      );
      if (!expired.length) return;
      const ids = expired.map((row) => row.id);
      await sql.query('DELETE FROM sessions WHERE garage_id=ANY($1::text[])', [ids]);
      await sql.query('DELETE FROM invitations WHERE garage_id=ANY($1::text[])', [ids]);
      await sql.query('DELETE FROM memberships WHERE garage_id=ANY($1::text[])', [ids]);
      await sql.query("DELETE FROM garages WHERE id=ANY($1::text[]) AND state->>'demo'='true'", [
        ids,
      ]);
    });
  }
  async saveGoogleRequest(state: string, browser: string, payload: GoogleAuthRequest) {
    await this.ready;
    await this.db.query('DELETE FROM google_auth_requests WHERE expires<$1', [Date.now()]);
    await this.db.query(
      'INSERT INTO google_auth_requests(state_hash,browser_hash,payload,expires) VALUES($1,$2,$3::jsonb,$4)',
      [digest(state), digest(browser), JSON.stringify(payload), Date.now() + 10 * 60000],
    );
  }
  async consumeGoogleRequest(
    state: string,
    browser: string,
  ): Promise<GoogleAuthRequest | undefined> {
    await this.ready;
    const [row] = await this.rows<{ payload: GoogleAuthRequest }>(
      'DELETE FROM google_auth_requests WHERE state_hash=$1 AND browser_hash=$2 AND expires>$3 RETURNING payload',
      [digest(state), digest(browser), Date.now()],
    );
    return row?.payload;
  }
  async googleAccount(profile: GoogleProfile, request: GoogleAuthRequest) {
    if (!profile.emailVerified) throw new UserError('google_unverified_email');
    return this.atomic(async (sql) => {
      // Serialize this provider identity; email alone never associates an existing account.
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended('google:' || $1,0))", [
        profile.sub,
      ]);
      const [identity] = await this.rows<{ email: string }>(
        'SELECT email FROM google_identities WHERE subject=$1',
        [profile.sub],
        sql,
      );
      let email = identity?.email;
      let linkedTarget: { garageId: string; userId: string } | undefined;
      if (request.linkSessionHash) {
        const [session] = await this.rows<{
          account_email: string;
          garage_id: string;
          user_id: string;
        }>(
          'SELECT account_email,garage_id,user_id FROM sessions WHERE token_hash=$1 AND expires>$2',
          [request.linkSessionHash, Date.now()],
          sql,
        );
        if (
          !session?.account_email ||
          session.account_email !== profile.email ||
          (email && email !== session.account_email)
        )
          throw new UserError('google_link_failed');
        const [other] = await this.rows<{ subject: string }>(
          'SELECT subject FROM google_identities WHERE email=$1',
          [session.account_email],
          sql,
        );
        if (other && other.subject !== profile.sub) throw new UserError('google_link_failed');
        if (!identity)
          await sql.query('INSERT INTO google_identities(subject,email) VALUES($1,$2)', [
            profile.sub,
            session.account_email,
          ]);
        email = session.account_email;
        linkedTarget = { garageId: session.garage_id, userId: session.user_id };
      } else if (!identity) {
        if (await this.account(profile.email, sql)) throw new UserError('google_link_required');
        await sql.query('INSERT INTO accounts(email,hash,name) VALUES($1,NULL,$2)', [
          profile.email,
          profile.name,
        ]);
        await sql.query('INSERT INTO google_identities(subject,email) VALUES($1,$2)', [
          profile.sub,
          profile.email,
        ]);
        email = profile.email;
      }
      if (!email) throw new UserError('google_signin_failed');
      if (request.invitation) return this.join(sql, email, request.invitation);
      if (linkedTarget) return linkedTarget;
      const [membership] = await this.rows<Membership>(
        'SELECT m.* FROM memberships m JOIN garages g ON g.id=m.garage_id WHERE email=$1 ORDER BY g.created_at,g.id LIMIT 1',
        [email],
        sql,
      );
      if (membership) return { garageId: membership.garage_id, userId: membership.user_id };
      return this.createOwned(sql, email, 'Mon garage');
    });
  }
  private async join(sql: Sql, email: string, token: string) {
    const [invite] = await this.rows<Invitation>(
      'SELECT *, expires::float8 AS expires FROM invitations WHERE token_hash=$1 AND email=$2 AND expires>$3 FOR UPDATE',
      [digest(token), email, Date.now()],
      sql,
    );
    if (!invite)
      throw new UserError('Invitation invalide ou expirée, ou destinée à une autre adresse mail.');
    const state = await this.get(invite.garage_id, sql, true);
    requireWritable(state);
    if (!invite.inviter_id)
      throw new UserError('Cette invitation doit être renouvelée par le responsable.');
    this.invitationRole(state, invite.inviter_id, invite.role, invite.custom_role_id ?? undefined);
    const [existing] = await this.rows<Membership>(
      'SELECT * FROM memberships WHERE email=$1 AND garage_id=$2',
      [email, invite.garage_id],
      sql,
    );
    let userId = existing?.user_id;
    if (!userId) {
      const account = await this.account(email, sql);
      if (!account) throw new UserError('Compte introuvable.');
      const role = state.settings.customRoles?.find((r) => r.id === invite.custom_role_id);
      if (invite.custom_role_id && !role)
        throw new UserError('Le rôle de cette invitation n’existe plus.');
      const user: User = {
        id: uid(),
        name: account.name,
        role: role?.baseRole ?? invite.role,
        color: '#8b78b7',
        ...(role ? { customRoleId: role.id } : {}),
      };
      state.users.push(user);
      state.revision++;
      log(state, `${user.name} a rejoint l’équipe`, account.name);
      await this.save(state, sql);
      await sql.query('INSERT INTO memberships(email,garage_id,user_id,role) VALUES($1,$2,$3,$4)', [
        email,
        state.id,
        user.id,
        user.role,
      ]);
      userId = user.id;
    }
    await sql.query('DELETE FROM invitations WHERE id=$1', [invite.id]);
    return { garageId: invite.garage_id, userId };
  }
  async joinGarage(email: string, token: string) {
    return this.atomic((sql) => this.join(sql, email, token));
  }
  async membership(email: string, garageId: string) {
    await this.ready;
    const [row] = await this.rows<Membership>(
      'SELECT * FROM memberships WHERE email=$1 AND garage_id=$2',
      [email, garageId],
    );
    if (!row) throw new UserError('Vous ne faites pas partie de ce garage.');
    return { garageId: row.garage_id, userId: row.user_id };
  }
  async newSession(garageId: string, userId: string) {
    await this.ready;
    const state = await this.get(garageId);
    const [membership] = await this.rows<{ email: string }>(
      'SELECT email FROM memberships WHERE garage_id=$1 AND user_id=$2',
      [garageId, userId],
    );
    if (!state.users.some((u) => u.id === userId) || (!state.demo && !membership))
      throw new UserError('Accès au garage refusé.');
    const token = randomBytes(32).toString('hex');
    await this.db.query('DELETE FROM sessions WHERE expires<$1', [Date.now()]);
    // ASVS 7.2.2: only a hash of the session secret is persisted.
    await this.db.query(
      'INSERT INTO sessions(token_hash,garage_id,user_id,account_email,expires) VALUES($1,$2,$3,$4,$5)',
      [
        digest(token),
        garageId,
        userId,
        membership?.email ?? null,
        Math.min(Date.now() + 7 * 86400000, state.demo ? state.demoExpires! : Infinity),
      ],
    );
    return token;
  }
  async session(cookie = '', demoUserId?: unknown): Promise<Session | undefined> {
    await this.ready;
    const token = /(?:^|;\s*)carm_session=([a-f0-9]{64})(?:;|$)/.exec(cookie)?.[1];
    if (!token) return;
    const [row] = await this.rows<{
      token_hash: string;
      garage_id: string;
      user_id: string;
      account_email: string | null;
      expires: number;
    }>(
      "SELECT s.*, s.expires::float8 AS expires FROM sessions s JOIN garages g ON g.id=s.garage_id WHERE s.token_hash=$1 AND s.expires>$2 AND (g.state->>'demo'<>'true' OR COALESCE((g.state->>'demoExpires')::bigint, (extract(epoch FROM g.created_at)*1000)::bigint+86400000)>$2)",
      [digest(token), Date.now()],
    );
    if (!row) return;
    const state = await this.get(row.garage_id);
    let userId = row.user_id;
    if (demoUserId !== undefined) {
      if (
        !state.demo ||
        typeof demoUserId !== 'string' ||
        !state.users.some((u) => u.id === demoUserId)
      )
        return;
      userId = demoUserId;
    }
    if (!state.users.some((u) => u.id === userId)) return;
    if (!state.demo) {
      const [membership] = await this.rows<Membership>(
        'SELECT * FROM memberships WHERE email=$1 AND garage_id=$2 AND user_id=$3',
        [row.account_email, row.garage_id, userId],
      );
      if (!membership) return;
    }
    return {
      garageId: row.garage_id,
      userId,
      email: row.account_email ?? undefined,
      expires: Math.min(row.expires, state.demo ? state.demoExpires! : Infinity),
      tokenHash: row.token_hash,
    };
  }
  async logout(s?: Session) {
    if (s) await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [s.tokenHash]);
  }
  async revokeSessionHash(hash: string) {
    await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [hash]);
  }
  async invite(session: Session, email: string, role: User['role'], customRoleId?: string) {
    return this.atomic(async (sql) => {
      const state = await this.get(session.garageId, sql, true);
      requireWritable(state);
      if (state.demo && session.email)
        throw new UserError('Les invitations réelles sont désactivées dans la démonstration.');
      role = this.invitationRole(state, session.userId, role, customRoleId).role;
      email = email.toLowerCase();
      if (
        (
          await this.rows(
            'SELECT 1 FROM memberships WHERE email=$1 AND garage_id=$2',
            [email, state.id],
            sql,
          )
        ).length
      )
        throw new UserError('Cette personne fait déjà partie du garage.');
      const token = randomBytes(24).toString('hex');
      await sql.query(
        'INSERT INTO invitations(id,token_hash,garage_id,email,role,expires,custom_role_id,inviter_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(garage_id,email) DO UPDATE SET token_hash=excluded.token_hash,role=excluded.role,expires=excluded.expires,custom_role_id=excluded.custom_role_id,inviter_id=excluded.inviter_id',
        [
          uid(),
          digest(token),
          state.id,
          email,
          role,
          Date.now() + 7 * 86400000,
          customRoleId ?? null,
          session.userId,
        ],
      );
      return token;
    });
  }
  private invitationRole(
    state: GarageState,
    inviterId: string,
    role: User['role'],
    customRoleId?: string,
  ): User {
    const inviter = state.users.find((u) => u.id === inviterId);
    if (!inviter) throw new UserError('Utilisateur non autorisé.');
    requirePermission(state, inviter, 'team.invite');
    if (role !== 'mechanic' && role !== 'reception') throw new UserError('Rôle invalide.');
    const custom = state.settings.customRoles?.find((r) => r.id === customRoleId);
    if (customRoleId && !custom) throw new UserError('Rôle introuvable dans ce garage.');
    const target: User = {
      id: '',
      name: '',
      color: '',
      role: custom?.baseRole ?? role,
      customRoleId,
    };
    // Recheck at acceptance: a pending role or the inviter's grants may have changed.
    if (permissions.some((p) => can(state, target, p.id) && !can(state, inviter, p.id)))
      throw new UserError('Vous ne pouvez pas déléguer des permissions que vous ne possédez pas.');
    return target;
  }
  async invitation(token: string, email: string) {
    await this.ready;
    return (
      await this.rows<Invitation>(
        'SELECT id,garage_id,email,role,custom_role_id,expires::float8 AS expires FROM invitations WHERE token_hash=$1 AND email=$2 AND expires>$3',
        [digest(token), email.toLowerCase(), Date.now()],
      )
    )[0];
  }
  async invitations(session: Session) {
    const state = await this.get(session.garageId);
    requirePermission(
      state,
      state.users.find((u) => u.id === session.userId)!,
      'team.invite',
    );
    return this.rows<{
      id: string;
      email: string;
      role: string;
      customRoleId: string | null;
      expires: number;
    }>(
      'SELECT id,email,role,custom_role_id AS "customRoleId",expires::float8 AS expires FROM invitations WHERE garage_id=$1 AND expires>$2 ORDER BY expires DESC',
      [state.id, Date.now()],
    );
  }
  async revokeInvitation(session: Session, id: string) {
    await this.updateGarage(session.garageId, async (state, sql) => {
      requirePermission(
        state,
        state.users.find((u) => u.id === session.userId)!,
        'team.invite',
      );
      await sql.query('DELETE FROM invitations WHERE garage_id=$1 AND id=$2', [
        session.garageId,
        id,
      ]);
    });
  }
  async useInvitation(token: string) {
    await this.db.query('DELETE FROM invitations WHERE token_hash=$1', [digest(token)]);
  }
  async changePassword(session: Session, hash: string) {
    if (!session.email) throw new UserError('Aucun compte personnel associé.');
    await this.atomic(async (sql) => {
      await sql.query('UPDATE accounts SET hash=$1 WHERE email=$2', [hash, session.email]);
      await sql.query('DELETE FROM sessions WHERE account_email=$1', [session.email]);
    });
  }
  async completeOnboarding(session: Session) {
    await this.ready;
    // ASVS 8.2.2: the account/member comes from the verified session, never the request body.
    if (session.email) {
      await this.db.query('UPDATE accounts SET onboarding_seen=true WHERE email=$1', [
        session.email,
      ]);
    } else {
      await this.updateGarage(session.garageId, (state) => {
        const user = state.users.find((u) => u.id === session.userId);
        if (!state.demo || !user) throw new UserError('Session invalide.');
        user.onboardingSeen = true;
        state.revision++;
      });
    }
  }
  async close() {
    try {
      await this.ready;
    } finally {
      await this.db.close();
    }
  }
}
