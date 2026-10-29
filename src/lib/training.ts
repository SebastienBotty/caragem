import { applyAction, createSeed, uid, type Action, type GarageState } from './domain.ts';
import type { Permission } from './permissions.ts';

export type TrainingEvent = Action | { type: 'trainingInvite' | 'trainingJoin' | 'trainingSend' };
type Step = {
  permissions?: Permission[];
  title: string;
  text: string;
  target: string;
  type: TrainingEvent['type'];
  expect?: Record<string, string>;
};
export function matchesTrainingStep(step: Step, event: TrainingEvent) {
  return (
    step.type === event.type &&
    Object.entries(step.expect ?? {}).every(
      ([key, value]) => (event as Record<string, unknown>)[key] === value,
    )
  );
}

const maintenance: Step[] = [
  {
    title: 'Attribuer l’entretien',
    text: 'Ouvrez la voiture fictive, puis, dans Travaux, cliquez sur le bouton « Attribuer les intervenants » de la tâche. Cochez Alex et enregistrez. Vous pouvez choisir plusieurs mécaniciens.',
    target:
      '[aria-label="Attribuer les intervenants"], .vehicle-mini-card, [title="Ouvrir le dossier"]',
    type: 'task',
    expect: { operation: 'assign' },
  },
  {
    title: 'Commencer l’entretien',
    text: 'Dans la tâche du dossier, cliquez sur Commencer. La tâche passe En cours et la voiture rejoint l’atelier. Vous jouez ici un patron fictif, autorisé à réaliser toutes les actions.',
    target: '.task-actions, .vehicle-mini-card',
    type: 'task',
    expect: { operation: 'start' },
  },
  {
    title: 'Réserver une pièce',
    text: 'Dans le dossier, ouvrez l’onglet Pièces, puis Réserver. Sélectionnez le filtre disponible et réservez une unité. Cette pièce sera indisponible pour les autres interventions.',
    target: '.drawer-tabs, .vehicle-mini-card',
    type: 'reserve',
  },
  {
    title: 'Déclarer la pièce montée',
    text: 'Toujours dans Pièces, cliquez sur Montée pour la réservation. Le stock fictif est décrémenté. Une pièce non utilisée peut être libérée au lieu d’être montée.',
    target: '.reservation-card, .drawer-content',
    type: 'consume',
  },
  {
    title: 'Terminer l’entretien',
    text: 'Revenez dans Travaux. Cliquez sur Terminer, saisissez 45 minutes puis confirmez avec Marquer comme terminé. Vous enregistrez ainsi le temps passé sur l’intervention.',
    target: '.drawer-tabs, .task-actions',
    type: 'task',
    expect: { operation: 'finish' },
  },
  {
    title: 'Valider le contrôle final',
    text: 'Les tâches sont terminées et aucune pièce ne reste réservée. Cliquez sur Valider le contrôle dans Travaux : la voiture devient prête à récupérer.',
    target: '.drawer-work-actions',
    type: 'stage',
    expect: { stage: 'ready' },
  },
];
const arrival: Step = {
  title: 'Créer une arrivée fictive',
  text: 'Cliquez sur Nouvelle arrivée. Sélectionnez Camille Formation, saisissez une Audi A3 rouge, immatriculée TEST-001, 45 000 km, avec le motif « Révision ». Enregistrez l’arrivée : rien n’est envoyé à votre vrai garage.',
  target: '[data-tour="arrival"], [data-tour="vehicle-create"], .customer-card .button',
  type: 'vehicle',
};
const returnStep: Step = {
  title: 'Restituer la voiture au client',
  text: 'Dans le dossier de la voiture prête, choisissez Remis au client dans le sélecteur d’étape, puis cliquez sur Déplacer. La visite est clôturée ; le véhicule et son historique restent enregistrés dans cet exercice.',
  target: '.drawer-footer, .vehicle-mini-card, [title="Ouvrir le dossier"]',
  type: 'stage',
  expect: { stage: 'returned' },
};

export function createTraining(page: string) {
  let state = createSeed(uid(), true);
  state.settings.name = 'Atelier d’entraînement';
  state.settings.configured = true;
  state.users = state.users.slice(0, 2);
  state.users[0].name = 'Patron fictif';
  state.users[1].name = 'Alex Formation';
  state.customers = [
    { id: uid(), name: 'Camille Formation', email: 'camille@example.invalid', phone: '0000000000' },
  ];
  state.vehicles = [];
  state.documents = [];
  state.mails = [];
  state.reservations = [];
  state.orders = [];
  state.appointments = [];
  state.activity = [];
  state.parts = [
    {
      id: uid(),
      name: 'Filtre à huile (exercice)',
      reference: 'TEST-FILTRE',
      supplier: 'Fournisseur fictif',
      stock: 10,
      min: 2,
      cost: 1000,
      price: 1800,
    },
  ];
  const vehicleSteps: Step[] = [
    arrival,
    {
      title: 'Passer au diagnostic',
      text: 'Depuis le menu, retrouvez la voiture dans Mon garage ou Véhicules, puis ouvrez son dossier. En bas du dossier, sélectionnez Diagnostic & devis puis cliquez sur Déplacer. C’est ici que se pilote le parcours de la voiture.',
      target:
        '.drawer-footer, .vehicle-mini-card, [title="Ouvrir le dossier"], [data-tour-nav="garage"]',
      type: 'stage',
      expect: { stage: 'diagnosis' },
    },
    {
      title: 'Mettre le véhicule en attente',
      text: 'Le diagnostic est établi. Dans le même sélecteur, choisissez À intervenir puis Déplacer. La voiture attend maintenant sa prise en charge.',
      target: '.drawer-footer',
      type: 'stage',
      expect: { stage: 'waiting' },
    },
    ...maintenance,
    returnStep,
  ];
  let title = 'De l’arrivée à la restitution';
  let initialPage = 'garage';
  let steps = vehicleSteps;
  if (!['garage', 'vehicles', 'planning', 'customers'].includes(page)) {
    state = applyAction(
      state,
      {
        type: 'vehicle',
        customerId: state.customers[0].id,
        model: 'Audi A3',
        plate: 'TEST-001',
        issue: 'Révision',
        mileage: 45000,
        color: '#cf4141',
        due: new Date(Date.now() + 86400000).toISOString(),
        priority: false,
      },
      state.users[0],
    );
    state.vehicles[0].stage = 'waiting';
  }
  if (page === 'tasks') {
    title = 'Réaliser un entretien';
    initialPage = 'vehicles';
    steps = maintenance;
  }
  if (page === 'customers') {
    initialPage = 'customers';
    title = 'Créer un client et accueillir sa voiture';
    steps = [
      {
        title: 'Créer un client fictif',
        text: 'Cliquez sur Nouveau client et saisissez un nom, une adresse en example.invalid et un téléphone fictifs. Enregistrez la fiche : vous pourrez ensuite lui rattacher une voiture.',
        target: '[data-tour="customer-create"]',
        type: 'customer',
      },
      ...vehicleSteps,
    ];
    steps[1] = {
      ...arrival,
      target: '.customer-card:last-child .button',
      text: 'Cliquez sur Nouvelle arrivée dans la fiche du client que vous venez de créer. Ajoutez sa voiture (Audi A3, TEST-001), son kilométrage et le motif Révision, puis enregistrez.',
    };
  }
  if (page === 'planning') {
    initialPage = 'planning';
    title = 'Du rendez-vous à la restitution';
    steps = [
      {
        title: 'Planifier une arrivée fictive',
        text: 'Cliquez sur Nouveau rendez-vous. Sélectionnez Camille Formation, ajoutez une Audi A3 TEST-001 pour une révision à la date d’aujourd’hui, puis enregistrez.',
        target: '[data-tour="appointment-create"]',
        type: 'appointment',
      },
      {
        title: 'Confirmer l’arrivée du client',
        text: 'Cliquez sur Véhicule arrivé dans le rendez-vous créé. Le dossier est créé en réception. Fermez ensuite le planning et ouvrez Véhicules dans le menu pour retrouver la voiture.',
        target: '.appointment .button',
        type: 'arrive',
      },
      ...vehicleSteps.slice(1),
    ];
  }
  if (page === 'estimates' || page === 'invoices') {
    title = 'Du devis au règlement';
    initialPage = 'estimates';
    steps = [
      {
        title: 'Préparer un devis fictif',
        text: 'Cliquez sur Nouveau devis. Choisissez TEST-001, vérifiez la main-d’œuvre proposée, ajoutez une prestation si nécessaire, puis créez le brouillon.',
        target: '[data-tour="document-create"]',
        type: 'document',
        expect: { kind: 'estimate' },
      },
      {
        title: 'Enregistrer l’accord du client',
        text: 'Ouvrez le devis créé avec son numéro ou Ouvrir. Cliquez sur Enregistrer l’accord, saisissez « Accord téléphonique fictif » et enregistrez.',
        target: '.modal-actions, .table-link',
        type: 'acceptEstimate',
      },
      {
        title: 'Transformer le devis en facture',
        text: 'Dans le devis accepté, cliquez sur Créer la facture. Puis ouvrez Factures dans le menu et le document qui vient d’être créé.',
        target: '.modal-actions',
        type: 'convertEstimate',
      },
      {
        title: 'Valider la facture',
        text: 'Ouvrez Factures depuis le menu, puis la facture avec son numéro ou Ouvrir. Vérifiez son contenu et cliquez sur Valider la facture.',
        target: '.modal-actions, [data-tour-nav="invoices"]',
        type: 'validateDocument',
      },
      {
        title: 'Enregistrer un paiement fictif',
        text: 'Cliquez sur Ajouter un paiement, laissez le montant total ou saisissez un règlement partiel, puis enregistrez. Aucun débit bancaire n’est effectué.',
        target: '.modal-actions',
        type: 'payment',
      },
    ];
  }
  if (page === 'inventory') {
    title = 'De la commande à la pièce montée';
    initialPage = 'inventory';
    steps = [
      {
        title: 'Créer une référence fictive',
        text: 'Cliquez sur Ajouter une pièce. Renseignez une référence TEST-PIECE, une désignation, un fournisseur fictif, une quantité et les prix, puis enregistrez.',
        target: '[data-tour="part-create"]',
        type: 'part',
      },
      {
        title: 'Commander une pièce',
        text: 'Cliquez sur Enregistrer une commande. Choisissez une pièce, une quantité et une date prévue, puis enregistrez la commande fictive.',
        target: '[data-tour="order-create"]',
        type: 'order',
      },
      {
        title: 'Réceptionner la livraison',
        text: 'Ouvrez Commandes, puis cliquez sur Réceptionner dans la commande créée. Saisissez la quantité reçue et enregistrez ; une réception partielle est possible.',
        target: '.panel-toolbar .segmented, .table-scroll .button',
        type: 'receive',
      },
      {
        ...maintenance[2],
        text: 'Ouvrez Véhicules dans le menu, puis le dossier TEST-001. Dans Pièces, cliquez sur Réserver, sélectionnez une référence et une quantité, puis enregistrez.',
        target: '[data-tour-nav="vehicles"], .drawer-tabs',
      },
      maintenance[3],
    ];
  }
  if (page === 'messages') {
    title = 'Préparer et envoyer un mail';
    initialPage = 'vehicles';
    steps = [
      {
        title: 'Préparer un brouillon fictif',
        text: 'Ouvrez TEST-001, puis cliquez sur Préparer un mail dans son en-tête. Vérifiez le destinataire example.invalid, adaptez le contenu et enregistrez le brouillon.',
        target: '[aria-label="Préparer un mail"], [title="Ouvrir le dossier"]',
        type: 'mail',
      },
      {
        title: 'Relire le message avant l’envoi',
        text: 'Fermez le dossier et ouvrez Messages dans le menu. Cliquez sur le brouillon, modifiez son objet ou son texte puis cliquez sur Enregistrer les modifications.',
        target: '[data-tour-nav="messages"], .mail-row',
        type: 'updateMail',
      },
      {
        title: 'Valider l’envoi simulé',
        text: 'Cliquez sur Valider et envoyer. Dans cet entraînement, le message sera marqué comme envoyé uniquement en mémoire : aucun serveur de messagerie n’est contacté.',
        target: '.modal-actions',
        type: 'trainingSend',
      },
    ];
  }
  if (page === 'team' || page === 'settings') {
    title = 'Inviter un collègue et régler ses accès';
    initialPage = 'team';
    steps = [
      {
        title: 'Inviter un collaborateur fictif',
        text: 'Cliquez sur Inviter un collaborateur. Saisissez collegue@example.invalid et choisissez Mécanicien, puis créez le lien. Ce lien est fictif et aucun mail ne sera envoyé.',
        target: '[data-tour="team-invite"]',
        type: 'trainingInvite',
      },
      {
        title: 'Simuler l’acceptation de l’invitation',
        text: 'Fermez la fenêtre d’invitation, puis cliquez ci-dessous sur Simuler l’acceptation. Cela représente le collègue qui crée son compte et rejoint le garage.',
        target: '[data-tour="team-pending"]',
        type: 'trainingJoin',
      },
      {
        title: 'Créer un rôle personnalisé',
        permissions: ['garage.view', 'tasks.work'],
        text: 'Ouvrez Permissions des rôles puis Créer un rôle. Nommez-le « Chef d’atelier », cochez Voir le garage et Prendre une tâche, puis enregistrez le rôle.',
        target: '[data-tour="team-roles"]',
        type: 'customRole',
      },
      {
        title: 'Attribuer le rôle au collègue',
        text: 'Fermez la gestion des rôles. Dans la fiche Nouveau collègue, cliquez sur Attribuer un rôle, choisissez Chef d’atelier et confirmez.',
        target: '[aria-label="Attribuer un rôle à Nouveau collègue"]',
        type: 'assignRole',
      },
      {
        title: 'Définir une exception individuelle',
        permissions: ['stock.view'],
        text: 'Dans la même fiche, ouvrez Permissions individuelles. Autorisez par exemple Consulter le stock, puis enregistrez. Cette exception reste prioritaire sur les réglages du rôle.',
        target:
          '.team-card:has([aria-label="Attribuer un rôle à Nouveau collègue"]) [data-tour="team-permissions"]',
        type: 'userPermissions',
      },
    ];
  }
  return { state, title, initialPage, steps };
}

export function applyTrainingAction(state: GarageState, action: Action) {
  return applyAction(state, action, state.users[0]);
}
