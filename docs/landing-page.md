# Landing page CaRM

La page `/decouvrir` présente une intervention au fil du défilement : saisie progressive d’un client, arrivée de sa Peugeot 308, affectation à Sarah, déplacement vers l’atelier, consommation d’un filtre, réception de cinq filtres et fin de l’intervention.

Elle réutilise `GarageScene`, les champs de `CustomerForm`, `InventoryScreen`, `TeamScreen` et les formulaires/dossiers de l’application. Le scénario utilise `applyAction` pour reproduire les règles métier : le stock passe de 4 à 3 puis à 8. Les étapes sont réversibles au scroll ; le mode libre conserve ses changements en mémoire jusqu’au rechargement.

Le contexte de démonstration ne dispose d’aucun transport réseau métier. Ses clients, commandes et actions restent locaux. Les opérations de compte, d’invitation, d’envoi et de stockage des photos y sont indisponibles. La page d’accès à l’application reste `/`.

Les contrôles permettent de parcourir les étapes au clavier, d’explorer la scène et d’ouvrir les dossiers. Le visualisateur fournit son affichage de secours si WebGL n’est pas disponible et respecte la préférence de réduction des animations. Sur mobile, la scène et la gestion sont empilées.

Validation : `node --test tests/landing-demo.test.ts`, `npm run typecheck`, `npm run build` et vérification du format des fichiers concernés. Les vérifications visuelles dépendent d’un navigateur disponible.
