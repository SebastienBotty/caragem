import { UserError } from '../lib/errors.ts';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { Store, passwordHash, passwordMatches, type Session } from './store.ts';
import { appOrigin, cookie, type Reply } from './http.ts';
import type { ServerResponse } from 'node:http';
import { authAttemptAllowed } from './auth-rate-limit.ts';
import { visibleState, roleLabel } from '../lib/permissions.ts';
import { broadcastGarage } from './realtime.ts';
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(2).max(100).optional(),
  garage: z.string().trim().min(2).max(100).optional(),
  invitation: z.string().min(20).max(100).optional(),
});

export async function accountApi(
  store: Store,
  io: Server,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  body: unknown,
  session: Session | undefined,
  send: Reply,
): Promise<boolean> {
  const broadcast = async (id: string) => broadcastGarage(io, await store.get(id));
  const establish = async (garageId: string, userId: string) => {
    const token = await store.newSession(garageId, userId);
    await store.logout(session);
    if (session) io.in(`session:${session.tokenHash}`).disconnectSockets();
    res.setHeader('Set-Cookie', cookie(token));
  };
  if (req.method === 'GET' && path === '/api/session') {
    const account = session?.email ? await store.account(session.email) : undefined;
    const garage = session ? await store.get(session.garageId) : undefined;
    send(
      200,
      session
        ? {
            state: visibleState(garage!, session.userId),
            onboardingSeen:
              account?.onboardingSeen ??
              garage?.users.find((u) => u.id === session.userId)?.onboardingSeen ??
              false,
            userId: session.userId,
            expires: session.expires,
            account: account
              ? {
                  email: account.email,
                  name: account.name,
                  hasPassword: Boolean(account.hash),
                  googleLinked: account.googleLinked,
                }
              : null,
            garages: account ? await store.garages(account.email) : [],
            smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM),
          }
        : { state: null },
    );
    return true;
  }
  if (req.method === 'GET' && path === '/api/invitation') {
    const params = new URL(req.url!, appOrigin()).searchParams;
    const input = z
      .object({ token: z.string().min(20).max(100), email: z.email() })
      .parse({ token: params.get('token'), email: params.get('email') });
    const invite = await store.invitation(input.token, input.email);
    if (!invite)
      throw new UserError(
        'Invitation invalide ou expirée. Demandez un nouveau lien au responsable.',
      );
    const garage = await store.get(invite.garage_id);
    send(200, {
      email: invite.email,
      garage: garage.settings.name,
      role: invite.role,
      roleName: roleLabel(garage, {
        role: invite.role,
        customRoleId: invite.custom_role_id ?? undefined,
      }),
      expires: invite.expires,
    });
    return true;
  }
  if (req.method === 'POST' && ['/api/demo', '/api/login', '/api/register'].includes(path)) {
    if (!authAttemptAllowed(req.socket.remoteAddress)) {
      send(429, { error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
      return true;
    }
    let target: { garageId: string; userId: string };
    if (path === '/api/demo') {
      const state = await store.create(true);
      target = { garageId: state.id, userId: state.users[0].id };
    } else {
      const input = credentials.parse(body);
      if (path === '/api/register') {
        if (!input.name) throw new UserError('Renseignez votre nom.');
        target = await store.register({
          ...input,
          name: input.name,
          hash: await passwordHash(input.password),
        });
        await broadcast(target.garageId);
      } else {
        const account = await store.account(input.email);
        const matches = await passwordMatches(
          input.password,
          account?.hash ?? (await passwordHash('dummy-password-not-an-account')),
        );
        if (!account || !matches) {
          send(401, { error: 'Adresse mail ou mot de passe incorrect.' });
          return true;
        }
        if (
          account.hash &&
          !account.hash.startsWith('scrypt$') &&
          !(await store.upgradePassword(
            account.email,
            account.hash,
            await passwordHash(input.password),
          ))
        ) {
          send(401, { error: 'Adresse mail ou mot de passe incorrect.' });
          return true;
        }
        if (input.invitation) {
          target = await store.joinGarage(account.email, input.invitation);
          await broadcast(target.garageId);
        } else {
          const garage = (await store.garages(account.email))[0];
          if (!garage) throw new UserError('Aucun garage associé à ce compte.');
          target = { garageId: garage.id, userId: garage.userId };
        }
      }
    }
    await establish(target.garageId, target.userId);
    send(200, { ok: true });
    return true;
  }
  const routes = [
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
  ];
  if (!routes.includes(path)) return false;
  if (!session) {
    send(401, { error: 'Connectez-vous pour continuer.' });
    return true;
  }
  if (req.method === 'GET' && path === '/api/invitations') {
    send(200, { invitations: await store.invitations(session) });
    return true;
  }
  if (req.method !== 'POST') return false;
  if (path === '/api/onboarding') {
    z.object({}).strict().parse(body);
    await store.completeOnboarding(session);
    send(200, { ok: true });
    return true;
  }
  if (path === '/api/logout') {
    await store.logout(session);
    io.in(`session:${session.tokenHash}`).disconnectSockets();
    res.setHeader('Set-Cookie', 'carm_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    send(200, { ok: true });
    return true;
  }
  if (path === '/api/demo-user') {
    const state = await store.get(session.garageId);
    if (!state.demo) throw new UserError('Le changement de profil est réservé à la démonstration.');
    const { userId } = z.object({ userId: z.string() }).parse(body);
    if (!state.users.some((u) => u.id === userId)) throw new UserError('Profil introuvable.');
    send(200, { ok: true, userId });
    return true;
  }
  if (path === '/api/invite') {
    const input = z
      .object({
        email: z.email().max(254),
        role: z.enum(['mechanic', 'reception']),
        customRoleId: z.string().min(1).max(100).optional(),
      })
      .parse(body);
    const token = await store.invite(session, input.email, input.role, input.customRoleId);
    send(200, {
      url: `${appOrigin()}/?invitation=${token}&email=${encodeURIComponent(input.email)}`,
    });
    return true;
  }
  if (path === '/api/revoke-invitation') {
    const { id } = z.object({ id: z.string().max(100) }).parse(body);
    await store.revokeInvitation(session, id);
    send(200, { invitations: await store.invitations(session) });
    return true;
  }
  if (path === '/api/password') {
    const input = z
      .object({ current: z.string().max(128), password: z.string().min(12).max(128) })
      .parse(body);
    const account = session.email ? await store.account(session.email) : undefined;
    if (!account || !(await passwordMatches(input.current, account.hash)))
      throw new UserError('Mot de passe actuel incorrect.');
    await store.changePassword(session, await passwordHash(input.password));
    io.in(`account:${session.email}`).disconnectSockets();
    await establish(session.garageId, session.userId);
    send(200, { ok: true });
    return true;
  }
  if (!session.email) throw new UserError('Cette action nécessite un compte personnel.');
  let target: { garageId: string; userId: string };
  if (path === '/api/garages') {
    const { name } = z.object({ name: z.string().trim().min(2).max(100) }).parse(body);
    target = await store.createGarage(session, name);
  } else if (path === '/api/switch-garage') {
    const { garageId } = z.object({ garageId: z.string().max(100) }).parse(body);
    target = await store.membership(session.email, garageId);
  } else if (path === '/api/accept-invitation') {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(body);
    target = await store.joinGarage(session.email, token);
    await broadcast(target.garageId);
  } else return false;
  await establish(target.garageId, target.userId);
  send(200, { ok: true });
  return true;
}
