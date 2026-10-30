import { UserError } from '../lib/errors.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from 'socket.io';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { Store, type Session } from './store.ts';
import { securityEvent } from './security-log.ts';
import { accountApi } from './account-api.ts';
import { securityHeaders, validOrigin } from './http.ts';
export { validOrigin, appOrigin, cookie } from './http.ts';
import { actionSchema, log } from '../lib/domain.ts';
import { createGoogleApi, googleConfiguration } from './google-auth.ts';
import { requirePermission, visibleState } from '../lib/permissions.ts';
import { broadcastGarage } from './realtime.ts';
import { dataTransferApi } from './data-transfer-api.ts';
import { vehiclePhotoApi } from './vehicle-photo-api.ts';
import { createBillingApi, type BillingConfig } from './billing-api.ts';
import { accountProfileApi } from './account-profile-api.ts';
import { accountPreferencesApi } from './account-preferences-api.ts';
import { accountSecurityApi } from './account-security-api.ts';
const knownRoutes = new Set([
  '/api/session',
  '/api/account/profile',
  '/api/account/email/start',
  '/api/account/email/confirm',
  '/api/account/preferences',
  '/api/account/notifications',
  '/api/account/security',
  '/api/account/security/sessions/revoke',
  '/api/account/security/2fa/setup',
  '/api/account/security/2fa/enable',
  '/api/account/security/2fa/disable',
  '/api/auth/2fa/status',
  '/api/auth/2fa/verify',
  '/api/billing',
  '/api/billing/checkout',
  '/api/billing/portal',
  '/api/billing/sync',
  '/api/billing/webhook',
  '/api/invitation',
  '/api/demo',
  '/api/login',
  '/api/register',
  '/api/auth/google/status',
  '/api/auth/google/start',
  '/api/auth/google/callback',
  '/api/onboarding',
  '/api/logout',
  '/api/demo-user',
  '/api/garages',
  '/api/switch-garage',
  '/api/accept-invitation',
  '/api/invite',
  '/api/invitations',
  '/api/revoke-invitation',
  '/api/password',
  '/api/actions',
  '/api/vehicle-photos',
  '/api/vehicle-photos/delete',
  '/api/send-mail',
  '/api/data-transfer/export',
  '/api/data-transfer/read',
  '/api/data-transfer/preview',
  '/api/data-transfer/import',
]);

async function body(req: IncomingMessage, maxBytes = 128000) {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new UserError('Requête trop volumineuse.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new UserError('Requête JSON invalide.');
  }
}
export function createApi(
  store: Store,
  io: Server,
  googleConfig = googleConfiguration,
  billingConfig?: BillingConfig,
) {
  const google = createGoogleApi(store, io, googleConfig);
  const billing = createBillingApi(store, io, billingConfig);
  const broadcast = async (garageId: string) => broadcastGarage(io, await store.get(garageId));
  return async function api(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = req.url?.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return false;
    const requestId = crypto.randomUUID();
    let session: Session | undefined;
    let action: string | undefined;
    const route = knownRoutes.has(path)
      ? path
      : path.startsWith('/api/vehicle-photos/')
        ? '/api/vehicle-photos/:id'
        : path.startsWith('/api/document/')
          ? '/api/document/:id'
          : '/api/unknown';
    res.setHeader('X-Request-Id', requestId);
    res.once('finish', () => {
      if (path !== '/api/auth/google/callback' && (res.statusCode >= 400 || req.method === 'POST'))
        securityEvent({
          event: 'http',
          outcome: res.statusCode >= 400 ? 'failure' : 'success',
          route,
          method: req.method,
          status: res.statusCode,
          userId: session?.userId,
          garageId: session?.garageId,
          requestId,
          action,
        });
    });
    res.setHeader('Cache-Control', 'no-store');
    securityHeaders(res);
    const send = (status: number, data: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    try {
      if (path === '/api/billing/webhook' && req.method === 'POST') {
        await billing.webhook(req, res, send);
        return true;
      }
      if (req.method !== 'GET' && !validOrigin(req.headers.origin)) {
        send(403, { error: 'Origine de requête refusée.' });
        return true;
      }
      // Read the complete request before taking any mutable garage snapshot.
      const inputBody =
        req.method === 'POST'
          ? await body(
              req,
              path === '/api/vehicle-photos'
                ? 12 * 1024 * 1024
                : path === '/api/account/profile'
                  ? 3 * 1024 * 1024
                  : [
                        '/api/data-transfer/preview',
                        '/api/data-transfer/import',
                        '/api/data-transfer/read',
                      ].includes(path)
                    ? 4 * 1024 * 1024
                    : 128000,
            )
          : undefined;
      session = await store.session(req.headers.cookie, req.headers['x-caragem-demo-user']);
      if (await google(req, res, path, inputBody, session, send)) return true;
      if (await accountSecurityApi(store, io, req, res, path, inputBody, session, send))
        return true;
      if (await accountProfileApi(store, io, req, res, path, inputBody, session, send)) return true;
      if (await accountPreferencesApi(store, io, req, res, path, inputBody, session, send))
        return true;
      if (await accountApi(store, io, req, res, path, inputBody, session, send)) return true;
      if (!session) {
        send(401, { error: 'Connectez-vous pour continuer.' });
        return true;
      }
      const s = await store.get(session.garageId);
      const userId = session.userId;
      const actor = s.users.find((u) => u.id === userId);
      if (!actor) throw new UserError('Session invalide.');
      if (await billing.handle(req, path, session, send)) return true;
      if (await vehiclePhotoApi(store, io, req.method, path, inputBody, session, res)) return true;
      if (await dataTransferApi(store, io, req, res, path, inputBody, session, s, send))
        return true;
      if (req.method === 'POST' && path === '/api/actions') {
        const input = actionSchema.parse(inputBody);
        action = input.type;
        const state = await store.act(session, input);
        await broadcastGarage(io, state);
        send(200, { state: visibleState(state, session.userId) });
        return true;
      }
      if (req.method === 'GET' && path.startsWith('/api/document/')) {
        requirePermission(s, actor, 'garage.view', 'documents.view');
        const documentId = path.slice('/api/document/'.length);
        const d = s.documents.find((d) => d.id === documentId);
        if (!d) throw new UserError('Document introuvable.');
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
        if (s.demo) throw new UserError('Les envois réels sont désactivés dans la démonstration.');
        if (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
          throw new UserError(
            'Configurez le serveur SMTP avant d’envoyer des mails. Le brouillon est conservé.',
          );
        const { result: mailSnapshot } = await store.updateGarage(s.id, (current) => {
          const sender = current.users.find((u) => u.id === userId)!;
          requirePermission(current, sender, 'garage.view', 'customers.view', 'mail.send');
          const mail = current.mails.find((m) => m.id === input.id);
          if (!mail || mail.status === 'sent' || mail.status === 'sending')
            throw new UserError('Ce mail ne peut pas être envoyé.');
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
            requireTLS: true,
            tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
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
          const { state: current } = await store.updateGarage(
            s.id,
            (current) => {
              const m = current.mails.find((m) => m.id === input.id)!;
              m.status = 'sent';
              m.sentAt = new Date().toISOString();
              m.sentBy = actor.name;
              m.error = undefined;
              current.revision++;
              log(current, `Mail envoyé : ${m.subject}`, actor.name);
            },
            true,
          );
          await broadcast(s.id);
          send(200, { state: visibleState(current, session.userId) });
        } catch {
          await store.updateGarage(
            s.id,
            (current) => {
              const m = current.mails.find((m) => m.id === input.id)!;
              m.status = 'failed';
              m.error = 'Échec de l’envoi SMTP. Vérifiez la configuration avant de réessayer.';
              current.revision++;
            },
            true,
          );
          await broadcast(s.id);
          send(502, { error: 'Échec de l’envoi SMTP. Le brouillon est conservé.' });
        }
        return true;
      }
      send(404, { error: 'Route introuvable.' });
    } catch (e) {
      if (e instanceof z.ZodError)
        send(400, { error: 'Vérifiez les champs renseignés et les valeurs numériques.' });
      else if (e instanceof UserError) send(400, { error: e.message });
      else send(500, { error: 'Une erreur interne est survenue.', requestId });
    }
    return true;
  };
}
