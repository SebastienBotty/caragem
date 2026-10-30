import { totals, uid, type Action } from './domain.ts';
import { applyTrainingAction, createTraining } from './training.ts';

const explanations: Record<string, string> = {
  customer:
    'Une fiche client rassemble le nom et les coordonnées. Ici, Léa Démonstration est créée automatiquement, puis sa voiture lui est rattachée.',
  vehicle:
    'La nouvelle arrivée rattache une Audi A3 TEST-001 à son client, avec 45 000 km et le motif Révision. Le dossier apparaît en réception.',
  diagnosis:
    'Le dossier passe au diagnostic : le garage identifie les travaux et prépare leur prise en charge.',
  waiting: 'Le diagnostic est établi. La voiture rejoint les véhicules en attente d’intervention.',
  estimateTask:
    'L’entretien reçoit une estimation de 45 minutes. Le temps prévu reste distinct du temps réellement passé.',
  assign:
    'Alex Formation est affecté à l’entretien. Une tâche peut être confiée à plusieurs mécaniciens.',
  start: 'L’entretien démarre : la tâche est en cours et la voiture rejoint l’atelier.',
  reserve:
    'Un filtre à huile est réservé pour cette voiture. Il devient indisponible pour les autres interventions, sans encore diminuer le stock physique.',
  consume:
    'Le filtre est déclaré monté : la réservation est consommée et le stock physique diminue d’une unité.',
  finish:
    'L’entretien est terminé avec 45 minutes de travail réel. Le dossier permet de comparer ce temps avec l’estimation.',
  ready:
    'Les travaux sont terminés et les pièces réservées sont traitées. Le contrôle final place la voiture parmi les véhicules prêts.',
  returned:
    'La voiture est remise au client. La visite est clôturée et son historique reste consultable.',
  appointment:
    'Un rendez-vous de révision est planifié pour Camille Formation et son Audi A3. Il réserve une date sans créer d’arrivée dans l’atelier.',
  arrive:
    'À l’arrivée du client, le rendez-vous est confirmé. Un dossier véhicule est automatiquement créé en réception.',
  document:
    'Un devis de révision est préparé : une prestation de 100 € HT, avec la TVA du garage. Le brouillon peut être relu avant l’accord du client.',
  acceptEstimate:
    'L’accord téléphonique fictif du client est enregistré dans le devis. Cette trace accompagne le document.',
  convertEstimate:
    'Le devis accepté est transformé en facture. Les prestations et les montants sont repris automatiquement.',
  validateDocument:
    'La facture est validée après vérification de son contenu. Elle est prête à recevoir un règlement.',
  payment:
    'Le règlement total est enregistré sur la facture. Son solde passe à zéro ; aucun débit bancaire n’a lieu dans cette visite.',
  part: 'Une référence TEST-PIECE est ajoutée avec 3 unités en stock, un seuil de 2, un coût de 10 € HT et un prix de vente de 18 € HT.',
  order:
    'Une commande de 5 pièces est enregistrée auprès du fournisseur fictif. Elle reste distincte du stock disponible tant que la livraison n’est pas réceptionnée.',
  receive:
    'Les 5 pièces commandées sont réceptionnées. Le stock de TEST-PIECE passe de 3 à 8 unités ; une réception partielle serait également possible.',
  mail: 'Un brouillon de mail annonce la prise en charge de TEST-001. Le destinataire et le texte sont déjà renseignés avec des données fictives.',
  updateMail:
    'Le brouillon est relu et son texte est complété avant l’envoi. Le destinataire et le contenu restent vérifiables.',
  trainingSend:
    'L’envoi est simulé : le message apparaît comme envoyé dans la démonstration. Aucun serveur de messagerie n’est contacté.',
  trainingInvite:
    'Une invitation fictive est préparée pour collegue@example.invalid avec le rôle Mécanicien. Aucun mail ni compte réel n’est créé.',
  trainingJoin:
    'L’acceptation de l’invitation est simulée. Nouveau collègue apparaît maintenant dans l’équipe.',
  customRole:
    'Le rôle Chef d’atelier est créé avec les accès Voir le garage et Prendre une tâche. Seuls les accès cochés sont autorisés.',
  assignRole:
    'Le rôle Chef d’atelier est attribué au nouveau collègue. Ses droits sont désormais calculés à partir de ce rôle.',
  userPermissions:
    'Une autorisation individuelle de consulter le stock est ajoutée. Cette exception est prioritaire sur le réglage du rôle.',
};

export function createTrainingDemonstration(page: string) {
  const tour = createTraining(page);
  tour.state.settings.name = 'Atelier de démonstration';
  tour.state.parts[0].name = 'Filtre à huile (démonstration)';
  let state = tour.state;
  let invitation: { id: string; email: string; role: 'mechanic'; expires: number } | null = null;
  const scenes = tour.steps.map((step) => {
    const vehicle = state.vehicles[0],
      task = vehicle?.tasks[0];
    const customer = state.customers.at(-1)!;
    const part = state.parts.at(-1)!;
    const document = state.documents.at(-1);
    const colleague = state.users.at(-1)!;
    let action: Action | undefined;
    const operation = step.expect?.operation;
    const stage = step.expect?.stage;
    switch (step.type) {
      case 'customer':
        action = {
          type: 'customer',
          name: 'Léa Démonstration',
          email: 'lea@example.invalid',
          phone: '0000000001',
        };
        break;
      case 'vehicle':
        action = {
          type: 'vehicle',
          customerId: customer.id,
          model: 'Audi A3',
          plate: 'TEST-001',
          issue: 'Révision',
          mileage: 45000,
          color: '#cf4141',
          due: new Date().toISOString(),
          priority: false,
        };
        break;
      case 'stage':
        action = {
          type: 'stage',
          id: vehicle.id,
          stage: stage as 'diagnosis' | 'waiting' | 'ready' | 'returned',
        };
        break;
      case 'estimateTask':
        action = { type: 'estimateTask', vehicleId: vehicle.id, taskId: task.id, minutes: 45 };
        break;
      case 'task':
        action = {
          type: 'task',
          vehicleId: vehicle.id,
          taskId: task.id,
          operation: operation as 'assign' | 'start' | 'finish',
          assignees: [state.users[1].id],
          minutes: 45,
        };
        break;
      case 'reserve':
        action = { type: 'reserve', vehicleId: vehicle.id, partId: part.id, quantity: 1 };
        break;
      case 'consume':
        action = { type: 'consume', id: state.reservations.at(-1)!.id };
        break;
      case 'appointment':
        action = {
          type: 'appointment',
          customerId: customer.id,
          model: 'Audi A3',
          plate: 'TEST-001',
          reason: 'Révision',
          at: new Date().toISOString(),
        };
        break;
      case 'arrive':
        action = { type: 'arrive', id: state.appointments[0].id };
        break;
      case 'document':
        action = {
          type: 'document',
          kind: 'estimate',
          vehicleId: vehicle.id,
          lines: [{ label: 'Révision', quantity: 1, unitPrice: 10000 }],
          taxRate: state.settings.country === 'FR' ? 20 : 21,
        };
        break;
      case 'acceptEstimate':
        action = {
          type: 'acceptEstimate',
          id: document!.id,
          evidence: 'Accord téléphonique fictif',
        };
        break;
      case 'convertEstimate':
        action = { type: 'convertEstimate', id: document!.id };
        break;
      case 'validateDocument':
        action = { type: 'validateDocument', id: document!.id };
        break;
      case 'payment':
        action = {
          type: 'payment',
          id: document!.id,
          amount: totals(document!.lines, document!.taxRate).gross,
        };
        break;
      case 'part':
        action = {
          type: 'part',
          reference: 'TEST-PIECE',
          name: 'Filtre de démonstration',
          supplier: 'Fournisseur fictif',
          stock: 3,
          min: 2,
          cost: 1000,
          price: 1800,
        };
        break;
      case 'order':
        action = {
          type: 'order',
          reference: 'TEST-COMMANDE',
          supplier: part.supplier,
          partId: part.id,
          vehicleId: vehicle.id,
          quantity: 5,
          due: new Date().toISOString(),
          unitCost: part.cost,
        };
        break;
      case 'receive':
        action = { type: 'receive', id: state.orders.at(-1)!.id, quantity: 5 };
        break;
      case 'mail':
        action = {
          type: 'mail',
          vehicleId: vehicle.id,
          to: customer.email,
          subject: 'Prise en charge de TEST-001',
          body: 'Bonjour, votre Audi A3 a été prise en charge pour sa révision.',
        };
        break;
      case 'updateMail':
        action = {
          type: 'updateMail',
          id: state.mails[0].id,
          to: customer.email,
          subject: 'Révision de TEST-001',
          body: 'Bonjour, votre Audi A3 a été prise en charge pour sa révision. Nous vous préviendrons dès qu’elle sera prête.',
        };
        break;
      case 'trainingSend': {
        state = structuredClone(state);
        Object.assign(state.mails[0], {
          status: 'sent',
          sentAt: new Date().toISOString(),
          sentBy: state.users[0].name,
        });
        break;
      }
      case 'trainingInvite':
        invitation = {
          id: uid(),
          email: 'collegue@example.invalid',
          role: 'mechanic',
          expires: Date.now() + 86400000,
        };
        break;
      case 'trainingJoin': {
        state = structuredClone(state);
        state.users.push({
          id: uid(),
          name: 'Nouveau collègue',
          role: 'mechanic',
          color: '#8b78b7',
        });
        invitation = null;
        break;
      }
      case 'customRole':
        action = {
          type: 'customRole',
          name: 'Chef d’atelier',
          baseRole: 'mechanic',
          permissions: { 'garage.view': true, 'tasks.work': true },
        };
        break;
      case 'assignRole':
        action = {
          type: 'assignRole',
          userId: colleague.id,
          roleId: state.settings.customRoles!.at(-1)!.id,
        };
        break;
      case 'userPermissions':
        action = {
          type: 'userPermissions',
          userId: colleague.id,
          permissions: { 'stock.view': true },
        };
        break;
      default:
        throw new Error(`Démonstration manquante : ${step.type}`);
    }
    if (action) state = applyTrainingAction(state, action);
    const isVehicle = ['stage', 'estimateTask', 'task', 'reserve', 'consume'].includes(step.type);
    const isDocument = [
      'document',
      'acceptEstimate',
      'convertEstimate',
      'validateDocument',
      'payment',
    ].includes(step.type);
    const scenePage = isDocument
      ? state.documents.at(-1)!.kind === 'invoice'
        ? 'invoices'
        : 'estimates'
      : isVehicle || step.type === 'vehicle'
        ? tour.initialPage === 'garage'
          ? 'garage'
          : 'vehicles'
        : ['appointment', 'arrive'].includes(step.type)
          ? 'planning'
          : ['part', 'order', 'receive'].includes(step.type)
            ? 'inventory'
            : ['mail', 'updateMail', 'trainingSend'].includes(step.type)
              ? 'messages'
              : step.type === 'customer'
                ? 'customers'
                : 'team';
    return {
      state,
      page: scenePage,
      invitation,
      step: { ...step, text: explanations[operation ?? stage ?? step.type] },
      vehicleId: isVehicle ? state.vehicles[0].id : undefined,
      tab: ['reserve', 'consume'].includes(step.type) ? 'parts' : 'work',
      documentId: isDocument ? state.documents.at(-1)!.id : undefined,
    };
  });
  return { title: tour.title, scenes };
}
