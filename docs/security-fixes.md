# Corrections de l’audit de sécurité du 29 octobre 2026

Huit points traités dans l’application ; SEC-02 est différé à la demande de l’utilisateur. Le choix de l’hébergement déterminera la configuration du proxy, le partage des compteurs entre instances et la collecte durable des journaux.

| Point                     | État                                                    |
| ------------------------- | ------------------------------------------------------- |
| SEC-01 Invitations        | Corrigé, contrôles à l’émission et à l’acceptation      |
| SEC-02 Proxy              | Différé sur demande                                     |
| SEC-03 Ressources         | Démo unique sur compte, expiration/purge et quotas      |
| SEC-04 Réauthentification | Quota par compte commun aux sessions                    |
| SEC-05 Mots de passe      | Scrypt renforcé, migration compatible                   |
| SEC-06 Erreurs            | Messages internes masqués                               |
| SEC-07 Journaux           | Événements JSON ; collecte à configurer à l’hébergement |
| SEC-08 Iframes            | En-têtes appliqués au HTML et à l’API                   |
| SEC-09 SMTP               | TLS obligatoire, certificats vérifiés                   |

Vérification finale : 60 tests réussis, TypeScript et build de production réussis ; `npm audit` ne signale aucune vulnérabilité connue sur les 171 dépendances comptabilisées. Un test Chrome du parcours de démo utilise un schéma PostgreSQL temporaire et aucun service Google/SMTP réel. Les scénarios de reproduction et captures locaux sont dans `test-results/`, exclus de Git.

## SEC-01 — Invitations

Un membre peut uniquement inviter vers un rôle dont toutes les permissions effectives sont comprises dans les siennes. Le contrôle est répété à l’acceptation, avec les permissions et le rôle actuels, sous verrou transactionnel du garage. Le propriétaire conserve la capacité d’inviter vers tous les rôles non propriétaires.

Les invitations antérieures à cette migration ne permettent pas d’identifier leur émetteur : elles doivent être renouvelées. Les comptes et appartenances existants sont conservés, ainsi que les données importées depuis SQLite.

Validation : `tests/security-invitations.test.ts` et tests existants de comptes, permissions, rôles et import SQLite.

## SEC-06 — Erreurs internes

Les erreurs métier explicitement classées `UserError` et les erreurs de validation restent présentables avec HTTP 400. Les exceptions inattendues renvoient HTTP 500 avec un message générique et un identifiant de corrélation, sans contenu PostgreSQL ni secret.

Validation : `tests/security-api.test.ts`, ainsi que les tests API, permissions, domaine et Google.

## SEC-05 — Hashes de mots de passe

Les nouveaux hashes scrypt contiennent leur version et utilisent N=32768, r=8, p=3 (configuration minimale OWASP, environ 32 Mio par calcul). Les anciens hashes sont encore vérifiés et migrent automatiquement après une connexion réussie. Une comparaison SQL protège contre l’écrasement d’un changement de mot de passe concurrent. Les formats et paramètres inattendus sont refusés.

Validation : `tests/security-passwords.test.ts`, migration HTTP dans `tests/security-api.test.ts` et tests existants de comptes, Google, sessions et import. La latence est mesurée localement ; la calibration de charge sur le futur serveur reste nécessaire.

## SEC-04 — Confirmation du mot de passe

Les changements de mot de passe et associations Google partagent un quota de 10 tentatives par compte pendant 15 minutes, indépendant des autres comptes et des différentes sessions du même compte. Le dépassement retourne HTTP 429. Le quota expire automatiquement.

Validation : régression HTTP multi-session et multi-compte, expiration avec horloge simulée et tests Google existants. Comme le compteur existant, ce quota est local au processus ; son partage entre instances sera à adapter lors du choix d’hébergement.

## SEC-02 — Configuration du proxy différée

À la demande de l’utilisateur, les règles d’identification réseau et la protection des connexions publiques derrière un proxy ne sont pas modifiées avant le choix de l’hébergement. Le risque d’un quota partagé via l’adresse du proxy reste donc ouvert. Aucun en-tête `X-Forwarded-For` n’est accepté aveuglément.

## SEC-08 — Interdiction des iframes

Le serveur applique `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'`, `X-Frame-Options: DENY` et `X-Content-Type-Options: nosniff` aux réponses HTML et API. Les scripts Next.js et le rendu WebGL ne sont pas restreints par une politique de scripts ajoutée arbitrairement.

Validation : vérification des vrais en-têtes HTTP dans `tests/security-api.test.ts`. Les réponses du frontal de production resteront à contrôler après déploiement.

## SEC-09 — Chiffrement SMTP obligatoire

Le transport exige TLS : connexion implicite sur le port 465, ou STARTTLS obligatoire sur les autres ports. TLS 1.2 minimum et vérification des certificats sont explicites. Un serveur sans STARTTLS provoque un échec d’envoi ; le brouillon est conservé. Aucun contournement en clair n’est activé.

Validation : le test HTTP/PDF/mail existant vérifie les options réellement transmises au transport simulé. Aucun email réel n’est envoyé ; le certificat et la disponibilité du futur serveur SMTP restent à vérifier.

## SEC-07 — Journal de sécurité

Les opérations POST et refus HTTP, erreurs internes, authentifications socket et résultats OAuth produisent des événements JSON indépendants de l’activité métier. Les événements contiennent horodatage, type, résultat, route normalisée, statut, identifiants internes d’acteur/garage, type d’action validé et identifiant de corrélation lorsqu’ils sont disponibles. Les erreurs internes utilisent le même identifiant que la réponse client.

Une liste explicite de champs exclut corps de requête, email, mot de passe, cookie, URL complète, jetons et message d’exception. Les routes inconnues sont normalisées pour éviter de journaliser une donnée placée dans le chemin. Aucun journal de sécurité n’est exposé par l’API ni limité aux 500 événements métier.

Les événements sont écrits sur stdout : le superviseur d’hébergement devra les collecter dans un stockage réservé aux exploitants, avec une rétention de 90 jours et rotation, sans les publier ni les mélanger aux fichiers web. La collecte durable, les accès et alertes restent à configurer lorsque l’hébergement sera choisi.

Validation : tests des événements d’échec de connexion, corrélation des erreurs internes, absence de secrets et tests HTTP/OAuth/socket existants.

## SEC-03 — Démo liée au compte et limites de stockage

La démo exige désormais un compte personnel connecté. Depuis **Mes garages**, le compte ouvre ou retrouve un seul garage de démonstration, y compris depuis un autre navigateur. L’essai unique de 24 h commence à la création et n’est prolongé ni par une nouvelle ouverture ni par une nouvelle session. Une contrainte unique en base et un verrou du compte protègent les créations concurrentes. L’échéance est conservée dans le compte après la purge : une nouvelle démo est refusée lorsque l’essai est terminé.

Les sessions de démo expirent au plus tard avec le garage ; les lectures et mutations d’un garage expiré sont refusées. La purge transactionnelle s’exécute au démarrage et toutes les heures, ainsi qu’avant l’ouverture d’une démo. Elle supprime uniquement les garages marqués `demo=true` expirés et leurs sessions, invitations et appartenances, jamais les comptes ou garages personnels. Pour les anciennes démos sans date d’expiration, les 24 h sont calculées depuis leur date de création. Les invitations réelles sont désactivées dans les nouvelles démos.

La création est limitée à 10 garages personnels possédés par compte (les appartenances à d’autres garages et la démo ne consomment pas ce quota). Un état de garage ne peut pas dépasser 10 Mio sérialisés : une mutation trop volumineuse est refusée avant d’écraser les données. Les installations possédant déjà un garage plus volumineux devront prévoir son archivage avant de pouvoir ajouter des données.

Validation : tests HTTP de compte obligatoire, réouverture concurrente sans prolongation, expiration et refus de renouvellement sans supprimer le garage personnel ; quotas de création sous concurrence ; dépassement de taille sans écrasement ; tests HTTP/socket/PDF existants adaptés au compte obligatoire. Parcours Chrome réel : connexion, ouverture, échéance visible, retour au garage personnel et réouverture du même garage ; en-têtes HTML vérifiés et aucune erreur JavaScript.
