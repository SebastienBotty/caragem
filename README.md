# CaRM

CRM de garage avec atelier 3D, comptes personnels et accès à plusieurs garages, réalisé en Next.js et TypeScript. La scène est inspirée de `exempleGarage.png` : garage miniature en coupe, ponts, équipements, marquages et zones d’intervention.

## Démarrer

Node.js **24 ou supérieur** et une base PostgreSQL sont nécessaires. Le projet Neon dédié est **CaRM**, à Francfort. La connexion privée se trouve dans `.env` et ne doit pas être publiée.

```sh
npm install
npm run db:migrate
npm run dev
```

Ouvrir http://localhost:3000 pour créer son compte et son premier garage vide. Le bouton portant le nom du garage permet ensuite de changer de garage ou d’en créer un autre. Le même compte peut être responsable dans un garage et mécanicien dans un autre.

Dans **Équipe**, le responsable crée un lien d’invitation personnel à transmettre au collaborateur. Le destinataire crée son compte ou se connecte à son compte existant, puis rejoint le garage. Les liens expirent après 7 jours, sont utilisables une seule fois et peuvent être révoqués. La démonstration reste accessible sans compte ; elle est isolée des garages personnels et n’envoie aucun mail réel.

### Visite guidée

Au premier accès à son garage, l’utilisateur reçoit une visite guidée des rubriques auxquelles ses permissions donnent accès. La configuration initiale du garage passe en premier. Les étapes mettent en évidence l’interface et changent de rubrique sans modifier les données métier. Les boutons Précédent/Suivant permettent de parcourir le guide ; Plus tard, Passer la visite, la croix et Échap permettent de le fermer.

Le guide peut être relancé depuis **Visite guidée** dans la barre latérale, y compris depuis le menu sur mobile. Sa fermeture est mémorisée en PostgreSQL sur le compte personnel, pour tous ses garages et appareils ; en démonstration, elle est mémorisée par profil. Si l’enregistrement échoue, le guide se ferme et un message prévient qu’il pourra réapparaître à la prochaine connexion.

### Clients et véhicules

Un client peut avoir plusieurs véhicules. À l’arrivée, sélectionner le client permet de choisir un véhicule enregistré ou d’en ajouter un nouveau. La plaque et le modèle sont préremplis pour un véhicule connu ; le kilométrage et la couleur peuvent être actualisés pour la nouvelle visite. Un véhicule déjà au garage ne peut pas être enregistré une seconde fois.

Les véhicules existants sont repris automatiquement depuis les dossiers persistés, avec une seule entrée par client et immatriculation, et les informations de la dernière visite. Chaque arrivée conserve un dossier d’intervention distinct. La fiche client regroupe les visites sous chaque véhicule et permet d’enregistrer une nouvelle arrivée directement. Aucune migration destructive n’est nécessaire.

### Permissions du garage

À la création du garage, la configuration propose **Permissions des rôles**. Le patron peut ensuite modifier ces réglages depuis **Paramètres** ou **Équipe**, puis choisir les **Permissions individuelles** de chaque collaborateur : hériter du rôle, autoriser ou interdire. Les exceptions individuelles sont prioritaires. Le patron conserve tous les droits ; la gestion des permissions ne peut pas être déléguée.

Les valeurs par défaut s’appliquent également aux garages existants sans réécriture de leurs données. Elles sont enregistrées dans les données du garage en PostgreSQL, avec les exceptions individuelles. Pour autoriser une action, il faut aussi autoriser la consultation de sa catégorie. Les contrôles côté serveur utilisent les droits actuels et filtrent les réponses HTTP, les PDF et les événements Socket.IO par destinataire.

Par défaut, les mécaniciens suivent les interventions et le stock sans coordonnées clients ni documents financiers. L’accueil prépare les documents mais ne les valide pas et n’enregistre pas les paiements. Une facture préparée doit être validée avant son premier paiement ; les anciennes factures ayant déjà reçu un paiement restent utilisables. Cette validation interne ne constitue pas une certification comptable.

### Connexion Google

Le bouton **Se connecter avec Google** est disponible à l’inscription et à la connexion. Pour l’activer :

1. Dans Google Cloud / Google Auth Platform, configurer l’application et créer un client OAuth de type **Application Web**. En mode test, ajouter les comptes Google autorisés comme utilisateurs de test.
2. Ajouter l’URI de redirection `http://localhost:3000/api/auth/google/callback`. En production, utiliser exactement `${APP_ORIGIN}/api/auth/google/callback` avec l’origine HTTPS réelle.
3. Renseigner `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans `.env`, puis redémarrer le serveur. Ces valeurs restent au serveur ; elles ne doivent pas être préfixées par `NEXT_PUBLIC_`.

Sans ces identifiants, le bouton reste visible mais désactivé et la connexion par mail reste disponible. Aucun identifiant Google de démonstration n’est fourni.

Un nouveau compte Google obtient un garage vide à configurer. Depuis un lien d’invitation, le compte rejoint directement le garage invité, avec le rôle prévu, sans créer de garage supplémentaire. Google est identifié par son `sub`, et non par son adresse mail. Les jetons d’accès Google ne sont pas conservés.

Pour une adresse déjà inscrite avec un mot de passe CaRM, se connecter par mail puis aller dans **Paramètres → Connexion Google** pour confirmer le mot de passe et associer explicitement le compte Google de même adresse. Cette association conserve les garages et le mot de passe existants. Les comptes créés uniquement avec Google n’ont pas de mot de passe CaRM.

Le parcours vérifie PKCE, `state`, `nonce`, signature, audience, émetteur, expiration et adresse Google vérifiée. Les demandes expirent après 10 minutes et sont utilisables une seule fois.

En démonstration, chaque onglet conserve son propre profil. Ouvrir deux onglets du même garage puis choisir un mécanicien dans l’un permet de tester ses actions en direct dans l’onglet du responsable.

```sh
npm run typecheck
npm run format:check
npm test
npm run build
npm start
```

Il faut arrêter le serveur de développement avant de démarrer la production sur le même port. Le script `start` utilise le serveur Node personnalisé, nécessaire à Socket.IO. `next start` seul ne fournit pas l’API métier ni les sockets. L’application doit être hébergée sur un serveur Node persistant ; les fonctions serverless classiques ne suffisent pas à ce déploiement.

## Ce qui fonctionne

- Authentification, comptes indépendants des garages, rôles responsable/accueil/mécanicien par garage, invitations individuelles pour nouveaux comptes et comptes existants.
- Garage 3D à angle fixe, déplacement de la vue, zoom par zone, modules configurables, capacité extensible et emplacements stables lors des transferts. Respect du réglage de réduction des animations.
- Salle de repos avec tables, télévision, distributeur et billard. Les mécaniciens sans tâche en cours y apparaissent ; leur nom reste visible dans le garage.
- Clients, dossiers véhicules, visites successives et historique, notes et journal d’activité.
- Tâches avec plusieurs intervenants, attribution par le responsable ou prise d’une tâche disponible, suivi du temps saisi manuellement.
- Rendez-vous, enregistrement de l’arrivée et restitutions prévues.
- Pièces, stock disponible/réservé, montage, libération et ajustements justifiés.
- Commandes fournisseurs enregistrées et réceptions partielles.
- Devis, accord client enregistré, conversion en facture, paiements suivis, PDF téléchargeables. **Ce sont des brouillons de travail, pas une solution de facturation certifiée.**
- Brouillons de mails préremplis, modifiables et validés manuellement, avec document PDF facultatif. Aucun déclenchement automatique.
- Synchronisation Socket.IO entre les sessions du même garage. Les actions sont validées au serveur ; les clients n’envoient pas un état complet à écraser.

Les données sont conservées dans PostgreSQL, compatible Neon. `accounts`, `memberships`, `sessions` et `invitations` sont des tables relationnelles ; chaque garage conserve ses dossiers métier en JSONB dans `garages`. Les mutations d’un garage verrouillent sa ligne dans une transaction pour préserver les mises à jour concurrentes. Le schéma est dans `src/server/schema.sql`.

### Import de l’ancienne base SQLite

Le fichier `data/carm.sqlite` reste intact. L’import conserve les garages, les mots de passe hachés, les appartenances et les sessions. Si plusieurs anciennes invitations ciblent le même email dans un garage, seul le dernier lien est conservé. La cible doit être vide ; un conflit annule l’ensemble de l’import.

```sh
npm run db:import:sqlite
npm run db:import:sqlite -- --apply
```

La première commande affiche uniquement les quantités à importer. `--source=chemin/ancienne.sqlite` permet de choisir une autre source. L’import n’a pas été appliqué automatiquement au nouveau projet Neon.

## Configuration

Copier `.env.example` vers `.env` si nécessaire, puis renseigner `DATABASE_URL` avec la connexion PostgreSQL / Neon. Elle est lue uniquement au serveur. `APP_ORIGIN` doit être l’origine exacte utilisée par les navigateurs, par exemple `https://garage.example.com`, et `HOST=0.0.0.0` permet l’écoute réseau. En production, utiliser HTTPS : les cookies sont alors marqués Secure. Pour essayer sur téléphone, utiliser une origine réseau accessible et identique sur tous les appareils.

L’envoi réel nécessite `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` et, si nécessaire, `SMTP_USER` / `SMTP_PASS`. Les secrets restent au serveur. Chaque envoi est explicitement validé dans Messages ; le brouillon est conservé en cas d’échec. Les tests d’envoi utilisent un transport simulé, sans email externe.

## Tests PostgreSQL

Configurer `.env.test` à partir de `.env.test.example`, avec une base réservée aux tests. Chaque test utilise un schéma temporaire distinct, supprimé après vérification. Le serveur de test PostgreSQL peut être lancé avec `docker compose -f compose.test.yaml up -d`, ou remplacé par un PostgreSQL local. Les tests n’utilisent jamais `DATABASE_URL` comme cible implicite.

```sh
npm test
```

Les tests couvrent notamment les appartenances multiples, les permissions par garage, les invitations, l’import SQLite, les écritures concurrentes et la synchronisation Socket.IO. Aucun email réel n’est envoyé.

## Limites actuelles

- Un processus Node pour les sockets. PostgreSQL partage les données, mais un adaptateur Socket.IO partagé reste nécessaire avant de multiplier les serveurs applicatifs. Un garage représente un établissement.
- Pas de mode hors connexion : les actions nécessitent le serveur, et la scène se resynchronise à la reconnexion.
- Pas encore de facturation légale FR/BE, avoirs, abonnement SaaS, récupération de mot de passe, vérification d’adresse mail, photos jointes ou connecteurs fournisseurs/comptables.
- L’animation suit des trajets simples ; elle ne simule pas une circulation avec évitement de collisions.
- Le rendu 3D utilise des modèles procéduraux stylisés, sans reproduction exacte des marques automobiles. Les polices Google ont des polices système de remplacement.
- Le rendu WebGL et plusieurs parcours ont été vérifiés dans Chrome automatisé, avec un format mobile simulé. Le confort et la fluidité sur appareils physiques restent à valider. Les tests couvrent aussi TypeScript, le build, les règles métier, les API, les PDF et les échanges Socket.IO en WebSocket et en polling HTTP.

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
- `src/server/database.ts`, `schema.sql`, `store.ts` : PostgreSQL, schéma et transactions.
- `src/server/account-api.ts` : comptes, garages, appartenances et invitations ; `api.ts` : actions métier.
- `src/server/` : sessions, PDF et sockets ; `server.ts` : serveur Next.js et Socket.IO partagé.
- `scripts/` : préparation du schéma et import SQLite sans écrasement.
- `tests/` : tests Node avec PostgreSQL de test isolé.

Le formatage est partagé via `.prettierrc.json`. Lancer `npm run format` pour formater le projet, ou `npm run format:check` pour vérifier sans modifier les fichiers. Les données, dépendances, fichiers générés et logos tiers sont exclus.
