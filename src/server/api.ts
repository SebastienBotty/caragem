import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from 'socket.io';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { Store } from './store.ts';
import { accountApi } from './account-api.ts';
import { validOrigin } from './http.ts';
export { validOrigin, appOrigin, cookie } from './http.ts';
import { actionSchema, log } from '../lib/domain.ts';
import { createGoogleApi, googleConfiguration } from './google-auth.ts';
import { requirePermission, visibleState } from '../lib/permissions.ts';
import { broadcastGarage } from './realtime.ts';

async function body(req: IncomingMessage) {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 128000) throw new Error('Requête trop volumineuse.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new Error('Requête JSON invalide.');
  }
}
export function createApi(store: Store, io: Server, googleConfig = googleConfiguration) {
  const google = createGoogleApi(store, io, googleConfig);
  const broadcast = async (garageId: string) => broadcastGarage(io, await store.get(garageId));
  return async function api(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = req.url?.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, data: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    try {
      if (req.method !== 'GET' && !validOrigin(req.headers.origin)) {
        send(403, { error: 'Origine de requête refusée.' });
        return true;
      }
      // Read the complete request before taking any mutable garage snapshot.
      const inputBody = req.method === 'POST' ? await body(req) : undefined;
      const session = await store.session(req.headers.cookie, req.headers['x-carm-demo-user']);
      if (await google(req, res, path, inputBody, session, send)) return true;
      if (await accountApi(store, io, req, res, path, inputBody, session, send)) return true;
      if (!session) {
        send(401, { error: 'Connectez-vous pour continuer.' });
        return true;
      }
      const s = await store.get(session.garageId);
      const actor = s.users.find((u) => u.id === session.userId);
      if (!actor) throw new Error('Session invalide.');
      if (req.method === 'POST' && path === '/api/actions') {
        const state = await store.act(session, actionSchema.parse(inputBody));
        await broadcastGarage(io, state);
        send(200, { state: visibleState(state, session.userId) });
        return true;
      }
      if (req.method === 'GET' && path.startsWith('/api/document/')) {
        requirePermission(s, actor, 'garage.view', 'documents.view');
        const documentId = path.slice('/api/document/'.length);
        const d = s.documents.find((d) => d.id === documentId);
        if (!d) throw new Error('Document introuvable.');
        if (s.vehicles.find((v) => v.id === d.vehicleId)?.stage === 'returned')
          requirePermission(s, actor, 'history.view');
        const readable = visibleState(s, actor.id);
        const { documentPdf } = await import('./pdf.ts');
        const bytes = await documentPdf(readable, d);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${d.number}.pdf"`);
        res.end(Buffer.from(bytes));
        return true;
      }
      if (req.method === 'POST' && path === '/api/send-mail') {
        requirePermission(s, actor, 'garage.view', 'customers.view', 'mail.send');
        const input = z.object({ id: z.string() }).parse(inputBody);
        if (s.demo) throw new Error('Les envois réels sont désactivés dans la démonstration.');
        if (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
          throw new Error(
            'Configurez le serveur SMTP avant d’envoyer des mails. Le brouillon est conservé.',
          );
        const { result: mailSnapshot } = await store.updateGarage(s.id, (current) => {
          const sender = current.users.find((u) => u.id === session.userId)!;
          requirePermission(current, sender, 'garage.view', 'customers.view', 'mail.send');
          const mail = current.mails.find((m) => m.id === input.id);
          if (!mail || mail.status === 'sent' || mail.status === 'sending')
            throw new Error('Ce mail ne peut pas être envoyé.');
          if (mail.documentId) requirePermission(current, sender, 'documents.view');
          if (current.vehicles.find((v) => v.id === mail.vehicleId)?.stage === 'returned')
            requirePermission(current, sender, 'history.view');
          const snapshot = structuredClone(mail);
          mail.status = 'sending';
          current.revision++;
          return snapshot;
        });
        await broadcast(s.id);
        try {
          const transport = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT ?? 587),
            secure: process.env.SMTP_PORT === '465',
            auth: process.env.SMTP_USER
              ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
              : undefined,
            connectionTimeout: 15000,
            socketTimeout: 30000,
          });
          const doc = mailSnapshot.documentId
            ? s.documents.find((d) => d.id === mailSnapshot.documentId)
            : undefined;
          const attachments = doc
            ? [
                {
                  filename: `${doc.number}.pdf`,
                  content: Buffer.from(await (await import('./pdf.ts')).documentPdf(s, doc)),
                  contentType: 'application/pdf',
                },
              ]
            : [];
          await transport.sendMail({
            from: process.env.SMTP_FROM,
            to: mailSnapshot.to,
            subject: mailSnapshot.subject,
            text: mailSnapshot.body,
            attachments,
            disableFileAccess: true,
            disableUrlAccess: true,
          });
          const { state: current } = await store.updateGarage(s.id, (current) => {
            const m = current.mails.find((m) => m.id === input.id)!;
            m.status = 'sent';
            m.sentAt = new Date().toISOString();
            m.sentBy = actor.name;
            m.error = undefined;
            current.revision++;
            log(current, `Mail envoyé : ${m.subject}`, actor.name);
          });
          await broadcast(s.id);
          send(200, { state: visibleState(current, session.userId) });
        } catch {
          await store.updateGarage(s.id, (current) => {
            const m = current.mails.find((m) => m.id === input.id)!;
            m.status = 'failed';
            m.error = 'Échec de l’envoi SMTP. Vérifiez la configuration avant de réessayer.';
            current.revision++;
          });
          await broadcast(s.id);
          send(502, { error: 'Échec de l’envoi SMTP. Le brouillon est conservé.' });
        }
        return true;
      }
      send(404, { error: 'Route introuvable.' });
    } catch (e) {
      send(400, {
        error:
          e instanceof z.ZodError
            ? 'Vérifiez les champs renseignés et les valeurs numériques.'
            : e instanceof Error
              ? e.message
              : 'Une erreur est survenue.',
      });
    }
    return true;
  };
}
