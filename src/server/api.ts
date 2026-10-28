import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from 'socket.io';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { Store, passwordHash, passwordMatches } from './store.ts';
import { actionSchema, log, uid, type User } from '../lib/domain.ts';

const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(2).max(100).optional(),
  garage: z.string().trim().min(2).max(100).optional(),
  invitation: z.string().max(100).optional(),
});
const attempts = new Map<string, { count: number; until: number }>();
export const appOrigin = () => process.env.APP_ORIGIN ?? 'http://localhost:3000';
export function validOrigin(origin?: string) {
  return origin === appOrigin() || (!process.env.APP_ORIGIN && origin === 'http://127.0.0.1:3000');
}
export function cookie(token: string) {
  return `carm_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${appOrigin().startsWith('https:') ? '; Secure' : ''}`;
}
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
export function createApi(store: Store, io: Server) {
  const broadcast = (garageId: string) => io.to(garageId).emit('garage:state', store.get(garageId));
  const disconnect = (hash?: string) => {
    if (hash) io.in(`session:${hash}`).disconnectSockets();
  };
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
      const session = store.session(req.headers.cookie);
      if (req.method === 'GET' && path === '/api/session') {
        send(
          200,
          session
            ? {
                state: store.get(session.garageId),
                userId: session.userId,
                smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM),
              }
            : { state: null },
        );
        return true;
      }
      if (req.method === 'POST' && ['/api/demo', '/api/login', '/api/register'].includes(path)) {
        const key = req.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
        const rate = attempts.get(key) ?? { count: 0, until: now + 15 * 60000 };
        rate.count++;
        attempts.set(key, rate);
        if (rate.count > 40) {
          send(429, {
            error: 'Trop de tentatives. Réessayez dans 15 minutes.',
          });
          return true;
        }
        let garageId: string;
        let userId: string;
        if (path === '/api/demo') {
          const s = store.create(true);
          garageId = s.id;
          userId = s.users[0].id;
        } else {
          const input = credentials.parse(inputBody);
          const existing = store.account(input.email);
          if (path === '/api/login') {
            // Dummy work keeps failed-email and failed-password responses comparable.
            const hash = existing?.hash ?? (await passwordHash('dummy-password-not-an-account'));
            const matches = await passwordMatches(input.password, hash);
            if (!existing || !matches) {
              send(401, { error: 'Adresse mail ou mot de passe incorrect.' });
              return true;
            }
            garageId = existing.garage_id;
            userId = existing.user_id;
          } else {
            if (existing) throw new Error('Cette adresse possède déjà un compte. Connectez-vous.');
            if (!input.name) throw new Error('Renseignez votre nom.');
            const hash = await passwordHash(input.password);
            if (input.invitation) {
              const invite = store.invitation(input.invitation, input.email);
              if (!invite) throw new Error('Invitation invalide ou expirée.');
              const s = store.get(invite.garage_id);
              const u: User = {
                id: uid(),
                name: input.name,
                role: invite.role,
                color: '#8b78b7',
              };
              s.users.push(u);
              s.revision++;
              store.save(s);
              garageId = s.id;
              userId = u.id;
              store.useInvitation(input.invitation);
            } else {
              const s = store.create(false);
              s.users[0].name = input.name;
              s.settings.name = input.garage ?? 'Mon garage';
              store.save(s);
              garageId = s.id;
              userId = s.users[0].id;
            }
            store.addAccount(input.email, hash, garageId, userId);
            broadcast(garageId);
          }
        }
        store.logout(session);
        disconnect(session?.tokenHash);
        res.setHeader('Set-Cookie', cookie(store.newSession(garageId, userId)));
        send(200, { ok: true });
        return true;
      }
      if (!session) {
        send(401, { error: 'Connectez-vous pour continuer.' });
        return true;
      }
      const s = store.get(session.garageId);
      const actor = s.users.find((u) => u.id === session.userId);
      if (!actor) {
        send(401, { error: 'Session invalide.' });
        return true;
      }
      if (req.method === 'POST' && path === '/api/logout') {
        store.logout(session);
        disconnect(session.tokenHash);
        res.setHeader('Set-Cookie', 'carm_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
        send(200, { ok: true });
        return true;
      }
      if (req.method === 'POST' && path === '/api/demo-user') {
        if (!s.demo) throw new Error('Le changement de profil est réservé à la démonstration.');
        const input = z.object({ userId: z.string() }).parse(inputBody);
        if (!s.users.some((u) => u.id === input.userId)) throw new Error('Profil introuvable.');
        store.logout(session);
        disconnect(session.tokenHash);
        res.setHeader('Set-Cookie', cookie(store.newSession(s.id, input.userId)));
        send(200, { ok: true });
        return true;
      }
      if (req.method === 'POST' && path === '/api/actions') {
        const next = store.act(session, actionSchema.parse(inputBody));
        io.to(s.id).emit('garage:state', next);
        send(200, { state: next });
        return true;
      }
      if (req.method === 'POST' && path === '/api/invite') {
        const input = z
          .object({
            email: z.email().max(254),
            role: z.enum(['reception', 'mechanic']),
          })
          .parse(inputBody);
        const token = store.invite(session, input.email, input.role);
        send(200, {
          url: `${appOrigin()}/?invitation=${token}&email=${encodeURIComponent(input.email)}`,
        });
        return true;
      }
      if (req.method === 'POST' && path === '/api/password') {
        const input = z
          .object({
            current: z.string().max(128),
            password: z.string().min(12).max(128),
          })
          .parse(inputBody);
        const row = store.db
          .prepare('SELECT email,hash FROM accounts WHERE garage_id=? AND user_id=?')
          .get(s.id, actor.id) as { email: string; hash: string } | undefined;
        if (!row || !(await passwordMatches(input.current, row.hash)))
          throw new Error('Mot de passe actuel incorrect.');
        store.db
          .prepare('UPDATE accounts SET hash=? WHERE email=?')
          .run(await passwordHash(input.password), row.email);
        store.db
          .prepare('DELETE FROM sessions WHERE garage_id=? AND user_id=?')
          .run(s.id, actor.id);
        io.in(`user:${actor.id}`).disconnectSockets();
        res.setHeader('Set-Cookie', cookie(store.newSession(s.id, actor.id)));
        send(200, { ok: true });
        return true;
      }
      if (req.method === 'GET' && path.startsWith('/api/document/')) {
        const documentId = path.slice('/api/document/'.length);
        const d = s.documents.find((d) => d.id === documentId);
        if (!d) throw new Error('Document introuvable.');
        const { documentPdf } = await import('./pdf.ts');
        const bytes = await documentPdf(s, d);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${d.number}.pdf"`);
        res.end(Buffer.from(bytes));
        return true;
      }
      if (req.method === 'POST' && path === '/api/send-mail') {
        if (actor.role === 'mechanic')
          throw new Error('Envoi réservé au responsable ou à l’accueil.');
        const input = z.object({ id: z.string() }).parse(inputBody);
        const mail = s.mails.find((m) => m.id === input.id);
        if (!mail || mail.status === 'sent' || mail.status === 'sending')
          throw new Error('Ce mail ne peut pas être envoyé.');
        if (s.demo) throw new Error('Les envois réels sont désactivés dans la démonstration.');
        if (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
          throw new Error(
            'Configurez le serveur SMTP avant d’envoyer des mails. Le brouillon est conservé.',
          );
        const mailSnapshot = structuredClone(mail);
        mail.status = 'sending';
        s.revision++;
        store.save(s);
        broadcast(s.id);
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
          const current = store.get(s.id);
          const m = current.mails.find((m) => m.id === mail.id)!;
          m.status = 'sent';
          m.sentAt = new Date().toISOString();
          m.sentBy = actor.name;
          m.error = undefined;
          current.revision++;
          log(current, `Mail envoyé : ${m.subject}`, actor.name);
          store.save(current);
          broadcast(s.id);
          send(200, { state: current });
        } catch {
          const current = store.get(s.id);
          const m = current.mails.find((m) => m.id === mail.id)!;
          m.status = 'failed';
          m.error = 'Échec de l’envoi SMTP. Vérifiez la configuration avant de réessayer.';
          current.revision++;
          store.save(current);
          broadcast(s.id);
          send(502, { error: m.error });
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
