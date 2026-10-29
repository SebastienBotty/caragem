# Corrections de l’audit de sécurité du 29 octobre 2026

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
