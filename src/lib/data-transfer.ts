import { z } from 'zod';
import {
  actionSchema,
  blockageKinds,
  lineSchema,
  totals,
  uid,
  type GarageState,
  type Customer,
  type Vehicle,
  type Part,
  type Document,
  type Appointment,
  type Purchase,
} from './domain.ts';
import { plateKey } from './customer-vehicles.ts';
import { UserError } from './errors.ts';
import { csvCell, parseCsv, writeCsv } from './csv.ts';

export const transferKindSchema = z.enum([
  'customers',
  'vehicles',
  'stock',
  'reservations',
  'appointments',
  'orders',
  'documents',
]);
export type TransferKind = z.infer<typeof transferKindSchema>;
type Column = readonly [key: string, label: string, required?: boolean];
const customerColumns: Column[] = [
  ['customer_id', 'Identifiant client'],
  ['customer_email', 'Email client'],
  ['customer_name', 'Nom du client'],
  ['customer_phone', 'Téléphone client'],
];
const vehicleColumns: Column[] = [
  ['vehicle_id', 'Identifiant visite véhicule'],
  ['plate', 'Immatriculation'],
  ['visit', 'Numéro de visite'],
];
export const csvDatasets: Record<TransferKind, { label: string; columns: Column[]; help: string }> =
  {
    customers: {
      label: 'Clients',
      columns: [
        ['id', 'Identifiant'],
        ['name', 'Nom', true],
        ['email', 'Email'],
        ['phone', 'Téléphone'],
      ],
      help: 'Le nom est obligatoire. L’email ou le couple nom / téléphone sert à reconnaître les clients existants. Email et téléphone sont facultatifs ; s’ils sont renseignés, l’email doit être valide et le téléphone contenir 7 à 15 chiffres.',
    },
    vehicles: {
      label: 'Véhicules et visites',
      columns: [
        ['id', 'Identifiant'],
        ...customerColumns,
        ['plate', 'Immatriculation', true],
        ['brand', 'Marque'],
        ['model', 'Marque et modèle', true],
        ['mileage', 'Kilométrage'],
        ['color', 'Couleur hexadécimale'],
        ['stage', 'Étape'],
        ['issue', 'Motif'],
        ['blocker', 'Blocage'],
        ['blocker_details', 'Détails du blocage (JSON)'],
        ['blocker_history', 'Historique des blocages (JSON)'],
        ['priority', 'Prioritaire'],
        ['due', 'Restitution prévue'],
        ['visit', 'Numéro de visite'],
        ['created_at', 'Date de création'],
        ['tasks', 'Tâches (JSON)'],
        ['notes', 'Notes (JSON)'],
      ],
      help: 'Importez les clients d’abord. Renseignez leur identifiant, email ou nom et téléphone. Sans étape, le véhicule rejoint l’historique. Étapes : reception, diagnosis, waiting, workshop, ready, returned. Tâches et notes sont facultatives.',
    },
    stock: {
      label: 'Stock et pièces',
      columns: [
        ['id', 'Identifiant'],
        ['reference', 'Référence', true],
        ['name', 'Désignation', true],
        ['supplier', 'Fournisseur'],
        ['stock', 'Quantité en stock'],
        ['min', 'Stock minimum'],
        ['cost', 'Coût HT en euros'],
        ['price', 'Prix HT en euros'],
      ],
      help: 'Les prix sont en euros HT, avec deux décimales maximum. Les quantités sont entières et positives ou nulles. Les références déjà présentes sont ignorées.',
    },
    reservations: {
      label: 'Réservations de pièces',
      columns: [
        ['id', 'Identifiant'],
        ['part_id', 'Identifiant pièce'],
        ['part_reference', 'Référence pièce'],
        ...vehicleColumns,
        ['quantity', 'Quantité', true],
        ['consumed', 'Montée / consommée'],
      ],
      help: 'Importez le stock et les véhicules d’abord. Les réservations non consommées doivent tenir dans le stock physique et concerner des véhicules encore en intervention.',
    },
    appointments: {
      label: 'Rendez-vous',
      columns: [
        ['id', 'Identifiant'],
        ...customerColumns,
        ['plate', 'Immatriculation', true],
        ['model', 'Marque et modèle', true],
        ['reason', 'Motif', true],
        ['at', 'Date et heure', true],
        ['arrived', 'Arrivé'],
      ],
      help: 'Importez les clients d’abord. Dates au format ISO (ex. 2026-11-10T09:00:00+01:00). Les rendez-vous n’ajoutent pas de voiture dans l’atelier.',
    },
    orders: {
      label: 'Commandes fournisseurs',
      columns: [
        ['id', 'Identifiant'],
        ['reference', 'Référence commande', true],
        ['supplier', 'Fournisseur', true],
        ['part_id', 'Identifiant pièce'],
        ['part_reference', 'Référence pièce'],
        ...vehicleColumns,
        ['quantity', 'Quantité commandée', true],
        ['received', 'Quantité reçue'],
        ['due', 'Date attendue', true],
        ['unit_cost', 'Coût unitaire HT en euros'],
      ],
      help: 'Importez le stock et les véhicules d’abord. Identifiez la pièce par son identifiant ou sa référence. Les quantités reçues sont conservées sans modifier le stock déjà importé.',
    },
    documents: {
      label: 'Devis et factures',
      columns: [
        ['id', 'Identifiant document'],
        ['number', 'Numéro document', true],
        ['kind', 'Type (devis ou facture)', true],
        ...vehicleColumns,
        ['label', 'Désignation ligne', true],
        ['quantity', 'Quantité ligne', true],
        ['unit_price', 'Prix unitaire HT en euros', true],
        ['tax_rate', 'TVA en pourcentage', true],
        ['discount_rate', 'Ristourne en pourcentage'],
        ['discount_amount', 'Ristourne HT en euros'],
        ['paid', 'Montant réglé en euros'],
        ['accepted', 'Accord enregistré'],
        ['validated', 'Facture validée'],
        ['created_at', 'Date de création'],
      ],
      help: 'Une ligne CSV par prestation ou pièce. Répétez le même numéro, type et les mêmes informations du document sur toutes ses lignes. Importez les véhicules d’abord. Les montants réglés sont des données historiques, sans opération bancaire.',
    },
  };

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
export function suggestMapping(kind: TransferKind, headers: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, label] of csvDatasets[kind].columns) {
    const index = headers.findIndex(
      (h) => normalize(h) === normalize(key) || normalize(h) === normalize(label),
    );
    if (index >= 0) result[key] = index;
  }
  return result;
}

export const transferExamples: Record<TransferKind, Record<string, string>> = {
  customers: {
    id: 'client-exemple',
    name: 'Camille Exemple',
    email: 'camille@example.com',
    phone: '+32412345678',
  },
  stock: {
    id: 'piece-exemple',
    reference: 'FILTRE-001',
    name: 'Filtre à huile',
    supplier: 'Fournisseur Exemple',
    stock: '10',
    min: '2',
    cost: '8.50',
    price: '15.00',
  },
  vehicles: {
    id: 'vehicule-exemple',
    customer_id: 'client-exemple',
    plate: '1-ABC-123',
    brand: 'Peugeot',
    model: '308',
    mileage: '75000',
    color: '#2563eb',
    stage: 'reception',
    issue: 'Entretien annuel',
    priority: 'false',
    visit: '1',
    created_at: '2026-11-10T09:00:00+01:00',
  },
  reservations: {
    id: 'reservation-exemple',
    part_id: 'piece-exemple',
    vehicle_id: 'vehicule-exemple',
    quantity: '1',
    consumed: 'false',
  },
  appointments: {
    id: 'rdv-exemple',
    customer_id: 'client-exemple',
    plate: '1-ABC-123',
    model: 'Peugeot 308',
    reason: 'Entretien annuel',
    at: '2026-11-10T09:00:00+01:00',
    arrived: 'false',
  },
  orders: {
    id: 'commande-exemple',
    reference: 'CMD-EXEMPLE-001',
    supplier: 'Fournisseur Exemple',
    part_id: 'piece-exemple',
    vehicle_id: 'vehicule-exemple',
    quantity: '5',
    received: '0',
    due: '2026-11-10',
    unit_cost: '8.50',
  },
  documents: {
    id: 'document-exemple',
    number: 'DEV-EXEMPLE-001',
    kind: 'estimate',
    vehicle_id: 'vehicule-exemple',
    label: 'Entretien annuel',
    quantity: '1',
    unit_price: '100.00',
    tax_rate: '21',
    discount_rate: '10',
    paid: '0',
    accepted: 'false',
    validated: 'false',
    created_at: '2026-11-10T09:00:00+01:00',
  },
};

export function exampleDataCsv(kind: TransferKind): string {
  const headers = csvDatasets[kind].columns.map(([key]) => key);
  return writeCsv(headers, [headers.map((key) => transferExamples[kind][key] ?? '')]);
}

const text = z.string().trim().min(1).max(200);
const identifier = z.string().min(1).max(100);
const date = z
  .string()
  .max(40)
  .pipe(z.union([z.iso.datetime({ offset: true }), z.iso.date()]));
const integer = z.number().int().min(0).max(100000);
const cents = z.number().int().min(0).max(100000000);
const customerSchema = z.object({
  id: identifier,
  name: text,
  email: z.union([z.email().max(254), z.literal('')]),
  phone: z.string().max(2000),
});
const taskSchema = z.object({
  id: identifier.default(uid),
  title: text,
  assignees: z.array(identifier).max(20).default([]),
  status: z.enum(['todo', 'doing', 'done']),
  minutes: integer,
  estimatedMinutes: z.number().int().min(0).max(100000).optional(),
});
const noteSchema = z.object({
  id: identifier.default(uid),
  text: z.string().trim().min(1).max(4000),
  author: text,
  at: date,
});
const blockageSchema = z.object({
  kind: z.enum(blockageKinds.map((kind) => kind.id)),
  assigneeId: identifier.optional(),
  expectedAt: date.optional(),
  nextAction: z.string().max(2000),
  openedAt: date,
});
const vehicleSchema = z.object({
  id: identifier,
  customerId: identifier,
  plate: z.string().trim().min(1).max(25),
  model: text,
  mileage: z.number().int().min(0).max(5000000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  stage: z.enum(['reception', 'diagnosis', 'waiting', 'workshop', 'ready', 'returned']),
  issue: text,
  blocker: z.string().max(2000),
  blockerDetails: blockageSchema.optional(),
  blockerHistory: z
    .array(blockageSchema.extend({ text: z.string().max(2000), resolvedAt: date }))
    .max(5000)
    .optional(),
  priority: z.boolean(),
  due: date,
  visit: z.number().int().min(1).max(100000),
  createdAt: date,
  tasks: z.array(taskSchema).max(5000),
  notes: z.array(noteSchema).max(5000),
});
const partSchema = z.object({
  id: identifier,
  reference: text,
  name: text,
  supplier: text,
  stock: integer,
  min: integer,
  cost: cents,
  price: cents,
});

function numeric(value: string, fallback = 0): number {
  if (!value) return fallback;
  if (!/^[+-]?(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d+)?$/.test(value))
    throw new UserError(
      'Nombre attendu, avec des groupes de trois chiffres pour les milliers (ex. 1 234,50).',
    );
  const cleaned = value.replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(cleaned) || !Number.isFinite(Number(cleaned)))
    throw new UserError('Valeur numérique invalide.');
  return Number(cleaned);
}
function euros(value: string): number {
  const amount = numeric(value) * 100;
  if (Math.abs(amount - Math.round(amount)) > 0.000001)
    throw new UserError('Les montants en euros acceptent deux décimales maximum.');
  return Math.round(amount);
}
function boolean(value: string): boolean {
  if (!value || ['0', 'false', 'non', 'faux', 'no'].includes(value.toLowerCase())) return false;
  if (['1', 'true', 'oui', 'vrai', 'yes'].includes(value.toLowerCase())) return true;
  throw new UserError('Valeur oui/non invalide.');
}
function json(value: string): unknown {
  try {
    return value ? JSON.parse(value) : [];
  } catch {
    throw new UserError('Le contenu JSON des tâches ou notes est invalide.');
  }
}
function customerFor(state: GarageState, row: Record<string, string>): Customer {
  const byId = state.customers.find((c) => c.id === row.customer_id);
  if (row.customer_id && !byId)
    throw new UserError(
      'Identifiant client introuvable. Importez ce client avant ses données liées.',
    );
  if (byId) {
    if (row.customer_email && byId.email.toLowerCase() !== row.customer_email.toLowerCase())
      throw new UserError('Identifiant et email client contradictoires.');
    if (row.customer_name && normalize(byId.name) !== normalize(row.customer_name))
      throw new UserError('Identifiant et nom du client contradictoires.');
    if (row.customer_phone && phoneKey(byId.phone) !== phoneKey(row.customer_phone))
      throw new UserError('Identifiant et téléphone client contradictoires.');
    return byId;
  }
  const candidates = state.customers.filter((c) =>
    row.customer_email
      ? c.email.toLowerCase() === row.customer_email.toLowerCase()
      : row.customer_name &&
        normalize(c.name) === normalize(row.customer_name) &&
        (!row.customer_phone || c.phone === row.customer_phone),
  );
  if (candidates.length !== 1)
    throw new UserError(
      'Client absent ou ambigu : importez les clients puis renseignez un identifiant ou un email unique.',
    );
  return candidates[0];
}
function vehicleFor(state: GarageState, row: Record<string, string>): Vehicle {
  const byId = state.vehicles.find((v) => v.id === row.vehicle_id);
  if (row.vehicle_id && !byId)
    throw new UserError(
      'Identifiant de visite véhicule introuvable. Importez cette visite avant ses données liées.',
    );
  if (byId) {
    if (row.plate && plateKey(byId.plate) !== plateKey(row.plate))
      throw new UserError('Identifiant véhicule et immatriculation contradictoires.');
    if (row.visit && byId.visit !== numeric(row.visit))
      throw new UserError('Identifiant véhicule et numéro de visite contradictoires.');
    return byId;
  }
  const candidates = state.vehicles.filter(
    (v) =>
      row.plate &&
      plateKey(v.plate) === plateKey(row.plate) &&
      (!row.visit || v.visit === numeric(row.visit)),
  );
  if (candidates.length !== 1)
    throw new UserError(
      'Visite véhicule absente ou ambiguë : importez les véhicules et renseignez l’identifiant ou l’immatriculation et la visite.',
    );
  return candidates[0];
}
function partFor(state: GarageState, row: Record<string, string>): Part {
  if (row.part_id && !state.parts.some((p) => p.id === row.part_id))
    throw new UserError(
      'Identifiant pièce introuvable. Importez cette pièce avant ses données liées.',
    );
  const part =
    state.parts.find((p) => p.id === row.part_id) ??
    state.parts.find((p) => p.reference === row.part_reference);
  if (!part) throw new UserError('Pièce introuvable : importez le stock d’abord.');
  if (row.part_reference && part.reference !== row.part_reference)
    throw new UserError('Identifiant et référence pièce contradictoires.');
  return part;
}

const phoneKey = (value: string) => value.replace(/\D/g, '').replace(/^00/, '');
function validateCell(key: string, value: string, kind: TransferKind) {
  if (!value) return;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/u.test(value))
    throw new UserError(
      'Caractère de contrôle ou caractère illisible interdit. Vérifiez l’encodage du fichier.',
    );
  if (['phone', 'customer_phone'].includes(key)) {
    if (!/^\+?[\d ()\u00a0.\-]+$/.test(value) || !/^\d{7,15}$/.test(phoneKey(value)))
      throw new UserError(
        'Téléphone attendu : 7 à 15 chiffres, avec indicatif + ou 00 facultatif (ex. +32 412 34 56 78).',
      );
  } else if (['email', 'customer_email'].includes(key)) {
    if (!z.email().max(254).safeParse(value).success)
      throw new UserError('Adresse email invalide (ex. client@example.com).');
  } else if (key === 'plate') {
    if (!/^[\p{L}\p{N}][\p{L}\p{N} .\-]{0,24}$/u.test(value))
      throw new UserError(
        'Immatriculation attendue : lettres et chiffres, avec espaces, points ou tirets (25 caractères maximum).',
      );
  } else if (['due', 'at', 'created_at'].includes(key)) {
    const valid =
      key === 'at'
        ? z.iso.datetime({ offset: true }).safeParse(value).success
        : date.safeParse(value).success;
    if (!valid)
      throw new UserError(
        'Date ISO valide attendue (2026-11-10), avec heure et fuseau pour un rendez-vous (2026-11-10T09:00:00+01:00).',
      );
  } else if (['priority', 'consumed', 'arrived', 'accepted', 'validated'].includes(key)) {
    boolean(value);
  } else if (
    [
      'stock',
      'min',
      'mileage',
      'visit',
      'quantity',
      'received',
      'cost',
      'price',
      'unit_cost',
      'unit_price',
      'paid',
      'discount_amount',
      'tax_rate',
      'discount_rate',
    ].includes(key)
  ) {
    const monetary = [
      'cost',
      'price',
      'unit_cost',
      'unit_price',
      'paid',
      'discount_amount',
    ].includes(key);
    const amount = monetary ? euros(value) : numeric(value);
    const maximum =
      key === 'mileage'
        ? 5000000
        : key === 'tax_rate'
          ? 30
          : key === 'discount_rate'
            ? 100
            : monetary
              ? 100000000
              : key === 'quantity' && kind !== 'documents'
                ? 10000
                : 100000;
    if (amount < 0 || amount > maximum || ((key === 'visit' || key === 'quantity') && amount === 0))
      throw new UserError(
        `Valeur hors limites : ${key === 'visit' || key === 'quantity' ? 'strictement positive' : 'positive ou nulle'}, au maximum ${monetary ? `${maximum / 100} €` : maximum}.`,
      );
    if (
      !['tax_rate', 'discount_rate'].includes(key) &&
      !(key === 'quantity' && kind === 'documents') &&
      !Number.isInteger(amount)
    )
      throw new UserError('Nombre entier attendu.');
  } else if (
    key === 'stage' &&
    !['reception', 'diagnosis', 'waiting', 'workshop', 'ready', 'returned'].includes(
      value.toLowerCase(),
    )
  ) {
    throw new UserError(
      'Étape attendue : reception, diagnosis, waiting, workshop, ready ou returned.',
    );
  } else if (key === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new UserError('Couleur au format #RRGGBB attendue (ex. #2563eb).');
  } else if (['tasks', 'notes', 'blocker_details', 'blocker_history'].includes(key)) {
    json(value);
  }
}

export type ImportReport = {
  added: number;
  skipped: number;
  errors: { row: number; message: string }[];
};
export function prepareCsvImport(
  current: GarageState,
  kind: TransferKind,
  content: string,
  mapping: Record<string, number>,
): { state: GarageState; report: ImportReport } {
  // ASVS 2.2.1–3: parse and validate every record before any transaction can commit it.
  const parsed = parseCsv(content);
  const columns = csvDatasets[kind].columns;
  for (const [key, index] of Object.entries(mapping)) {
    if (
      !columns.some(([field]) => field === key) ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= parsed.headers.length
    )
      throw new UserError('Correspondance de colonnes invalide.');
  }
  for (const [key, label, required] of columns)
    if (required && mapping[key] === undefined)
      throw new UserError(`Associez la colonne « ${label} ».`);
  if (new Set(Object.values(mapping)).size !== Object.values(mapping).length)
    throw new UserError(
      'Une même colonne du fichier ne peut pas être associée à plusieurs champs CaRM.',
    );
  const state = structuredClone(current);
  delete state.savedVehicles;
  const report: ImportReport = { added: 0, skipped: 0, errors: [] };
  const now = new Date().toISOString();
  let rows = parsed.rows.map((values, index) => ({
    index: parsed.rowNumbers[index],
    data: Object.fromEntries(
      columns.map(([key]) => [
        key,
        mapping[key] === undefined ? '' : csvCell(values[mapping[key]]).trim(),
      ]),
    ),
  }));
  const add = <T extends { id: string }>(
    items: T[],
    item: T,
    key: (record: T) => string,
    identifyById = false,
  ) => {
    if (items.some((old) => old.id === item.id && key(old) !== key(item)))
      throw new UserError('Cet identifiant est déjà utilisé pour un autre enregistrement.');
    if (items.some((old) => old.id === item.id || (!identifyById && key(old) === key(item)))) {
      report.skipped++;
      return;
    }
    items.push(item);
    report.added++;
  };
  const run = (index: number, operation: () => void) => {
    try {
      operation();
    } catch (error) {
      const message =
        error instanceof UserError
          ? error.message
          : error instanceof z.ZodError
            ? 'Valeurs invalides : ' +
              error.issues
                .map((issue) => {
                  const aliases: Record<string, string> = {
                    unitPrice: 'unit_price',
                    taxRate: 'tax_rate',
                    discountRate: 'discount_rate',
                    discountAmount: 'discount_amount',
                    customerId: 'customer_id',
                    createdAt: 'created_at',
                    blockerDetails: 'blocker_details',
                    blockerHistory: 'blocker_history',
                  };
                  const key = String(issue.path[0] ?? '');
                  const label =
                    columns.find(([field]) => field === (aliases[key] ?? key))?.[1] ?? key;
                  const reason =
                    issue.code === 'too_small'
                      ? 'valeur trop petite ou vide'
                      : issue.code === 'too_big'
                        ? 'limite dépassée'
                        : issue.code === 'invalid_value'
                          ? 'valeur non autorisée'
                          : 'format ou type invalide';
                  return `${label}${issue.path.length > 1 ? ` (${issue.path.slice(1).join('.')})` : ''} : ${reason}`;
                })
                .filter(Boolean)
                .join(', ')
            : undefined;
      if (!message) throw error;
      if (report.errors.length < 100) report.errors.push({ row: index, message });
    }
  };
  // ASVS 2.2.1–3: validate supplied fields even when a duplicate would otherwise be skipped.
  const seen = new Map<string, string>();
  rows = rows.filter(({ index, data }) => {
    let valid = true;
    for (const [key, label, required] of columns) {
      run(index, () => {
        try {
          if (required && !data[key]) throw new UserError('Valeur obligatoire manquante.');
          validateCell(key, data[key], kind);
        } catch (error) {
          valid = false;
          if (error instanceof UserError) throw new UserError(`${label} : ${error.message}`);
          throw error;
        }
      });
    }
    if (kind !== 'documents' && data.id)
      run(index, () => {
        const previous = seen.get(data.id),
          signature = JSON.stringify(data);
        if (previous && previous !== signature) {
          valid = false;
          throw new UserError(
            'Cet identifiant apparaît plusieurs fois dans le fichier avec des données différentes.',
          );
        }
        seen.set(data.id, signature);
      });
    return valid;
  });
  if (kind === 'documents') {
    for (const row of rows) {
      const kind = row.data.kind.toLowerCase();
      row.data.kind = kind === 'devis' ? 'estimate' : kind === 'facture' ? 'invoice' : kind;
    }
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.data.id || `${row.data.kind}:${row.data.number}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const group of groups.values())
      run(group[0].index, () => {
        const r = group[0].data;
        for (const row of group)
          for (const [key, label, required] of columns)
            if (required && !row.data[key]) throw new UserError(`Valeur manquante : ${label}.`);
        for (const row of group)
          for (const [key, label] of columns)
            if (!['label', 'quantity', 'unit_price'].includes(key) && row.data[key] !== r[key])
              throw new UserError(`Informations différentes pour un même document : ${label}.`);
        const vehicle = vehicleFor(state, r);
        const kind = z.enum(['estimate', 'invoice']).parse(r.kind);
        const lines = group.map(({ data }) =>
          lineSchema.parse({
            label: data.label,
            quantity: numeric(data.quantity),
            unitPrice: euros(data.unit_price),
          }),
        );
        const action = {
          type: 'document' as const,
          vehicleId: vehicle.id,
          kind,
          lines,
          taxRate: numeric(r.tax_rate),
          discountRate: numeric(r.discount_rate),
          discountAmount: euros(r.discount_amount),
        };
        actionSchema.parse(action);
        const total = totals(lines, action.taxRate, action.discountRate, action.discountAmount);
        if (action.discountAmount > total.subtotal)
          throw new UserError('La ristourne dépasse le montant HT.');
        const paid = cents.parse(euros(r.paid));
        if (paid > total.gross || (kind === 'estimate' && paid > 0))
          throw new UserError(
            'Le montant réglé dépasse le montant de la facture ou concerne un devis.',
          );
        const document: Document = {
          ...action,
          id: identifier.parse(r.id || uid()),
          number: text.parse(r.number),
          paid,
          accepted: boolean(r.accepted),
          validated: paid > 0 || boolean(r.validated),
          createdAt: date.parse(r.created_at || now),
        };
        add(state.documents, document, (d) => `${d.kind}:${d.number}`);
      });
  } else
    for (const { index, data: r } of rows)
      run(index, () => {
        for (const [key, label, required] of columns)
          if (required && !r[key]) throw new UserError(`Valeur manquante : ${label}.`);
        const id = identifier.parse(r.id || uid());
        switch (kind) {
          case 'customers': {
            const customer = customerSchema.parse({
              id,
              name: r.name,
              email: r.email,
              phone: r.phone,
            });
            add(
              state.customers,
              customer,
              (c) => (c.email ? c.email.toLowerCase() : `${normalize(c.name)}:${c.phone}`),
              Boolean(r.id),
            );
            break;
          }
          case 'stock': {
            const part = partSchema.parse({
              id,
              reference: r.reference,
              name: r.name,
              supplier: r.supplier || 'Non renseigné',
              stock: numeric(r.stock),
              min: numeric(r.min),
              cost: euros(r.cost),
              price: euros(r.price),
            });
            add(state.parts, part, (p) => p.reference);
            break;
          }
          case 'vehicles': {
            const stage = r.stage.toLowerCase() || 'returned';
            const vehicle = vehicleSchema.parse({
              id,
              customerId: customerFor(state, r).id,
              plate: r.plate.toUpperCase(),
              model:
                r.brand && !normalize(r.model).startsWith(normalize(r.brand))
                  ? `${r.brand} ${r.model}`
                  : r.model,
              mileage: numeric(r.mileage),
              color: r.color || '#7b9ab6',
              stage,
              issue: r.issue || 'Véhicule importé',
              blocker: r.blocker,
              blockerDetails: r.blocker_details ? json(r.blocker_details) : undefined,
              blockerHistory: r.blocker_history ? json(r.blocker_history) : undefined,
              priority: boolean(r.priority),
              due: r.due || r.created_at || now,
              visit: numeric(r.visit, 1),
              createdAt: r.created_at || now,
              tasks: json(r.tasks),
              notes: json(r.notes),
            });
            vehicle.tasks = vehicle.tasks.map((task) => ({
              ...task,
              assignees: task.assignees.filter((id) => state.users.some((u) => u.id === id)),
            }));
            if (
              vehicle.blockerDetails?.assigneeId &&
              !state.users.some((u) => u.id === vehicle.blockerDetails!.assigneeId)
            )
              vehicle.blockerDetails.assigneeId = undefined;
            vehicle.blockerHistory = vehicle.blockerHistory?.map((blockage) => ({
              ...blockage,
              assigneeId: state.users.some((u) => u.id === blockage.assigneeId)
                ? blockage.assigneeId
                : undefined,
            }));
            const existing = state.vehicles.find(
              (v) => plateKey(v.plate) === plateKey(vehicle.plate) && v.stage !== 'returned',
            );
            if (
              stage !== 'returned' &&
              existing &&
              !(existing.customerId === vehicle.customerId && existing.visit === vehicle.visit)
            )
              throw new UserError(
                'Une autre visite de ce véhicule est déjà présente dans l’atelier.',
              );
            if (
              ['ready', 'returned'].includes(stage) &&
              vehicle.tasks.some((t) => t.status !== 'done')
            )
              throw new UserError(
                'Un véhicule terminé ne peut pas contenir des tâches inachevées.',
              );
            add(state.vehicles, vehicle, (v) => `${v.customerId}:${plateKey(v.plate)}:${v.visit}`);
            break;
          }
          case 'appointments': {
            const action = {
              type: 'appointment' as const,
              customerId: customerFor(state, r).id,
              model: r.model,
              plate: r.plate.toUpperCase(),
              reason: r.reason,
              at: date.parse(r.at),
            };
            actionSchema.parse(action);
            const appointment: Appointment = { ...action, id, arrived: boolean(r.arrived) };
            add(
              state.appointments,
              appointment,
              (a) => `${a.customerId}:${plateKey(a.plate)}:${new Date(a.at).toISOString()}`,
              Boolean(r.id),
            );
            break;
          }
          case 'orders': {
            const part = partFor(state, r);
            const action = {
              type: 'order' as const,
              reference: r.reference,
              supplier: r.supplier,
              partId: part.id,
              vehicleId: r.vehicle_id || r.plate ? vehicleFor(state, r).id : '',
              quantity: numeric(r.quantity),
              due: date.parse(r.due),
              unitCost: euros(r.unit_cost),
            };
            actionSchema.parse(action);
            const received = integer.parse(numeric(r.received));
            if (received > action.quantity)
              throw new UserError('La quantité reçue dépasse la quantité commandée.');
            const order: Purchase = { ...action, id, received };
            add(state.orders, order, (o) => `${o.supplier}:${o.reference}`, Boolean(r.id));
            break;
          }
          case 'reservations': {
            const part = partFor(state, r),
              vehicle = vehicleFor(state, r);
            const quantity = z.number().int().min(1).max(10000).parse(numeric(r.quantity));
            const consumed = boolean(r.consumed);
            const existing = state.reservations.find((item) =>
              r.id
                ? item.id === id
                : item.partId === part.id &&
                  item.vehicleId === vehicle.id &&
                  item.quantity === quantity &&
                  item.consumed === consumed,
            );
            if (existing && (existing.partId !== part.id || existing.vehicleId !== vehicle.id))
              throw new UserError('Cet identifiant de réservation est déjà utilisé.');
            if (existing) {
              report.skipped++;
              break;
            }
            if (!consumed) {
              if (['ready', 'returned'].includes(vehicle.stage))
                throw new UserError('Impossible de réserver pour un véhicule terminé.');
              const reserved = state.reservations
                .filter((item) => item.partId === part.id && !item.consumed)
                .reduce((sum, item) => sum + item.quantity, 0);
              if (reserved + quantity > part.stock)
                throw new UserError('Les réservations dépassent le stock disponible.');
            }
            state.reservations.push({
              id,
              partId: part.id,
              vehicleId: vehicle.id,
              quantity,
              consumed,
            });
            report.added++;
            break;
          }
        }
      });
  return { state, report };
}

export function exportDataCsv(state: GarageState, kind: TransferKind, template = false): string {
  const columns = csvDatasets[kind].columns;
  const rows: Record<string, string | number | boolean | undefined>[] = [];
  const client = (id: string) => {
    const c = state.customers.find((c) => c.id === id)!;
    return {
      customer_id: c.id,
      customer_email: c.email,
      customer_name: c.name,
      customer_phone: c.phone,
    };
  };
  const vehicle = (id: string) => {
    const v = state.vehicles.find((v) => v.id === id);
    return { vehicle_id: v?.id, plate: v?.plate, visit: v?.visit };
  };
  switch (kind) {
    case 'customers':
      rows.push(...state.customers);
      break;
    case 'stock':
      rows.push(
        ...state.parts.map((p) => ({
          ...p,
          cost: (p.cost / 100).toFixed(2),
          price: (p.price / 100).toFixed(2),
        })),
      );
      break;
    case 'vehicles':
      rows.push(
        ...state.vehicles.map((v) => ({
          id: v.id,
          plate: v.plate,
          model: v.model,
          mileage: v.mileage,
          color: v.color,
          stage: v.stage,
          issue: v.issue,
          blocker: v.blocker,
          priority: v.priority,
          due: v.due,
          visit: v.visit,
          ...client(v.customerId),
          brand: '',
          photos: undefined,
          blocker_details: v.blockerDetails ? JSON.stringify(v.blockerDetails) : undefined,
          blocker_history: v.blockerHistory ? JSON.stringify(v.blockerHistory) : undefined,
          created_at: v.createdAt,
          tasks: JSON.stringify(v.tasks),
          notes: JSON.stringify(v.notes),
        })),
      );
      break;
    case 'appointments':
      rows.push(...state.appointments.map((a) => ({ ...a, ...client(a.customerId) })));
      break;
    case 'orders':
      rows.push(
        ...state.orders.map((o) => ({
          ...o,
          ...vehicle(o.vehicleId),
          part_id: o.partId,
          part_reference: state.parts.find((p) => p.id === o.partId)?.reference,
          unit_cost: (o.unitCost / 100).toFixed(2),
        })),
      );
      break;
    case 'reservations':
      rows.push(
        ...state.reservations.map((r) => ({
          ...r,
          ...vehicle(r.vehicleId),
          part_id: r.partId,
          part_reference: state.parts.find((p) => p.id === r.partId)?.reference,
        })),
      );
      break;
    case 'documents':
      for (const d of state.documents)
        for (const l of d.lines)
          rows.push({
            ...vehicle(d.vehicleId),
            id: d.id,
            number: d.number,
            kind: d.kind,
            label: l.label,
            quantity: l.quantity,
            unit_price: (l.unitPrice / 100).toFixed(2),
            tax_rate: d.taxRate,
            discount_rate: d.discountRate,
            discount_amount: ((d.discountAmount ?? 0) / 100).toFixed(2),
            paid: (d.paid / 100).toFixed(2),
            accepted: d.accepted,
            validated: d.validated,
            created_at: d.createdAt,
          });
      break;
  }
  return writeCsv(
    columns.map(([key]) => key),
    template ? [] : rows.map((row) => columns.map(([key]) => row[key])),
  );
}
