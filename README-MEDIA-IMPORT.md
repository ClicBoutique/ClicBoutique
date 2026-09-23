# Import d’images et de vidéos

Cette version ajoute un bouton « Importer des images / vidéos » dans la boutique générée.

- Jusqu’à 12 fichiers à la fois.
- Images et vidéos jusqu’à 50 Mo par fichier.
- Les médias importés sont associés à la génération en cours.
- Les images/vidéos importées sont envoyées vers `/uploads/` et incluses dans l’export Shopify.
- Sur Render sans stockage persistant, les fichiers peuvent disparaître après un redéploiement/restart. Pour un stockage durable, configure ensuite un stockage persistant ou un bucket objet.

## Variable Shopify

Ajoute dans Render :

`SHOPIFY_INSTALL_URL` = le lien d’installation de ton application Shopify.
