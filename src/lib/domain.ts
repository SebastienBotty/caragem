import { z } from 'zod';
import { customerVehicles, plateKey, type CustomerVehicle } from './customer-vehicles.ts';
import {
  actionPermissions,
  can,
  requirePermission,
  permissionOverridesSchema,
  rolePermissionsSchema,
  type Permission,
  type PermissionOverrides,
  type RolePermissions,
} from './permissions.ts';

export const stages = [
  { id: 'reception', label: 'Réception', color: '#6987b7', short: 'Arrivées' },
  {
    id: 'diagnosis',
    label: 'Diagnostic & devis',
    color: '#9b7cbe',
    short: 'Diagnostic',
  },
  {
    id: 'waiting',
    label: 'À intervenir',
    color: '#dfaa4b',
    short: 'En attente',
  },
  {
    id: 'workshop',
    label: 'En intervention',
    color: '#4778db',
    short: 'Atelier',
  },
  {
    id: 'ready',
    label: 'Prête à récupérer',
    color: '#43a88b',
    short: 'Terminées',
  },
] as const;
export type Stage = (typeof stages)[number]['id'] | 'returned';
export type User = {
  id: string;
  name: string;
  role: 'owner' | 'reception' | 'mechanic';
  color: string;
  permissions?: PermissionOverrides;
  onboardingSeen?: boolean;
};
export type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
};
export type Task = {
  id: string;
  title: string;
  assignees: string[];
  status: 'todo' | 'doing' | 'done';
  minutes: number;
};
export type Vehicle = {
  id: string;
  plate: string;
  model: string;
  color: string;
  customerId: string;
  mileage: number;
  stage: Stage;
  issue: string;
  blocker: string;
  priority: boolean;
  due: string;
  tasks: Task[];
  notes: { id: string; text: string; author: string; at: string }[];
  createdAt: string;
  visit: number;
};
export type Part = {
  id: string;
  reference: string;
  name: string;
  supplier: string;
  stock: number;
  min: number;
  cost: number;
  price: number;
};
export type Reservation = {
  id: string;
  partId: string;
  vehicleId: string;
  quantity: number;
  consumed: boolean;
};
export type Purchase = {
  id: string;
  reference: string;
  supplier: string;
  partId: string;
  vehicleId: string;
  quantity: number;
  received: number;
  due: string;
  unitCost: number;
};
export type Line = { label: string; quantity: number; unitPrice: number };
export type Document = {
  id: string;
  number: string;
  kind: 'estimate' | 'invoice';
  vehicleId: string;
  lines: Line[];
  taxRate: number;
  paid: number;
  accepted: boolean;
  validated?: boolean;
  createdAt: string;
};
export type Mail = {
  id: string;
  vehicleId: string;
  to: string;
  subject: string;
  body: string;
  documentId?: string;
  status: 'draft' | 'sending' | 'sent' | 'failed';
  error?: string;
  sentAt?: string;
  sentBy?: string;
};
export type Appointment = {
  id: string;
  customerId: string;
  model: string;
  plate: string;
  reason: string;
  at: string;
  arrived: boolean;
};
export type GarageState = {
  id: string;
  demo: boolean;
  revision: number;
  settings: {
    name: string;
    country: 'FR' | 'BE';
    address: string;
    businessId: string;
    modules: Record<string, number>;
    configured: boolean;
    rolePermissions?: RolePermissions;
  };
  users: User[];
  customers: Customer[];
  vehicles: Vehicle[];
  savedVehicles?: CustomerVehicle[];
  parts: Part[];
  reservations: Reservation[];
  orders: Purchase[];
  documents: Document[];
  mails: Mail[];
  appointments: Appointment[];
  activity: { id: string; text: string; author: string; at: string; permissions?: Permission[] }[];
};

const text = z.string().trim().min(1).max(200);
const optionalText = z.string().trim().max(2000);
const id = z.string().min(1).max(100);
const count = z.number().int().min(1).max(10000);
const cents = z.number().int().min(0).max(100_000_000);
const date = z
  .string()
  .max(40)
  .refine((v) => Number.isFinite(Date.parse(v)), 'Date invalide');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const stage = z.enum(['reception', 'diagnosis', 'waiting', 'workshop', 'ready', 'returned']);
export const lineSchema = z.object({
  label: text,
  quantity: z.number().min(0.01).max(10000),
  unitPrice: cents,
});

// ASVS V2.2: allowlisted operations and bounded input at the server boundary.
export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('customer'),
    name: text,
    email: z.email().max(254),
    phone: optionalText,
  }),
  z.object({
    type: z.literal('vehicle'),
    customerId: id,
    existingVehicleId: id.optional(),
    model: text,
    plate: text,
    issue: text,
    mileage: z.number().int().min(0).max(5_000_000),
    color,
    due: date,
    priority: z.boolean(),
  }),
  z.object({ type: z.literal('stage'), id, stage }),
  z.object({ type: z.literal('vehicleColor'), id, color }),
  z.object({ type: z.literal('blocker'), id, text: optionalText }),
  z.object({
    type: z.literal('note'),
    id,
    text: z.string().trim().min(1).max(4000),
  }),
  z.object({ type: z.literal('addTask'), vehicleId: id, title: text }),
  z.object({
    type: z.literal('task'),
    vehicleId: id,
    taskId: id,
    operation: z.enum(['claim', 'start', 'finish', 'reopen', 'assign']),
    assignees: z.array(id).max(20).optional(),
    minutes: z.number().int().min(0).max(100000).optional(),
  }),
  z.object({
    type: z.literal('reserve'),
    vehicleId: id,
    partId: id,
    quantity: count,
  }),
  z.object({ type: z.literal('consume'), id }),
  z.object({ type: z.literal('release'), id }),
  z.object({
    type: z.literal('part'),
    reference: text,
    name: text,
    supplier: text,
    stock: z.number().int().min(0).max(100000),
    min: z.number().int().min(0).max(100000),
    cost: cents,
    price: cents,
  }),
  z.object({
    type: z.literal('adjustStock'),
    id,
    delta: z.number().int().min(-100000).max(100000),
    reason: text,
  }),
  z.object({
    type: z.literal('order'),
    reference: text,
    supplier: text,
    partId: id,
    vehicleId: z.string().max(100),
    quantity: count,
    due: date,
    unitCost: cents,
  }),
  z.object({ type: z.literal('receive'), id, quantity: count }),
  z.object({
    type: z.literal('document'),
    vehicleId: id,
    kind: z.enum(['estimate', 'invoice']),
    lines: z.array(lineSchema).min(1).max(100),
    taxRate: z.number().min(0).max(30),
  }),
  z.object({ type: z.literal('acceptEstimate'), id, evidence: text }),
  z.object({ type: z.literal('validateDocument'), id }),
  z.object({ type: z.literal('convertEstimate'), id }),
  z.object({
    type: z.literal('payment'),
    id,
    amount: cents.refine((v) => v > 0),
  }),
  z.object({
    type: z.literal('mail'),
    vehicleId: id,
    to: z.email().max(254),
    subject: text,
    body: z.string().trim().min(1).max(10000),
    documentId: id.optional(),
  }),
  z.object({
    type: z.literal('updateMail'),
    id,
    to: z.email().max(254),
    subject: text,
    body: z.string().trim().min(1).max(10000),
    documentId: id.optional(),
  }),
  z.object({
    type: z.literal('appointment'),
    customerId: id,
    model: text,
    plate: text,
    reason: text,
    at: date,
  }),
  z.object({ type: z.literal('arrive'), id }),
  z.object({ type: z.literal('revisit'), id, issue: text, due: date }),
  z.object({ type: z.literal('rolePermissions'), permissions: rolePermissionsSchema }),
  z.object({
    type: z.literal('userPermissions'),
    userId: id,
    permissions: permissionOverridesSchema,
  }),
  z.object({
    type: z.literal('settings'),
    name: text,
    country: z.enum(['FR', 'BE']),
    address: optionalText,
    businessId: optionalText,
    rolePermissions: rolePermissionsSchema.optional(),
    modules: z.object({
      reception: z.number().int().min(1).max(10),
      diagnosis: z.number().int().min(1).max(10),
      waiting: z.number().int().min(1).max(10),
      workshop: z.number().int().min(1).max(10),
      ready: z.number().int().min(1).max(10),
    }),
  }),
]);
export type Action = z.infer<typeof actionSchema>;
export const uid = () => crypto.randomUUID();
export const money = (cents: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
export const totals = (lines: Line[], rate: number) => {
  const net = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice), 0);
  const tax = Math.round((net * rate) / 100);
  return { net, tax, gross: net + tax };
};
export const available = (s: GarageState, partId: string) =>
  (s.parts.find((p) => p.id === partId)?.stock ?? 0) -
  s.reservations
    .filter((r) => r.partId === partId && !r.consumed)
    .reduce((n, r) => n + r.quantity, 0);
export const capacity = (stageId: string, modules: number) =>
  modules * (stageId === 'workshop' || stageId === 'diagnosis' ? 1 : 4);
export function log(s: GarageState, text: string, author: string, permissions?: Permission[]) {
  s.activity.unshift({ id: uid(), text, author, at: new Date().toISOString(), permissions });
  s.activity = s.activity.slice(0, 500);
}
function requireItem<T extends { id: string }>(items: T[], itemId: string): T {
  const item = items.find((i) => i.id === itemId);
  if (!item) throw new Error('Élément introuvable dans ce garage.');
  return item;
}
export function applyAction(current: GarageState, input: Action, actor: User): GarageState {
  const a = actionSchema.parse(input);
  const s = structuredClone(current);
  if (!s.users.some((u) => u.id === actor.id && u.role === actor.role))
    throw new Error('Utilisateur non autorisé.');
  actor = s.users.find((u) => u.id === actor.id)!;
  requirePermission(s, actor, ...actionPermissions(a));
  const now = new Date().toISOString();
  let message = '';
  const vehicle = (id: string) => {
    const v = requireItem(s.vehicles, id);
    requirePermission(
      s,
      actor,
      'garage.view',
      ...(v.stage === 'returned' ? ['history.view' as const] : []),
    );
    return v;
  };
  const activeVehicle = (id: string) => {
    const v = vehicle(id);
    if (v.stage === 'returned')
      throw new Error('Ce dossier est clôturé. Créez une nouvelle visite.');
    return v;
  };
  switch (a.type) {
    case 'vehicleColor': {
      const v = activeVehicle(a.id);
      v.color = a.color;
      message = `${v.plate} : couleur du véhicule mise à jour`;
      break;
    }
    case 'customer': {
      s.customers.push({
        id: uid(),
        name: a.name,
        email: a.email,
        phone: a.phone,
      });
      message = `Client ajouté : ${a.name}`;
      break;
    }
    case 'vehicle': {
      requireItem(s.customers, a.customerId);
      const existing = a.existingVehicleId
        ? requireItem(s.vehicles, a.existingVehicleId)
        : undefined;
      if (existing && existing.customerId !== a.customerId)
        throw new Error('Ce véhicule n’appartient pas au client sélectionné.');
      const plate = (existing?.plate ?? a.plate).trim().toUpperCase();
      if (s.vehicles.some((v) => plateKey(v.plate) === plateKey(plate) && v.stage !== 'returned'))
        throw new Error('Ce véhicule est déjà présent dans le garage.');
      const visit =
        Math.max(
          0,
          ...s.vehicles.filter((v) => plateKey(v.plate) === plateKey(plate)).map((v) => v.visit),
        ) + 1;
      s.vehicles.push({
        ...a,
        id: uid(),
        plate,
        model: existing?.model ?? a.model,
        stage: 'reception',
        blocker: '',
        tasks: [
          {
            id: uid(),
            title: a.issue,
            assignees: [],
            status: 'todo',
            minutes: 0,
          },
        ],
        notes: [],
        createdAt: now,
        visit,
      });
      message = `${plate} est arrivé à la réception`;
      break;
    }
    case 'stage': {
      const v = activeVehicle(a.id);
      if (
        (a.stage === 'returned' || a.stage === 'ready') &&
        s.reservations.some((r) => r.vehicleId === v.id && !r.consumed)
      )
        throw new Error('Utilisez ou libérez les pièces réservées avant la validation.');
      if (a.stage === 'ready' && (v.tasks.some((t) => t.status !== 'done') || v.blocker))
        throw new Error('Terminez les tâches et levez les blocages avant de valider le contrôle.');
      if (a.stage === 'returned' && v.stage !== 'ready')
        throw new Error('Validez le véhicule comme prêt avant la restitution.');
      if (a.stage === v.stage) throw new Error('Le véhicule se trouve déjà dans cette zone.');
      v.stage = a.stage;
      message = `${v.plate} → ${stages.find((x) => x.id === a.stage)?.label ?? 'Remis au client'}`;
      break;
    }
    case 'blocker': {
      const v = activeVehicle(a.id);
      v.blocker = a.text;
      message = `${v.plate} : ${a.text ? `blocage — ${a.text}` : 'blocage levé'}`;
      break;
    }
    case 'note': {
      const v = activeVehicle(a.id);
      v.notes.unshift({ id: uid(), text: a.text, author: actor.name, at: now });
      message = `Note ajoutée sur ${v.plate}`;
      break;
    }
    case 'addTask': {
      const v = activeVehicle(a.vehicleId);
      if (v.stage === 'ready')
        throw new Error('Replacez le véhicule en atelier avant d’ajouter des travaux.');
      v.tasks.push({
        id: uid(),
        title: a.title,
        status: 'todo',
        assignees: [],
        minutes: 0,
      });
      message = `Travail ajouté sur ${v.plate} : ${a.title}`;
      break;
    }
    case 'task': {
      const v = activeVehicle(a.vehicleId);
      const t = requireItem(v.tasks, a.taskId);
      if (v.stage === 'ready')
        throw new Error('Replacez le véhicule en atelier pour modifier les travaux.');
      if (a.operation === 'claim') {
        if (t.status !== 'todo')
          throw new Error('L’état de la tâche a changé. Actualisez votre vue.');
        if (t.assignees.length)
          throw new Error('Cette tâche est déjà attribuée. Demandez à être ajouté.');
        t.assignees = [actor.id];
      } else if (a.operation === 'assign') {
        if (!a.assignees) throw new Error('Sélectionnez les intervenants.');
        a.assignees.forEach((id) => requireItem(s.users, id));
        t.assignees = [...new Set(a.assignees)];
      } else {
        if (!can(s, actor, 'tasks.manage') && !t.assignees.includes(actor.id))
          throw new Error('Prenez cette tâche avant de la modifier.');
        if (a.operation === 'start') {
          if (v.stage !== 'workshop') requirePermission(s, actor, 'vehicles.stage');
          if (t.status !== 'todo') throw new Error('L’état de la tâche a changé.');
          if (!t.assignees.length) t.assignees.push(actor.id);
          t.status = 'doing';
          v.stage = 'workshop';
        }
        if (a.operation === 'finish') {
          if (t.status !== 'doing') throw new Error('L’état de la tâche a changé.');
          t.status = 'done';
          t.minutes = a.minutes ?? t.minutes;
        }
        if (a.operation === 'reopen') {
          if (t.status !== 'done') throw new Error('L’état de la tâche a changé.');
          t.status = 'todo';
        }
      }
      message = `${v.plate} · ${t.title} : ${a.operation === 'finish' ? 'terminé' : a.operation === 'start' ? 'commencé' : 'attribution mise à jour'}`;
      break;
    }
    case 'part': {
      if (s.parts.some((p) => p.reference === a.reference))
        throw new Error('Cette référence existe déjà.');
      s.parts.push({ ...a, id: uid() });
      message = `Pièce ajoutée : ${a.name}`;
      break;
    }
    case 'reserve': {
      const v = activeVehicle(a.vehicleId);
      const p = requireItem(s.parts, a.partId);
      if (available(s, p.id) < a.quantity) throw new Error('Stock disponible insuffisant.');
      s.reservations.push({
        id: uid(),
        vehicleId: v.id,
        partId: p.id,
        quantity: a.quantity,
        consumed: false,
      });
      message = `${a.quantity} × ${p.name} réservé pour ${v.plate}`;
      break;
    }
    case 'consume': {
      const r = requireItem(s.reservations, a.id);
      activeVehicle(r.vehicleId);
      const p = requireItem(s.parts, r.partId);
      if (r.consumed) throw new Error('Cette réservation est déjà utilisée.');
      if (p.stock < r.quantity) throw new Error('Stock insuffisant.');
      p.stock -= r.quantity;
      r.consumed = true;
      message = `${p.name} monté sur ${vehicle(r.vehicleId).plate}`;
      break;
    }
    case 'release': {
      const r = requireItem(s.reservations, a.id);
      vehicle(r.vehicleId);
      if (r.consumed) throw new Error('Une pièce utilisée ne peut pas être libérée.');
      s.reservations = s.reservations.filter((x) => x.id !== r.id);
      message = 'Réservation de pièce libérée';
      break;
    }
    case 'adjustStock': {
      const p = requireItem(s.parts, a.id);
      if (available(s, p.id) + a.delta < 0)
        throw new Error('Stock disponible insuffisant pour cet ajustement.');
      p.stock += a.delta;
      message = `Stock ${p.reference} : ${a.delta > 0 ? '+' : ''}${a.delta} · ${a.reason}`;
      break;
    }
    case 'order': {
      requireItem(s.parts, a.partId);
      if (a.vehicleId) activeVehicle(a.vehicleId);
      s.orders.push({ ...a, id: uid(), received: 0 });
      message = `Commande ${a.reference} enregistrée`;
      break;
    }
    case 'receive': {
      const o = requireItem(s.orders, a.id);
      if (o.received + a.quantity > o.quantity)
        throw new Error('La réception dépasse la quantité restante.');
      o.received += a.quantity;
      requireItem(s.parts, o.partId).stock += a.quantity;
      message = `${o.reference} : ${a.quantity} pièce(s) réceptionnée(s)`;
      break;
    }
    case 'document': {
      vehicle(a.vehicleId);
      const n = s.documents.filter((d) => d.kind === a.kind).length + 1;
      const d: Document = {
        ...a,
        id: uid(),
        number: `${a.kind === 'estimate' ? 'DEV' : 'FAC'}-${new Date().getFullYear()}-${String(n).padStart(3, '0')}`,
        paid: 0,
        accepted: false,
        validated: false,
        createdAt: now,
      };
      s.documents.push(d);
      message = `Brouillon ${d.number} créé`;
      break;
    }
    case 'acceptEstimate': {
      const d = requireItem(s.documents, a.id);
      vehicle(d.vehicleId);
      if (d.kind !== 'estimate') throw new Error('Ce document n’est pas un devis.');
      d.accepted = true;
      message = `${d.number} : accord enregistré · ${a.evidence}`;
      break;
    }
    case 'validateDocument': {
      const d = requireItem(s.documents, a.id);
      vehicle(d.vehicleId);
      if (d.kind !== 'invoice') throw new Error('Enregistrez l’accord du client sur le devis.');
      if (d.validated) throw new Error('Cette facture est déjà validée.');
      d.validated = true;
      message = `${d.number} : facture validée`;
      break;
    }
    case 'convertEstimate': {
      const d = requireItem(s.documents, a.id);
      vehicle(d.vehicleId);
      if (d.kind !== 'estimate' || !d.accepted)
        throw new Error('Enregistrez d’abord l’accord sur le devis.');
      if (s.documents.some((x) => x.kind === 'invoice' && x.vehicleId === d.vehicleId))
        throw new Error('Une facture existe déjà pour cette intervention.');
      return applyAction(
        current,
        {
          type: 'document',
          vehicleId: d.vehicleId,
          kind: 'invoice',
          lines: d.lines,
          taxRate: d.taxRate,
        },
        actor,
      );
    }
    case 'payment': {
      const d = requireItem(s.documents, a.id);
      if (d.kind !== 'invoice') throw new Error('Un paiement doit être associé à une facture.');
      vehicle(d.vehicleId);
      if (!d.validated && !(d.validated === undefined && d.paid > 0))
        throw new Error('Validez la facture avant d’enregistrer un paiement.');
      if (d.paid + a.amount > totals(d.lines, d.taxRate).gross)
        throw new Error('Le montant dépasse le solde restant.');
      d.paid += a.amount;
      message = `${d.number} : règlement de ${money(a.amount)}`;
      break;
    }
    case 'mail': {
      vehicle(a.vehicleId);
      if (a.documentId) requirePermission(s, actor, 'documents.view');
      if (a.documentId && requireItem(s.documents, a.documentId).vehicleId !== a.vehicleId)
        throw new Error('Le document doit appartenir à ce dossier.');
      s.mails.unshift({ ...a, id: uid(), status: 'draft' });
      message = `Mail préparé : ${a.subject}`;
      break;
    }
    case 'updateMail': {
      const m = requireItem(s.mails, a.id);
      vehicle(m.vehicleId);
      if (a.documentId) requirePermission(s, actor, 'documents.view');
      if (m.status === 'sent' || m.status === 'sending')
        throw new Error('Ce mail ne peut plus être modifié.');
      if (a.documentId && requireItem(s.documents, a.documentId).vehicleId !== m.vehicleId)
        throw new Error('Le document doit appartenir à ce dossier.');
      Object.assign(m, {
        to: a.to,
        subject: a.subject,
        body: a.body,
        documentId: a.documentId,
        status: 'draft',
        error: undefined,
      });
      message = `Brouillon de mail modifié`;
      break;
    }
    case 'appointment': {
      requireItem(s.customers, a.customerId);
      s.appointments.push({
        ...a,
        id: uid(),
        plate: a.plate.toUpperCase(),
        arrived: false,
      });
      message = `Rendez-vous enregistré pour ${a.plate.toUpperCase()}`;
      break;
    }
    case 'arrive': {
      const ap = requireItem(s.appointments, a.id);
      if (ap.arrived) throw new Error('Cette arrivée a déjà été enregistrée.');
      const next = applyAction(
        s,
        {
          type: 'vehicle',
          customerId: ap.customerId,
          model: ap.model,
          plate: ap.plate,
          issue: ap.reason,
          mileage: 0,
          color: '#7294b8',
          due: ap.at,
          priority: false,
        },
        actor,
      );
      requireItem(next.appointments, ap.id).arrived = true;
      return next;
    }
    case 'revisit': {
      const old = vehicle(a.id);
      if (old.stage !== 'returned') throw new Error('Ce véhicule a déjà une visite en cours.');
      if (
        s.vehicles.some((v) => plateKey(v.plate) === plateKey(old.plate) && v.stage !== 'returned')
      )
        throw new Error('Une visite est déjà en cours.');
      const saved = customerVehicles(s, old.customerId).find(
        (v) => plateKey(v.plate) === plateKey(old.plate),
      )!;
      s.vehicles.push({
        ...structuredClone(old),
        model: saved.model,
        color: saved.color,
        mileage: saved.mileage,
        id: uid(),
        stage: 'reception',
        issue: a.issue,
        due: a.due,
        blocker: '',
        priority: false,
        tasks: [
          {
            id: uid(),
            title: a.issue,
            assignees: [],
            status: 'todo',
            minutes: 0,
          },
        ],
        notes: [],
        createdAt: now,
        visit:
          Math.max(
            ...s.vehicles
              .filter((v) => plateKey(v.plate) === plateKey(old.plate))
              .map((v) => v.visit),
          ) + 1,
      });
      message = `Nouvelle visite de ${old.plate}`;
      break;
    }
    case 'settings': {
      if (a.rolePermissions && actor.role !== 'owner')
        throw new Error('Seul le patron peut modifier les permissions.');
      s.settings = { ...s.settings, ...a, configured: true };
      message = 'Configuration du garage mise à jour';
      break;
    }
    case 'rolePermissions': {
      if (actor.role !== 'owner') throw new Error('Seul le patron peut modifier les permissions.');
      s.settings.rolePermissions = a.permissions;
      message = 'Permissions des rôles mises à jour';
      break;
    }
    case 'userPermissions': {
      if (actor.role !== 'owner') throw new Error('Seul le patron peut modifier les permissions.');
      const user = requireItem(s.users, a.userId);
      if (user.role === 'owner') throw new Error('Le patron conserve toujours un accès complet.');
      user.permissions = a.permissions;
      message = `Permissions individuelles de ${user.name} mises à jour`;
      break;
    }
  }
  s.revision += 1;
  log(s, message, actor.name, actionPermissions(a));
  return s;
}

export function createSeed(garageId: string, demo: boolean): GarageState {
  const today = new Date();
  const time = (hour: number, days = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const users: User[] = [
    { id: uid(), name: 'Alex Martin', role: 'owner', color: '#4166d5' },
    { id: uid(), name: 'Thomas Leroy', role: 'mechanic', color: '#d99668' },
    { id: uid(), name: 'Sarah Bernard', role: 'mechanic', color: '#8b78b7' },
    { id: uid(), name: 'Lucas Petit', role: 'mechanic', color: '#65a98b' },
  ];
  const customers: Customer[] = [
    {
      id: uid(),
      name: 'Sophie Dubois',
      email: 'sophie.dubois@example.com',
      phone: '06 12 34 56 78',
    },
    {
      id: uid(),
      name: 'Pierre Moreau',
      email: 'pierre.moreau@example.com',
      phone: '06 23 45 67 89',
    },
    {
      id: uid(),
      name: 'Camille Laurent',
      email: 'camille.laurent@example.com',
      phone: '06 34 56 78 90',
    },
    {
      id: uid(),
      name: 'Julien Rousseau',
      email: 'julien.rousseau@example.com',
      phone: '06 45 67 89 01',
    },
    {
      id: uid(),
      name: 'Emma Lefebvre',
      email: 'emma.lefebvre@example.com',
      phone: '06 56 78 90 12',
    },
    {
      id: uid(),
      name: 'Marc Vincent',
      email: 'marc.vincent@example.com',
      phone: '06 67 89 01 23',
    },
  ];
  const specs: [string, string, string, Stage, string, number, boolean, string][] = [
    ['Peugeot 308', 'GH-284-LP', '#b5c9cf', 'reception', 'Révision des 60 000 km', 0, false, ''],
    [
      'Renault Clio',
      'FT-619-AB',
      '#bb6870',
      'diagnosis',
      'Voyant moteur allumé',
      1,
      false,
      'Accord client attendu',
    ],
    [
      'Volkswagen Golf',
      'EZ-903-KM',
      '#708ba9',
      'waiting',
      'Remplacement embrayage',
      2,
      false,
      'Pièce attendue',
    ],
    ['BMW Série 3', 'GP-472-NX', '#3e6978', 'workshop', 'Disques et plaquettes avant', 1, true, ''],
    ['Fiat 500', 'FK-152-RE', '#dbbf76', 'workshop', 'Vidange et filtres', 3, false, ''],
    ['Audi A3', 'HB-801-VC', '#a5aabb', 'workshop', 'Diagnostic électrique', 2, false, ''],
    ['Toyota Yaris', 'GN-736-DS', '#79a58c', 'ready', 'Entretien annuel', 3, false, ''],
    ['Citroën C3', 'FE-428-TB', '#d3d9db', 'ready', 'Remplacement des pneus', 1, false, ''],
    ['Renault Captur', 'HC-196-JL', '#ba8060', 'waiting', 'Kit de distribution', 0, false, ''],
    ['Dacia Duster', 'GX-654-PQ', '#99a8a0', 'reception', 'Contrôle freinage', 0, false, ''],
    ['Mercedes Classe A', 'GM-208-ZF', '#7d879a', 'diagnosis', 'Bruit de suspension', 2, false, ''],
    ['Peugeot 208', 'HJ-593-CL', '#7c9eac', 'workshop', 'Remplacement batterie', 1, false, ''],
  ];
  const vehicles: Vehicle[] = specs.map(
    ([model, plate, color, stage, issue, mechanic, priority, blocker], i) => ({
      id: uid(),
      plate,
      model,
      color,
      customerId: customers[i % customers.length].id,
      mileage: 32000 + i * 8100,
      stage,
      issue,
      blocker,
      priority,
      due: time(i % 3 === 0 ? 12 : 17, i > 7 ? 1 : 0),
      createdAt: time(8),
      visit: 1,
      tasks: [
        {
          id: uid(),
          title: issue,
          assignees: mechanic ? [users[mechanic].id] : [],
          status: stage === 'ready' ? 'done' : stage === 'workshop' ? 'doing' : 'todo',
          minutes: stage === 'ready' ? 75 : 0,
        },
      ],
      notes: [
        {
          id: uid(),
          text: 'Véhicule réceptionné. État général vérifié avec le client.',
          author: users[0].name,
          at: time(8),
        },
      ],
    }),
  );
  const parts: Part[] = [
    {
      id: uid(),
      reference: 'FLT-HU712',
      name: 'Filtre à huile Bosch',
      supplier: 'Autodistribution',
      stock: 12,
      min: 4,
      cost: 720,
      price: 1490,
    },
    {
      id: uid(),
      reference: 'BRK-0986',
      name: 'Plaquettes de frein avant',
      supplier: 'Autodistribution',
      stock: 3,
      min: 4,
      cost: 3500,
      price: 6900,
    },
    {
      id: uid(),
      reference: 'OIL-5W30',
      name: 'Huile moteur 5W30 · 1 L',
      supplier: 'TotalEnergies',
      stock: 28,
      min: 10,
      cost: 580,
      price: 1250,
    },
    {
      id: uid(),
      reference: 'BAT-60AH',
      name: 'Batterie Varta 60 Ah',
      supplier: 'Bosch Service',
      stock: 2,
      min: 2,
      cost: 8400,
      price: 13900,
    },
    {
      id: uid(),
      reference: 'CLU-6243',
      name: 'Kit embrayage LuK',
      supplier: 'Autodistribution',
      stock: 0,
      min: 1,
      cost: 18500,
      price: 29900,
    },
  ];
  const documents: Document[] = [3, 6, 7].map((i, n) => ({
    id: uid(),
    number: `FAC-${today.getFullYear()}-00${n + 1}`,
    kind: 'invoice',
    vehicleId: vehicles[i].id,
    lines: [
      {
        label: vehicles[i].issue,
        quantity: 1,
        unitPrice: [24500, 12900, 18900][n],
      },
      { label: 'Main-d’œuvre atelier', quantity: 1.5, unitPrice: 6500 },
    ],
    taxRate: 20,
    paid: n === 1 ? 27180 : 0,
    accepted: false,
    createdAt: time(10),
  }));
  documents.push({
    id: uid(),
    number: `DEV-${today.getFullYear()}-001`,
    kind: 'estimate',
    vehicleId: vehicles[1].id,
    lines: [{ label: 'Diagnostic électronique', quantity: 1, unitPrice: 6500 }],
    taxRate: 20,
    paid: 0,
    accepted: false,
    createdAt: time(9),
  });
  const s: GarageState = {
    id: garageId,
    demo,
    revision: 0,
    settings: {
      name: 'Garage des Érables',
      country: 'FR',
      address: '24 rue des Érables, 59000 Lille',
      businessId: '',
      modules: {
        reception: 1,
        diagnosis: 2,
        waiting: 1,
        workshop: 4,
        ready: 1,
      },
      configured: demo,
    },
    users: demo ? users : [users[0]],
    customers: demo ? customers : [],
    vehicles: demo ? vehicles : [],
    parts: demo ? parts : [],
    reservations: [],
    orders: demo
      ? [
          {
            id: uid(),
            reference: 'AD-2026-0842',
            supplier: 'Autodistribution',
            partId: parts[4].id,
            vehicleId: vehicles[2].id,
            quantity: 2,
            received: 0,
            due: time(11, 1),
            unitCost: 18500,
          },
        ]
      : [],
    documents: demo ? documents : [],
    mails: demo
      ? [
          {
            id: uid(),
            vehicleId: vehicles[6].id,
            to: customers[0].email,
            subject: 'Votre Toyota Yaris est prête',
            body: 'Bonjour Sophie,\n\nL’entretien de votre Toyota Yaris est terminé. Vous pouvez venir récupérer votre véhicule au garage.\n\nÀ bientôt,\nL’équipe du Garage des Érables',
            status: 'draft',
          },
        ]
      : [],
    appointments: demo
      ? [
          {
            id: uid(),
            customerId: customers[3].id,
            model: 'Renault Mégane',
            plate: 'HG-204-VD',
            reason: 'Révision annuelle',
            at: time(14),
            arrived: false,
          },
          {
            id: uid(),
            customerId: customers[1].id,
            model: 'Ford Focus',
            plate: 'FR-590-BC',
            reason: 'Contrôle climatisation',
            at: time(9, 1),
            arrived: false,
          },
        ]
      : [],
    activity: [],
  };
  if (demo) {
    log(s, 'BMW GP-472-NX · intervention commencée', users[1].name);
    log(s, 'Toyota GN-736-DS · véhicule prêt à récupérer', users[3].name);
    log(s, 'Renault FT-619-AB · accord client attendu', users[2].name);
  }
  return s;
}
