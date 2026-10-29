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
