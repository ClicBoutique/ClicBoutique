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
