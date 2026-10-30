# Abonnements par garage

Chaque personne bénéficie de **14 jours gratuits, sans carte, uniquement pour le premier garage dont elle devient créatrice et propriétaire**. Chaque garage supplémentaire nécessite immédiatement son propre abonnement de **25 € TTC / mois pour toute son équipe**, sans nouvel essai. Il est créé en lecture seule et devient utilisable en modification après paiement confirmé. Chaque garage conserve son abonnement et son compte de facturation Stripe distincts.

La règle s’applique aux nouvelles créations : les essais déjà accordés et les périodes déjà payées sont conservés. Rejoindre un garage sur invitation ou ouvrir la démonstration ne consomme pas l’essai du premier garage personnel. Les créations simultanées sont sérialisées par compte pour ne pas accorder deux essais. L’expiration du premier essai ne permet pas d’en obtenir un autre en créant un nouveau garage. La démonstration conserve son fonctionnement séparé.

L’expiration n’efface aucune donnée. Consultation, téléchargements et export restent possibles selon les permissions existantes. Les écritures métier sont contrôlées côté serveur dans la transaction : tâches, clients, véhicules, photos, stock, documents, mails, import et invitations. Déconnexion, changement de garage, sécurité du compte et facturation restent accessibles. Un mail dont l’envoi a déjà commencé peut enregistrer son résultat après l’expiration.

Les dates financières sont dans `garage_billing`, séparées du JSON métier ; elles ne sont jamais importées depuis les fichiers utilisateur. La lecture seule est calculée à chaque écriture et dans l’interface, même sans rechargement de page. Les changements Stripe sont diffusés par les sockets habituels. L’interface vérifie l’expiration toutes les 30 secondes ; le serveur la vérifie immédiatement.

## Gérer tous ses garages depuis Mon compte

La rubrique **Mon compte → Abonnements et paiements** présente les garages dont le compte est propriétaire, même s’ils sont en lecture seule et quel que soit le garage actuellement ouvert. Les garages rejoints comme collaborateur et les espaces de démonstration ne figurent pas dans cette liste. Les paramètres de chaque garage ne contiennent plus de fiche de facturation. L’indicateur à côté du titre du garage ouvre cette rubrique du compte.

Chaque fiche présente le tarif de 25 € TTC/mois, l’état d’accès, la fin d’essai ou de période payée et, lorsqu’un abonnement Stripe existe, sa date de début, sa période en cours, sa prochaine échéance ou tentative de paiement et les dates de résiliation. La dernière facture réglée indique la date enregistrée par Stripe et le montant réglé ; une facture gratuite peut indiquer 0 €, sans prélèvement.

Les dix dernières factures du garage sont affichées avec leur numéro, date d’émission, état, total TTC, date et montant réglés, solde et échéance éventuelle. Les liens permettent d’ouvrir la facture Stripe ou son PDF lorsqu’ils sont disponibles. L’historique antérieur, le moyen de paiement et la résiliation restent accessibles dans le portail Stripe du garage choisi. Une indisponibilité de Stripe est signalée sans masquer l’état local ni bloquer les autres garages.

La lecture de l’historique et les actions de facturation vérifient l’appartenance et le rôle de propriétaire sur **le garage ciblé**, sans modifier le garage actif. Un rôle de collaborateur dans le garage courant n’empêche pas de gérer ses autres garages personnels. Les identifiants de clients et d’abonnements Stripe proviennent uniquement des liaisons conservées au serveur ; les liens de facture sont limités aux domaines HTTPS Stripe attendus. Les réponses privées ne sont pas mises en cache. Le retour de Checkout ou du portail ramène à Mon compte et synchronise uniquement le garage concerné. Les montants affichés proviennent de Stripe et conservent la TVA incluse configurée sur le tarif.

## Préparer Stripe en environnement de test

1. Créer le produit Caragem et un prix récurrent **EUR 25,00, mensuel, quantité fixe, taxes incluses**. Renseigner son identifiant `price_…` dans `STRIPE_PRICE_ID`. Aucun tarif annuel ni nombre de collaborateurs facturés.
2. Configurer Stripe Tax : adresse du vendeur, code fiscal adapté au produit, immatriculations effectivement actives. Vérifier la configuration dans le sandbox utilisé, puis mettre `STRIPE_AUTOMATIC_TAX=true`. Le serveur refuse le paiement sans immatriculation active ; activer ce drapeau seul ne configure pas la TVA. Les règles fiscales et éventuelles exonérations doivent être validées pour l’entreprise vendeuse avant la mise en service.
3. Renseigner `STRIPE_SECRET_KEY` (de préférence une clé restreinte côté serveur). Autoriser les opérations Customers, Prices en lecture, Checkout Sessions, Subscriptions et invoices en lecture, Billing Portal Sessions et Tax Registrations en lecture. Ne jamais exposer la clé au navigateur ou la committer.
4. Activer le portail client : historique des factures, mise à jour du moyen de paiement et **résiliation à la fin de la période**. Désactiver les changements d’offre/quantité, les coupons et la résiliation immédiate. Le portail ne donne accès qu’à la facturation du garage choisi dans Mon compte.
5. Créer le webhook `https://votre-domaine/api/billing/webhook`, renseigner son secret de signature dans `STRIPE_WEBHOOK_SECRET`, et écouter : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`.
6. Configurer `APP_ORIGIN` avec l’origine publique exacte. En local, utiliser Stripe CLI pour transférer les événements de test : `stripe listen --forward-to localhost:3000/api/billing/webhook`, puis utiliser le secret affiché par cette commande. Ne pas utiliser un secret live pour ces tests.
7. Redémarrer le serveur Node après une modification des variables ou du backend.

Sans configuration Stripe, l’essai et la lecture seule fonctionnent ; les boutons de souscription sont indisponibles. L’application ne fabrique jamais un succès de paiement local.

## Développement local sans entreprise créée

Le projet peut être testé entièrement dans un environnement Stripe de test, avec des coordonnées de vendeur fictives et une immatriculation de test. La configuration locale de démonstration utilise la Belgique et le code Stripe **SaaS – usage professionnel** (`txcd_10103001`), avec le tarif de **25 € TTC par mois**. Ces données servent aux simulations : elles ne constituent ni une entreprise ni une immatriculation fiscale réelle.

Les clés, l’identifiant du prix et le secret du webhook restent dans le fichier `.env` local ignoré par Git. Le CLI doit être connecté au même environnement que la clé de l’application. Pour transférer les événements vers le serveur local, maintenir `stripe listen --forward-to localhost:3000/api/billing/webhook` en fonctionnement et utiliser son secret de signature dans `STRIPE_WEBHOOK_SECRET`. Le relais s’arrête à la fermeture de son processus ; il faut le relancer après un redémarrage du poste. Redémarrer aussi le serveur Caragem après toute modification du `.env`.

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

Ils ne remplacent pas un essai de bout en bout dans un vrai sandbox Stripe : Checkout, authentification bancaire, renouvellement avec horloge de test, portail, TVA et réception des webhooks publics. Ce contrôle reste nécessaire avant tout paiement réel. Les emails de facturation et relances automatiques de Stripe se configurent dans Stripe ; les mails métier Caragem restent soumis à validation manuelle.

Documentation officielle : [abonnements et webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [Checkout et abonnements](https://docs.stripe.com/payments/checkout/build-subscriptions), [taxes incluses](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior).
