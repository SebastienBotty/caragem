import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, digest, passwordHash } from '../src/server/store.ts';
import { createSeed } from '../src/lib/domain.ts';
import { importLegacyDatabase, readLegacyDatabase } from '../src/server/import-sqlite.ts';
import { testDatabase } from './helpers/database.ts';

test('SQLite import preserves garage data, account hashes, sessions and invitations without overwriting PostgreSQL', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'carm-import-'));
  const path = join(directory, 'legacy.sqlite');
  const old = new DatabaseSync(path);
  const target = new Store(testDatabase());
  try {
    old.exec(
      'CREATE TABLE garages(id TEXT,state TEXT); CREATE TABLE accounts(email TEXT,hash TEXT,garage_id TEXT,user_id TEXT); CREATE TABLE sessions(token_hash TEXT,garage_id TEXT,user_id TEXT,expires INTEGER); CREATE TABLE invitations(token_hash TEXT,garage_id TEXT,email TEXT,role TEXT,expires INTEGER);',
    );
    const state = createSeed('legacy-real', false);
    state.users[0].name = 'Original Owner';
    const token = 'b'.repeat(64),
      invitation = 'c'.repeat(48),
      expires = Date.now() + 86400000;
    const hash = await passwordHash('a strong legacy password');
    old.prepare('INSERT INTO garages VALUES(?,?)').run(state.id, JSON.stringify(state));
    old
      .prepare('INSERT INTO accounts VALUES(?,?,?,?)')
      .run('legacy@example.com', hash, state.id, state.users[0].id);
    old
      .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
      .run(digest(token), state.id, state.users[0].id, expires);
    old
      .prepare('INSERT INTO invitations VALUES(?,?,?,?,?)')
      .run(digest(invitation), state.id, 'invite@example.com', 'mechanic', expires);
    const legacy = readLegacyDatabase(path);
    await importLegacyDatabase(target, legacy);
    const { billing, ...imported } = await target.get(state.id);
    assert.deepEqual(imported, state);
    assert.ok(billing!.trialEndsAt > Date.now());
    assert.equal((await target.account('legacy@example.com'))?.hash, hash);
    assert.equal((await target.session(`carm_session=${token}`))?.email, 'legacy@example.com');
    assert.equal((await target.invitation(invitation, 'invite@example.com'))?.garage_id, state.id);
    await assert.rejects(importLegacyDatabase(target, legacy), /vide/);
    assert.equal(
      old.prepare('SELECT count(*) AS count FROM garages').get()?.count,
      1,
      'original SQLite database remains unchanged',
    );
  } finally {
    old.close();
    await target.close();
    assert.equal(dirname(directory), tmpdir());
    rmSync(directory, { recursive: true });
  }
});
