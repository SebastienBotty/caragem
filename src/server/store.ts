import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  applyAction,
  createSeed,
  uid,
  type Action,
  type GarageState,
  type User,
} from '../lib/domain.ts';

const scryptAsync = promisify(scrypt);
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password: string, hash: string) {
  const [salt, key] = hash.split(':');
  if (!salt || !key) return false;
  const actual = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export type Session = {
  garageId: string;
  userId: string;
  expires: number;
  tokenHash: string;
};

export class Store {
  db: DatabaseSync;
  constructor(path = process.env.DATABASE_PATH ?? './data/carm.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS garages(id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts(email TEXT PRIMARY KEY, hash TEXT NOT NULL, garage_id TEXT NOT NULL REFERENCES garages(id), user_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, garage_id TEXT NOT NULL REFERENCES garages(id), user_id TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invitations(token_hash TEXT PRIMARY KEY, garage_id TEXT NOT NULL REFERENCES garages(id), email TEXT NOT NULL, role TEXT NOT NULL, expires INTEGER NOT NULL);
    `);
  }
  create(demo: boolean) {
    const state = createSeed(uid(), demo);
    this.save(state);
    return state;
  }
  get(id: string): GarageState {
    // ASVS 1.2.4 / 8.2.2: parameterized, tenant-scoped reads only.
    const row = this.db.prepare('SELECT state FROM garages WHERE id = ?').get(id) as
      { state: string } | undefined;
    if (!row) throw new Error('Garage introuvable.');
    return JSON.parse(row.state);
  }
  save(s: GarageState) {
    this.db
      .prepare(
        'INSERT INTO garages(id,state) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state',
      )
      .run(s.id, JSON.stringify(s));
  }
  act(session: Session, action: Action) {
    // shortcut: one Node process serializes writes; use database transactions and a socket adapter before scaling across processes.
    const state = this.get(session.garageId);
    const user = state.users.find((u) => u.id === session.userId);
    if (!user) throw new Error('Session invalide.');
    const next = applyAction(state, action, user);
    this.save(next);
    return next;
  }
  account(email: string) {
    return this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email.toLowerCase()) as
      { email: string; hash: string; garage_id: string; user_id: string } | undefined;
  }
  addAccount(email: string, hash: string, garageId: string, userId: string) {
    this.db
      .prepare('INSERT INTO accounts VALUES(?,?,?,?)')
      .run(email.toLowerCase(), hash, garageId, userId);
  }
  newSession(garageId: string, userId: string) {
    // ASVS 7.2.2–7.2.4: fresh CSPRNG token; only its hash is stored.
    this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
      .run(digest(token), garageId, userId, Date.now() + 7 * 86400000);
    return token;
  }
  session(cookie = ''): Session | undefined {
    const token = /(?:^|;\s*)carm_session=([a-f0-9]{64})(?:;|$)/.exec(cookie)?.[1];
    if (!token) return;
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?')
      .get(digest(token), Date.now()) as
      | {
          token_hash: string;
          garage_id: string;
          user_id: string;
          expires: number;
        }
      | undefined;
    if (row)
      return {
        garageId: row.garage_id,
        userId: row.user_id,
        expires: row.expires,
        tokenHash: row.token_hash,
      };
  }
  logout(s?: Session) {
    if (s) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(s.tokenHash);
  }
  invite(s: Session, email: string, role: User['role']) {
    const state = this.get(s.garageId);
    if (state.users.find((u) => u.id === s.userId)?.role !== 'owner')
      throw new Error('Action réservée au responsable.');
    const token = randomBytes(24).toString('hex');
    this.db
      .prepare('INSERT INTO invitations VALUES(?,?,?,?,?)')
      .run(digest(token), s.garageId, email.toLowerCase(), role, Date.now() + 7 * 86400000);
    return token;
  }
  invitation(token: string, email: string) {
    return this.db
      .prepare('SELECT * FROM invitations WHERE token_hash=? AND email=? AND expires>?')
      .get(digest(token), email.toLowerCase(), Date.now()) as
      { garage_id: string; role: User['role'] } | undefined;
  }
  useInvitation(token: string) {
    this.db.prepare('DELETE FROM invitations WHERE token_hash=?').run(digest(token));
  }
  close() {
    this.db.close();
  }
}
