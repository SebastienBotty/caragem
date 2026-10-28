import { readFileSync } from 'node:fs';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
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
const scryptAsync = promisify(scrypt);
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${((await scryptAsync(password, salt, 64)) as Buffer).toString('hex')}`;
}
export async function passwordMatches(password: string, hash: string | null) {
  if (!hash) return false;
  const [salt, key] = hash.split(':');
  if (!salt || !key) return false;
  const actual = (await scryptAsync(password, salt, 64)) as Buffer;
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
type Account = { email: string; hash: string | null; name: string; googleLinked: boolean };
type Membership = { garage_id: string; user_id: string; role: User['role'] };
type Invitation = {
  id: string;
  garage_id: string;
  email: string;
  role: 'mechanic' | 'reception';
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
    if (!demo) {
      state.settings.address = '';
      state.settings.name = 'Mon garage';
    }
    await this.save(state);
    return state;
  }
  async get(id: string, sql: Sql = this.db, lock = false): Promise<GarageState> {
    await this.ready;
    const [row] = await this.rows<{ state: GarageState }>(
      `SELECT state FROM garages WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [id],
      sql,
    );
    if (!row) throw new Error('Garage introuvable.');
    return row.state;
  }
  async save(state: GarageState, sql: Sql = this.db) {
    await this.ready;
    await sql.query(
      'INSERT INTO garages(id,state) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET state=excluded.state',
      [state.id, JSON.stringify(state)],
    );
  }
  async updateGarage<T>(id: string, change: (state: GarageState) => T | Promise<T>) {
    return this.atomic(async (sql) => {
      const state = await this.get(id, sql, true);
      const result = await change(state);
      await this.save(state, sql);
      return { state, result };
    });
  }
  async act(session: Session, action: Action) {
    const { state } = await this.updateGarage(session.garageId, (s) => {
      const user = s.users.find((u) => u.id === session.userId);
      if (!user) throw new Error('Session invalide.');
      Object.assign(s, applyAction(s, action, user));
    });
    return state;
  }
  async account(email: string, sql: Sql = this.db) {
    await this.ready;
    return (
      await this.rows<Account>(
        'SELECT email,hash,name,FALSE AS "googleLinked" FROM accounts WHERE email=$1',
        [email.toLowerCase()],
        sql,
      )
    )[0];
  }
  async garages(email: string): Promise<GarageAccess[]> {
    await this.ready;
    return this.rows<GarageAccess>(
      `SELECT g.id, g.state->'settings'->>'name' AS name, m.user_id AS "userId", m.role FROM memberships m JOIN garages g ON g.id=m.garage_id WHERE m.email=$1 ORDER BY g.created_at,g.id`,
      [email],
    );
  }
  private async createOwned(sql: Sql, email: string, garageName: string) {
    const account = await this.account(email, sql);
    if (!account) throw new Error('Compte introuvable.');
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
        throw new Error('Cette adresse possède déjà un compte. Connectez-vous.');
      await sql.query('INSERT INTO accounts(email,hash,name) VALUES($1,$2,$3)', [
        input.email,
        input.hash,
        input.name,
      ]);
      if (input.invitation) return this.join(sql, input.email, input.invitation);
      if (!input.garage) throw new Error('Renseignez le nom de votre garage.');
      return this.createOwned(sql, input.email, input.garage);
    });
  }
  async createGarage(session: Session, name: string) {
    if (!session.email) throw new Error('Créez un compte personnel pour créer un garage.');
    return this.atomic((sql) => this.createOwned(sql, session.email!, name));
  }
  private async join(sql: Sql, email: string, token: string) {
    const [invite] = await this.rows<Invitation>(
      'SELECT *, expires::float8 AS expires FROM invitations WHERE token_hash=$1 AND email=$2 AND expires>$3 FOR UPDATE',
      [digest(token), email, Date.now()],
      sql,
    );
    if (!invite)
      throw new Error('Invitation invalide ou expirée, ou destinée à une autre adresse mail.');
    const [existing] = await this.rows<Membership>(
      'SELECT * FROM memberships WHERE email=$1 AND garage_id=$2',
      [email, invite.garage_id],
      sql,
    );
    let userId = existing?.user_id;
    if (!userId) {
      const state = await this.get(invite.garage_id, sql, true);
      const account = await this.account(email, sql);
      if (!account) throw new Error('Compte introuvable.');
      const user: User = { id: uid(), name: account.name, role: invite.role, color: '#8b78b7' };
      state.users.push(user);
      state.revision++;
      log(state, `${user.name} a rejoint l’équipe`, account.name);
      await this.save(state, sql);
      await sql.query('INSERT INTO memberships(email,garage_id,user_id,role) VALUES($1,$2,$3,$4)', [
        email,
        state.id,
        user.id,
        invite.role,
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
    if (!row) throw new Error('Vous ne faites pas partie de ce garage.');
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
      throw new Error('Accès au garage refusé.');
    const token = randomBytes(32).toString('hex');
    await this.db.query('DELETE FROM sessions WHERE expires<$1', [Date.now()]);
    // ASVS 7.2.2: only a hash of the session secret is persisted.
    await this.db.query(
      'INSERT INTO sessions(token_hash,garage_id,user_id,account_email,expires) VALUES($1,$2,$3,$4,$5)',
      [digest(token), garageId, userId, membership?.email ?? null, Date.now() + 7 * 86400000],
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
    }>('SELECT *, expires::float8 AS expires FROM sessions WHERE token_hash=$1 AND expires>$2', [
      digest(token),
      Date.now(),
    ]);
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
      expires: row.expires,
      tokenHash: row.token_hash,
    };
  }
  async logout(s?: Session) {
    if (s) await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [s.tokenHash]);
  }
  async revokeSessionHash(hash: string) {
    await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [hash]);
  }
  async invite(session: Session, email: string, role: User['role']) {
    const state = await this.get(session.garageId);
    if (state.users.find((u) => u.id === session.userId)?.role !== 'owner')
      throw new Error('Vous n’avez pas l’autorisation pour cette action.');
    if (role !== 'mechanic' && role !== 'reception') throw new Error('Rôle invalide.');
    email = email.toLowerCase();
    if (
      (
        await this.rows('SELECT 1 FROM memberships WHERE email=$1 AND garage_id=$2', [
          email,
          state.id,
        ])
      ).length
    )
      throw new Error('Cette personne fait déjà partie du garage.');
    const token = randomBytes(24).toString('hex');
    await this.db.query(
      'INSERT INTO invitations(id,token_hash,garage_id,email,role,expires) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(garage_id,email) DO UPDATE SET token_hash=excluded.token_hash,role=excluded.role,expires=excluded.expires',
      [uid(), digest(token), state.id, email, role, Date.now() + 7 * 86400000],
    );
    return token;
  }
  async invitation(token: string, email: string) {
    await this.ready;
    return (
      await this.rows<Invitation>(
        'SELECT id,garage_id,email,role,expires::float8 AS expires FROM invitations WHERE token_hash=$1 AND email=$2 AND expires>$3',
        [digest(token), email.toLowerCase(), Date.now()],
      )
    )[0];
  }
  async invitations(session: Session) {
    const state = await this.get(session.garageId);
    if (state.users.find((u) => u.id === session.userId)?.role !== 'owner')
      throw new Error('Vous n’avez pas l’autorisation pour cette action.');
    return this.rows<{ id: string; email: string; role: string; expires: number }>(
      'SELECT id,email,role,expires::float8 AS expires FROM invitations WHERE garage_id=$1 AND expires>$2 ORDER BY expires DESC',
      [state.id, Date.now()],
    );
  }
  async revokeInvitation(session: Session, id: string) {
    await this.invitations(session);
    await this.db.query('DELETE FROM invitations WHERE garage_id=$1 AND id=$2', [
      session.garageId,
      id,
    ]);
  }
  async useInvitation(token: string) {
    await this.db.query('DELETE FROM invitations WHERE token_hash=$1', [digest(token)]);
  }
  async changePassword(session: Session, hash: string) {
    if (!session.email) throw new Error('Aucun compte personnel associé.');
    await this.atomic(async (sql) => {
      await sql.query('UPDATE accounts SET hash=$1 WHERE email=$2', [hash, session.email]);
      await sql.query('DELETE FROM sessions WHERE account_email=$1', [session.email]);
    });
  }
  async close() {
    try {
      await this.ready;
    } finally {
      await this.db.close();
    }
  }
}
