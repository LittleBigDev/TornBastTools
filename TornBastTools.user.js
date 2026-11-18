// ==UserScript==
// @name         TornBastTools
// @namespace    wardogs.tornbasttools
// @version      1.46
// @description  Outils Torn pour les membres Wardogs. Item market : remplissage de l'Add listing et mise à jour des prix de mes annonces. Échange : ajout des objets à vendre aux traders, minimum attendu et contrôle de l'offre. Items : message pour les traders. Partout : bouton Fermer le bazaar quand le bazaar ouvert expose au mug.
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-idle
// @noframes
// @downloadURL  https://raw.githubusercontent.com/LittleBigDev/TornBastTools/main/TornBastTools.user.js
// @updateURL    https://raw.githubusercontent.com/LittleBigDev/TornBastTools/main/TornBastTools.user.js
// ==/UserScript==

(function () {
  "use strict";

  // DONNÉES DÉBUT
  // GARDER : objets à ne jamais vendre, en minuscules. Valeur = nombre d'exemplaires à garder (999999 = tous).
  // Vide dans la version publiée : chaque joueur règle ses objets sur la page (champ « garder » et ✕), réglages
  // mémorisés dans Violentmonkey. Une modification du code serait écrasée à la prochaine mise à jour automatique.
  const GARDER = {};
  const TAUX_TRADERS = {"Alcohol": 0.95, "Artifact": 0.9, "Booster": 0.95, "Candy": 0.95, "Car": 0, "Clothing": 0.25, "Defensive": 0.8, "Drug": 0.95, "Energy Drink": 0.95, "Enhancer": 0.9, "Flower": 0.98, "Jewelry": 0.8, "Material": 0.9, "Medical": 0.9, "Melee": 0.8, "Other": 0.25, "Plushie": 0.98, "Primary": 0.8, "Secondary": 0.8, "Special": 0.9, "Supply Pack": 0.95, "Temporary": 0.95, "Tool": 0.9};
  const PAS_TRADERS = ["wheel clamp"];
  const TAUX_ITEM_MARKET = 0.85;
  const TAUX_BAZAAR = {"Alcohol": 0.97, "Artifact": 0.92, "Booster": 0.97, "Candy": 0.97, "Car": 0.92, "Clothing": 0.27, "Defensive": 0.82, "Drug": 0.97, "Energy Drink": 0.97, "Enhancer": 0.92, "Flower": 1.0, "Jewelry": 0.82, "Material": 0.92, "Medical": 0.92, "Melee": 0.82, "Other": 0.27, "Plushie": 1.0, "Primary": 0.82, "Secondary": 0.82, "Special": 0.92, "Supply Pack": 0.97, "Temporary": 0.97, "Tool": 0.92};
  const TAUX_BAZAAR_DEFAUT = 0.27;
  // DONNÉES FIN (PAS_TRADERS : objets refusés par les traders, en minuscules ; TAUX_BAZAAR : part de la valeur marché retenue pour son bazaar, par catégorie)

  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- API Torn ----------

  function cle() {
    let k = GM_getValue("cle_api", "");
    if (!k) {
      k = (prompt("TornBastTools : clé API Torn (accès Limited suffisant)") || "").trim();
      if (k) GM_setValue("cle_api", k);
    }
    return k;
  }

  function api(chemin) {
    return new Promise((ok, ko) => GM_xmlhttpRequest({
      method: "GET",
      url: `https://api.torn.com/${chemin}${chemin.includes("?") ? "&" : "?"}key=${cle()}`,
      onload: (r) => {
        const d = JSON.parse(r.responseText);
        d.error ? ko(new Error(d.error.error)) : ok(d);
      },
      onerror: () => ko(new Error("réseau")),
    }));
  }

  async function annonces(ids) {
    // {id: annonces de l'item market, de la moins chère à la plus chère}
    const res = {};
    for (let i = 0; i < ids.length; i += 8) {  // par paquets, limite API : 100 appels par minute
      await Promise.all(ids.slice(i, i + 8).map(async (id) => {
        res[id] = (await api(`v2/market/${id}/itemmarket`)).itemmarket.listings;
      }));
    }
    return res;
  }

  async function plusBasses(ids) {
    const l = await annonces(ids);
    return Object.fromEntries(ids.map((id) => [id, l[id].length ? l[id][0].price : null]));
  }

  // Taux des traders Wardogs pour un objet du catalogue ; 0 s'ils n'en veulent pas (PAS_TRADERS)
  const tauxTraders = (it) => (PAS_TRADERS.includes(it.name.toLowerCase()) ? 0 : TAUX_TRADERS[it.type] || 0.25);

  // Meilleur canal d'un objet du catalogue, partagé par tous les boutons :
  // bazaar (le sien, sans frais, estimation pessimiste) = valeur marché × TAUX_BAZAAR de la catégorie
  // (taux des traders + 2 points ; un bazaar ne refuse rien, PAS_TRADERS ne compte pas) ;
  // item market sur l'annonce la plus basse (à défaut la valeur marché) moins 15 % ; à égalité, bazaar puis item market.
  const netBazaar = (it) => (it.market_value || 0) * (TAUX_BAZAAR[it.type] ?? TAUX_BAZAAR_DEFAUT);
  function meilleurCanal(it, prixBas) {
    const bazaar = netBazaar(it);
    const im = (prixBas || it.market_value || 0) * TAUX_ITEM_MARKET, ville = it.sell_price || 0;
    if (Math.max(bazaar, im, ville) <= 0) return null;
    return bazaar >= im && bazaar >= ville ? "bazaar" : im >= ville ? "im" : "ville";
  }

  // Catalogue des objets, prix de rachat (sell_price) limité aux boutiques de Torn : rien ne voyage avec soi,
  // donc aucune revente possible à l'étranger. Objet sans boutique connue : prix du catalogue gardé.
  async function catalogueObjets() {
    const [v1, v2] = await Promise.all([api("torn/?selections=items"), api("v2/torn/items")]);
    for (const it of v2.items) {
      if (!it.value.shops.length || !v1.items[it.id]) continue;
      v1.items[it.id].sell_price = Math.max(0, ...it.value.shops.filter((s) => s.country === "Torn").map((s) => s.sell_price || 0));
    }
    return v1.items;
  }

  async function boutiques(ids) {
    // {id: boutique de Torn qui rachète le plus cher}, 100 objets par appel
    const res = {};
    for (let i = 0; i < ids.length; i += 100) {
      for (const it of (await api(`v2/torn/items?ids=${ids.slice(i, i + 100).join(",")}`)).items) {
        const offres = it.value.shops.filter((s) => s.sell_price && s.country === "Torn").sort((a, b) => b.sell_price - a.sell_price);
        res[it.id] = offres.length ? offres[0].shop : "Ville";
      }
    }
    return res;
  }

  // ---------- Listes d'objets : Add listing de l'item market, ou ajout d'objets à un échange ----------
  // Les deux pages ont la même logique (quantité ou case par exemplaire, objets uniques groupés à déplier)
  // mais pas la même structure. Item market : React récent, liste virtualisée. Échange : ancienne page, <li>.

  const echange = () => location.pathname.includes("trade.php");

  const lignes = () => [...document.querySelectorAll(echange()
    ? "ul.items-cont.all-items > li:not(.disabled)"
    : '[class*="itemRow___"]:not([class*="grayedOut"])')];

  function lire(ligne) {
    const id = (ligne.querySelector("img")?.getAttribute("src") || "").match(/items\/(\d+)/)?.[1];
    if (echange()) {
      return {
        nom: ligne.querySelector(".name-wrap .t-overflow")?.textContent.trim(), id,
        qte: Number(ligne.querySelector(".item-amount")?.textContent.trim()) || 1,
        unique: !!ligne.querySelector('input[name="amount"][type="checkbox"]'),
        pos: [...ligne.parentElement.children].indexOf(ligne),  // lignes stables : leur rang suffit
        groupe: ligne.classList.contains("parent-group"),
      };
    }
    const nom = ligne.querySelector('[class*="name___"]')?.textContent.trim();
    const qte = Number((ligne.querySelector('[class*="title___"]')?.textContent.match(/x(\d+)\s*$/) || [0, 1])[1]);
    // objet unique (arme, armure) : une ligne par exemplaire, repérée par sa position dans la liste
    const unique = !ligne.querySelector('input[placeholder="Qty"]:not([type="hidden"])');
    const pos = Number((ligne.closest('[class*="virtualListing"]')?.getAttribute("style") || "").match(/translateY\((-?\d+)/)?.[1] || 0);
    // ligne groupée : reconnue à sa flèche (libellé « Expand N … items », ou « View all info … » si un exemplaire est équipé)
    return { nom, id, qte, unique, pos, groupe: !!ligne.querySelector('[class*="groupArrow"], button[aria-label^="Expand"]') };
  }

  // Price repéré par son conteneur : son texte indicatif sert à afficher le canal (voir estomper). Pas de prix dans un échange.
  const champ = (ligne, nom) => echange()
    ? (nom === "Qty" ? ligne.querySelector('input[name="amount"][type="text"]') : null)
    : ligne.querySelector(nom === "Price"
      ? '[class*="priceInputWrapper"] input:not([type="hidden"])'
      : 'input[placeholder="Qty"]:not([type="hidden"])');
  const cases = (ligne) => [...ligne.querySelectorAll('input[type="checkbox"]')];
  const anonymat = (ligne) => cases(ligne).find((c) => /anonymous/i.test(c.getAttribute("aria-label") || ""));
  // objet unique (arme, armure) : pas de champ quantité, une case à cocher pour le sélectionner
  const selection = (ligne) => echange() ? ligne.querySelector('input[name="amount"][type="checkbox"]')
    : cases(ligne).find((c) => !/anonymous/i.test(c.getAttribute("aria-label") || ""));
  // ligne où l'on peut saisir (sinon : page de confirmation de l'item market)
  const modifiable = (ligne, o) => o.groupe || !!champ(ligne, echange() ? "Qty" : "Price") || !!selection(ligne);
  const cocher = (c, oui) => { if (c && c.checked !== oui) c.click(); };

  // Info-bulle maison (voir infobulle) : un attribut title serait affiché deux fois (navigateur + Torn).
  // Sur un champ, le texte est porté par son conteneur.
  const support = (el) => el.closest('[class*="priceInputWrapper"]') || el;
  const bulleDe = (el) => support(el).dataset.tbtBulle || "";
  function bulle(el, texte) {
    const cible = support(el);
    if (texte) cible.dataset.tbtBulle = texte;
    else delete cible.dataset.tbtBulle;
  }

  // Valeur d'un exemplaire d'objet unique : bonus d'abord, puis somme des stats (dégâts, précision, armure)
  function score(ligne) {
    if (echange()) {  // bonus non lus sur cette page : stats seules
      return [...ligne.querySelectorAll(".info-main-wrap .left")].reduce((t, e) => t + (parseFloat(e.textContent) || 0), 0);
    }
    const stats = [...ligne.querySelectorAll('[class*="property___"] span[aria-label]')]
      .reduce((t, e) => t + (parseFloat(e.getAttribute("aria-label")) || 0), 0);
    const bonus = [...ligne.querySelectorAll('[class*="modifier___"]')]
      .filter((i) => !/no bonus/i.test(i.getAttribute("aria-label") || "")).length;
    return bonus * 1000 + stats;
  }

  // Plusieurs exemplaires d'un objet unique sont regroupés sous « Expand N … items » : tout déplier
  async function deplier() {
    for (let tour = 0; tour < 5; tour++) {
      let ouverts = 0;
      await parcourir((l) => {
        const b = echange() ? (l.classList.contains("parent-group") && l.querySelector(".group-arrow"))
          : l.querySelector('[class*="groupArrow"]') ? l.querySelector("button") : l.querySelector('button[aria-label^="Expand"]');
        if (b) { b.click(); ouverts++; }
      });
      if (!ouverts) return;
    }
  }

  function saisir(input, valeur) {
    if (!input) return;
    // champs gérés par React : passer par le setter natif puis signaler la saisie
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, String(valeur));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const PRIX_SUSPECT = 2;  // prix > 2 × valeur marché : annonces bon marché sans doute toutes vendues, vérifier

  // Prix rempli suspect : orange + info-bulle (réappliqué à chaque fois que la page redessine la ligne)
  function signaler(ligne, o) {
    const p = champ(ligne, "Price"), pl = plan.get(o.id);
    if (!p) return;
    const suspect = !!pl && pl.mv > 0 && pl.prix > PRIX_SUSPECT * pl.mv && p.value !== "";
    p.style.setProperty("color", suspect ? "#ff9800" : "", suspect ? "important" : "");
    p.style.setProperty("box-shadow", suspect ? "inset 0 0 0 2px #ff9800" : "", suspect ? "important" : "");
    if (suspect) {
      bulle(p, `Prix ${Math.round(pl.prix / pl.mv * 10) / 10} × la valeur marché (${pl.mv.toLocaleString("en-US")} $) : `
        + "les annonces bon marché ont peut-être toutes été vendues. Vérifier avant de mettre en vente.");
    } else if (bulleDe(p).startsWith("Prix ")) bulle(p, "");
  }

  function remplirLigne(ligne, qte, prix, mv) {
    const q = champ(ligne, "Qty");
    q ? saisir(q, qte) : cocher(selection(ligne), true);
    saisir(champ(ligne, "Price"), prix);
    cocher(anonymat(ligne), true);
    ligne.style.outline = "2px solid #2e7d32";
  }

  function viderLigne(ligne) {
    const q = champ(ligne, "Qty");
    q ? saisir(q, "") : cocher(selection(ligne), false);
    saisir(champ(ligne, "Price"), "");
    cocher(anonymat(ligne), false);
    ligne.style.outline = "";
  }

  // ---------- Exemplaires à garder, réglables ligne par ligne ----------
  // Choix d'une ligne (mémorisé dans Violentmonkey) : nombre, ou "tout" ; sans choix, GARDER (en tête du script) s'applique.

  const choix = () => GM_getValue("garder_lignes", {});

  function aGarder(nom, qte) {
    const c = choix()[nom.toLowerCase()];
    if (c === "tout") return qte;
    return Math.min(qte, c !== undefined ? c : GARDER[nom.toLowerCase()] || 0);
  }

  function noter(nom, valeur) {
    const c = choix();
    if (valeur === null) delete c[nom.toLowerCase()];
    else c[nom.toLowerCase()] = valeur;
    GM_setValue("garder_lignes", c);
  }

  const plan = new Map();     // id -> { qte: possédés, prix }, du dernier clic sur Remplir
  const remplis = new Set();  // ids remplis par le script
  const ailleurs = new Map(); // id -> meilleur canal quand ce n'est pas l'item market (Bazaar, nom de boutique)

  const exemplaires = new Map(); // id d'objet unique -> Map(position de la ligne -> score)

  function appliquer(ligne) {
    const o = lire(ligne), p = plan.get(o.id);
    if (!o.id) return;
    let n = p ? p.qte - aGarder(o.nom, p.qte) : 0;
    if (o.unique) {  // garder les exemplaires aux meilleures stats, vendre les autres
      const ordre = [...(exemplaires.get(o.id) || [])].sort((a, b) => b[1] - a[1]).map(([pos]) => pos);
      const rang = ordre.indexOf(o.pos);
      n = p && rang >= aGarder(o.nom, ordre.length) ? 1 : 0;
      if (!n) { if (p) viderLigne(ligne); estomper(ligne, o); ligne.style.opacity = "0.4"; return; }
    }
    if (n > 0) { remplirLigne(ligne, n, p.prix, p.mv); remplis.add(o.id); }
    else if (remplis.has(o.id)) { viderLigne(ligne); remplis.delete(o.id); }
    estomper(ligne, o);
  }

  // Ligne estompée quand rien n'y est à vendre : tout gardé (✕), stock <= exemplaires à garder,
  // ou meilleur canal ailleurs (affiché sur la ligne après Remplir)
  // Pages des boutiques de la ville où vendre (nouvel onglet), relevées sur la carte de la ville le 8/10.
  // Nikeh Performance n'y figure pas tant que la boutique est verrouillée (cours SPT2126) : adresse déduite.
  const PAGES_BOUTIQUES = {
    "Sally's Sweet Shop": "shops.php?step=candy", "Bits 'n' Bobs": "shops.php?step=bitsnbobs",
    "TC Clothing": "shops.php?step=clothes", "Big Al's Gun Shop": "bigalgunshop.php",
    "Pharmacy": "shops.php?step=pharmacy", "Jewelry Store": "shops.php?step=jewelry",
    "Super Store": "shops.php?step=super", "Recycling Center": "shops.php?step=recyclingcenter",
    "Pawn Shop": "shops.php?step=pawnshop", "Nikeh Sports": "shops.php?step=nikeh",
    "Nikeh Performance": "shops.php?step=nikeh", "Docks": "shops.php?step=docks",
    "Print Store": "shops.php?step=printstore", "Cyber Force": "shops.php?step=cyberforce",
    "Post Office": "shops.php?step=postoffice",
  };

  // Nom de boutique en orange (texte indicatif du champ vide) cliquable : ouvre la boutique dans un nouvel onglet.
  // Seulement tant que le champ est vide, pour pouvoir quand même y saisir une valeur.
  function lienBoutique(champVide, ligne) {
    const page = () => PAGES_BOUTIQUES[ailleurs.get(lire(ligne).id)];
    champVide.style.cursor = page() && !champVide.value ? "pointer" : "";
    champVide.classList.toggle("tbt-lien", !!page());  // souligné seulement si c'est une boutique
    if (champVide.dataset.tbtLien) return;
    champVide.dataset.tbtLien = "1";
    champVide.addEventListener("mousedown", (e) => {
      const p = page();
      if (!p || champVide.value) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(`https://www.torn.com/${p}`, "_blank");
    }, true);
  }

  function estomper(ligne, o) {
    // objet unique déplié : exemplaires comptés par Remplir, à défaut lignes affichées ; ligne groupée : « xN » du titre
    const qte = o.unique && !o.groupe
      ? exemplaires.get(o.id)?.size || lignes().filter((l) => lire(l).id === o.id).length
      : o.qte;
    ligne.style.opacity = aGarder(o.nom, qte) >= qte || ailleurs.has(o.id) ? "0.4" : "";
    // canal à utiliser affiché dans le champ vide de la ligne (Price, ou Qty dans un échange) : colonne alignée, place libre
    const prix = champ(ligne, echange() ? "Qty" : "Price");
    if (prix) {
      prix.placeholder = ailleurs.has(o.id) ? `→ ${ailleurs.get(o.id)}` : echange() ? "Qty" : "Price";
      prix.classList.toggle("tbt-ailleurs", ailleurs.has(o.id));
      if (ailleurs.has(o.id)) bulle(prix, `Mieux vendu : ${ailleurs.get(o.id)}`
        + (PAGES_BOUTIQUES[ailleurs.get(o.id)] ? " (clic : ouvrir la boutique)" : ""));
      else if (bulleDe(prix).startsWith("Mieux vendu")) bulle(prix, "");  // ne pas effacer l'alerte de prix
      lienBoutique(prix, ligne);
    }
    signaler(ligne, o);
  }

  // Un seul contrôle par objet : sur la ligne groupée, ou sur le premier exemplaire une fois dépliée
  function suiteDuMeme(ligne, o) {
    const prec = echange() ? ligne.previousElementSibling
      : ligne.closest('[class*="virtualListing"]')?.previousElementSibling?.querySelector('[class*="itemRow___"]');
    return o.unique && !!prec && lire(prec).id === o.id;
  }

  function controle(ligne) {
    const o = lire(ligne);
    // ligne groupée : pas de zone d'infos, le contrôle va directement dans la ligne
    const zone = echange() ? ligne
      : ligne.querySelector('[class*="additionalInfo___"]') || (o.groupe ? ligne : null);
    const ancien = ligne.querySelector(".tbt-garder");
    // page de confirmation (« Add these items to the market? ») : lignes sans champ, pas de contrôle
    if (!modifiable(ligne, o)) { ancien?.remove(); return; }
    if (!o.id || !zone) return;
    if (suiteDuMeme(ligne, o)) { ancien?.remove(); estomper(ligne, o); return; }
    if (ancien && ancien.dataset.id === o.id) return;
    ancien?.remove();  // ligne réutilisée par la page pour un autre objet
    const c = choix()[o.nom.toLowerCase()];
    const boite = document.createElement("span");
    boite.className = "tbt-garder";
    boite.dataset.id = o.id;
    // superposé (hors du flux) pour ne pas écraser le nom ni les stats : juste avant le prix, ou avant la flèche d'une ligne groupée
    zone.style.position = "relative";
    let place;
    if (echange()) {
      // échange : colonne fixe, alignée sur toutes les lignes, dans l'espace libre entre le nom (« … x55 ») et les valeurs
      place = "left:300px";
    } else {
      // repère : le texte du prix (« $1,516 », pas son bloc)
      const prix = zone.querySelector('[class*="price___"] span');
      place = `right:${Math.round(prix ? zone.getBoundingClientRect().right - prix.getBoundingClientRect().left + 6 : 30)}px`;
    }
    boite.style.cssText = "position:absolute;top:50%;transform:translateY(-50%);z-index:1;display:inline-flex;"
      + `align-items:center;gap:2px;font-size:11px;${place}`;
    boite.addEventListener("click", (e) => e.stopPropagation());  // ne pas déplier la ligne groupée
    bulle(boite, "Exemplaires à garder (vide : liste GARDER du script, valeur en grisé). ✕ : ne rien vendre de cet objet");
    const saisie = document.createElement("input");
    // style imposé : la page d'échange agrandit ses champs de saisie
    saisie.style.cssText = "width:34px;height:18px;line-height:16px;box-sizing:border-box;font-size:11px;padding:0 2px;"
      + "text-align:center;background:#222;color:#ddd;border:1px solid #555;border-radius:3px;margin:0";
    const defaut = GARDER[o.nom.toLowerCase()] || 0;
    saisie.placeholder = defaut >= 999999 ? "tout" : String(defaut);
    saisie.value = c === undefined ? "" : c;
    const tout = document.createElement("button");
    tout.type = "button";
    tout.textContent = "✕";
    tout.style.cssText = "font-size:12px;padding:0 3px;cursor:pointer;background:none;border:none;color:#ddd";
    const maj = (valeur) => {
      noter(o.nom, valeur);
      saisie.value = valeur === null ? "" : valeur;
      // toutes les lignes de l'objet (exemplaires d'un objet unique compris)
      lignes().filter((l) => lire(l).id === o.id).forEach((l) => (plan.has(o.id) ? appliquer(l) : estomper(l, lire(l))));
    };
    saisie.addEventListener("change", () => {
      const v = saisie.value.trim().toLowerCase();
      maj(v === "" ? null : v === "tout" ? "tout" : Math.max(0, parseInt(v, 10) || 0));
    });
    tout.addEventListener("click", () => maj(choix()[o.nom.toLowerCase()] === "tout" ? null : "tout"));
    boite.append(saisie, tout);
    zone.append(boite);
    estomper(ligne, o);
  }

  // La liste ne garde qu'une fenêtre de lignes : la parcourir en descendant, ce qui est saisi reste mémorisé.
  async function parcourir(action) {
    window.scrollTo(0, 0);
    await attendre(800);
    let avant;
    do {  // s'arrête quand la page ne descend plus (plus rien à charger)
      lignes().forEach(action);
      avant = window.scrollY;
      window.scrollBy(0, window.innerHeight * 0.8);
      await attendre(700);
    } while (window.scrollY !== avant);
    lignes().forEach(action);
    window.scrollTo(0, 0);
  }

  // ---------- Remplissage ----------

  async function remplir(bouton) {
    bouton.disabled = true;
    try {
      bouton.textContent = "Dépliage…";
      await deplier();
      bouton.textContent = "Inventaire…";
      const vus = new Map();
      exemplaires.clear();
      await parcourir((l) => {
        const o = lire(l);
        if (!o.id || o.groupe) return;
        if (o.unique) {
          if (!exemplaires.has(o.id)) exemplaires.set(o.id, new Map());
          o.qte = exemplaires.get(o.id).set(o.pos, score(l)).size;
        }
        vus.set(o.id, o);
      });

      bouton.textContent = "Prix…";
      const catalogue = await catalogueObjets();
      const candidats = [...vus.values()].filter((o) => o.qte > aGarder(o.nom, o.qte));
      const bas = await plusBasses(candidats.map((o) => o.id));

      plan.clear();
      ailleurs.clear();
      const enVille = [];
      for (const o of candidats) {
        const it = catalogue[o.id];
        if (!it) continue;
        const meilleur = meilleurCanal(it, bas[o.id]);
        // Add listing : ce qui rapporte le plus sur l'item market ; échange : ce dont le meilleur canal est le bazaar
        // sur l'Add listing, il faut une annonce existante pour fixer le prix (annonce la plus basse - 1 $)
        if (meilleur === (echange() ? "bazaar" : "im") && (echange() || bas[o.id])) {
          plan.set(o.id, { qte: o.qte, prix: (bas[o.id] || 0) - 1, mv: it.market_value || 0 });
        }
        else if (meilleur === "ville") enVille.push(o.id);
        else if (meilleur) ailleurs.set(o.id, meilleur === "bazaar" ? "Bazaar" : echange() ? "Item market" : "aucune annonce");
      }
      if (enVille.length) Object.entries(await boutiques(enVille)).forEach(([id, b]) => ailleurs.set(id, b));

      bouton.textContent = "Remplissage…";
      await parcourir(appliquer);
      bouton.textContent = `${remplis.size} objet(s) remplis : vérifier puis ${echange() ? "Add to trade" : "Add to market"}`;
    } catch (e) {
      bouton.textContent = `Erreur : ${e.message} (détail dans la console)`;
      console.error("[TornBastTools]", e);
    } finally {
      bouton.disabled = false;
    }
  }

  function ajouterBouton() {
    if (document.getElementById("tbt-remplir")) return;
    // « Clear all » : bouton sur l'item market, simple texte cliquable dans un échange
    const effacer = [...document.querySelectorAll(echange() ? ".items-footer .clear-action" : "button")]
      .find((b) => b.textContent.trim() === "Clear all");
    if (!effacer) return;
    const b = document.createElement("button");
    b.id = "tbt-remplir";
    b.type = "button";
    b.className = "torn-btn";
    b.style.marginLeft = "8px";
    b.textContent = "Remplir";
    b.addEventListener("click", () => remplir(b));
    effacer.after(b);
  }

  // ---------- Mes annonces (viewListing) : bouton « Màj prix » ----------
  // Prix visé = annonce concurrente la moins chère - 1 $ : baisse si quelqu'un est passé dessous,
  // remonte si je suis seul en tête. Mes annonces viennent de l'API (prix réellement en vente, pas les champs
  // déjà modifiés) et sont retirées de la liste du marché (même prix, même quantité).

  const cibles = new Map();  // id -> { avant: prix en vente, cible: prix visé }

  const valeur = (input) => Number(input.value.replace(/\D/g, ""));

  function cadrer(ligne) {
    const o = lire(ligne), p = champ(ligne, "Price"), c = cibles.get(o.id);
    if (!p) return;
    const change = c && c.cible !== c.avant && valeur(p) === c.cible;
    const mieux = c?.mieux && valeur(p) === c.cible;  // orange : à ce prix, un autre canal paie plus
    const couleur = mieux ? "#ff9800" : change ? (c.cible < c.avant ? "#e53935" : "#2e7d32") : "";
    p.style.setProperty("box-shadow", couleur ? `inset 0 0 0 2px ${couleur}` : "", couleur ? "important" : "");
    const $ = (n) => `${Math.round(n).toLocaleString("en-US")} $`;
    bulle(p, mieux ? `Mieux vendu : ${c.mieux} (${Math.round((c.mieuxNet / c.net - 1) * 100)} % plus cher)`
      : change ? `En vente à ${$(c.avant)} (${c.cible < c.avant ? "baisse" : "hausse"})` : "");
  }

  async function majPrix(bouton) {
    bouton.disabled = true;
    try {
      bouton.textContent = "Prix…";
      const miennes = new Map();  // id d'objet -> mes annonces
      for (const a of (await api("v2/user/itemmarket")).itemmarket) {
        const id = String(a.item.id);
        if (!miennes.has(id)) miennes.set(id, []);
        miennes.get(id).push(a);
      }
      // Sans modification en attente (Save changes grisé), les champs affichent mes vrais prix en vente :
      // s'ils diffèrent de l'API, celle-ci sert encore une réponse en cache (~30 s), ne pas calculer sur du périmé
      const sauver = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Save changes");
      if (sauver?.disabled) {
        let perime = false;
        await parcourir((l) => {
          const o = lire(l), p = champ(l, "Price"), mes = miennes.get(o.id);
          if (p && mes && !mes.some((m) => m.price === valeur(p))) perime = true;
        });
        if (perime) { bouton.textContent = "API pas encore à jour (cache ~30 s) : réessayer dans un instant"; return; }
      }
      const marche = await annonces([...miennes.keys()]);
      cibles.clear();
      for (const [id, mes] of miennes) {
        const autres = [...marche[id]];
        for (const m of mes) {
          const i = autres.findIndex((a) => a.price === m.price && a.amount === m.amount);
          if (i >= 0) autres.splice(i, 1);
        }
        if (autres.length) cibles.set(id, { avant: mes[0].price, cible: autres[0].price - 1 });
      }
      // Au prix visé, un autre canal paie-t-il mieux ? (même règle que Remplir)
      const catalogue = await catalogueObjets();
      const enVille = [];
      for (const [id, c] of cibles) {
        const it = catalogue[id];
        if (!it) continue;
        const im = c.cible * TAUX_ITEM_MARKET;
        const bazaar = netBazaar(it), ville = it.sell_price || 0;
        if (Math.max(bazaar, ville) <= im) continue;
        c.net = im;
        if (ville >= bazaar) { c.mieux = "Ville"; c.mieuxNet = ville; enVille.push(id); }
        else { c.mieux = "Bazaar"; c.mieuxNet = bazaar; }
      }
      if (enVille.length) Object.entries(await boutiques(enVille)).forEach(([id, b]) => { cibles.get(id).mieux = b; });
      bouton.textContent = "Mise à jour…";
      const remis = new Set();  // champs modifiés à la main, ramenés au prix en vente (déjà le meilleur)
      await parcourir((l) => {
        const o = lire(l), p = champ(l, "Price"), c = cibles.get(o.id);
        if (p && c && valeur(p) !== c.cible) { saisir(p, c.cible); if (c.cible === c.avant) remis.add(o.id); }
        cadrer(l);
      });
      const n = [...cibles.values()].filter((c) => c.cible !== c.avant).length;
      const ailleursN = [...cibles.values()].filter((c) => c.mieux).length;
      bouton.textContent = ailleursN ? `${n} prix modifié(s), ${ailleursN} mieux vendu(s) ailleurs (orange)`
        : n ? `${n} prix modifié(s) : vérifier puis Save changes`
        : remis.size ? `Prix déjà au mieux, ${remis.size} champ(s) remis au prix en vente : rien à sauver`
        : "Prix déjà au mieux";
    } catch (e) {
      bouton.textContent = `Erreur : ${e.message} (détail dans la console)`;
      console.error("[TornBastTools]", e);
    } finally {
      bouton.disabled = false;
    }
  }

  // Save changes ou Undo changes : les prix comparés ne sont plus d'actualité, effacer cadres et compteur
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("button");
    if (!b || !/^(Save|Undo) changes$/.test(b.textContent.trim())) return;
    cibles.clear();
    const maj = document.getElementById("tbt-majprix");
    if (maj) maj.textContent = "Màj prix";
    setTimeout(() => lignes().forEach(cadrer), 300);
  }, true);

  function ajouterBoutonMaj() {
    if (document.getElementById("tbt-majprix")) return;
    const annuler = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Undo changes");
    if (!annuler) return;
    const b = document.createElement("button");
    b.id = "tbt-majprix";
    b.type = "button";
    b.className = "torn-btn";
    b.style.marginLeft = "8px";
    b.textContent = "Màj prix";
    b.addEventListener("click", () => majPrix(b));
    annuler.after(b);
  }

  // ---------- Échange, vue (step=view) : minimum attendu des traders Wardogs ----------
  // Mes objets (colonne de gauche) × valeur marché × taux de la catégorie.
  // Si l'autre joueur a mis de l'argent, comparaison avec ce minimum (tolérance 1 %).

  let catalogueVue = null;  // catalogue des objets, lu une fois par page
  let signatureVue = "";    // contenu de l'échange déjà évalué

  const dollars = (n) => `${Math.round(n).toLocaleString("en-US")} $`;
  const argentPropose = () => {
    const t = document.querySelector(".trade-cont .user.right ul.cont li.color1 .name")?.textContent || "";
    return /in trade/i.test(t) ? Number(t.replace(/\D/g, "")) : null;
  };

  // Sous « Total value: … » (div.tt-total-value, ajouté par TornTools) : nos lignes au même style, dans l'ordre
  // « Taxed value » puis « Wardogs ». Style recopié tel qu'affiché, sans reprendre la classe :
  // TornTools pourrait modifier ou supprimer sa ligne.
  function ligneTotal(id, libelle, montant, apres) {
    const modele = document.querySelector(".trade-cont .user.left .tt-total-value");
    if (!modele || !apres) return null;
    let ligne = document.getElementById(id);
    if (!ligne || ligne.previousElementSibling !== apres) {
      ligne?.remove();
      ligne = document.createElement("div");
      ligne.id = id;
      const st = getComputedStyle(modele), stMontant = getComputedStyle(modele.querySelector("span") || modele);
      ligne.style.cssText = ["height", "line-height", "font-size", "font-family", "text-align", "color"]
        .map((k) => `${k}:${st.getPropertyValue(k)}`).join(";");
      ligne.append(`${libelle}: `, Object.assign(document.createElement("span"), { style: `color:${stMontant.color}` }));
      apres.after(ligne);
    }
    ligne.querySelector("span").textContent = `$${Math.round(montant).toLocaleString("en-US")}`;  // format de TornTools
    return ligne;
  }

  async function evaluerEchange() {
    const mesObjets = [...document.querySelectorAll(".trade-cont .user.left ul.cont li.color2 .desc li .name")];
    // TornTools peut afficher son « Total value » après notre passage : refaire la ligne Wardogs si elle manque
    const signature = mesObjets.map((e) => e.textContent.trim()).join("|") + "#" + argentPropose()
      + "#" + !!document.getElementById("tbt-wardogs") + !!document.getElementById("tbt-reel")
      + "#" + !!document.querySelector(".trade-cont .user.left .tt-total-value");
    if (!document.querySelector(".trade-cont") || signature === signatureVue) return;
    signatureVue = signature;
    try {
      catalogueVue = catalogueVue || await catalogueObjets();
      const parNom = new Map(Object.entries(catalogueVue).map(([id, it]) => [it.name, { id, it }]));
      const objets = [];
      const inconnus = [];
      for (const e of mesObjets) {
        // texte propre de la ligne, sans ce qu'ajoutent d'autres scripts (TornTools affiche « $39,863 » à la suite)
        const propre = [...e.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim();
        const m = propre.replace(/\s*\$[\d,]+$/, "").match(/^(.*?)(?: x(\d+))?$/);
        const trouve = parNom.get(m[1]);
        if (trouve) objets.push({ e, ...trouve, q: Number(m[2] || 1) });
        else inconnus.push(m[1]);
      }
      // Taxed value : ce que je toucherais en mettant moi-même en vente (annonce la plus basse - 1 $, frais 15 %)
      const bas = await plusBasses([...new Set(objets.map((o) => o.id))]);
      let total = 0, reel = 0;
      for (const { e, id, it, q } of objets) {
        const taux = tauxTraders(it), v = (it.market_value || 0) * q * taux;
        const r = bas[id] ? (bas[id] - 1) * TAUX_ITEM_MARKET * q : 0;
        total += v;
        reel += r;
        bulle(e, `Wardogs : ${q} × ${dollars(it.market_value || 0)} × ${Math.round(taux * 100)} % = ${dollars(v)}`
          + (bas[id] ? ` · Item market : ${q} × ${dollars(bas[id] - 1)} × 85 % = ${dollars(r)}` : " · Item market : aucune annonce"));
      }
      const ligneReel = ligneTotal("tbt-reel", "Taxed value", reel,
        document.querySelector(".trade-cont .user.left .tt-total-value"));
      const enLigne = !!ligneTotal("tbt-wardogs", "Wardogs", total, ligneReel);
      const offre = argentPropose();
      let bandeau = document.getElementById("tbt-attendu");
      // bandeau : comparaison de l'offre et objets non comptés (et le minimum lui-même si TornTools n'affiche pas son total)
      if (enLigne && offre === null && !inconnus.length) { bandeau?.remove(); return; }
      if (!bandeau) {
        bandeau = document.createElement("div");
        bandeau.id = "tbt-attendu";
        bandeau.style.cssText = "margin-top:8px;padding:8px 12px;border-radius:5px;background:#1b1f26;color:#eee;"
          + "border:1px solid #e0a030;font-size:13px;font-weight:bold";
        document.querySelector(".trade-cont").after(bandeau);
      }
      let texte = enLigne ? "" : `Minimum attendu des traders Wardogs : ${dollars(total)}`;
      if (offre !== null && total > 0) {
        const ecart = offre / total - 1, ok = ecart >= -0.01;
        texte += `${texte ? " · " : ""}Offre : ${dollars(offre)} (${ecart >= 0 ? "+" : ""}${(ecart * 100).toFixed(1)} %) : `
          + (ok ? "OK" : "trop bas, demander le détail par objet");
        bandeau.style.borderColor = ok ? "#2e7d32" : "#e53935";
      } else bandeau.style.borderColor = "#e0a030";
      if (inconnus.length) texte += `${texte ? " · " : ""}non comptés : ${inconnus.join(", ")}`;
      bandeau.textContent = texte;
    } catch (e) {
      signatureVue = "";  // réessayer au prochain changement de la page
      console.error("[TornBastTools]", e);
    }
  }

  // ---------- Items (item.php) : message pour les traders ----------
  // Catégories des objets à vendre aux traders, lues sur la page (temps réel : l'inventaire de l'API est une photo
  // qui peut dater de plus d'une demi-heure). Règle : objets gardés exclus,
  // meilleur canal = bazaar, une catégorie par terme, Arson et portefeuilles à part, le reste en « + other stuff to resell ».

  const TERMES = { Flower: "flowers", Plushie: "plushies", Candy: "candies", Alcohol: "alcohol", Drug: "drugs",
    "Energy Drink": "energy drinks", Booster: "boosters", "Supply Pack": "supply packs", Medical: "medical",
    Enhancer: "enhancers", Artifact: "artifacts", Car: "cars" };
  const FOURRE_TOUT = "other stuff to resell";

  async function messageTraders(bouton, sortie) {
    bouton.disabled = true;
    try {
      bouton.textContent = "Inventaire…";
      // la liste se charge au défilement mais garde ses lignes : descendre jusqu'à ce qu'il n'en arrive plus
      let n = -1;
      while (n !== document.querySelectorAll("#all-items > li[data-item]").length) {
        n = document.querySelectorAll("#all-items > li[data-item]").length;
        window.scrollTo(0, document.body.scrollHeight);
        await attendre(900);
      }
      window.scrollTo(0, 0);
      // quantité par objet : ligne groupée (objet unique en plusieurs exemplaires) si elle existe, sinon somme des lignes
      const noms = new Map(), groupes = new Map(), sommes = new Map();
      for (const li of document.querySelectorAll("#all-items > li[data-item]")) {
        if (li.dataset.equipped === "true") continue;
        const id = li.dataset.item, q = Number(li.dataset.qty) || 1;
        noms.set(id, li.dataset.sort);
        if (li.classList.contains("item-group")) groupes.set(id, q);
        else sommes.set(id, (sommes.get(id) || 0) + q);
      }
      const stock = new Map([...noms].map(([id, nom]) => [id, { nom, qte: groupes.get(id) ?? sommes.get(id) }]));
      bouton.textContent = "Prix…";
      const catalogue = await catalogueObjets();
      const candidats = [...stock].filter(([, o]) => o.qte > aGarder(o.nom, o.qte)).map(([id]) => id);
      const bas = await plusBasses(candidats);
      const valeurs = new Map();
      for (const id of candidats) {
        const it = catalogue[id], o = stock.get(id);
        if (!it) continue;
        if (meilleurCanal(it, bas[id]) !== "bazaar") continue;
        const traders = (it.market_value || 0) * tauxTraders(it);
        // portefeuilles : « wallets », terme des joueurs ; les autres Supply Packs (caches, cadeaux…) gardent leur nom
        const terme = /Arson/.test(it.effect || "") ? "Arson materials"
          : /Wallet|Billfold|Cardholder|Clutch|Purse/.test(it.name) ? "wallets" : TERMES[it.type] || FOURRE_TOUT;
        valeurs.set(terme, (valeurs.get(terme) || 0) + traders * (o.qte - aGarder(o.nom, o.qte)));
      }
      const termes = [...valeurs.keys()].filter((t) => t !== FOURRE_TOUT).sort((a, b) => valeurs.get(b) - valeurs.get(a));
      let texte = termes.join(", ");
      if (valeurs.has(FOURRE_TOUT)) texte = texte ? `${texte}, + ${FOURRE_TOUT}` : FOURRE_TOUT;
      sortie.textContent = texte || "Rien à vendre aux traders.";
      sortie.style.display = "block";
      if (texte) {
        await navigator.clipboard.writeText(texte);
        bouton.textContent = "Message copié";
      } else bouton.textContent = "Message traders";
    } catch (e) {
      bouton.textContent = `Erreur : ${e.message} (détail dans la console)`;
      console.error("[TornBastTools]", e);
    } finally {
      bouton.disabled = false;
    }
  }

  function ajouterBoutonItems() {
    if (document.getElementById("tbt-message")) return;
    const titre = [...document.querySelectorAll(".items-wrap span.m-hide")].find((e) => /^Your items/.test(e.textContent.trim()));
    const entete = titre?.parentElement;
    if (!entete) return;
    const b = document.createElement("button");
    b.id = "tbt-message";
    b.type = "button";
    b.className = "torn-btn";
    b.style.cssText = "margin-left:10px;vertical-align:middle;line-height:20px;height:22px;padding:0 8px";
    b.textContent = "Message traders";
    const sortie = document.createElement("div");
    sortie.style.cssText = "display:none;margin:6px 0;padding:8px 12px;border-radius:5px;background:#1b1f26;color:#eee;"
      + "border:1px solid #e0a030;font-size:13px;font-weight:bold;user-select:all";
    b.addEventListener("click", (e) => { e.stopPropagation(); messageTraders(b, sortie); });
    entete.append(b);
    entete.closest(".items-wrap")?.before(sortie);
  }

  // ---------- Toutes les pages : bouton flottant « Fermer le bazaar » ----------
  // Une vente du bazaar arrive en argent sur soi, que n'importe qui peut alors muger (buy mug). Le bouton s'affiche,
  // en haut à droite, quand ce risque existe : à Torn (statut Okay : ni hôpital, ni prison, ni vol, ni étranger)
  // avec un bazaar ouvert qui contient des objets. Un clic, une requête : step=closeBazaar (relevée le 12/11/2026).
  // État du bazaar : bazaar.php?sid=bazaarData&step=getBazaarContent (l'API Torn ne voit pas s'il est fermé).

  const BAZAAR_RELECTURE_MS = 30_000;

  // Requête de la page elle-même (cookies de session de Torn) : par GM_xmlhttpRequest, Torn répond 403
  async function bazaarData(step) {
    const rfcv = /(?:^|;\s*)rfc_v=([^;]+)/.exec(document.cookie)?.[1] || "";
    const r = await fetch(`/bazaar.php?sid=bazaarData&step=${step}&rfcv=${rfcv}`,
      { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }

  let boutonBazaar = null;
  // Débogage : true affiche le bouton en permanence, avec l'état lu sous le libellé
  const DEBUG_BAZAAR = false;

  async function verifierBazaar() {
    if (DEBUG_BAZAAR) afficherBazaar(true);
    if (document.hidden) return;
    if (!GM_getValue("cle_api", "")) { diagnostic("pas de clé API"); return; }  // pas de demande de clé sur une page quelconque
    try {
      const [profil, contenu] = await Promise.all([api("user/?selections=basic"), bazaarData("getBazaarContent&ID=")]);
      const d = JSON.parse(contenu);
      const risque = profil.status?.state === "Okay"
        && !!d.state?.isBazaarExists && !d.state.isClosed;
      diagnostic(`statut ${profil.status?.state}, bazaar ${d.state?.isBazaarExists ? (d.state.isClosed ? "fermé" : "ouvert") : "absent"}, `
        + `${d.totalQuantity} objets, risque ${risque ? "oui" : "non"}`);
      afficherBazaar(risque);
    } catch (e) {
      diagnostic(`erreur : ${e.message}`);
      console.error("[TornBastTools] état du bazaar", e);
    }
  }

  // Débogage : état lu affiché sous le libellé du bouton
  function diagnostic(texte) {
    if (!DEBUG_BAZAAR || !boutonBazaar) return;
    boutonBazaar.innerHTML = "";
    boutonBazaar.append("Fermer le bazaar", Object.assign(document.createElement("small"), { textContent: texte }));
  }

  function afficherBazaar(risque) {
    if (!risque && !DEBUG_BAZAAR) { boutonBazaar?.remove(); boutonBazaar = null; return; }
    if (boutonBazaar) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tbt-bazaar";
    b.textContent = "Fermer le bazaar";
    bulle(b, "Bazaar ouvert à Torn : une vente arrive en argent sur soi, exposé au mug");
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await bazaarData("closeBazaar");
        afficherBazaar(false);
        b.disabled = false;
        verifierBazaar();
      } catch (e) {
        b.innerHTML = "";
        b.append("Réessayer : fermer le bazaar", Object.assign(document.createElement("small"), { textContent: `erreur : ${e.message}` }));
        b.disabled = false;
        console.error("[TornBastTools]", e);
      }
    });
    document.body.append(b);
    boutonBazaar = b;
  }

  verifierBazaar();
  setInterval(verifierBazaar, BAZAAR_RELECTURE_MS);
  document.addEventListener("visibilitychange", verifierBazaar);

  const style = document.createElement("style");
  style.textContent = ".tbt-ailleurs::placeholder { color: #e0a030; opacity: 1; }"
    + ".tbt-lien::placeholder { text-decoration: underline; }"
    // Bouton « Fermer le bazaar » : même style que les boutons de Torn Oracle (rouge « danger » du même thème)
    + ".tbt-bazaar { position: fixed; top: 70px; right: 12px; z-index: 100001; appearance: none; cursor: pointer;"
    + " display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 14px; border-radius: 8px;"
    + " border: 1px solid #b91c1c; background: #b91c1c; color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.25);"
    + " font: 600 13px/1.3 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; touch-action: manipulation; }"
    + ".tbt-bazaar:hover { filter: brightness(1.08); }"
    + ".tbt-bazaar:disabled { opacity: .45; cursor: progress; }"
    + ".tbt-bazaar small { font-size: 11px; font-weight: 400; opacity: .9; }"
    + "body.dark-mode .tbt-bazaar { background: #dc2626; border-color: #f87171; }";
  document.head.append(style);

  // Une seule bulle flottante pour toute la page : les lignes de Torn coupent ce qui dépasse (overflow hidden)
  const infobulle = document.createElement("div");
  infobulle.style.cssText = "position:fixed;display:none;background:#1b1f26;color:#eee;padding:6px 10px;border-radius:5px;"
    + "border:1px solid #e0a030;box-shadow:0 3px 10px rgba(0,0,0,.7);font-size:12px;font-weight:bold;"
    + "white-space:nowrap;z-index:100000;pointer-events:none";
  document.body.append(infobulle);
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest?.("[data-tbt-bulle]");
    if (!el) { infobulle.style.display = "none"; return; }
    infobulle.textContent = el.dataset.tbtBulle;
    infobulle.style.display = "block";
    const r = el.getBoundingClientRect();
    infobulle.style.left = `${Math.max(4, r.right - infobulle.offsetWidth)}px`;
    infobulle.style.top = `${r.top - infobulle.offsetHeight - 4}px`;
  });

  // La page redessine ses lignes au défilement : remettre bouton et contrôles, au plus une fois par image
  let prevu = false;
  function surveiller() {
    if (prevu) return;
    prevu = true;
    requestAnimationFrame(() => {
      prevu = false;
      if (!echange() && location.hash.includes("viewListing")) { ajouterBoutonMaj(); lignes().forEach(cadrer); }
      if (echange() && location.hash.includes("step=view")) evaluerEchange();
      if (location.pathname.includes("item.php")) { ajouterBoutonItems(); return; }
      if (!location.hash.includes(echange() ? "step=add" : "addListing")) return;
      ajouterBouton();
      lignes().forEach(controle);
    });
  }
  // characterData : Torn change certains textes en place (« 17 queued » → « 50 queued ») sans recréer d'élément
  new MutationObserver(surveiller).observe(document.body, { childList: true, subtree: true, characterData: true });
  surveiller();
})();
