import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from 'socket.io';
import {
  accountPreferencesSchema,
  normalizeAccountPreferences,
  type AccountNotification,
} from '../lib/account-preferences.ts';
import { billingAccess } from '../lib/billing.ts';
import { UserError } from '../lib/errors.ts';
import { can } from '../lib/permissions.ts';
import type { Store, Session } from './store.ts';
import type { Reply } from './http.ts';

export async function accountPreferencesApi(
  store: Store,
  io: Server,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  body: unknown,
  session: Session | undefined,
  send: Reply,
): Promise<boolean> {
  if (!['/api/account/preferences', '/api/account/notifications'].includes(path)) return false;
  if (!session?.email) {
    send(401, { error: 'Connectez-vous avec un compte personnel.' });
    return true;
  }
  await store.ready;
  const { rows } = await store.db.query('SELECT preferences FROM accounts WHERE email=$1', [
    session.email,
  ]);
  if (!rows[0]) throw new UserError('Compte introuvable.');
  const preferences = normalizeAccountPreferences(rows[0].preferences);
  if (path === '/api/account/preferences') {
    if (req.method === 'GET') {
      send(200, { preferences });
      return true;
    }
    if (req.method !== 'POST') {
      send(405, { error: 'Méthode non autorisée.' });
      return true;
    }
    const input = accountPreferencesSchema.parse(body);
    if (
      input.defaultGarageId &&
      !(await store.garages(session.email)).some((garage) => garage.id === input.defaultGarageId)
    )
      throw new UserError('Le garage par défaut doit faire partie de vos garages.');
    await store.db.query('UPDATE accounts SET preferences=$2::jsonb WHERE email=$1', [
      session.email,
      JSON.stringify(input),
    ]);
    io.in(`account:${session.email}`).emit('account:changed');
    send(200, { preferences: input });
    return true;
  }
  if (req.method !== 'GET') {
    send(405, { error: 'Méthode non autorisée.' });
    return true;
  }
  const state = await store.get(session.garageId);
  const user = state.users.find((user) => user.id === session.userId);
  if (!user) throw new UserError('Session invalide.');
  // ASVS 8.3.1: every notification is rebuilt from current membership and permissions.
  const notifications: AccountNotification[] = [];
  const garage = { garageId: state.id, garageName: state.settings.name };
  if (can(state, user, 'garage.view')) {
    for (const vehicle of state.vehicles) {
      if (vehicle.stage === 'returned') continue;
      if (
        preferences.notifications.blockages &&
        vehicle.blocker &&
        vehicle.blockerDetails?.assigneeId === user.id
      )
        notifications.push({
          ...garage,
          id: `blockage:${vehicle.id}`,
          kind: 'blockages',
          title: `${vehicle.plate} : blocage à suivre`,
          description: `${vehicle.blocker}${vehicle.blockerDetails.nextAction ? ` · ${vehicle.blockerDetails.nextAction}` : ''}`,
          page: 'garage',
          vehicleId: vehicle.id,
        });
      if (preferences.notifications.assignments)
        for (const task of vehicle.tasks) {
          if (task.status === 'done' || !task.assignees.includes(user.id)) continue;
          notifications.push({
            ...garage,
            id: `task:${vehicle.id}:${task.id}`,
            kind: 'assignments',
            title: `${vehicle.plate} : ${task.title}`,
            description:
              task.status === 'doing'
                ? 'Ce travail vous est attribué et est en cours.'
                : 'Un travail vous attend sur ce véhicule.',
            page: 'tasks',
            vehicleId: vehicle.id,
          });
        }
    }
  }
  if (preferences.notifications.billing && user.role === 'owner' && !state.demo) {
    if (billingAccess(state.billing) === 'readonly')
      notifications.push({
        ...garage,
        id: `billing:${state.id}`,
        kind: 'billing',
        title: 'Garage en lecture seule',
        description: 'L’essai ou la période payée est terminé. Vos données sont conservées.',
        page: 'settings',
      });
    else if (['past_due', 'unpaid', 'incomplete'].includes(state.billing?.status ?? ''))
      notifications.push({
        ...garage,
        id: `billing:${state.id}`,
        kind: 'billing',
        title: 'Paiement à régulariser',
        description: 'Ouvrez la gestion de l’abonnement pour vérifier votre moyen de paiement.',
        page: 'settings',
      });
  }
  if (preferences.notifications.invitations) {
    const { rows: invitations } = await store.db.query(
      "SELECT i.id,i.garage_id,g.state->'settings'->>'name' AS name FROM invitations i JOIN garages g ON g.id=i.garage_id WHERE i.email=$1 AND i.expires>$2 AND g.state->>'demo'='false' AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.email=$1 AND m.garage_id=i.garage_id) ORDER BY i.expires LIMIT 50",
      [session.email, Date.now()],
    );
    for (const invitation of invitations)
      notifications.push({
        id: `invitation:${invitation.id}`,
        kind: 'invitations',
        title: 'Invitation à rejoindre un garage',
        description:
          'Utilisez le lien d’invitation transmis par le responsable pour rejoindre ce garage.',
        garageId: String(invitation.garage_id),
        garageName: String(invitation.name),
      });
  }
  send(200, { notifications: notifications.slice(0, 100) });
  return true;
}
