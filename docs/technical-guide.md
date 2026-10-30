# Caragem — Guide technique et fonctionnel

Ce guide complète la [présentation du projet](../README.md). Les paramètres personnels et les abonnements sont détaillés dans les guides dédiés.

CRM de garage avec atelier 3D, comptes personnels et accès à plusieurs garages, réalisé en Next.js et TypeScript. La scène prend la forme d’un garage miniature en coupe, avec ponts, équipements, marquages et zones d’intervention.

## Démarrer

Node.js **24 ou supérieur** et une base PostgreSQL sont nécessaires. Renseigner sa propre connexion PostgreSQL dans `.env` à partir de `.env.example`. Les secrets ne doivent pas être publiés.

```sh
npm install
npm run db:migrate
npm run dev
```

Ouvrir http://localhost:3000 pour créer son compte et son premier garage vide. Le bouton portant le nom du garage permet ensuite de changer de garage ou d’en créer un autre. Le même compte peut être responsable dans un garage et mécanicien dans un autre.

Dans **Équipe**, le responsable crée un lien d’invitation personnel à transmettre au collaborateur. Le destinataire crée son compte ou se connecte à son compte existant, puis rejoint le garage. Les liens expirent après 7 jours, sont utilisables une seule fois et peuvent être révoqués. La démonstration nécessite un compte connecté et s’ouvre depuis **Mes garages** : un seul garage de démo par compte, pendant 24 h sans prolongation à la réouverture. Elle est isolée des garages personnels, puis supprimée automatiquement ; elle n’envoie aucun mail réel ni invitation réelle. Voir [les corrections de sécurité](security-fixes.md) pour les quotas et les conditions de déploiement.

### Visite guidée

Au premier accès à son garage, l’utilisateur reçoit une visite guidée des rubriques auxquelles ses permissions donnent accès. La configuration initiale du garage passe en premier. Les étapes mettent en évidence l’interface et changent de rubrique sans modifier les données métier. Les boutons Précédent/Suivant permettent de parcourir le guide ; Plus tard, Passer la visite, la croix et Échap permettent de le fermer.

Les onglets **Mon garage, Clients, Devis, Pièces & stock, Messages et Équipe** proposent un bouton **Visite guidée** en bas à droite. Les onglets Mon travail, Véhicules, Planning, Factures et Paramètres ne répètent pas les visites des parcours proches. Il ouvre une **démonstration isolée**, avec les vrais écrans et des données fictives déjà renseignées. Aucune saisie ni action métier n’est demandée : chaque étape affiche directement son résultat. **Précédent / Suivant** permettent de revoir les étapes à son rythme : arrivée → diagnostic → attente → entretien (attribution, temps, pièces) → contrôle → restitution ; rendez-vous et fiche client ; devis → accord → facture → règlement ; commande → réception → pièce montée ; brouillon → envoi simulé ; invitation → acceptation simulée → rôle personnalisé → attribution → exception individuelle.

La démonstration utilise un patron fictif et des instantanés locaux préparés par les mêmes règles métier que l’application. Les contrôles métier sont désactivés ; seuls les boutons du guide sont actifs. Elle ne copie pas les données du garage, n’utilise ni API ni sockets, n’envoie aucun mail et ne crée aucun compte. Les invitations, acceptations et envois sont simulés ; le téléchargement de PDF est désactivé. Quitter retrouve le garage réel, ses recherches et filtres inchangés. Le bouton du menu conserve la visite générale de première prise en main.

Dans la visite des permissions, les formulaires s’ouvrent automatiquement avec le rôle, son attribution et l’exception individuelle déjà renseignés. Le guide met en évidence les réglages présentés. Les dossiers et les documents s’ouvrent également automatiquement sur les étapes concernées ; les mails sont affichés sans nécessiter d’édition.

Avant chaque changement d’écran, le guide met d’abord en évidence le bouton du menu qui permet d’y accéder. L’utilisateur clique sur ce bouton ou confirme son ouverture depuis la carte du guide, puis découvre le contenu de la rubrique. Sur mobile, le menu s’ouvre automatiquement pour montrer ce chemin.

Le guide peut être relancé depuis **Visite guidée** dans la barre latérale, y compris depuis le menu sur mobile. Sa fermeture est mémorisée en PostgreSQL sur le compte personnel, pour tous ses garages et appareils ; en démonstration, elle est mémorisée par profil. Si l’enregistrement échoue, le guide se ferme et un message prévient qu’il pourra réapparaître à la prochaine connexion.

### Clients et véhicules

Les blocages des dossiers peuvent préciser un motif (accord, pièces, diagnostic, sous-traitance, ressources ou autre), un responsable, une échéance et la prochaine action attendue. Leur date d’ouverture est conservée lors des modifications. Lever un blocage l’archive dans la visite ; une nouvelle visite repart sans les blocages de la précédente. Les anciens textes restent compatibles et les permissions de modification technique s’appliquent.

L’onglet **Photos** d’un dossier permet d’ajouter des clichés d’arrivée, de diagnostic, d’intervention ou de restitution, avec une légende et un constat (observation, conforme, à surveiller, à traiter). Un constat peut créer une tâche sans doublon. Consultation et modification utilisent les permissions techniques du dossier ; l’historique exige aussi son autorisation. Les visites clôturées restent en lecture seule, avec suppression des photos réservée au patron.

Les images sont privées, stockées dans `vehicle_photos` (PostgreSQL), séparément du JSON et des événements sockets ; seules leurs métadonnées accompagnent les dossiers. JPEG, PNG et WebP sont décodés, réorientés, limités à 1600 px et réencodés en JPEG sans métadonnées originales. Limites : 8 Mio / 40 mégapixels à l’entrée, 1 Mio après traitement, 30 photos par visite et 250 Mio par garage. Le stockage devra évoluer vers un stockage objet pour des volumes plus importants. Les exports CSV ne contiennent pas les fichiers image. Les visites guidées ne chargent pas de photos réelles.

Dans **Travaux**, chaque tâche peut recevoir un temps prévu en minutes, dès l’arrivée, lors de sa création ou via **Temps prévu** (permission de gestion des tâches). Une estimation vide signifie « à estimer », distincte de zéro. Le dossier totalise les estimations et les temps passés saisis manuellement à la fin des tâches ; l’écart final n’est affiché que lorsque toutes les tâches sont estimées et terminées. Les durées calendaires des blocages documentés sont séparées des heures de travail. Les anciennes tâches restent compatibles sans estimation et les nouvelles visites ne reprennent pas les anciens temps. La démonstration d’entretien inclut l’estimation.

Un client peut avoir plusieurs véhicules. À l’arrivée, sélectionner le client permet de choisir un véhicule enregistré ou d’en ajouter un nouveau. La plaque et le modèle sont préremplis pour un véhicule connu ; le kilométrage et la couleur peuvent être actualisés pour la nouvelle visite. Un véhicule déjà au garage ne peut pas être enregistré une seconde fois.

Les véhicules existants sont repris automatiquement depuis les dossiers persistés, avec une seule entrée par client et immatriculation, et les informations de la dernière visite. Chaque arrivée conserve un dossier d’intervention distinct. La fiche client regroupe les visites sous chaque véhicule et permet d’enregistrer une nouvelle arrivée directement. Aucune migration destructive n’est nécessaire.

### Permissions du garage

À la création du garage, la configuration propose **Permissions des rôles**. Le patron peut ensuite modifier ces réglages depuis **Paramètres** ou **Équipe**, puis choisir les **Permissions individuelles** de chaque collaborateur : hériter du rôle, autoriser ou interdire. Les exceptions individuelles sont prioritaires. Le patron conserve tous les droits ; la gestion des permissions ne peut pas être déléguée.

Dans **Équipe → Permissions des rôles → Créer un rôle**, le patron peut nommer un rôle personnalisé, choisir ses permissions et le modifier ensuite. Sa fonction de base (Mécanicien ou Accueil) détermine sa présence dans l’atelier 3D ; les accès proviennent uniquement des cases cochées, sans héritage des permissions du rôle de base. Les permissions non cochées sont interdites. Le nom doit être unique dans le garage et distinct des rôles intégrés.

Le bouton **Attribuer un rôle** d’un membre permet de choisir un rôle intégré ou personnalisé. Les exceptions individuelles sont conservées. Les rôles personnalisés sont également disponibles à l’invitation ; les nouveaux membres reçoivent les réglages actuels du rôle à leur arrivée. Les modifications et attributions sont persistées dans PostgreSQL et transmises en direct aux autres sessions. Le patron ne peut pas perdre son accès complet.

Les valeurs par défaut s’appliquent également aux garages existants sans réécriture de leurs données. Elles sont enregistrées dans les données du garage en PostgreSQL, avec les exceptions individuelles. Pour autoriser une action, il faut aussi autoriser la consultation de sa catégorie. Les contrôles côté serveur utilisent les droits actuels et filtrent les réponses HTTP, les PDF et les événements Socket.IO par destinataire.

Par défaut, les mécaniciens suivent les interventions et le stock sans coordonnées clients ni documents financiers. L’accueil prépare les documents mais ne les valide pas et n’enregistre pas les paiements. Une facture préparée doit être validée avant son premier paiement ; les anciennes factures ayant déjà reçu un paiement restent utilisables. Cette validation interne ne constitue pas une certification comptable.

### Connexion Google

Le bouton **Se connecter avec Google** est disponible à l’inscription et à la connexion. Pour l’activer :

1. Dans Google Cloud / Google Auth Platform, configurer l’application et créer un client OAuth de type **Application Web**. En mode test, ajouter les comptes Google autorisés comme utilisateurs de test.
2. Ajouter l’URI de redirection `http://localhost:3000/api/auth/google/callback`. En production, utiliser exactement `${APP_ORIGIN}/api/auth/google/callback` avec l’origine HTTPS réelle.
3. Renseigner `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans `.env`, puis redémarrer le serveur. Ces valeurs restent au serveur ; elles ne doivent pas être préfixées par `NEXT_PUBLIC_`.

Sans ces identifiants, le bouton reste visible mais désactivé et la connexion par mail reste disponible. Aucun identifiant Google de démonstration n’est fourni.

Un nouveau compte Google obtient un garage vide à configurer. Depuis un lien d’invitation, le compte rejoint directement le garage invité, avec le rôle prévu, sans créer de garage supplémentaire. Google est identifié par son `sub`, et non par son adresse mail. Les jetons d’accès Google ne sont pas conservés.

Pour une adresse déjà inscrite avec un mot de passe Caragem, se connecter par mail puis aller dans **Mon compte → Connexion au compte → Connexion Google** pour confirmer le mot de passe et associer explicitement le compte Google de même adresse. Cette association conserve les garages et le mot de passe existants. Les comptes créés uniquement avec Google n’ont pas de mot de passe Caragem.

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
- Garage 3D à angle fixe, déplacement de la vue, zoom par zone, modules configurables, capacité extensible et emplacements stables lors des transferts. La caméra est mémorisée par garage dans l’onglet, y compris après une action, un redimensionnement, une navigation ou un rechargement. Les commandes de zone, de vue d’ensemble et de réinitialisation permettent de recadrer volontairement. Respect du réglage de réduction des animations.
- Salle de repos avec tables, télévision, distributeur et billard. Les mécaniciens sans tâche en cours y apparaissent ; leur nom reste visible dans le garage.
- Clients, dossiers véhicules, visites successives et historique, notes et journal d’activité.
- Tâches avec plusieurs intervenants, attribution par le responsable ou prise d’une tâche disponible, suivi du temps saisi manuellement.
- Rendez-vous, enregistrement de l’arrivée et restitutions prévues.
- Nouveaux véhicules : marque choisie dans une liste alphabétique, modèle saisi librement, dans les arrivées comme dans les rendez-vous. « Autre marque » permet de renseigner une marque absente. Les libellés des véhicules existants sont conservés.
- Pièces, stock disponible/réservé, montage, libération et ajustements justifiés.
- Commandes fournisseurs enregistrées et réceptions partielles.
- Devis, accord client enregistré, conversion en facture, paiements suivis, PDF téléchargeables. **Ce sont des brouillons de travail, pas une solution de facturation certifiée.**
- Ristourne globale facultative à la création des devis et factures : deux champs liés, en euros HT et en pourcentage (0 à 100 %), se mettent à jour mutuellement avec un affichage à deux décimales. Le dernier champ modifié fait référence : un montant en euros reste fixe si les lignes changent, un pourcentage suit le total HT. La ristourne est déduite du HT avant TVA, détaillée dans les totaux et les PDF, conservée lors de la conversion en facture et prise en compte dans le solde à payer. Un montant fixe ne peut pas dépasser le total HT. Les anciens documents conservent leurs montants et leurs ristournes en pourcentage.
- Brouillons de mails préremplis, modifiables et validés manuellement, avec document PDF facultatif. Aucun déclenchement automatique.
- Synchronisation Socket.IO entre les sessions du même garage. Les actions sont validées au serveur ; les clients n’envoient pas un état complet à écraser.

Les données sont conservées dans PostgreSQL, compatible Neon. `accounts`, `memberships`, `sessions` et `invitations` sont des tables relationnelles ; chaque garage conserve ses dossiers métier en JSONB dans `garages`. Les mutations d’un garage verrouillent sa ligne dans une transaction pour préserver les mises à jour concurrentes. Le schéma est dans `src/server/schema.sql`.

Le catalogue de marques est maintenu dans `src/lib/vehicle-makes.ts`. Il couvre des marques actuelles et historiques du marché européen, avec les immatriculations par marque du [VDIK](https://www.vdik.de/en/topics/automotive-market/passenger-car-market/) et du [SMMT](https://www.smmt.co.uk/vehicle-data/car-registrations/) comme références consultées le 29 octobre 2026. La disponibilité varie selon les pays et les nouvelles commercialisations ; « Autre marque » évite de bloquer une saisie absente de la liste. Le catalogue est indépendant des logos 3D disponibles.

### Import de l’ancienne base SQLite

Si une ancienne base existe, le fichier source `data/legacy.sqlite` reste intact. L’import conserve les garages, les mots de passe hachés, les appartenances et les sessions. Si plusieurs anciennes invitations ciblent le même email dans un garage, seul le dernier lien est conservé. La cible doit être vide ; un conflit annule l’ensemble de l’import. Utiliser `--source=chemin/ancienne.sqlite` pour choisir un fichier existant portant un autre nom.

```sh
npm run db:import:sqlite
npm run db:import:sqlite -- --apply
```

La première commande affiche uniquement les quantités à importer. `--source=chemin/ancienne.sqlite` permet de choisir une autre source. L’import doit être déclenché explicitement sur une base cible vide.

## Import et export CSV et Excel

Dans **Paramètres → Importer / exporter les données**, le responsable peut transférer les clients, véhicules et visites (avec tâches et notes), stocks, réservations de pièces, rendez-vous, commandes fournisseurs, devis et factures. Formats CSV, Excel XLS et XLSX, modèles vides, exemples remplis, structure des colonnes, aperçu et confirmation sont inclus. Un import invalide est annulé en totalité ; les données existantes ne sont pas écrasées. Formats et exemples : [guide du transfert](csv-transfer.md). Limite d’import : 1 Mio / 5 000 lignes par fichier. Pour Excel, seule la première feuille est analysée ; les dates doivent être en texte ISO.

## Configuration

Le nom de l’application et les préfixes des cookies, du stockage navigateur et des exports sont désormais `caragem`. Après une mise à jour du nom, les utilisateurs doivent se reconnecter et leurs anciens réglages de caméra locaux peuvent être réinitialisés. Les données métier, la clé de chiffrement et les identifiants Stripe existants sont conservés. Les noms physiques des bases, les connexions privées et les archives SQLite ne sont pas modifiés ; une ancienne archive reste importable en fournissant explicitement `--source=chemin/ancienne.sqlite`.

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
- La facturation légale FR/BE, les avoirs, la récupération de mot de passe et les connecteurs fournisseurs/comptables restent à compléter. Les abonnements, les photos privées et le changement d’adresse vérifié sont désormais implémentés : voir [abonnements](billing.md), [profil](account-profile.md), [sécurité du compte](account-security.md) et [préférences](account-preferences.md).
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
