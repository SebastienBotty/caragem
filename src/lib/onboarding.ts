import type { GarageState, User } from './domain.ts';
import { can, type Permission } from './permissions.ts';

export function onboardingSteps(state: GarageState, user: User) {
  const steps: {
    id: string;
    page: string;
    target: string;
    title: string;
    text: string;
    permission?: Permission;
  }[] = [
    {
      id: 'garage',
      page: 'garage',
      target: '.garage-view',
      title: 'Votre garage prend vie',
      text: 'Chaque zone représente une étape d’intervention. Déplacez la vue en glissant et zoomez avec la molette ou les boutons. Cliquez sur une voiture pour ouvrir son dossier.',
      permission: 'garage.view',
    },
    {
      id: 'arrival',
      page: 'garage',
      target: '[data-tour="arrival"]',
      title: 'Accueillir un véhicule',
      text: 'Enregistrez une arrivée en sélectionnant le client, puis l’un de ses véhicules ou un nouveau. Un dossier distinct conserve les travaux et le suivi de chaque visite.',
      permission: 'vehicles.create',
    },
    {
      id: 'customers',
      page: 'customers',
      target: '[data-tour="content"]',
      title: 'Les clients et leurs véhicules',
      text: 'Un client peut avoir plusieurs voitures. Retrouvez ses coordonnées, ses véhicules enregistrés et les visites auxquelles vous avez accès.',
      permission: 'customers.view',
    },
    {
      id: 'tasks',
      page: 'tasks',
      target: '[data-tour="content"]',
      title: 'Suivre le travail de l’équipe',
      text: can(state, user, 'tasks.work')
        ? 'Dans Mon travail, retrouvez vos tâches. Prenez un travail disponible, commencez-le puis terminez-le en indiquant le temps passé. Plusieurs personnes peuvent intervenir sur un même véhicule.'
        : 'Consultez les tâches de l’équipe et les intervenants de chaque véhicule. Les actions disponibles dépendent des permissions accordées par le patron.',
      permission: 'garage.view',
    },
    {
      id: 'planning',
      page: 'planning',
      target: '[data-tour="content"]',
      title: 'Anticiper les arrivées et les départs',
      text: 'Le planning rassemble les rendez-vous et les restitutions prévues. Les personnes autorisées peuvent y enregistrer les rendez-vous et confirmer l’arrivée des véhicules.',
      permission: 'planning.view',
    },
    {
      id: 'stock',
      page: 'inventory',
      target: '[data-tour="content"]',
      title: 'Retrouver les bonnes pièces',
      text: 'Consultez le stock disponible. Depuis un dossier véhicule, les personnes autorisées peuvent réserver des pièces et déclarer celles qui ont été montées.',
      permission: 'stock.view',
    },
    {
      id: 'documents',
      page: 'estimates',
      target: '[data-tour="content"]',
      title: 'Préparer et suivre les documents',
      text: 'Les devis et factures sont liés au dossier du véhicule. Préparation, validation et paiements disposent de permissions distinctes. Une facture doit être validée avant son premier paiement.',
      permission: 'documents.view',
    },
    {
      id: 'messages',
      page: 'messages',
      target: '[data-tour="content"]',
      title: 'Garder la main sur les mails',
      text: 'Relisez les destinataires, le contenu et les pièces jointes avant l’envoi. Chaque mail doit être validé manuellement : rien ne part automatiquement.',
      permission: 'mail.send',
    },
    {
      id: 'team',
      page: 'team',
      target: '[data-tour="content"]',
      title: 'Un garage, une équipe',
      text:
        user.role === 'owner'
          ? 'Invitez les collaborateurs à rejoindre votre garage. Vous pouvez adapter les permissions des rôles et définir des exceptions pour chaque personne.'
          : 'Retrouvez les membres du garage et les travaux qui leur sont attribués. Le patron définit les permissions de chacun.',
    },
    {
      id: 'settings',
      page: 'settings',
      target: '[data-tour="content"]',
      title: 'Vous êtes prêt !',
      text: 'Retrouvez les réglages du garage et de votre compte dans Paramètres. La Visite guidée du menu relance ce parcours général. Le bouton en bas à droite de chaque onglet lance un entraînement interactif avec des données fictives.',
    },
  ];
  return steps.filter((step) => !step.permission || can(state, user, step.permission));
}

export function onboardingRoute(state: GarageState, user: User, initialPage: string) {
  const labels: Record<string, string> = {
    garage: 'Mon garage',
    customers: 'Clients',
    tasks: 'Mon travail',
    planning: 'Planning',
    inventory: 'Pièces & stock',
    estimates: 'Devis',
    messages: 'Messages',
    team: 'Équipe',
    settings: 'Paramètres',
  };
  let previousPage = initialPage;
  return onboardingSteps(state, user).flatMap((step) => {
    const content = { ...step, navigation: '' };
    const changesPage = step.page !== previousPage;
    previousPage = step.page;
    if (!changesPage) return [content];
    const label = labels[step.page];
    return [
      {
        ...step,
        id: `${step.id}-navigation`,
        navigation: label,
        target: `[data-tour-nav="${step.page}"]`,
        title: `Ouvrir ${label}`,
        text: `Dans le menu, cliquez sur « ${label} ». Le bouton mis en évidence permet d’accéder à cette rubrique.`,
      },
      content,
    ];
  });
}
