# Sécurité du compte

L’écran « Mon compte » présente les sessions du compte personnel, avec le type d’appareil/navigateur déclaré, le garage, les dates de connexion et de dernière activité. Ces indications viennent du navigateur et ne constituent pas une identification matérielle. Les jetons de session et leurs empreintes ne sont jamais exposés. Le compte peut révoquer une session ou toutes les autres ; les connexions Socket.IO correspondantes sont coupées. L’activité est actualisée au plus toutes les cinq minutes.

## Double authentification

Configurer `ACCOUNT_ENCRYPTION_KEY` avec **32 octets aléatoires encodés en 64 caractères hexadécimaux**, conservés dans le gestionnaire de secrets du serveur. Exemple de génération locale : `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Ne pas committer cette clé. Elle est nécessaire pour chiffrer/déchiffrer les secrets TOTP en AES-256-GCM ; la perdre ou la changer sans migration rend les codes de l’application inutilisables. Sauvegarder la clé séparément des sauvegardes de base.

Sans cette clé, l’activation est indisponible. Pour un compte déjà protégé, l’absence de clé ne contourne pas la vérification ; un code de secours valide reste utilisable. Le support ne possède pas de route de contournement de la double authentification.

L’utilisateur confirme son mot de passe actuel, ou se reconnecte avec Google s’il n’a pas de mot de passe. La preuve d’authentification Google doit dater de moins de dix minutes ; un simple changement de garage ou renouvellement d’identifiant de session ne renouvelle pas cette preuve. L’activation nécessite ensuite un premier code généré par l’application. La clé est à saisir manuellement dans une application compatible TOTP (SHA-1, six chiffres, pas de trente secondes). Aucun service externe ne reçoit cette clé.

Les codes tolèrent un pas d’horloge adjacent pour la dérive du téléphone. Chaque compteur accepté est consommé sous verrou en base et ne peut être rejoué, y compris entre deux connexions simultanées. Après une validation, il peut donc être nécessaire d’attendre le code suivant. Huit codes de secours de 128 bits sont affichés une seule fois à l’activation et peuvent être téléchargés ; seules leurs empreintes SHA-256 sont stockées. Chaque code est à usage unique. La désactivation exige une réauthentification et un code de l’application ou de secours.

L’activation révoque les autres sessions. Une session créée avec le premier facteur seul ne devient pas valide en cas d’activation concurrente. La session courante est marquée comme vérifiée seulement après confirmation du code d’activation.

## Connexion

Le premier facteur (mot de passe ou identité Google vérifiée) crée un défi opaque de cinq minutes, porté par un cookie HttpOnly. Ce défi n’est pas une session authentifiée. Cinq codes invalides épuisent le défi, en plus des limites de tentatives par adresse/compte. Un code correct consomme le défi et crée une nouvelle session vérifiée.

Les invitations et associations Google d’un compte déjà protégé sont exécutées après le second facteur. Même un compte sans garage encore accessible doit passer ce facteur avant de rejoindre un nouveau garage. La modification du mot de passe ou de l’adresse mail et la désactivation/activation du facteur invalident les défis en cours.

Tests : vecteurs RFC 6238, chiffrement authentifié, expiration et rejeu, concurrence de codes de secours, compte sans garage, refus d’une session non vérifiée, isolement et révocation des sessions, réauthentification Google récente et parcours OIDC signé suivi du défi.

Les tests OIDC utilisent un fournisseur simulé avec jetons signés ; aucun compte Google réel ni appareil d’authentification physique n’a été utilisé pendant les tests automatisés.
