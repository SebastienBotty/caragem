# CaRM

MVP d’un CRM de garage avec atelier 3D, réalisé en Next.js et TypeScript. La scène est inspirée de `exempleGarage.png` : garage miniature en coupe, ponts, équipements, marquages et zones d’intervention.

## Démarrer

Node.js **24 ou supérieur** est nécessaire pour TypeScript natif et SQLite.

```sh
npm install
npm run dev
```

Ouvrir http://localhost:3000 puis **Explorer le garage de démonstration**, ou créer son propre garage. La démonstration est isolée ; le menu du profil permet de tester les mécaniciens. Aucun mail réel n’est envoyé en mode démonstration.

```sh
npm run typecheck
npm run format:check
npm test
npm run build
npm start
```

Il faut arrêter le serveur de développement avant de démarrer la production sur le même port. Le script `start` utilise le serveur Node personnalisé, nécessaire à Socket.IO. `next start` seul ne fournit pas l’API métier ni les sockets. L’application doit être hébergée sur un serveur Node persistant ; les fonctions serverless classiques ne suffisent pas à ce déploiement.

## Ce qui fonctionne

- Authentification, garages isolés, rôles responsable/accueil/mécanicien, invitations individuelles.
- Garage 3D avec rotation, zoom par zone, modules configurables, capacité extensible et déplacements animés. Respect du réglage de réduction des animations.
- Clients, dossiers véhicules, visites successives et historique, notes et journal d’activité.
- Tâches avec plusieurs intervenants, attribution par le responsable ou prise d’une tâche disponible, suivi du temps saisi manuellement.
- Rendez-vous, enregistrement de l’arrivée et restitutions prévues.
- Pièces, stock disponible/réservé, montage, libération et ajustements justifiés.
- Commandes fournisseurs enregistrées et réceptions partielles.
- Devis, accord client enregistré, conversion en facture, paiements suivis, PDF téléchargeables. **Ce sont des brouillons de travail, pas une solution de facturation certifiée.**
- Brouillons de mails préremplis, modifiables et validés manuellement, avec document PDF facultatif. Aucun déclenchement automatique.
- Synchronisation Socket.IO entre les sessions du même garage. Les actions sont validées au serveur ; les clients n’envoient pas un état complet à écraser.

Les données sont conservées dans `data/carm.sqlite` (SQLite WAL), hors du dossier public. Sauvegarder ce dossier avec une sauvegarde SQLite cohérente. Aucun service cloud externe n’est requis pour essayer le MVP.

## Configuration

Copier `.env.example` vers `.env` si nécessaire. `APP_ORIGIN` doit être l’origine exacte utilisée par les navigateurs, par exemple `https://garage.example.com`, et `HOST=0.0.0.0` permet l’écoute réseau. En production, utiliser HTTPS : les cookies sont alors marqués Secure. Pour essayer sur téléphone, utiliser une origine réseau accessible et identique sur tous les appareils.

L’envoi réel nécessite `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` et, si nécessaire, `SMTP_USER` / `SMTP_PASS`. Les secrets restent au serveur. Chaque envoi est explicitement validé dans Messages ; le brouillon est conservé en cas d’échec. Les tests d’envoi utilisent un transport simulé, sans email externe.

## Limites du MVP

- Un processus Node et un établissement par garage. SQLite stocke un document par garage : adapter le stockage et l’adaptateur Socket.IO avant de multiplier les processus ou les serveurs.
- Pas de mode hors connexion : les actions nécessitent le serveur, et la scène se resynchronise à la reconnexion.
- Pas encore de facturation légale FR/BE, avoirs, abonnement SaaS, récupération de mot de passe, vérification d’adresse mail, photos jointes ou connecteurs fournisseurs/comptables.
- L’animation suit des trajets simples ; elle ne simule pas une circulation avec évitement de collisions.
- Le rendu 3D utilise des modèles procéduraux stylisés, sans reproduction exacte des marques automobiles. Les polices Google ont des polices système de remplacement.
- Le contrôle visuel automatisé du navigateur a été indisponible dans l’environnement de création. Le rendu WebGL et le confort sur appareils physiques restent à valider. Les vérifications portent sur TypeScript, le build, les règles métier, les API, les PDF et les échanges Socket.IO.

## Structure

- `src/app/` : App Router et styles.
- `src/components/workspace.tsx` : chargement de la session et choix entre connexion et application.
- `src/components/app-shell.tsx` : navigation et structure générale de l’application.
- `src/components/dashboard.tsx` : vue d’ensemble du garage et activité.
- `src/components/screens/` : un écran par domaine (clients, véhicules, planning, stock, équipe, messages, paramètres).
- `src/components/forms/` : formulaires de création et de configuration.
- `src/components/documents/` : création, détail et liste des devis/factures.
- Les fichiers `management.tsx`, `forms.tsx` et `documents.tsx` regroupent les exports pour conserver les imports existants.
- `src/lib/domain.ts` : types, validation et règles métier ; `src/lib/layout.ts` : agencement des modules.
- `src/server/` : SQLite, API, sessions, PDF et sockets ; `server.ts` : serveur Next.js et Socket.IO partagé.
- `tests/` : tests Node sans base externe.

Le formatage est partagé via `.prettierrc.json`. Lancer `npm run format` pour formater le projet, ou `npm run format:check` pour vérifier sans modifier les fichiers. Les données, dépendances, fichiers générés et logos tiers sont exclus.
