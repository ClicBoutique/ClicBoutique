# ClicBoutique — production-ready base

Cette version est une base réellement exploitable côté serveur : comptes, sessions, SQLite, extraction fournisseur, génération optionnelle via Anthropic, OAuth Shopify et export produit via Shopify Admin GraphQL.

## Ce qui fonctionne déjà
- inscription / connexion serveur avec mot de passe hashé
- session HttpOnly
- crédits stockés côté serveur
- connexion Shopify OAuth (à configurer dans Shopify Partner Dashboard)
- récupération serveur d'un produit fournisseur
- extraction de titres/descriptions/images avec plusieurs heuristiques
- génération de copy via Anthropic si `ANTHROPIC_API_KEY` est renseignée
- aperçu boutique plein écran animé
- export d'un produit + médias vers Shopify Admin GraphQL
- débit d'1 crédit seulement après export Shopify réussi
- protection basique par rate limit
- secrets via variables d'environnement

## Important pour les paiements
Les liens PayPal statiques fournis sont conservés comme fallback. Pour créditer automatiquement un utilisateur après paiement, il faut brancher une intégration PayPal API/Checkout avec webhook vérifié, car un simple retour navigateur ou un lien de paiement statique ne doit pas être considéré comme une preuve de paiement. PayPal recommande de vérifier les signatures des webhooks côté serveur.

## Important pour Shopify
La connexion Shopify n'est plus demandée pendant la création de la boutique. L'utilisateur arrive directement sur Shopify uniquement lorsqu'il clique sur « Exporter vers Shopify » et qu'il possède au moins 1 crédit.

Pour un vrai parcours multi-boutiques, configure `SHOPIFY_INSTALL_URL` avec le lien d'installation/listing Shopify de ton application. Pour un test sur une seule boutique, tu peux utiliser `SHOPIFY_STORE=nom-boutique.myshopify.com`.

Le callback utilisé par le flux OAuth legacy est :
`https://TON-DOMAINE/api/shopify/callback`

Scopes de départ :
`read_products,write_products,write_themes,read_themes`

Les images originales récupérées depuis le fournisseur (notamment les CDN AliExpress quand elles sont disponibles) sont conservées dans la génération et passées à Shopify via le proxy d'images ClicBoutique.

Important : si tu veux que des utilisateurs de différentes boutiques Shopify puissent installer l'application, l'application Shopify doit être distribuée de façon compatible (généralement public distribution) et son parcours d'installation/OAuth doit être configuré dans le Dev Dashboard. Un simple lien d'admin d'une boutique n'est pas un lien d'installation universel. Shopify documente le flux OAuth et les liens d'installation. 


## Installation locale
```bash
npm install
cp .env.example .env
# renseigner les secrets
npm start
```

Puis ouvrir http://localhost:3000

## Déploiement
Le projet est adapté à Render/Railway/Fly.io ou un VPS Node. Il faut une base persistante pour `clicboutique.db`; sur un hébergement à filesystem éphémère, utiliser PostgreSQL ou un disque persistant avant production.

## Limites à terminer avant vente publique
1. Remplacer SQLite par PostgreSQL managé ou volume persistant.
2. Ajouter la gestion de comptes oubli de mot de passe / email verification.
3. Finaliser PayPal Checkout + webhook vérifié et mapping pack -> crédit.
4. Stocker les tokens Shopify chiffrés au repos.
5. Ajouter validation HMAC/state complète selon le template Shopify choisi.
6. Ajouter les mutations Shopify nécessaires au thème/sections si l'objectif est de publier un design complet, pas seulement un produit.
7. Ajouter extraction fournisseur avec navigateur headless/proxy spécialisé si AliExpress bloque les requêtes serveur.
8. Ajouter logs, monitoring, backups et HTTPS.
