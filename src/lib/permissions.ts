import { z } from 'zod';
import type { Action, GarageState, User } from './domain.ts';

export const permissions = [
  {
    id: 'garage.view',
    label: 'Voir le garage et les véhicules',
    group: 'Véhicules',
    mechanic: true,
    reception: true,
  },
  {
    id: 'history.view',
    label: 'Consulter les interventions passées',
    group: 'Véhicules',
    mechanic: true,
    reception: true,
  },
  {
    id: 'vehicles.create',
    label: 'Enregistrer une arrivée ou une nouvelle visite',
    group: 'Véhicules',
    mechanic: false,
    reception: true,
  },
  {
    id: 'vehicles.edit',
    label: 'Modifier les informations techniques, la couleur et les notes',
    group: 'Véhicules',
    mechanic: true,
    reception: true,
  },
  {
    id: 'vehicles.stage',
    label: 'Faire avancer un véhicule dans les étapes',
    group: 'Véhicules',
    mechanic: true,
    reception: true,
  },
  {
    id: 'vehicles.return',
    label: 'Remettre un véhicule au client',
    group: 'Véhicules',
    mechanic: false,
    reception: true,
  },
  {
    id: 'tasks.work',
    label: 'Prendre une tâche et enregistrer son travail',
    group: 'Interventions',
    mechanic: true,
    reception: false,
  },
  {
    id: 'tasks.manage',
    label: 'Créer des tâches et attribuer les intervenants',
    group: 'Interventions',
    mechanic: false,
    reception: true,
  },
  {
    id: 'planning.view',
    label: 'Consulter le planning de l’équipe',
    group: 'Planning et clients',
    mechanic: true,
    reception: true,
  },
  {
    id: 'planning.manage',
    label: 'Créer et modifier les rendez-vous',
    group: 'Planning et clients',
    mechanic: false,
    reception: true,
  },
  {
    id: 'customers.view',
    label: 'Consulter les coordonnées des clients',
    group: 'Planning et clients',
    mechanic: false,
    reception: true,
  },
  {
    id: 'customers.manage',
    label: 'Créer et modifier les fiches clients',
    group: 'Planning et clients',
    mechanic: false,
    reception: true,
  },
  {
    id: 'stock.view',
    label: 'Consulter le stock',
    group: 'Stock',
    mechanic: true,
    reception: true,
  },
  {
    id: 'stock.reserve',
    label: 'Réserver et libérer des pièces',
    group: 'Stock',
    mechanic: true,
    reception: true,
  },
  {
    id: 'stock.consume',
    label: 'Déclarer les pièces utilisées',
    group: 'Stock',
    mechanic: true,
    reception: false,
  },
  {
    id: 'stock.manage',
    label: 'Gérer les références, les quantités et les commandes',
    group: 'Stock',
    mechanic: false,
    reception: false,
  },
  {
    id: 'documents.view',
    label: 'Consulter et télécharger les devis et factures',
    group: 'Documents et paiements',
    mechanic: false,
    reception: true,
  },
  {
    id: 'documents.prepare',
    label: 'Préparer des devis et des factures',
    group: 'Documents et paiements',
    mechanic: false,
    reception: true,
  },
  {
    id: 'documents.validate',
    label: 'Valider les documents et enregistrer les accords',
    group: 'Documents et paiements',
    mechanic: false,
    reception: false,
  },
  {
    id: 'payments.manage',
    label: 'Enregistrer les paiements',
    group: 'Documents et paiements',
    mechanic: false,
    reception: false,
  },
  {
    id: 'mail.send',
    label: 'Préparer, valider et envoyer les mails',
    group: 'Administration',
    mechanic: false,
    reception: true,
  },
  {
    id: 'finances.view',
    label: 'Voir les statistiques financières',
    group: 'Administration',
    mechanic: false,
    reception: false,
  },
  {
    id: 'garage.configure',
    label: 'Configurer le garage',
    group: 'Administration',
    mechanic: false,
    reception: false,
  },
  {
    id: 'team.invite',
    label: 'Gérer les invitations',
    group: 'Administration',
    mechanic: false,
    reception: false,
  },
] as const;
export type Permission = (typeof permissions)[number]['id'];
export type PermissionOverrides = Partial<Record<Permission, boolean>>;
export type RolePermissions = Partial<Record<'mechanic' | 'reception', PermissionOverrides>>;
export const permissionSchema = z.enum(permissions.map((p) => p.id));
export const permissionOverridesSchema = z.partialRecord(permissionSchema, z.boolean());
export const rolePermissionsSchema = z
  .object({
    mechanic: permissionOverridesSchema.optional(),
    reception: permissionOverridesSchema.optional(),
  })
  .strict();

const prerequisites: Partial<Record<Permission, Permission[]>> = {
  'history.view': ['garage.view'],
  'vehicles.create': ['garage.view'],
  'vehicles.edit': ['garage.view'],
  'vehicles.stage': ['garage.view'],
  'vehicles.return': ['garage.view'],
  'tasks.work': ['garage.view'],
  'tasks.manage': ['garage.view'],
  'planning.manage': ['planning.view'],
  'customers.manage': ['customers.view'],
  'stock.reserve': ['garage.view', 'stock.view'],
  'stock.consume': ['garage.view', 'stock.view'],
  'stock.manage': ['stock.view'],
  'documents.view': ['garage.view'],
  'documents.prepare': ['documents.view'],
  'documents.validate': ['documents.view'],
  'payments.manage': ['documents.view'],
  'mail.send': ['garage.view', 'customers.view'],
};

export function can(state: GarageState, user: User, permission: Permission): boolean {
  if (user.role === 'owner') return true;
  const granted =
    user.permissions?.[permission] ??
    state.settings.rolePermissions?.[user.role]?.[permission] ??
    permissions.find((p) => p.id === permission)![user.role];
  return granted && (prerequisites[permission] ?? []).every((p) => can(state, user, p));
}

export function requirePermission(state: GarageState, user: User, ...required: Permission[]) {
  // ASVS 8.3.1: enforce the current garage's grants at the trusted service layer.
  if (!required.every((permission) => can(state, user, permission)))
    throw new Error('Vous n’avez pas l’autorisation pour cette action.');
}

export function actionPermissions(action: Action): Permission[] {
  switch (action.type) {
    case 'settings':
      return ['garage.configure'];
    case 'rolePermissions':
    case 'userPermissions':
      return [];
    case 'customer':
      return ['customers.view', 'customers.manage'];
    case 'vehicle':
    case 'revisit':
      return ['garage.view', 'vehicles.create'];
    case 'arrive':
      return ['garage.view', 'planning.view', 'vehicles.create'];
    case 'stage':
      return ['garage.view', action.stage === 'returned' ? 'vehicles.return' : 'vehicles.stage'];
    case 'vehicleColor':
    case 'blocker':
    case 'note':
      return ['garage.view', 'vehicles.edit'];
    case 'addTask':
      return ['garage.view', 'tasks.manage'];
    case 'task':
      return ['garage.view', action.operation === 'assign' ? 'tasks.manage' : 'tasks.work'];
    case 'reserve':
    case 'release':
      return ['garage.view', 'stock.view', 'stock.reserve'];
    case 'consume':
      return ['garage.view', 'stock.view', 'stock.consume'];
    case 'part':
    case 'adjustStock':
    case 'order':
    case 'receive':
      return ['stock.view', 'stock.manage'];
    case 'document':
    case 'convertEstimate':
      return ['garage.view', 'documents.view', 'documents.prepare'];
    case 'acceptEstimate':
    case 'validateDocument':
      return ['garage.view', 'documents.view', 'documents.validate'];
    case 'payment':
      return ['garage.view', 'documents.view', 'payments.manage'];
    case 'mail':
    case 'updateMail':
      return ['garage.view', 'customers.view', 'mail.send'];
    case 'appointment':
      return ['planning.view', 'planning.manage'];
  }
}

export function visibleState(current: GarageState, userId: string): GarageState {
  const user = current.users.find((u) => u.id === userId);
  if (!user) throw new Error('Session invalide.');
  if (user.role === 'owner') return current;
  const state = structuredClone(current);
  const allowed = (p: Permission) => can(current, user, p);
  // ASVS 8.2.3: HTTP and socket payloads share the same field-level filtering.
  if (!allowed('garage.view')) state.vehicles = [];
  else if (!allowed('history.view'))
    state.vehicles = state.vehicles.filter((v) => v.stage !== 'returned');
  const vehicleIds = new Set(state.vehicles.map((v) => v.id));
  if (!allowed('customers.view'))
    state.customers = state.customers.map((c) => ({ ...c, email: '', phone: '' }));
  if (!allowed('planning.view')) state.appointments = [];
  if (!allowed('stock.view')) {
    state.parts = [];
    state.reservations = [];
    state.orders = [];
  } else {
    state.reservations = state.reservations.filter((r) => vehicleIds.has(r.vehicleId));
    if (!allowed('stock.manage')) state.orders = [];
  }
  state.documents = allowed('documents.view')
    ? state.documents.filter((d) => vehicleIds.has(d.vehicleId))
    : [];
  state.mails =
    allowed('mail.send') && allowed('customers.view')
      ? state.mails.filter((m) => vehicleIds.has(m.vehicleId))
      : [];
  state.activity = state.activity.filter(
    (a) => a.permissions?.length && a.permissions.every(allowed),
  );
  state.users = state.users.map((u) => (u.id === userId ? u : { ...u, permissions: undefined }));
  return state;
}
