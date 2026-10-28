import { DatabaseSync } from 'node:sqlite';
import { uid, type GarageState, type User } from '../lib/domain.ts';
import type { Store } from './store.ts';

type LegacyAccount = { email: string; hash: string; garage_id: string; user_id: string };
type LegacySession = { token_hash: string; garage_id: string; user_id: string; expires: number };
type LegacyInvitation = {
  token_hash: string;
  garage_id: string;
  email: string;
  role: User['role'];
  expires: number;
};

export function readLegacyDatabase(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const garages = (
      db.prepare('SELECT id,state FROM garages').all() as { id: string; state: string }[]
    ).map((row) => ({ id: row.id, state: JSON.parse(row.state) as GarageState }));
    const accounts = db.prepare('SELECT * FROM accounts').all() as LegacyAccount[];
    const sessions = db.prepare('SELECT * FROM sessions').all() as LegacySession[];
    const invitations = db
      .prepare('SELECT * FROM invitations ORDER BY rowid')
      .all() as LegacyInvitation[];
    const latest = new Map<string, LegacyInvitation>();
    for (const invite of invitations)
      latest.set(`${invite.garage_id}:${invite.email.toLowerCase()}`, invite);
    for (const account of accounts) {
      if (
        !garages
          .find((g) => g.id === account.garage_id)
          ?.state.users.some((u) => u.id === account.user_id)
      )
        throw new Error('Un compte SQLite référence un membre absent. Import annulé.');
    }
    for (const garage of garages)
      if (garage.state.id !== garage.id)
        throw new Error('Identifiant de garage incohérent. Import annulé.');
    return { garages, accounts, sessions, invitations: [...latest.values()] };
  } finally {
    db.close();
  }
}

export async function importLegacyDatabase(
  store: Store,
  legacy: ReturnType<typeof readLegacyDatabase>,
) {
  await store.atomic(async (sql) => {
    await sql.query('SELECT pg_advisory_xact_lock(73190421)');
    const { rows } = await sql.query(
      'SELECT (SELECT count(*) FROM garages)::int AS garages, (SELECT count(*) FROM accounts)::int AS accounts',
    );
    if (rows[0].garages !== 0 || rows[0].accounts !== 0)
      throw new Error('La base cible doit être vide. Aucune donnée existante ne sera écrasée.');
    for (const garage of legacy.garages) await store.save(garage.state, sql);
    for (const account of legacy.accounts) {
      const user = legacy.garages
        .find((g) => g.id === account.garage_id)!
        .state.users.find((u) => u.id === account.user_id)!;
      await sql.query('INSERT INTO accounts(email,hash,name) VALUES($1,$2,$3)', [
        account.email.toLowerCase(),
        account.hash,
        user.name,
      ]);
      await sql.query('INSERT INTO memberships(email,garage_id,user_id,role) VALUES($1,$2,$3,$4)', [
        account.email.toLowerCase(),
        account.garage_id,
        account.user_id,
        user.role,
      ]);
    }
    for (const session of legacy.sessions) {
      const account = legacy.accounts.find(
        (a) => a.garage_id === session.garage_id && a.user_id === session.user_id,
      );
      await sql.query(
        'INSERT INTO sessions(token_hash,garage_id,user_id,account_email,expires) VALUES($1,$2,$3,$4,$5)',
        [
          session.token_hash,
          session.garage_id,
          session.user_id,
          account?.email.toLowerCase() ?? null,
          session.expires,
        ],
      );
    }
    for (const invite of legacy.invitations)
      await sql.query(
        'INSERT INTO invitations(id,token_hash,garage_id,email,role,expires) VALUES($1,$2,$3,$4,$5,$6)',
        [
          uid(),
          invite.token_hash,
          invite.garage_id,
          invite.email.toLowerCase(),
          invite.role,
          invite.expires,
        ],
      );
  });
}
