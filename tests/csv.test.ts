import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, writeCsv, csvCell } from '../src/lib/csv.ts';

test('CSV reads BOM, comma/semicolon/tab, quoted delimiters, quotes and multiline fields', () => {
  assert.deepEqual(parseCsv('\ufeffname;note\r\n"Alice; Bob";"dit ""bonjour""\nensuite"\r\n'), {
    headers: ['name', 'note'],
    rows: [['Alice; Bob', 'dit "bonjour"\nensuite']],
    rowNumbers: [2],
  });
  assert.deepEqual(parseCsv('name,email\nAlice,a@example.com').rows, [['Alice', 'a@example.com']]);
  assert.deepEqual(parseCsv('\nname,email\nAlice,a@example.com').headers, ['name', 'email']);
  assert.deepEqual(parseCsv('name\temail\nAlice\ta@example.com').rows, [
    ['Alice', 'a@example.com'],
  ]);
  assert.deepEqual(parseCsv('name;note\n\n"Alice\nBob";hello\nNext;note').rowNumbers, [3, 5]);
  for (const text of [
    'name,name\na,b',
    'name;mail\na',
    'name\n"unfinished',
    'name\n"closed"oops',
    'name\na"b',
  ])
    assert.throws(() => parseCsv(text));
});

test('CSV exports neutralize formulas and retain phone prefixes, apostrophes, accents and quoted data on reimport', () => {
  const values = [
    '=HYPERLINK("bad")',
    '+32412345678',
    '-ABC',
    '@SUM(A1)',
    '  =1+1',
    '\t=1+1',
    "'=literal",
    'Élodie; "Garage"\nBE',
  ];
  const parsed = parseCsv(
    writeCsv(
      ['value'],
      values.map((value) => [value]),
    ),
  );
  assert.deepEqual(
    parsed.rows.map(([value]) => csvCell(value)),
    values,
  );
  for (const [value] of parsed.rows.slice(0, 7)) assert.ok(value.startsWith("'"));
  assert.throws(() => parseCsv('name\n' + 'x'.repeat(1024 * 1024)), /volumineux|limite/i);
});
