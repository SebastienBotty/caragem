# Transférer les données en CSV et Excel

Le responsable du garage ouvre **Paramètres → Importer / exporter les données**. Chaque catégorie possède un export, un modèle vide et un exemple rempli au choix en **CSV, XLS ou XLSX**. La rubrique **Structure attendue et exemple** affiche les noms des colonnes, les champs obligatoires et des valeurs fictives avant de sélectionner un fichier. Remplacer ces valeurs avant l’import. Les identifiants fictifs des exemples permettent de comprendre les liens entre catégories. Les autres rôles, y compris les rôles personnalisés, ne peuvent pas utiliser ces transferts. L’entraînement ne donne pas accès aux données réelles.

## Importer depuis une autre plateforme

1. Exporter les données de l’autre logiciel au format CSV UTF-8, XLS ou XLSX.
2. Choisir la catégorie dans Caragem et sélectionner le fichier.
3. Associer ses colonnes aux champs Caragem. Les noms standards et les libellés français correspondants sont reconnus automatiquement ; les autres peuvent être choisis manuellement. Les champs marqués `*` sont obligatoires.
4. Cliquer sur **Analyser avant import**, vérifier l’aperçu, les doublons et les erreurs.
5. Confirmer l’import. Si une ligne est invalide, aucun enregistrement du fichier n’est ajouté. Si le garage a changé depuis l’analyse, une nouvelle analyse est nécessaire.

L’import ajoute des données. Il ne met pas à jour et n’écrase pas les enregistrements existants. Le rapport indique combien sont ignorés comme doublons. Les identifiants fournis sont prioritaires pour les clients, rendez-vous et commandes : deux clients ayant des identifiants différents peuvent partager un email. Sans identifiant, les critères métier ci-dessous sont utilisés. Pour modifier des données déjà présentes, utiliser les écrans métier.

Les fichiers acceptent le point-virgule, la virgule ou la tabulation, les guillemets doubles échappés et les champs sur plusieurs lignes. Limite par fichier : **1 Mio et 5 000 lignes de données**. Les gros transferts doivent être découpés en conservant l’en-tête. Toutes les lignes d’un document doivent rester dans le même fichier.

Pour **Excel**, placer les noms des colonnes sur la première ligne et les données dans la **première feuille**. Le nom de la feuille analysée est affiché ; les autres feuilles ne sont pas importées. Les cellules avec formules ou erreurs et les fichiers chiffrés sont refusés : coller les valeurs avant l’import. Saisir les dates en **texte ISO** avec le fuseau horaire pour les heures, afin d’éviter un décalage ambigu des dates Excel. Les téléphones et identifiants doivent rester du texte pour conserver les zéros initiaux. Les modèles générés utilisent des cellules texte, sans formule. Maximum 100 colonnes ; les archives XLSX sont aussi limitées à 8 Mio après décompression. Le contenu normalisé doit tenir dans la limite CSV de 1 Mio. Les anciennes feuilles XLS sont de vrais fichiers binaires BIFF, pas des CSV renommés.

La lecture et l’écriture Excel utilisent [SheetJS CE 0.20.3 depuis sa distribution officielle](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), version fixée dans le manifeste et le verrou des dépendances.

Les nombres acceptent le point ou la virgule décimale et les espaces de milliers, sans symbole monétaire. Les prix et paiements sont en **euros** dans le CSV et convertis en centimes au serveur. Les quantités de stock sont entières. Les dates doivent être ISO : `2026-11-10` pour une date seule, ou `2026-11-10T09:00:00+01:00` pour une date et heure avec fuseau. Les booléens acceptent `true/false`, `1/0`, `oui/non`.

## Contrôles avant enregistrement

Les mêmes contrôles sont appliqués côté serveur pendant l’analyse et à nouveau à la confirmation, y compris si l’API d’import est appelée directement. Une seule erreur bloque **tout le fichier**, sans ajout partiel. L’écran affiche la ligne et le champ à corriger, jusqu’à 100 erreurs par analyse. Pour Excel, les numéros correspondent aux lignes du classeur, y compris après les lignes vides ou les cellules sur plusieurs lignes ; les formules et dates Excel refusées indiquent leur cellule.

- Chaque colonne peut alimenter un seul champ Caragem. Les colonnes non associées sont signalées et ne sont pas importées.
- Un email renseigné doit respecter le format d’une adresse. Le téléphone est facultatif ; s’il est renseigné, il doit contenir 7 à 15 chiffres, avec un indicatif `+` ou `00` facultatif. Espaces, parenthèses, points et tirets sont acceptés ; les libellés et extensions doivent être retirés.
- Les immatriculations acceptent les lettres, chiffres, espaces, points et tirets, jusqu’à 25 caractères, sans imposer le format d’un pays particulier.
- Les nombres refusent les symboles monétaires et les séparateurs ambigus : `1 234,50` est accepté, `1 23` est refusé. Prix et quantités négatifs, quantités entières fractionnaires, dates impossibles, étapes inconnues, couleurs ou valeurs oui/non invalides sont bloqués. Un rendez-vous exige une date avec heure et fuseau.
- Un identifiant de client, pièce ou visite fourni doit exister ; il ne sera pas remplacé par une autre recherche. Les noms, emails, téléphones, plaques ou numéros de visite fournis avec cet identifiant doivent être cohérents. Sans identifiant, les recherches uniques par coordonnées, référence ou plaque restent possibles.
- Deux lignes portant le même identifiant avec des données différentes sont refusées. Les lignes répétées d’un devis ou d’une facture restent autorisées pour ses prestations, avec des informations de document cohérentes.
- Les valeurs sont contrôlées même lorsqu’un enregistrement existe déjà. Une réimportation de données anciennes non conformes peut donc demander un nettoyage préalable ; aucune correction silencieuse n’est faite.

## Ordre et liens entre catégories

| Ordre | Catégorie              | Liens et contenu                                                                                                                                                                                                                                                       |
| ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Clients                | Nom, email, téléphone. Un client sans email est accepté. Doublon : email, ou nom et téléphone si l’email est vide.                                                                                                                                                     |
| 2     | Stock et pièces        | Référence, désignation, fournisseur, stock physique, seuil, coût et prix HT. Doublon : référence.                                                                                                                                                                      |
| 3     | Véhicules et visites   | Client, plaque, modèle, kilométrage, couleur, étape, motif, blocage, priorité, dates, numéro de visite. Tâches, notes et détails des blocages peuvent être conservés dans les colonnes JSON de l’export Caragem. Doublon : client, plaque normalisée et numéro de visite. |
| 4     | Réservations           | Pièce, visite, quantité et consommation. Les quantités non consommées ne peuvent pas dépasser le stock disponible ni concerner un véhicule terminé. Doublon : identifiant ; sans identifiant, même pièce, visite, quantité et état.                                    |
| 5     | Rendez-vous            | Client, modèle, plaque, motif, date et état d’arrivée. Aucun véhicule n’est créé automatiquement.                                                                                                                                                                      |
| 5     | Commandes fournisseurs | Pièce, visite facultative, quantités commandée/reçue, échéance et coût. Une réception historique ne rajoute pas une seconde fois les pièces au stock importé. Doublon : référence de commande.                                                                         |
| 5     | Devis et factures      | Une ligne CSV par prestation/pièce, regroupée par identifiant ou type et numéro. TVA, ristourne en euros ou %, règlements historiques, accord et validation sont conservés. Doublon : type et numéro.                                                                  |

Les identifiants exportés sont conservés et permettent de rétablir les liens dans un nouveau garage. Si aucun identifiant client n’est renseigné, Caragem peut retrouver le client par email, ou par nom et téléphone. Sans identifiant, les pièces peuvent être retrouvées par référence et les visites par plaque et numéro de visite ; en cas d’ambiguïté, le fichier doit être précisé. Un identifiant fourni mais inconnu est toujours refusé. Importer les clients et pièces avant leurs données liées.

Les véhicules sans étape sont placés dans l’historique (`returned`) : un catalogue importé n’est pas assimilé à des arrivées dans l’atelier. Pour transférer les dossiers en cours, renseigner `reception`, `diagnosis`, `waiting`, `workshop` ou `ready`. Le CSV doit fournir des valeurs correspondant à ces étapes ; la correspondance des colonnes ne traduit pas automatiquement les statuts propres à un autre logiciel.

La colonne `model` contient la marque et le modèle. Une colonne facultative `brand` permet de les assembler à l’import lorsque l’autre plateforme les sépare. Les tâches et notes peuvent être omises dans un import externe. Les affectations à des collaborateurs inconnus du garage cible sont retirées et doivent être réattribuées.

## Exemple de clients et de véhicules

```csv
id;name;email;phone
client-001;Garage Exemple;contact@example.com;+32412345678
```

```csv
customer_id;plate;brand;model;mileage
client-001;AB-123-CD;Renault;Clio;45000
```

Pour un devis à plusieurs lignes, répéter ses informations sur chacune des lignes :

```csv
number;kind;plate;visit;label;quantity;unit_price;tax_rate;discount_rate
DEV-EXTERNE-001;devis;AB-123-CD;1;Main-d'œuvre;1;65.00;21;10
DEV-EXTERNE-001;devis;AB-123-CD;1;Filtre;1;19.99;21;10
```

Les types de document acceptent `devis` / `estimate` et `facture` / `invoice`. Les règlements importés sont seulement des données historiques ; aucun débit bancaire ni mail n’est déclenché. Ils ne peuvent pas dépasser le total remisé de la facture.

## Exporter vers un autre outil

Le CSV contient uniquement la catégorie sélectionnée du garage courant. Les montants ont deux décimales, les dates sont ISO et les relations disposent de colonnes d’identification. Les cellules pouvant être interprétées comme des formules de tableur sont protégées par une apostrophe ; Caragem la retire lors de son propre réimport. L’autre logiciel peut demander une adaptation de colonnes, de statuts ou de cette protection.

Ces transferts concernent les données métier décrites ci-dessus. Ils ne constituent pas une sauvegarde PostgreSQL complète : les comptes, mots de passe, accès, invitations, préférences, mails et fichiers joints ne sont pas transférés. Aucun connecteur propre à une plateforme externe n’est installé. Une photo ne peut pas être transportée dans ces CSV.

L’import est recalculé et validé au serveur dans une transaction verrouillant le garage, puis les sessions connectées reçoivent le nouvel état. Les limites de taille du garage restent applicables. Le journal d’activité conserve la catégorie et le nombre d’enregistrements ajoutés/ignorés.
