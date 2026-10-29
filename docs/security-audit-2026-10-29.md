# Audit de sécurité CaRM — 29 octobre 2026

> Rapport initial conservé comme historique. Les corrections et leurs vérifications sont décrites dans [security-fixes.md](security-fixes.md). Le traitement du proxy (SEC-02) reste différé à la demande de l’utilisateur.

## Synthèse

L’audit local identifie **un risque élevé, six risques moyens et deux risques faibles**. Le risque prioritaire est une délégation excessive des invitations : un membre disposant de `team.invite` peut inviter un compte avec un rôle plus puissant que le sien. Le scénario a été reproduit avec l’API et une base PostgreSQL de test isolée.

Les 46 tests existants passent, ainsi que TypeScript. `npm audit --json` ne signale aucune vulnérabilité connue parmi les 171 dépendances comptabilisées. Ces résultats ne couvrent pas les erreurs de logique métier : six constats supplémentaires ont fait l’objet de vérifications ciblées, dont le scénario de délégation.

Ce rapport est une revue du code et des contrôles locaux, pas une certification ni un pentest du service en production. Aucune correction applicative n’est incluse. Des modifications utilisateur étaient en cours pendant la revue ; les résultats décrivent l’arbre de travail examiné, et non uniquement un commit figé.

## Méthode, outils et périmètre

- Skills déjà installés utilisés : `web-security-review`, `api-security-review`, `sca-audit`, `secrets-scan` du plugin Code Security Skills 0.2.11.
- Compléments installés depuis le [catalogue officiel OpenAI](https://github.com/openai/skills/tree/main/skills/.curated) : `security-best-practices`, `security-threat-model`, `security-ownership-map`. Disponibles au prochain tour. Les deux derniers sont préparés pour un approfondissement ; aucune analyse formelle des propriétaires Git ou des menaces selon leur workflow complet n’est revendiquée ici.
- Revue : `server.ts`, API, authentification locale et Google, sessions, Socket.IO, PostgreSQL, permissions, actions métier, génération PDF, SMTP, composants et configuration concernés, import SQLite et tests associés.
- Node 24.19.0, npm 11.17.0 ; vérifications locales sans sollicitation des services Google ou SMTP réels.
- Détection de secrets par motifs sans affichage des valeurs : fichiers suivis et historique Git. Le scan a comptabilisé 123 fichiers suivis et 13 commits ; seules les connexions fictives de `.env.example` et `.env.test.example` ont été détectées. Les fichiers `.env` réels ne figurent pas dans la liste des chemins sensibles suivis ou leur historique contrôlé.
- Aucun scanner spécialisé de secrets n’était disponible. Les motifs couvrent les jetons de fournisseurs usuels, clés privées et identifiants inclus dans des URL ; ils ne prouvent pas l’absence de secrets de formats arbitraires. Les fichiers locaux ignorés ne sont pas couverts.
- Référentiels : OWASP Web Top 10 **2021**, conformément au skill installé, et API Top 10 **2023**. La grille Web est versionnée volontairement ; ce rapport ne prétend pas utiliser la dernière édition.

Hypothèses : service éventuellement accessible sur Internet, plusieurs garages indépendants, données clients et financières sensibles. La présence d’un reverse proxy, ses protections, l’hébergement et les politiques d’exploitation ne sont pas connus ; les constats qui en dépendent sont explicitement conditionnels.

## Architecture et frontières de confiance

Le navigateur utilise React/Next.js, l’API HTTP personnalisée et Socket.IO sur un serveur Node persistant (`server.ts:10`). L’identité provient d’un cookie vérifié côté serveur ; l’identifiant de garage est tiré de la session (`src/server/store.ts:342`). Les actions accèdent au JSONB du garage dans PostgreSQL avec un verrou transactionnel (`src/server/store.ts:105`). Les diffusions temps réel réutilisent le filtrage des permissions (`src/server/realtime.ts:8`).

Les frontières externes sont navigateur → serveur, serveur → PostgreSQL, serveur → fournisseur Google et serveur → SMTP. Les actifs principaux sont les comptes, sessions, invitations, données clients, plaques et interventions, devis/factures, stock et disponibilité du service. Les scénarios examinés concernent un visiteur anonyme, un membre à permissions restreintes et un attaquant ayant déjà volé une session. Aucun accès administrateur à l’hébergement n’est supposé.

## Inventaire de la surface API

| Surface                                                               | Accès et contrôles observés                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /api/session`                                                    | Public ; renvoie un état vide sans session, une projection autorisée sinon             |
| `GET /api/invitation`                                                 | Public avec jeton et email concordants, expiration vérifiée                            |
| `POST /api/demo`, `/api/login`, `/api/register`                       | Public ; origine exacte, JSON limité, limite commune par adresse réseau                |
| `GET /api/auth/google/status`                                         | Public ; indicateur de disponibilité                                                   |
| `POST /api/auth/google/start`                                         | Public pour connexion ; session et mot de passe pour association ; limite par adresse  |
| `GET /api/auth/google/callback`                                       | Transaction liée au navigateur, state, nonce, PKCE et jeton signé                      |
| `GET /api/invitations` ; `POST /api/invite`, `/api/revoke-invitation` | Session et permission `team.invite`                                                    |
| `POST /api/onboarding`, `/api/logout`, `/api/demo-user`               | Session ; changement d’identité limité aux garages de démonstration                    |
| `POST /api/garages`, `/api/switch-garage`, `/api/accept-invitation`   | Compte personnel ; appartenance ou invitation vérifiée                                 |
| `POST /api/password`                                                  | Session personnelle et mot de passe actuel                                             |
| `POST /api/actions`                                                   | Session, schéma discriminé, permissions et références au garage courant                |
| `GET /api/document/:id`                                               | Session, documents et garage autorisés ; historique si dossier restitué                |
| `POST /api/send-mail`                                                 | Session et permissions clients/mail ; document/historique selon contenu ; démo bloquée |
| `/socket.io/`                                                         | Origine ou Referer contrôlé, session vérifiée, salon décidé au serveur                 |

Les requêtes autres que GET exigent une origine acceptée (`src/server/api.ts:42`). Cela protège contre le CSRF navigateur ; un script autonome peut fournir cet en-tête et reste soumis à l’authentification et aux quotas applicatifs.

## Constats élevés

### SEC-01 — Les invitations permettent une élévation indirecte des permissions

- **Gravité : élevée ; confiance : élevée ; CWE-269 ; OWASP A01 / API5.**
- **Emplacements :** `src/server/store.ts:390`, `src/server/store.ts:269`, `src/server/account-api.ts:174`.
- **Préconditions :** un membre non responsable possède `team.invite` ; un rôle de base ou personnalisé disponible accorde une permission qu’il ne possède pas. Par défaut, les mécaniciens n’ont pas `team.invite` : ce n’est pas une attaque anonyme ou ouverte à tout membre.
- **Impact :** le membre peut créer un second compte ayant accès à la configuration, aux documents ou à d’autres capacités supérieures, selon les rôles disponibles. Le rôle propriétaire n’est pas attribuable par cette route.
- **Preuve :** un propriétaire crée un rôle personnalisé avec `garage.configure=true`, puis délègue uniquement `team.invite` à un mécanicien. Celui-ci appelle `POST /api/invite` avec ce `customRoleId`, obtient HTTP 200 et inscrit un second compte avec le jeton. `can(..., 'garage.configure')` retourne `false` pour l’invitant et `true` pour le nouveau membre. L’inscription locale ne demande pas de preuve de contrôle de l’email.
- **Cause :** `invite()` vérifie le droit d’inviter et l’existence du rôle, sans limiter les permissions pouvant être déléguées. `join()` applique ensuite ce rôle.
- **Correction :** définir explicitement les rôles qu’un invitant peut attribuer. La solution minimale consiste à réserver les invitations au propriétaire ; si la délégation est nécessaire, vérifier les permissions effectives du rôle cible, et empêcher toute réattribution plus puissante lors de l’acceptation après modification du rôle. Tester aussi les rôles de base et les refus individuels.

## Constats moyens

### SEC-02 — Le quota d’authentification peut bloquer tous les utilisateurs derrière un proxy

- **Gravité : moyenne, conditionnelle au déploiement ; confiance : élevée sur le code ; CWE-307 ; OWASP A04 / API4.**
- **Emplacements :** `src/server/auth-rate-limit.ts:1`, `src/server/account-api.ts:89`, `src/server/google-auth.ts:66`.
- **Preuve :** les 40 premiers appels à `authAttemptAllowed()` pour une même adresse passent ; le 41e est refusé. La clé vient de `req.socket.remoteAddress`, commune aux utilisateurs lorsque le proxy ouvre les connexions vers Node avec sa propre adresse. Démo, inscription, connexion et démarrage Google partagent ce compteur.
- **Impact :** un visiteur peut consommer le quota et empêcher les connexions des autres utilisateurs pendant la fenêtre de 15 minutes. Le compteur en mémoire est indépendant par processus et disparaît au redémarrage.
- **Correction :** limiter au proxy et/ou utiliser une adresse issue exclusivement de proxys explicitement approuvés, avec quotas par compte et adresse adaptés. Ne pas faire confiance directement à un `X-Forwarded-For` fourni par Internet. Séparer l’usage démo des connexions réelles. Vérifier la topologie réelle avant modification.

### SEC-03 — Les démonstrations et créations de garages consomment du stockage sans limite durable

- **Gravité : moyenne ; confiance : élevée ; CWE-770 ; OWASP A04 / API4 / API6.**
- **Emplacements :** `src/server/account-api.ts:94`, `src/server/store.ts:78`, `src/server/store.ts:98`, `src/server/store.ts:179`, `src/server/store.ts:384`.
- **Preuve :** trois appels anonymes à `/api/demo`, suivis chacun d’un logout, laissent trois garages supplémentaires en PostgreSQL. Aucune suppression des garages de démonstration n’apparaît dans le code examiné ; l’expiration ne concerne que les sessions. Un compte peut également créer des garages sans quota métier.
- **Impact :** accumulation de JSONB, hausse du stockage et des coûts ; chaque action relit/réécrit l’état du garage, puis peut le diffuser aux connexions. La limite de 128 000 octets concerne chaque requête, pas la taille totale d’un garage.
- **Correction :** durée de vie et purge contrôlée des démonstrations, quota de création par compte et limites raisonnables des collections/connexions. La purge devra cibler explicitement `demo=true` et préserver les données personnelles. Aucun test de saturation n’a été effectué.

### SEC-04 — Les vérifications du mot de passe actuel ne sont pas limitées

- **Gravité : moyenne ; confiance : élevée ; CWE-307 ; OWASP A07 / API2 / API4.**
- **Emplacements :** `src/server/account-api.ts:194`, `src/server/google-auth.ts:66`.
- **Preuve :** 45 appels consécutifs à `/api/password` avec une session valide et un mot de passe actuel incorrect retournent tous HTTP 400, sans HTTP 429. La fonction de limitation n’est appelée que pour les routes publiques listées et le démarrage Google.
- **Impact :** après vol d’une session, essais répétés du secret actuel, pouvant mener à une prise de contrôle durable si le mot de passe est découvert ; coût scrypt répété côté serveur. Une session seule ne suffit pas à changer directement le mot de passe.
- **Correction :** appliquer un quota par compte et session aux réauthentifications sensibles, avec réponse 429 et journalisation des refus. Ne pas provoquer un verrouillage permanent du compte légitime.

### SEC-05 — Le coût scrypt est inférieur aux configurations minimales OWASP

- **Gravité : moyenne ; confiance : élevée ; CWE-916 ; OWASP A02.**
- **Emplacements :** `src/server/store.ts:16`, `src/server/store.ts:20`.
- **Preuve :** les appels n’indiquent aucune option scrypt. Un hash généré par l’application a été reproduit exactement avec `N=16384, r=8, p=1`, les valeurs par défaut Node. OWASP recommande notamment `N=2^17, r=8, p=1`, ou à `N=2^14` un parallélisme `p=5`.
- **Impact :** résistance réduite au cassage hors ligne après compromission de la base. Le sel aléatoire et la comparaison en temps constant sont présents ; les mots de passe ne sont pas stockés en clair.
- **Correction :** calibrer le coût sur le serveur réel, ajuster `maxmem`, stocker les paramètres avec chaque hash et rehasher progressivement à la connexion. Changer seulement les paramètres de vérification rendrait les anciens comptes inaccessibles.
- **Sources :** [valeurs par défaut Node](https://nodejs.org/download/release/v26.9.0/docs/api/crypto.html), [recommandations OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

### SEC-07 — La journalisation métier ne constitue pas un journal de sécurité

- **Gravité : moyenne ; confiance : élevée sur le dépôt ; CWE-778 ; OWASP A09.**
- **Emplacements :** `src/lib/domain.ts:347`, `src/server/account-api.ts:88`, `src/server/store.ts:390`, `src/server/store.ts:465`, `src/server/api.ts:157`.
- **Preuve :** l’activité métier est limitée aux 500 dernières entrées dans l’état JSONB. Les échecs de connexion, refus de permissions, créations/révocations d’invitation et changements de mot de passe ne disposent pas d’un journal de sécurité structuré dans les chemins examinés. Le catch de l’API répond au client sans journaliser les erreurs inattendues.
- **Impact :** investigation et détection difficiles après abus de comptes ou de délégation. Une journalisation externe éventuelle n’a pas été inspectée.
- **Correction :** événements structurés séparés de l’activité métier, contenant identifiants internes d’acteur/garage, action, résultat et horodatage ; stockage à accès limité et rétention définie. Exclure mots de passe, cookies, jetons d’invitation et paramètres OAuth des journaux.

### SEC-09 — Le transport SMTP n’exige pas STARTTLS hors du port 465

- **Gravité : moyenne, conditionnelle au serveur/réseau SMTP ; confiance : élevée sur la configuration ; CWE-319 ; OWASP A02.**
- **Emplacement :** `src/server/api.ts:103`.
- **Preuve :** `secure` est activé uniquement avec `SMTP_PORT=465` ; `requireTLS` n’est pas défini. Nodemailer utilise STARTTLS quand il est annoncé, mais ne l’exige pas par défaut.
- **Impact :** si le serveur SMTP n’annonce pas STARTTLS, les données clients et pièces jointes peuvent transiter en clair. Aucun déclassement TLS ni envoi réel n’a été tenté ; la configuration SMTP de production reste inconnue.
- **Correction :** TLS implicite sur 465 ou `requireTLS: true` sur le transport SMTP de production ; conserver la vérification des certificats. Un relais local approuvé peut nécessiter une politique distincte documentée.
- **Source :** [options TLS du transport Nodemailer](https://nodemailer.com/smtp).

## Constats faibles

### SEC-06 — Des exceptions internes sont renvoyées telles quelles au client

- **Gravité : faible ; confiance : élevée ; CWE-209 ; OWASP A05 / API8.**
- **Emplacement :** `src/server/api.ts:157`.
- **Preuve :** une exception interne injectée dans `store.account()` avec un message sentinelle est renvoyée mot pour mot par `/api/login`. Le catch traite toutes les instances de `Error` comme des erreurs présentables et utilise HTTP 400, y compris pour des incidents internes.
- **Impact :** des messages PostgreSQL ou internes peuvent divulguer des détails techniques. Aucun secret réel n’a été extrait pour cette preuve.
- **Correction :** distinguer les erreurs métier autorisées des exceptions inattendues ; réponse générique HTTP 500 et identifiant de corrélation pour ces dernières, détail réservé au journal serveur.

### SEC-08 — La protection contre l’intégration en iframe n’est pas définie dans l’application

- **Gravité : faible, conditionnelle aux en-têtes du proxy et au navigateur ; confiance : élevée sur le code, exploitation non démontrée ; CWE-1021 ; OWASP A05 / API8.**
- **Emplacements :** `next.config.ts:2`, `server.ts:16`, `src/app/layout.tsx:15`.
- **Preuve :** absence de `Content-Security-Policy: frame-ancestors` et `X-Frame-Options` dans les configurations et chemins serveur examinés. Les en-têtes d’un éventuel frontal n’ont pas été vérifiés.
- **Impact :** risque de clickjacking selon le contexte d’intégration. `SameSite=Strict` réduit l’exposition authentifiée dans une iframe intersite, mais n’est pas une politique explicite d’intégration et ne couvre pas tous les scénarios same-site.
- **Correction :** définir `frame-ancestors 'none'` ou une liste d’origines requises, et vérifier les réponses HTML réelles. Une CSP plus large est une défense complémentaire à calibrer avec Next.js et la 3D ; aucune XSS n’a été démontrée.

## Couverture OWASP Web 2021

| Catégorie            | Résultat local                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A01 Contrôle d’accès | SEC-01 ; isolation inter-garages et filtrage des permissions couverts par tests                                                       |
| A02 Cryptographie    | SEC-05, SEC-09 ; HTTPS et chiffrement au repos de production non inspectés                                                            |
| A03 Injections       | SQL paramétré observé ; pas de sink HTML brut, eval ou exécution de commande pilotée par requête identifié ; pas de fuzzing exhaustif |
| A04 Conception       | SEC-02, SEC-03 ; schémas serveur et transitions métier contrôlées                                                                     |
| A05 Configuration    | SEC-06, SEC-08 ; frontal et cloud hors périmètre                                                                                      |
| A06 Composants       | npm audit : zéro vulnérabilité connue ; ne vérifie pas la malveillance ou la maintenance de tous les paquets                          |
| A07 Authentification | SEC-04 ; sessions et OIDC vérifiés dans les tests existants                                                                           |
| A08 Intégrité        | Lockfile présent, import transactionnel sans écrasement ; pipeline CI/CD et protections du dépôt distant non inspectés                |
| A09 Journalisation   | SEC-07                                                                                                                                |
| A10 SSRF             | Pas d’URL arbitraire fournie par une requête et récupérée côté serveur identifiée ; destinations Google/SMTP configurées côté serveur |

## Couverture OWASP API 2023

| Catégorie                  | Résultat local                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| API1 BOLA                  | Contrôles d’appartenance et références au garage courant ; tests inter-garages passent                            |
| API2 Authentification      | SEC-04 ; cookies et OIDC contrôlés                                                                                |
| API3 Propriétés            | Projection commune HTTP/socket ; permissions d’écriture côté serveur ; pas de mass assignment privilégié démontré |
| API4 Ressources            | SEC-02, SEC-03, SEC-04 ; charge/volumétrie non mesurées                                                           |
| API5 Fonctions             | SEC-01                                                                                                            |
| API6 Flux métier           | SEC-03 ; aucun paiement externe ni webhook exposé identifié                                                       |
| API7 SSRF                  | Pas de surface utilisateur arbitraire identifiée                                                                  |
| API8 Configuration         | SEC-06, SEC-08                                                                                                    |
| API9 Inventaire            | Routes HTTP et socket recensées ci-dessus ; environnements déployés inconnus                                      |
| API10 Consommation externe | OIDC signé, state/nonce/PKCE ; SMTP : SEC-09 ; aucun webhook entrant identifié                                    |

## Contrôles positifs et choix à préserver

- Sessions aléatoires de 32 octets, seul leur SHA-256 est persisté ; expiration de sept jours, rotation à l’authentification, révocation après changement de mot de passe (`src/server/store.ts:324`, `src/server/account-api.ts:29`).
- Cookies HttpOnly/SameSite=Strict ; Secure dépend de l’origine HTTPS configurée (`src/server/http.ts:5`). L’absence de TLS du serveur local n’est pas qualifiée de faille de production.
- OAuth Google : PKCE S256, state, nonce, signature, email vérifié, transaction liée au navigateur et à usage unique ; association à un compte existant explicite avec confirmation du mot de passe (`src/server/google-auth.ts:16`, `src/server/google-auth.ts:89`, `src/server/store.ts:202`).
- Vérification des permissions côté serveur, relecture lors des mutations et filtrage commun des réponses HTTP/socket ; une identité démo ne permet pas d’usurper un compte réel.
- SQL paramétré, verrouillage des modifications du garage et transactions sur les inscriptions/invitations ; tests de concurrence présents.
- Schémas Zod, limite de corps HTTP et socket à 128 000 octets ; documents limités à 100 lignes.
- SMTP désactivé dans les démos ; contenu mail texte, accès fichier et URL désactivés pour Nodemailer (`src/server/api.ts:83`, `src/server/api.ts:131`).
- Métadonnées des véhicules enregistrés accessibles sans l’historique : comportement explicitement couvert par les tests, donc non classé comme contournement de `history.view`. Les coordonnées clients sont filtrées selon `customers.view` ; les noms nécessaires aux dossiers restent visibles.
- `.env*`, données locales et résultats de tests ignorés ; aucun secret confirmé dans les motifs et chemins contrôlés.

## Vérifications réalisées

| Vérification            | Résultat                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `npm.cmd audit --json`  | 0 critique / élevée / moyenne / faible, 171 dépendances comptabilisées                                        |
| `npm.cmd test`          | 46 réussites, 0 échec, 0 ignoré                                                                               |
| `npm.cmd run typecheck` | Réussite                                                                                                      |
| PoC SEC-01              | Invitation HTTP 200 ; nouveau compte disposant de `garage.configure` absent chez l’invitant                   |
| PoC SEC-02              | Un compteur commun accepte 40 appels pour une adresse puis refuse le suivant ; topologie proxy non reproduite |
| PoC SEC-03              | 3 créations démo + 3 logouts = 3 garages persistants supplémentaires                                          |
| PoC SEC-04              | 45 refus du mot de passe actuel sans limitation 429                                                           |
| PoC SEC-05              | Hash applicatif identique à scrypt explicite N=16384/r=8/p=1                                                  |
| PoC SEC-06              | Message d’erreur interne sentinelle renvoyé au client                                                         |
| Secrets                 | Deux exemples fictifs seulement parmi les motifs détectés ; historique contrôlé sans afficher de valeurs      |

Les PoC sont conservés localement dans `test-results/security-audit.mjs` et `test-results/security-secrets-scan.py`, ignorés par Git. Le script Node utilise `tests/helpers/database.ts`, crée un schéma temporaire et le supprime en fin de traitement ; utiliser uniquement `TEST_DATABASE_URL` d’une base de test. Reproduction locale :

```powershell
node --env-file-if-exists=.env.test --disable-warning=ExperimentalWarning test-results/security-audit.mjs
python test-results/security-secrets-scan.py
```

La première tentative de démarrer le cluster local référencé a échoué car le port 55432 était déjà occupé. Les tests ont ensuite réussi avec la base de test existante ; aucun serveur existant n’a été arrêté. Aucun test de charge, email réel ou appel OAuth réel n’a été effectué.

## Ordre des corrections recommandé

1. Corriger SEC-01 et ajouter un test d’interdiction d’invitation vers un rôle plus puissant.
2. Confirmer la topologie proxy et traiter SEC-02 ; limiter les réauthentifications (SEC-04) et les créations/persistances (SEC-03).
3. Versionner et calibrer les hashes avant toute migration scrypt (SEC-05) ; exiger TLS SMTP selon l’environnement (SEC-09).
4. Ajouter les événements de sécurité, masquer les erreurs inattendues et vérifier les en-têtes du frontal (SEC-07, SEC-06, SEC-08).
5. Sur un environnement de recette représentatif : tests navigateur de clickjacking, vérification HTTPS/cookies/CORS/socket, revue des accès PostgreSQL, sauvegardes et restauration, dépendances de déploiement, secrets et CI/CD. Les protections de production restent à vérifier avant de conclure sur l’ensemble de l’application déployée.

Les scores sont qualitatifs et contextualisés, sans CVSS chiffré non justifié. Les recommandations d’autorisation suivent la [fiche OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), notamment la validation systématique des droits.
