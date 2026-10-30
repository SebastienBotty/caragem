# Paramètres personnels

Fonctionnalités autorisées : profil prénom/nom/photo, changement d’adresse vérifié, notifications personnelles dans CaRM, sessions et révocation, écran et garage par défaut, qualité 3D et animations, double authentification avec codes de secours. L’espace « Mon compte » est accessible depuis l’avatar, distinct des réglages du garage et disponible même avec un abonnement expiré.

Répartition : sous-agent profil/email, sous-agent sécurité/sessions/2FA, sous-agent préférences/notifications/3D ; intégration, revue des interfaces, tests globaux et commits par la racine.

Les mises à jour de profil suivent les appartenances aux garages sans modifier les rôles. Les notifications respectent les permissions et ne déclenchent aucun mail métier. Une connexion 2FA incomplète n’obtient aucune session authentifiée ; les changements de garage ne renouvellent pas la preuve d’authentification récente. Secrets TOTP chiffrés, codes de secours hachés et à usage unique. L’absence de SMTP ou de clé de chiffrement est affichée clairement et ne simule aucune réussite.

Validation : tests de chaque module, parcours navigateur compte/préférences/profil et défi 2FA, TypeScript, build Next et Prettier sur fichiers concernés. Les changements sans rapport d’onboarding sont conservés.
