# Profil personnel et adresse de connexion

La rubrique « Mon compte » permet de modifier prénom, nom et photo. Le nom complet et la photo sont répercutés dans les garages réels dont le compte est membre, sans modifier les rôles ni les permissions. Cette opération reste disponible lorsque le garage est en lecture seule. Les garages de démonstration ne reçoivent pas ces données personnelles.

La photo doit être JPEG, PNG ou WebP, au maximum 2 Mio et 16 mégapixels. Elle est décodée puis réécrite sans métadonnées en JPEG carré de 256 pixels maximum et 64 Kio maximum ; aucun téléchargement depuis une URL distante n’est accepté. Le propriétaire peut exporter les données de son garage, qui contiennent les profils visibles de l’équipe.

## Changer d’adresse mail

Les routes `/api/account/email/start` et `/api/account/email/confirm` exigent une session personnelle ; elles sont désactivées dans la démonstration.

- Avec un mot de passe : confirmation du mot de passe actuel, puis code envoyé à la nouvelle adresse.
- Sans mot de passe, avec Google : code envoyé à la nouvelle adresse **et** code envoyé à l’adresse actuelle.
- Si la double authentification est activée, son code ou un code de secours est également exigé pour démarrer le changement.
- Les codes expirent après 10 minutes, sont liés à la session initiatrice, hachés en base, à usage unique et limités à cinq erreurs. Une demande ne peut être renvoyée avant une minute ; les démarrages et confirmations sont limités sur 15 minutes.
- La nouvelle adresse ne doit pas déjà appartenir à un autre compte. Les comptes, appartenances, sessions et identités Google sont mis à jour atomiquement via les clés étrangères `ON UPDATE CASCADE`.
- Après confirmation, le jeton de la session courante est renouvelé sans prolonger son expiration ni sa date d’authentification. Toutes les autres sessions du compte sont révoquées et les sockets de l’ancienne identité sont déconnectées.
- L’identité Google reste liée par son identifiant fournisseur : le changement de l’adresse CaRM n’exige pas de changer l’adresse du compte Google.

Les vérifications utilisent le serveur SMTP déjà configuré pour CaRM, avec TLS. Sans configuration SMTP, le changement est refusé ; une erreur d’envoi ne modifie jamais l’adresse. Aucun code n’est retourné dans une réponse API ou écrit dans les journaux. Les tests injectent un transport mémoire et n’envoient aucun mail réel.

Appliquer `src/server/account-profile.sql` après le schéma principal et les tables de sécurité/préférences. Cette migration est idempotente et rend les clés étrangères existantes vers `accounts` compatibles avec le changement d’adresse.
