# Abonnements CaRM

## Contrat

25 € TTC par mois et par garage, toute l’équipe comprise. Essai de 14 jours à la création sans carte. Souscrire pendant l’essai conserve sa date de fin. Résilier conserve l’accès jusqu’à la fin payée. À expiration, consultation selon les permissions existantes, aucune mutation métier, aucune suppression de données. Paiement et sécurité du compte restent accessibles.

Les garages existants reçoivent 14 jours à la migration. Les espaces de démonstration et visites guidées restent isolés. Un nouvel abonnement ne renouvelle jamais l’essai du garage.

## Plan d’exécution

- [ ] Essai et lecture seule : table `garage_billing`, projection publique dans `GarageState`, contrôle transactionnel des écritures dans Store, invitations incluses. Tests limites temporelles, persistance, API, isolement des garages. Commit distinct.
- [ ] Stripe : Checkout abonnement, portail propriétaire uniquement, prix EUR 2500 mensuel inclusif vérifié côté serveur, signatures sur corps brut, synchronisation depuis l’abonnement courant pour résister aux relectures/événements désordonnés, verrou par garage contre les doubles achats. Tests avec transport Stripe simulé et webhooks signés. Commit distinct.
- [ ] Interface : statut, dates, montant, souscription/gestion dans les paramètres et avertissement global ; rafraîchissement temporel et au retour du paiement. Documentation des variables et configuration Stripe Tax avant activation réelle. Vérification TypeScript, suite complète, build et navigateur.

## Décisions d’implémentation

État financier séparé du JSON métier et jamais importable. ASVS 8.3.1 : autorisation serveur, ASVS 2.3.3/2.3.4 : transactions/verrous. Paiement refusé : accès jusqu’au terme déjà payé, puis lecture seule ; aucun délai gratuit supplémentaire. Ne pas activer Stripe Tax sans immatriculation confirmée. En l’absence de Stripe configuré, essai utilisable puis lecture seule, aucun faux bouton de paiement fonctionnel. Aucun paiement réel effectué pendant le développement.

## Points de revue

Expiration dans un onglet ouvert ; invitations et photos hors reducer ; événements Stripe dupliqués ou désordonnés ; double clic de paiement ; abandon de Checkout ; utilisateur non propriétaire ou autre garage ; réabonnement sans nouvel essai ; TVA incluse sans supplément caché.
