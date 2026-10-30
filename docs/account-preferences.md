# Préférences personnelles et notifications

Les préférences sont enregistrées sur le compte, indépendamment du garage et de son abonnement : écran d’accueil, garage par défaut, qualité 3D, réduction des animations et catégories de notifications. Un garage par défaut doit appartenir aux garages accessibles au compte. Le choix d’écran ne donne aucune permission supplémentaire ; l’interface revient vers un écran autorisé si les permissions changent.

`accountPreferencesApi` expose `GET/POST /api/account/preferences` et `GET /api/account/notifications`. La migration `src/server/account-preferences.sql` s’exécute après le schéma principal. La sauvegarde émet `account:changed` vers les connexions du seul compte pour recharger ses préférences.

Les notifications montrent la situation actuelle : travaux non terminés attribués à l’utilisateur, blocages dont il est responsable, invitations non expirées destinées à son adresse et problèmes d’abonnement pour les propriétaires. Les informations sur les véhicules concernent uniquement le garage courant et exigent ses permissions actuelles. Les invitations d’autres garages ne contiennent jamais le secret du lien d’invitation.

Le centre de notifications est rafraîchi après les changements du garage et toutes les 30 secondes. Il ne constitue pas un historique ni une liste « non lue ». Les préférences désactivées masquent leur catégorie. Aucun email métier automatique n’est ajouté ; les mails clients restent validés manuellement.

Les tests couvrent les données anciennes, les champs invalides, l’appartenance du garage par défaut, la persistance même après expiration, l’isolation des comptes, les permissions retirées, les affectations, les blocages et la confidentialité des informations de facturation.
