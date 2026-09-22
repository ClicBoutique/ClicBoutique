# ClicBoutique — corrections intégrées

Cette version corrige les points signalés :

- Boutique générée beaucoup plus complète : logo texte, titre, sous-titre, description, prix quand disponible, galerie, bénéfices, réassurance et FAQ.
- Les vraies images récupérées depuis la page fournisseur sont utilisées. Elles ne sont pas remplacées par des images inventées.
- Si aucune image réelle ne peut être chargée, le message rouge exact s'affiche : « Attention : AliExpress ne donne pas accès aux photos avec certains liens. »
- Les titres du type `123456789.html` ne sont plus affichés comme nom de produit.
- Les boutons Google / Apple / Téléphone ne prétendent plus fonctionner s'ils ne sont pas configurés. Google est prêt à fonctionner dès que GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sont ajoutés.
- « Se souvenir de moi » utilise un cookie de session persistant ; l'email n'est pas ajouté à l'URL du produit.
- Les packs Starter / Pro / Business sont affichés avec les liens PayPal fournis.
- Si PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET sont configurés, le paiement passe par PayPal Orders et les crédits sont ajoutés automatiquement au retour de paiement.

## Variables Render à ajouter pour Google

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

Dans Google Cloud, l'URL de callback doit être :
https://VOTRE-DOMAINE/api/auth/google/callback

## Variables Render pour les crédits PayPal automatiques

PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_ENV=live

Sans ces clés PayPal, les boutons utilisent les liens PayPal statiques et le crédit automatique ne peut pas être associé de manière sûre au compte.
