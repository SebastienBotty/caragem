import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from 'socket.io';
import { z } from 'zod';
import {
  csvDatasets,
  exportDataCsv,
  exampleDataCsv,
  prepareCsvImport,
  transferKindSchema,
} from '../lib/data-transfer.ts';
import { log, type GarageState } from '../lib/domain.ts';
import { UserError } from '../lib/errors.ts';
import { visibleState } from '../lib/permissions.ts';
import { csvMaxBytes } from '../lib/csv.ts';
import type { Store, Session } from './store.ts';
import type { Reply } from './http.ts';
import { broadcastGarage } from './realtime.ts';
import { readSpreadsheet, writeSpreadsheet } from './spreadsheet-transfer.ts';

const inputSchema = z.object({
  kind: transferKindSchema,
  csv: z.string().max(csvMaxBytes),
  mapping: z
    .record(z.string().max(100), z.number().int().min(0).max(99))
    .refine((mapping) => Object.keys(mapping).length <= 30),
});

export async function dataTransferApi(
  store: Store,
  io: Server,
  req: IncomingMessage,
  _res: ServerResponse,
  path: string,
  body: unknown,
  session: Session,
  current: GarageState,
  send: Reply,
): Promise<boolean> {
  if (
    ![
      '/api/data-transfer/export',
      '/api/data-transfer/read',
      '/api/data-transfer/preview',
      '/api/data-transfer/import',
    ].includes(path)
  )
    return false;
  // ASVS 8.2.1–3: a full-garage transfer is restricted to its current owner, never client claims.
  if (current.users.find((u) => u.id === session.userId)?.role !== 'owner') {
    send(403, { error: 'Seul le responsable du garage peut transférer ses données.' });
    return true;
  }
  if (req.method !== 'POST') {
    send(405, { error: 'Méthode non autorisée.' });
    return true;
  }
  if (path === '/api/data-transfer/export') {
    const input = z
      .object({
        kind: transferKindSchema,
        template: z.boolean().default(false),
        example: z.boolean().default(false),
        format: z.enum(['csv', 'xls', 'xlsx']).default('csv'),
      })
      .parse(body);
    const csv = input.example
      ? exampleDataCsv(input.kind)
      : exportDataCsv(current, input.kind, input.template);
    const filename = `caragem-${input.kind}${input.example ? '-exemple' : input.template ? '-modele' : ''}.${input.format}`;
    send(
      200,
      input.format === 'csv'
        ? { filename, csv }
        : {
            filename,
            base64: writeSpreadsheet(csv, input.format),
            mime:
              input.format === 'xlsx'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : 'application/vnd.ms-excel',
          },
    );
    return true;
  }
  if (path === '/api/data-transfer/read') {
    const input = z.object({ base64: z.string().max(Math.ceil(csvMaxBytes / 3) * 4) }).parse(body);
    send(200, readSpreadsheet(input.base64));
    return true;
  }
  if (path === '/api/data-transfer/preview') {
    const input = inputSchema.parse(body);
    const { report } = prepareCsvImport(current, input.kind, input.csv, input.mapping);
    send(200, { ...report, revision: current.revision });
    return true;
  }
  const input = inputSchema.extend({ revision: z.number().int().min(0) }).parse(body);
  const { state, result } = await store.updateGarage(session.garageId, (state) => {
    if (state.users.find((u) => u.id === session.userId)?.role !== 'owner')
      throw new UserError('Vous n’avez plus l’autorisation de transférer les données.');
    if (state.revision !== input.revision)
      throw new UserError(
        'Les données du garage ont changé. Analysez de nouveau le fichier avant de confirmer.',
      );
    const prepared = prepareCsvImport(state, input.kind, input.csv, input.mapping);
    if (prepared.report.errors.length)
      throw new UserError(
        'Import annulé : corrigez les lignes signalées dans l’aperçu. Aucune donnée n’a été ajoutée.',
      );
    if (prepared.report.added) {
      Object.assign(state, prepared.state);
      state.revision++;
      log(
        state,
        `Import CSV · ${csvDatasets[input.kind].label} : ${prepared.report.added} ajout(s), ${prepared.report.skipped} doublon(s) ignoré(s)`,
        state.users.find((u) => u.id === session.userId)!.name,
        ['garage.configure'],
      );
    }
    return prepared.report;
  });
  await broadcastGarage(io, state);
  send(200, { state: visibleState(state, session.userId), report: result });
  return true;
}
