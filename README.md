# ClicBoutique — Store Builder

Ce pack est la base du générateur de boutiques ClicBoutique.

## Parcours
1. Connexion Shopify
2. URL fournisseur
3. Génération d'une boutique mono-produit plein écran
4. Aperçu animé
5. Export vers Shopify
6. Si 0 crédit : ouverture des packs PayPal

## Shopify
La connexion réelle doit utiliser l'authentification Shopify et le GraphQL Admin API. Shopify indique que les applications obtiennent un access token après l'installation/autorisation et utilisent ensuite ce token pour les appels Admin API. La documentation actuelle recommande GraphQL Admin API pour les nouvelles apps.

## Démarrage
```bash
npm install express
node server.js
```

Copier `.env.example` vers `.env` et renseigner les identifiants de l'application Shopify.

Le fichier `server.js` contient le squelette OAuth et l'endpoint d'export. Il faut encore brancher la base de données, la confirmation PayPal côté serveur, l'extraction fournisseur et les mutations Shopify GraphQL avant une mise en production.
