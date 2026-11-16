# TornBastTools

Userscript Violentmonkey (Firefox ou Chrome) d'outils Torn pour les membres Wardogs. Il ne valide jamais rien à la place du joueur : il remplit des champs ou affiche des informations, et c'est toujours le joueur qui clique sur le bouton de Torn (règle Torn : un clic, une action).

## Fonctions

### Item market, Add listing : bouton « Remplir »

À côté de « Clear all ». Au clic :

1. déplie les objets uniques regroupés (« Expand N … items »), puis parcourt toute la liste (elle se charge au défilement) et relève les objets
2. écarte les objets à garder (réglés sur la page, voir plus bas)
3. pour chaque objet, récupère l'annonce la plus basse via l'API et garde ceux dont l'item market est le meilleur canal (son bazaar, item market à 85 %, rachat dans une boutique de Torn)
4. les objets mieux vendus ailleurs sont estompés, avec le canal à utiliser (`→ Bazaar`, `→ Pharmacy`…)
5. coche l'anonymat, saisit la quantité et le prix (annonce la plus basse - 1 $), encadre la ligne en vert

Sur chaque ligne, un champ **garder** fixe le nombre d'exemplaires à conserver (vide : liste `GARDER` du script, sa valeur est affichée en grisé), et **✕** exclut toute la ligne (ligne grisée, re-cliquer pour annuler). Pour un objet unique (arme, armure), les exemplaires gardés sont ceux aux meilleures stats : bonus d'abord, puis somme dégâts + précision (ou armure). Ces choix sont mémorisés dans Violentmonkey et s'appliquent tout de suite si la ligne est déjà remplie.

Le script ne soumet rien : vérifier, puis cliquer soi-même sur **Add to market** (règle Torn : un clic, une action).

Frais : 5 % de base, +10 % en anonyme, d'où le calcul à 85 %.

### Item market, mes annonces : bouton « Màj prix »

À côté de « Undo changes ». Au clic, pour chaque annonce : prix visé = annonce concurrente la moins chère - 1 $ (ma propre annonce, même prix et même quantité, est écartée). Le prix baisse si quelqu'un est passé dessous (cadre rouge), remonte si je suis seul en tête (cadre vert) ; le prix en vente est dans l'info-bulle. Mes annonces sont lues via l'API (prix réellement en vente), on peut donc recliquer sans fausser le calcul. Si, au prix visé, le bazaar ou une boutique paie plus que l'item market (après frais), le cadre passe en orange avec le canal et l'écart en pourcentage dans l'info-bulle : retirer l'annonce et vendre ailleurs. Rien n'est enregistré : vérifier puis **Save changes**.

### Échange, ajout d'objets : bouton « Remplir »

À côté de « Clear all », sur la page d'ajout d'objets d'un échange (trade.php, étape Add items). Même fonctionnement que sur l'Add listing (dépliage des objets uniques, objets gardés, champ garder et ✕, meilleures stats conservées), mais il remplit les objets dont le meilleur canal est **le bazaar** (ceux qu'un trader rachète le mieux). Les autres sont estompés avec leur canal dans le champ Qty (`→ Item market`, `→ Pharmacy`…). Pas de prix ni d'anonymat dans un échange. Vérifier, puis **Add to trade**.

### Échange, vue : minimum attendu

Sous l'échange (trade.php, step=view), une ligne donne le **minimum attendu des traders Wardogs** pour mes objets (colonne de gauche) : valeur marché × taux de la catégorie. Juste au-dessus, **Taxed value** : ce que je toucherais en vendant moi-même sur l'item market (annonce la plus basse - 1 $, moins 15 % de frais). Les deux calculs de chaque objet s'affichent au survol de son nom. Dès que l'autre joueur met de l'argent, la ligne le compare au minimum : OK (cadre vert) ou trop bas au-delà de 1 % (cadre rouge).

### Items : bouton « Message traders »

Dans l'en-tête « Your items » de la page Items. Lit l'inventaire affiché (temps réel : celui de l'API est une photo qui peut dater de plus d'une demi-heure), garde les objets dont le meilleur canal est le bazaar (objets gardés exclus) et donne la description d'échange par catégories, de la plus grosse valeur à la plus petite (« plushies, flowers, Arson materials, wallets, + other stuff to resell » ; « wallets » pour les portefeuilles, « supply packs » pour les autres objets de cette catégorie). Le texte s'affiche au-dessus de la liste et est copié dans le presse-papiers.

## Installation

1. Installer l'extension **Violentmonkey**.
2. Ouvrir [TornBastTools.user.js](https://raw.githubusercontent.com/LittleBigDev/TornBastTools/main/TornBastTools.user.js) et cliquer sur **Installer**. Une ancienne copie installée à la main est remplacée si elle porte le même nom ; sinon, la supprimer du tableau de bord.
3. Au premier clic sur un bouton du script, il demande une **clé API Torn** (accès **Limited** suffisant : Settings, API Keys). Elle est gardée dans le stockage de Violentmonkey, jamais dans le code. Pour la changer : tableau de bord, TornBastTools, onglet **Valeurs**, supprimer `cle_api`.
4. Recommandé : l'extension **TornTools**. Sans elle, la vue de l'échange affiche le minimum Wardogs dans un bandeau au lieu d'une ligne sous « Total value ».

## Mises à jour

Automatiques : Violentmonkey vérifie l'adresse ci-dessus régulièrement et installe toute version plus récente. Pour forcer la vérification : tableau de bord, bouton **Vérifier les mises à jour**. Les réglages (clé API, objets gardés) sont conservés.

## Objets à garder

La liste `GARDER` du script est vide : chaque joueur règle ses objets sur la page (Add listing ou ajout à un échange), avec le champ **garder** (nombre d'exemplaires) ou la **✕** (rien vendre). Ne pas modifier le code : la modification serait écrasée à la prochaine mise à jour.

## Règles de calcul

- Trois canaux comparés en net par exemplaire : **bazaar** (son propre bazaar, sans frais, estimation pessimiste : valeur marché × (taux des traders Wardogs de la catégorie + 2 points), taux à 0 si l'objet est dans `PAS_TRADERS`), **item market** (annonce la plus basse, à défaut la valeur marché, × 0,85 : 5 % de frais + 10 % d'anonymat), **ville** (prix de rachat de la meilleure boutique de Torn, sans frais ; aucune revente à l'étranger, rien ne voyage avec soi). À égalité : bazaar, puis item market, puis ville. Les taux des traders servent aussi au minimum attendu d'un échange.
- Données de l'API Torn, limite de 100 requêtes par minute : le script envoie ses requêtes par paquets de 8. L'inventaire est lu sur la page (temps réel), pas via l'API.
