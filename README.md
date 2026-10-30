# CaRM — La gestion d’un garage, en 3D

**Application SaaS de gestion automobile · Projet personnel full-stack · En développement**

CaRM permet de suivre l’activité d’un garage dans un atelier 3D interactif : chaque véhicule occupe une zone correspondant à son étape d’intervention. Le responsable voit l’avancement du travail, les mécaniciens retrouvent leurs tâches et les changements sont partagés en temps réel.

Le projet associe une interface visuelle à une gestion métier complète : clients, véhicules, interventions, pièces, documents et équipe.

![Vue du garage CaRM : atelier 3D, zones d’intervention et suivi des véhicules](docs/images/carm-workshop.png)

_Capture de l’application avec des données fictives. La scène représente un workflow configurable ; elle ne reproduit pas les dimensions physiques d’un établissement._

[Fonctionnalités](#fonctionnalités) · [Choix techniques](#architecture-et-choix-techniques) · [Installation](#installation-locale) · [Tests](#tests-et-vérifications)

## Le problème abordé

Une intervention mobilise plusieurs personnes et dépend souvent d’un accord client, d’une pièce ou d’une disponibilité. CaRM rassemble ces informations autour du véhicule : **où en est-il, qui intervient et quelle est la prochaine action ?**

Le garage miniature sert de point d’entrée aux dossiers. Les vues de gestion et l’espace « Mon travail » permettent ensuite de traiter les opérations détaillées, notamment sur téléphone.

## Fonctionnalités

| Domaine                         | Fonctionnement                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Atelier 3D**                  | Modules configurables, zoom par zone, véhicules reconnaissables par marque et couleur, déplacements entre les étapes et mécaniciens identifiés.             |
| **Interventions**               | Plusieurs intervenants par dossier, tâches, temps prévu et temps saisi, blocages structurés avec responsable, échéance et prochaine action.                 |
| **Clients et véhicules**        | Plusieurs véhicules par client, visites successives, historique, notes et photos privées avec constats convertibles en tâches.                              |
| **Planning et stock**           | Rendez-vous, arrivées, réservations et consommation de pièces, commandes fournisseurs et réceptions partielles.                                             |
| **Documents**                   | Devis, accord client enregistré, conversion en facture, remises, suivi des paiements et génération de PDF. Mails préparés puis validés manuellement.        |
| **Équipe et accès**             | Comptes multi-garages, invitations, rôles personnalisés et exceptions de permissions individuelles.                                                         |
| **Compte personnel**            | Connexion Google ou mot de passe, double authentification, gestion des sessions, changement d’adresse vérifié, notifications et thème clair/sombre/système. |
| **Abonnements**                 | Essai de 14 jours puis 25 € TTC par mois et par garage via Stripe. À expiration, lecture seule et conservation des données.                                 |
| **Prise en main et transferts** | Visites guidées avec scénarios fictifs isolés ; import/export CSV et Excel avec aperçu, validation et confirmation.                                         |

## Architecture et choix techniques

| Couche                 | Technologies                                                  |
| ---------------------- | ------------------------------------------------------------- |
| Interface              | Next.js 16, React 19, TypeScript                              |
| Scène 3D               | Three.js, React Three Fiber et Drei                           |
| API et temps réel      | Serveur Node.js personnalisé, Socket.IO                       |
| Données                | PostgreSQL compatible Neon, requêtes SQL via `pg`             |
| Validation et identité | Zod, OpenID Connect avec PKCE, sessions côté serveur, TOTP    |
| Intégrations           | Stripe Billing, Nodemailer, PDF-lib, Sharp, SheetJS           |
| Vérification           | `node:test`, PostgreSQL de test isolé, TypeScript et Prettier |

### Un serveur qui porte les règles métier

Les clients envoient des actions typées : attribuer une tâche, réserver une pièce ou changer l’étape d’un véhicule. Le serveur valide les données et les permissions, applique l’action dans une transaction, puis diffuse le nouvel état aux sessions autorisées.

Les permissions filtrent aussi les réponses HTTP, les documents et les événements Socket.IO. L’appartenance à un garage et l’identité d’un utilisateur proviennent de sa session vérifiée.

### Des écritures concurrentes maîtrisées

Les comptes, appartenances, sessions et abonnements utilisent des tables relationnelles. Les données métier d’un garage sont regroupées en JSONB. Les mutations verrouillent la ligne du garage avec `SELECT … FOR UPDATE` pour éviter qu’une action écrase celle d’un autre utilisateur.

Ce modèle simplifie les mises à jour atomiques d’un dossier et de ses pièces. Il sérialise les écritures par garage ; une évolution vers davantage de tables métier serait à évaluer pour des volumes et des besoins de reporting plus importants.

### Des frontières explicites pour les intégrations

- **Stripe** : signatures de webhooks vérifiées, clés d’idempotence et état de l’abonnement relu côté serveur. Un retour sur la page de paiement ne suffit pas à ouvrir les droits.
- **Images** : décodage, limites de taille et réencodage avec Sharp. Les photos restent privées ; leurs données binaires ne transitent pas dans les événements du garage.
- **Authentification** : mots de passe hachés avec scrypt, secrets de session hachés en base, secrets TOTP chiffrés et codes de secours à usage unique.
- **Démonstrations** : les visites guidées utilisent des scénarios locaux fictifs, sans écriture dans les dossiers réels ni envoi de mail.

### Repères dans le code

```text
server.ts                   Serveur HTTP partagé par Next.js, l’API et Socket.IO
src/app/                    Pages, layout et styles
src/components/             Atelier 3D, écrans, formulaires et compte personnel
src/lib/domain.ts           Modèle, schémas d’actions et règles métier
src/lib/permissions.ts      Autorisations et filtrage des données par destinataire
src/lib/layout.ts           Placement des modules et trajets dans le garage
src/server/store.ts         Persistance et transactions
src/server/*-api.ts         API métier, comptes et intégrations
tests/                      Tests de logique, d’API, de persistance et de transport
```

Pour une lecture technique, commencer par [`domain.ts`](src/lib/domain.ts), [`store.ts`](src/server/store.ts), [`permissions.ts`](src/lib/permissions.ts) et [`realtime.ts`](src/server/realtime.ts).

## Installation locale

**Prérequis : Node.js 24+, npm et une base PostgreSQL accessible.** Neon peut être utilisé comme PostgreSQL hébergé.

```sh
git clone https://github.com/SebastienBotty/carm.git
cd carm
npm ci
```

Copier [`.env.example`](.env.example) vers `.env`, puis renseigner au minimum :

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/carm
APP_ORIGIN=http://localhost:3000
```

Pour une base hébergée, utiliser la connexion TLS fournie par l’hébergeur. Les identifiants ci-dessus sont des exemples à remplacer.

```sh
npm run db:migrate
npm run dev
```

Ouvrir [localhost:3000](http://localhost:3000), créer un compte et configurer son garage.

**Google, Stripe, SMTP et la double authentification sont optionnels pour un premier lancement.** Leurs variables et prérequis sont détaillés dans les [guides de configuration](#documentation). Sans configuration, les intégrations concernées restent indisponibles ; les données de démonstration ne nécessitent aucun paiement.

### Parcours de découverte

1. Depuis le sélecteur de garage, ouvrir **Mes garages → Ouvrir ma démonstration** pour explorer un garage prérempli. Cet espace est réservé au compte et disponible pendant 24 h.
2. Ouvrir un véhicule depuis la scène, consulter ses travaux et le faire progresser dans les étapes.
3. Tester les scénarios **Visite guidée** pour découvrir le cycle d’une intervention, les documents, le stock et les rôles sans modifier les données réelles.
4. Pour observer le temps réel, ouvrir deux sessions du même garage avec des profils différents. Les profils de démonstration se choisissent depuis l’avatar.

## Tests et vérifications

Les tests d’intégration nécessitent une base PostgreSQL **réservée aux tests**. Copier [`.env.test.example`](.env.test.example) vers `.env.test`. Un environnement Docker est fourni :

```sh
docker compose -f compose.test.yaml up -d
npm test
```

Chaque test crée un schéma temporaire distinct, puis le supprime. La suite couvre notamment les transitions métier, les montants, les stocks, les écritures concurrentes, les permissions, l’isolation des garages, les connexions Socket.IO, la double authentification et le cycle d’abonnement. Les services externes sont simulés dans les tests automatisés.

```sh
npm run typecheck
npm run format:check
npm run build
```

Des parcours navigateur ont également été vérifiés avec Chrome automatisé, en formats bureau et mobile simulé. Ces vérifications ne remplacent pas les essais sur appareils physiques ou avec les services externes réels.

### Exécution en production

Après le build, utiliser `npm start`. Le déploiement nécessite **un processus Node.js persistant**, qui expose l’API et Socket.IO en plus de Next.js. `next start` seul ne lance pas ces services. Si le serveur de développement est encore actif, l’arrêter ou choisir un autre port.

## État du projet et limites

CaRM est une application fonctionnelle en développement. Les principaux points à traiter avant une exploitation commerciale sont identifiés :

- **Documents financiers** : les devis et factures sont des documents de travail ; la conformité de facturation France/Belgique reste à compléter.
- **Intégrations réelles** : les parcours Google, SMTP et Stripe doivent être validés avec la configuration du déploiement, en particulier avant tout paiement réel.
- **Montée en charge** : le temps réel repose actuellement sur un processus Node. Plusieurs instances nécessiteraient notamment un adaptateur Socket.IO partagé.
- **Volumes et exploitation** : les photos sont stockées en PostgreSQL ; un stockage objet est à prévoir pour des volumes importants. Il n’y a pas de mode hors connexion ni de parcours de récupération de mot de passe.

## Documentation

- [Guide technique et fonctionnel](docs/technical-guide.md) — parcours détaillés, configuration Google/SMTP, modèle métier et import de l’ancienne base SQLite.
- [Abonnements Stripe](docs/billing.md) — configuration, cycle de vie et vérifications avant production.
- [Sécurité du compte](docs/account-security.md) — sessions, TOTP et clé de chiffrement.
- [Profil et adresse mail](docs/account-profile.md) — photos de profil et changement d’adresse vérifié.
- [Préférences et notifications](docs/account-preferences.md) — réglages personnels et thèmes.
- [Import/export CSV et Excel](docs/csv-transfer.md) — formats, rapprochement des colonnes et validation.
- [Suivi des corrections de sécurité](docs/security-fixes.md) — mesures appliquées et points de déploiement restants.

Les logos automobiles restent la propriété de leurs titulaires. Les sources et attributions figurent dans [`public/brands/README.md`](public/brands/README.md).
