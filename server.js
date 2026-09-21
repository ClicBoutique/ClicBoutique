const express = require("express");
const crypto = require("crypto");
const path = require("path");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_SCOPES = "read_products,write_products,read_themes,write_themes",
  SHOPIFY_APP_URL = "http://localhost:3000"
} = process.env;

function shopifyAuthUrl(shop) {
  const redirect = `${SHOPIFY_APP_URL}/auth/shopify/callback`;
  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: SHOPIFY_API_KEY || "",
    scope: SHOPIFY_SCOPES,
    redirect_uri: redirect,
    state
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

app.get("/auth/shopify", (req,res)=>{
  // In production, do not accept arbitrary shop domains without validation.
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send("Ajoute ?shop=nom-boutique.myshopify.com pour le prototype.");
  }
  res.redirect(shopifyAuthUrl(shop));
});

app.get("/auth/shopify/callback", async (req,res)=>{
  const { shop, code } = req.query;
  if (!shop || !code) return res.status(400).send("OAuth Shopify incomplet.");
  // Exchange `code` for an access token server-side here.
  // Store the token encrypted and associate it with the authenticated ClicBoutique account.
  res.redirect("/?shopify=connected");
});

app.post("/api/export", async (req,res)=>{
  // Production flow:
  // 1) verify ClicBoutique session
  // 2) verify confirmed PayPal entitlement/credit
  // 3) use Shopify Admin GraphQL API with the stored access token
  // 4) create/update the product, media, theme/app extension
  // 5) publish/return the storefront URL
  res.json({ok:true, message:"Export endpoint ready for Shopify Admin GraphQL integration."});
});

app.listen(process.env.PORT || 3000, ()=>console.log("ClicBoutique running"));
