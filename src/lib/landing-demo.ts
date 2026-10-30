import { applyAction, createSeed, type Action, type GarageState } from './domain.ts';

export const landingChapters = [
  [
    '08:30 · Nouveau client',
    'Une relation qui commence.',
    'Le client est créé. Coordonnées et véhicules restent réunis dans son dossier.',
  ],
  [
    '08:35 · Nouvelle arrivée',
    'Une voiture entre en scène.',
    'La Peugeot 308 de Camille rejoint la réception. Sa demande accompagne son arrivée.',
  ],
  [
    '08:45 · Équipe',
    'Chacun sait quoi faire.',
    'Sarah prend en charge la révision. Son intervention apparaît dans la charge de travail de l’équipe.',
  ],
  [
    '09:00 · Intervention',
    'Votre atelier prend vie.',
    'La tâche démarre et la voiture rejoint l’atelier. Retrouvez le même visualisateur que dans CaRM.',
  ],
  [
    '09:20 · Pièce utilisée',
    'Le stock suit le travail.',
    'Un filtre est réservé puis utilisé sur cette intervention. Le stock physique passe de 4 à 3.',
  ],
  [
    '11:00 · Réapprovisionnement',
    'Les pièces arrivent aussi.',
    'Une commande de cinq filtres est réceptionnée. Le stock passe de 3 à 8, prêt pour les prochaines interventions.',
  ],
  [
    '14:30 · Véhicule prêt',
    'Tout est prêt pour le départ.',
    'La révision est terminée, le temps est enregistré et la voiture rejoint les véhicules prêts à récupérer.',
  ],
] as const;

export function createLandingDemo() {
  let state = createSeed('landing-demo', true);
  state.settings.name = 'Atelier des Peupliers';
  state.orders = [];
  state.reservations = [];
  state.documents = [];
  state.mails = [];
  state.parts = [
    {
      id: 'landing-filter',
      reference: 'FLT-308',
      name: 'Filtre à huile',
      supplier: 'Auto Pièces',
      stock: 4,
      min: 2,
      cost: 800,
      price: 1600,
    },
  ];
  const actor = state.users[0];
  const apply = (action: Action) => {
    state = applyAction(state, action, actor);
  };
  const snapshots: GarageState[] = [structuredClone(state)];
  apply({
    type: 'customer',
    name: 'Camille Martin',
    email: 'camille@example.com',
    phone: '04 70 12 34 56',
  });
  const customerId = state.customers.at(-1)!.id;
  apply({
    type: 'vehicle',
    customerId,
    model: 'Peugeot 308',
    plate: 'CM-308-DE',
    mileage: 60000,
    issue: 'Révision annuelle et filtre à huile',
    color: '#d57957',
    priority: false,
    due: new Date(Date.now() + 86400000).toISOString(),
  });
  const vehicleId = state.vehicles.at(-1)!.id;
  const taskId = state.vehicles.at(-1)!.tasks[0].id;
  snapshots.push(structuredClone(state));
  apply({ type: 'task', vehicleId, taskId, operation: 'assign', assignees: [state.users[2].id] });
  snapshots.push(structuredClone(state));
  apply({ type: 'task', vehicleId, taskId, operation: 'start' });
  snapshots.push(structuredClone(state));
  apply({ type: 'reserve', vehicleId, partId: 'landing-filter', quantity: 1 });
  apply({ type: 'consume', id: state.reservations.at(-1)!.id });
  snapshots.push(structuredClone(state));
  apply({
    type: 'order',
    reference: 'CMD-DEMO',
    supplier: 'Auto Pièces',
    partId: 'landing-filter',
    vehicleId: '',
    quantity: 5,
    due: new Date().toISOString(),
    unitCost: 800,
  });
  apply({ type: 'receive', id: state.orders.at(-1)!.id, quantity: 5 });
  snapshots.push(structuredClone(state));
  apply({ type: 'task', vehicleId, taskId, operation: 'finish', minutes: 75 });
  apply({ type: 'stage', id: vehicleId, stage: 'ready' });
  snapshots.push(structuredClone(state));
  return { snapshots, vehicleId, customerId };
}
