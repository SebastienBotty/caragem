# Abonnements par garage

Chaque garage dispose de 14 jours gratuits à sa création, sans carte, puis coûte **25 € TTC / mois pour toute son équipe**. Chaque garage a son abonnement et son compte de facturation Stripe, même si un propriétaire en possède plusieurs. Les garages présents avant cette migration reçoivent 14 jours au premier démarrage de cette version. La démonstration conserve son fonctionnement séparé.

L’expiration n’efface aucune donnée. Consultation, téléchargements et export restent possibles selon les permissions existantes. Les écritures métier sont contrôlées côté serveur dans la transaction : tâches, clients, véhicules, photos, stock, documents, mails, import et invitations. Déconnexion, changement de garage, sécurité du compte et facturation restent accessibles. Un mail dont l’envoi a déjà commencé peut enregistrer son résultat après l’expiration.

Les dates financières sont dans `garage_billing`, séparées du JSON métier ; elles ne sont jamais importées depuis les fichiers utilisateur. La lecture seule est calculée à chaque écriture et dans l’interface, même sans rechargement de page. Les changements Stripe sont diffusés par les sockets habituels. L’interface vérifie l’expiration toutes les 30 secondes ; le serveur la vérifie immédiatement.

## Préparer Stripe en environnement de test

1. Créer le produit CaRM et un prix récurrent **EUR 25,00, mensuel, quantité fixe, taxes incluses**. Renseigner son identifiant `price_…` dans `STRIPE_PRICE_ID`. Aucun tarif annuel ni nombre de collaborateurs facturés.
2. Configurer Stripe Tax : adresse du vendeur, code fiscal adapté au produit, immatriculations effectivement actives. Vérifier la configuration dans le sandbox utilisé, puis mettre `STRIPE_AUTOMATIC_TAX=true`. Le serveur refuse le paiement sans immatriculation active ; activer ce drapeau seul ne configure pas la TVA. Les règles fiscales et éventuelles exonérations doivent être validées pour l’entreprise vendeuse avant la mise en service.
3. Renseigner `STRIPE_SECRET_KEY` (de préférence une clé restreinte côté serveur). Autoriser les opérations Customers, Prices en lecture, Checkout Sessions, Subscriptions et invoices en lecture, Billing Portal Sessions et Tax Registrations en lecture. Ne jamais exposer la clé au navigateur ou la committer.
4. Activer le portail client : historique des factures, mise à jour du moyen de paiement et **résiliation à la fin de la période**. Désactiver les changements d’offre/quantité, les coupons et la résiliation immédiate. Le portail ne donne accès qu’à la facturation du garage courant.
5. Créer le webhook `https://votre-domaine/api/billing/webhook`, renseigner son secret de signature dans `STRIPE_WEBHOOK_SECRET`, et écouter : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`.
6. Configurer `APP_ORIGIN` avec l’origine publique exacte. En local, utiliser Stripe CLI pour transférer les événements de test : `stripe listen --forward-to localhost:3000/api/billing/webhook`, puis utiliser le secret affiché par cette commande. Ne pas utiliser un secret live pour ces tests.
7. Redémarrer le serveur Node après une modification des variables ou du backend.

Sans configuration Stripe, l’essai et la lecture seule fonctionnent ; les boutons de souscription sont indisponibles. L’application ne fabrique jamais un succès de paiement local.

## Développement local sans entreprise créée

Le projet peut être testé entièrement dans un environnement Stripe de test, avec des coordonnées de vendeur fictives et une immatriculation de test. La configuration locale de démonstration utilise la Belgique et le code Stripe **SaaS – usage professionnel** (`txcd_10103001`), avec le tarif de **25 € TTC par mois**. Ces données servent aux simulations : elles ne constituent ni une entreprise ni une immatriculation fiscale réelle.

Les clés, l’identifiant du prix et le secret du webhook restent dans le fichier `.env` local ignoré par Git. Le CLI doit être connecté au même environnement que la clé de l’application. Pour transférer les événements vers le serveur local, maintenir `stripe listen --forward-to localhost:3000/api/billing/webhook` en fonctionnement et utiliser son secret de signature dans `STRIPE_WEBHOOK_SECRET`. Le relais s’arrête à la fermeture de son processus ; il faut le relancer après un redémarrage du poste. Redémarrer aussi le serveur CaRM après toute modification du `.env`.

La préparation locale a été vérifiée auprès du vrai sandbox Stripe : compte et clé de test, produit, prix, portail client, calcul de TVA incluse, création puis expiration d’un Checkout de test et endpoint local acceptant une signature valide et refusant une signature invalide. Un paiement par carte, le 3-D Secure et les renouvellements restent à exercer avant une mise en production. La configuration réelle exigera les informations de l’entreprise et des réglages fiscaux adaptés à sa situation.

## Cycle de vie de l’abonnement

- Souscription pendant l’essai : premier prélèvement à sa date de fin initiale, sans nouveau délai de 14 jours. Checkout impose 48 h minimum pour `trial_end` ; durant les dernières 48 h, une première période gratuite jusqu’à cette même date est utilisée avec `billing_cycle_anchor` et `proration_behavior=none`.
- Une période est ouverte comme payée après vérification d’une facture payée non gratuite auprès de Stripe. Le retour `?billing=success` seul n’accorde rien. Les factures gratuites d’essai n’allongent pas l’accès payé.
- Résiliation : la période déjà payée reste accessible, puis le garage passe en lecture seule.
- Paiement refusé : le terme déjà payé reste conservé ; pas de délai supplémentaire après ce terme. Régularisation via le portail Stripe.
- Réabonnement après résiliation effective : nouvelles mensualités sur le même garage, aucun nouvel essai, données inchangées.
- Les notifications signées sont vérifiées sur le corps brut, puis l’abonnement courant est relu auprès de Stripe sous verrou du garage. Un événement ancien ne rétablit pas un ancien abonnement. Des événements répétés ne créent ni facture ni période supplémentaire.
- Des clics concurrents réutilisent le même Checkout. Des clés d’idempotence protègent aussi les créations côté Stripe si la réponse réseau est perdue.

## Vérification avant production

Les tests automatisés utilisent PostgreSQL isolé et un serveur HTTP simulant Stripe ; les signatures sont vérifiées par le SDK Stripe réel. Ils couvrent propriétaire/employé, isolation des garages, prix et TVA, doubles clics, factures non payées, renouvellement refusé, résiliation, réabonnement et événements anciens/répétés.

Ils ne remplacent pas un essai de bout en bout dans un vrai sandbox Stripe : Checkout, authentification bancaire, renouvellement avec horloge de test, portail, TVA et réception des webhooks publics. Ce contrôle reste nécessaire avant tout paiement réel. Les emails de facturation et relances automatiques de Stripe se configurent dans Stripe ; les mails métier CaRM restent soumis à validation manuelle.

Documentation officielle : [abonnements et webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [Checkout et abonnements](https://docs.stripe.com/payments/checkout/build-subscriptions), [taxes incluses](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior).
