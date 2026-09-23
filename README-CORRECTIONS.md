# ClicBoutique — corrections (nouvelle passe)

## 1. Bouton retour
Un bouton « ← Retour » apparaît maintenant en haut à gauche dès que tu n'es plus sur le tout premier écran (URL). Il te ramène à l'écran précédent (fiche produit/prix, compte, Shopify, packs…) sans jamais te faire recommencer depuis le début. Le bouton se cache automatiquement pendant le chargement et sur l'écran de succès d'export.

## 2. Rester connecté
Les connexions par email/mot de passe (et la reprise de session) durent maintenant **30 jours automatiquement**, que la case « Se souvenir de moi » soit cochée ou non (elle l'est déjà par défaut). Une fois connecté avec un email, tu restes connecté à chaque retour sur le site tant que le cookie n'est pas effacé.
⚠️ Important : sur Render/Vercel, la variable `SESSION_SECRET` doit être **fixe** (toujours la même valeur) dans les paramètres d'environnement. Si elle change à chaque redéploiement, toutes les sessions sont invalidées à chaque déploiement — vérifie que `SESSION_SECRET` est bien définie une fois pour toutes dans les variables d'environnement du serveur, pas générée aléatoirement dans le code.

## 3. Compte admin lucarega1304@gmail.com
Ce compte a maintenant des **crédits illimités par défaut**, même sans configurer la variable `ADMIN_EMAIL` sur Render/Vercel (elle sert seulement à changer d'email admin plus tard si besoin). Ça s'applique automatiquement, que le compte existe déjà ou soit créé après coup, et pour toute méthode de connexion (email ou Google).

## 4. Connexion Google / Apple / Téléphone
Le code du bouton Google est complet et fonctionnera dès que tu ajoutes, sur Render/Vercel :
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
APP_URL=https://ton-domaine
```
et que tu déclares `https://ton-domaine/api/auth/google/callback` comme URI de redirection autorisée dans Google Cloud Console (API & Services → Identifiants → OAuth 2.0).

Je ne peux pas créer ces identifiants à ta place : ils demandent un compte Google Cloud (gratuit) et quelques clics dans une console que toi seul contrôles. Je ne peux pas non plus activer « Se connecter avec Apple » par le code seul — Apple exige un compte Apple Developer payant (99 $/an) et des certificats spécifiques. Tant que ces clés ne sont pas configurées, les boutons Apple et Téléphone affichent clairement qu'ils ne sont pas encore configurés (au lieu de sembler fonctionner puis échouer silencieusement, comme avant).

## 5. Images AliExpress qui ne se chargent pas
Deux choses ont changé :
- Le serveur retente maintenant automatiquement la **version mobile** de la page (`m.aliexpress.com`) quand la première tentative est bloquée (AliExpress protège fortement ses pages contre les robots, surtout depuis les serveurs cloud comme Render/Vercel — c'est une limite du site fournisseur, pas un bug côté ClicBoutique qu'on puisse éliminer à 100 %).
- **Solution de secours immédiate** : quand aucune image n'est trouvée, un lien « Coller les liens des images manuellement » apparaît sous le message d'alerte rouge. Fais un clic droit sur une photo AliExpress → « Copier l'adresse de l'image », colle les liens (un par ligne) et la boutique les utilise instantanément, sans consommer de crédit.

## 6. Boutique générée plus professionnelle
- Animations d'apparition au défilement (galerie, description, FAQ, arguments).
- Zoom léger au survol sur la photo principale et les miniatures.
- Clic sur une image = vue agrandie (lightbox) en plein écran.
- Barre d'achat flottante en bas d'écran sur mobile (prix + bouton export) qui apparaît au défilement.
- Sous-titres de section soulignés d'un trait dégradé pour une hiérarchie visuelle plus nette.

Le contenu (titre, description, bénéfices, FAQ) reste plus riche si `ANTHROPIC_API_KEY` est configurée sur Render/Vercel — sans cette clé, ClicBoutique utilise un texte générique correct mais plus basique.

## Variables d'environnement utiles (rappel)
```
SESSION_SECRET=une-valeur-longue-et-fixe
ADMIN_EMAIL=lucarega1304@gmail.com      # optionnel, déjà admin par défaut
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ANTHROPIC_API_KEY=
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_ENV=live
APP_URL=https://ton-domaine
```

---

## Suite (2ème passe)

### Photos vraiment "copiées" dans la boutique
Les images ne sont plus des liens directs vers AliExpress/alicdn — le serveur les **télécharge lui-même** et les ressert depuis ton propre domaine (`/api/image-proxy?...`), avec les bons en-têtes (`Referer` AliExpress) pour contourner la protection anti-hotlink qui bloquait l'affichage côté navigateur. Ça corrige à la fois :
- l'affichage dans la boutique générée (bug corrigé au passage : l'image principale n'était en fait jamais insérée dans la page — elle ne pouvait donc jamais s'afficher, même quand la récupération réussissait) ;
- la fiabilité de l'export Shopify, qui doit pouvoir aller chercher l'image lui-même — il ira maintenant la chercher sur ton domaine plutôt que sur AliExpress, ce qui est beaucoup plus fiable.

Les liens collés manuellement (voir passe précédente) passent aussi par ce même circuit.

### Admin lucarega1304@gmail.com
Confirmé actif par défaut (voir section 3 plus haut) — aucune configuration requise, mais il faut **déployer ce nouveau `server.js`** pour que ça s'applique.

### Connexion Google / Apple / « autre chose »
Le message que tu vois (« cette méthode de connexion doit être configurée sur ClicBoutique ») confirme qu'aucune clé Google n'est pour l'instant renseignée sur ton hébergeur (Render/Vercel) — ce n'est pas un bug du code, Google exige que **tu** crées ces identifiants toi-même (impossible pour moi de les générer à ta place) :
1. Va sur https://console.cloud.google.com/ → crée un projet (gratuit).
2. « API et services » → « Identifiants » → « Créer des identifiants » → « ID client OAuth » → type « Application Web ».
3. Ajoute comme URI de redirection autorisée : `https://TON-DOMAINE/api/auth/google/callback`
4. Copie le Client ID et le Client Secret générés.
5. Sur Render/Vercel, ajoute les variables d'environnement : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, et `APP_URL=https://TON-DOMAINE` (sans slash à la fin).
6. Redéploie.

Pour Apple, il faut en plus un compte Apple Developer payant (99 $/an) et la génération d'une clé "Sign in with Apple" — c'est une vraie contrainte d'Apple, pas quelque chose que le code peut contourner. Tant que ce n'est pas fait, le bouton Apple annonce honnêtement qu'il n'est pas configuré plutôt que d'échouer sans explication.

### Rendu visuel de la boutique générée
La boutique générée (page produit affichée à l'écran 5) a été redessinée dans un style minimal crème/noir avec navigation centrée, badge d'avis, colonne de vignettes cliquables à côté de la photo principale, bandeau d'arguments avec icônes, section immersive image/texte en alternance clair/sombre, et zoom/lightbox sur les photos — pour se rapprocher du type de rendu haut de gamme que tu as envoyé en exemple.

---

## Suite (3ème passe)

### 1. Connexion Shopify déplacée juste après l'URL
Le parcours est maintenant : **URL du produit → connexion Shopify → génération → boutique**. Dès que tu colles le lien AliExpress/Temu/Amazon/Chine et cliques sur « Commencer », l'écran Shopify apparaît immédiatement (au lieu d'attendre l'export). Si tu n'as pas encore ta boutique Shopify sous la main, un lien « Générer la boutique d'abord » te permet de continuer sans bloquer — tu pourras connecter Shopify plus tard, à l'export.

### 2. Compte requis seulement à l'export
Avant, il fallait créer un compte juste après la génération, avant même de voir la boutique. Maintenant tu peux voir, parcourir et modifier ta boutique en tant qu'invité ; la création de compte (ou connexion) n'est demandée qu'au moment où tu cliques sur « Exporter vers Shopify ». Une fois le compte créé, l'export reprend automatiquement là où tu l'avais laissé.

### 3. Couleurs restantes dans la boutique générée
Un reste de CSS de l'ancienne version (icône de marque en dégrédé violet/rose, section d'en-tête dupliquée) écrasait le thème crème/noir déjà en place et faisait réapparaître de la couleur dans la boutique générée. C'est supprimé : l'icône de marque, les étoiles d'avis et tout l'en-tête de la boutique générée sont maintenant strictement noir/blanc cassé, cohérents avec l'exemple NEXORA envoyé.
⚠️ Les couleurs violet/rose/orange restent utilisées ailleurs, mais uniquement dans l'interface **de ClicBoutique elle-même** (le générateur), jamais dans la boutique livrée au client final.

### 4. Photos qui ne remontent toujours pas
Deux améliorations côté récupération :
- La détection de blocage reconnaît maintenant aussi les pages anti-robot d'Amazon et les protections Cloudflare génériques (avant : seulement AliExpress), donc le message d'erreur est plus fiable.
- Quand la page se charge normalement mais qu'aucune image exploitable n'est trouvée (fournisseur qui charge ses photos en JavaScript), le serveur retente automatiquement une seconde fois avant d'abandonner.
- Ajout de motifs de lecture spécifiques aux fiches Amazon (`data-a-dynamic-image`, `hiRes`) et reconnaissance des CDN Temu (`kwcdn`).
- **Cela reste une limite du fournisseur, pas totalement éliminable** : certains sites bloquent systématiquement les serveurs cloud (Render/Vercel n'ont pas d'IP « résidentielle »). Le secours reste la solution existante : coller les liens d'images à la main (clic droit → Copier l'adresse de l'image) depuis la fiche produit, gratuitement, sans consommer de crédit.


## 7. Parcours Shopify simplifié
- Le formulaire « Connecte Shopify » a été supprimé de ClicBoutique.
- La génération démarre directement après l'URL produit.
- « Exporter vers Shopify » vérifie d'abord les crédits.
- Si le compte a au moins 1 crédit et n'est pas encore autorisé sur Shopify, le navigateur quitte immédiatement ClicBoutique et ouvre `SHOPIFY_INSTALL_URL`.
- Après le retour OAuth, l'export reprend automatiquement avec la génération sauvegardée.
- Pour une utilisation multi-boutiques, `SHOPIFY_INSTALL_URL` doit être le lien d'installation/listing de l'application Shopify, pas l'URL d'administration d'une boutique.

## 8. Qualité de la boutique IA
Le prompt de génération a été renforcé pour demander une identité de marque distinctive, une rédaction ecommerce premium en français, des bénéfices spécifiques au produit, une FAQ et une hiérarchie éditoriale cohérente, sans inventer de caractéristiques techniques. Les images originales récupérées sont conservées dans la galerie et utilisées à l'export.
