import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import {fileURLToPath} from "url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const db=new Database(process.env.DB_PATH || path.join(__dirname,"clicboutique.db"));
db.pragma("journal_mode=WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 credits INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS shopify_sessions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 shop TEXT UNIQUE NOT NULL,
 access_token TEXT NOT NULL,
 scope TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS generations(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 supplier_url TEXT NOT NULL,
 title TEXT,
 description TEXT,
 price TEXT,
 images_json TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS credit_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 type TEXT NOT NULL,
 amount INTEGER NOT NULL,
 external_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

app.use(express.json({limit:"1mb"}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname,"public")));
app.use("/api/",rateLimit({windowMs:60_000,max:100}));

const sign=(u)=>jwt.sign({uid:u.id,email:u.email},process.env.SESSION_SECRET,{expiresIn:"7d"});
function auth(req,res,next){
 const t=req.cookies.cb_session;
 if(!t)return res.status(401).json({error:"AUTH_REQUIRED"});
 try{req.user=jwt.verify(t,process.env.SESSION_SECRET)}catch{return res.status(401).json({error:"AUTH_REQUIRED"})}
 next();
}
function userRow(id){return db.prepare("SELECT * FROM users WHERE id=?").get(id)}
function safeUrl(u){try{const x=new URL(u);return /^https?:$/.test(x.protocol)?x.toString():null}catch{return null}}
function unique(a){return [...new Set(a.filter(Boolean))]}

function extractImages(html,base){
 const out=[];
 const add=u=>{try{if(!u)return;u=u.replace(/&amp;/g,"&").trim();const abs=new URL(u,base).toString();if(/\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(abs)||/alicdn|aliexpress|shopifycdn|cdn/i.test(abs))out.push(abs)}catch{}};
 for(const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi))add(m[1]);
 for(const m of html.matchAll(/<img[^>]+(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["']/gi))add(m[1]);
 for(const m of html.matchAll(/(?:imagePathList|imageUrlList|skuImages|galleryImages|imageList|images)\s*[:=]\s*(\[[\s\S]{0,10000}?\])/gi)){
   const block=m[1]; for(const x of block.matchAll(/["'](https?:[^"']+|\/\/[^"']+)["']/g))add(x[1]);
 }
 for(const m of html.matchAll(/https?:\/\/[^"'\\\s]+(?:alicdn|aliexpress)[^"'\\\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\\s]*)?/gi))add(m[0]);
 return unique(out).slice(0,20);
}
async function fetchSupplier(url){
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),12000);
 try{
  const r=await fetch(url,{signal:c.signal,redirect:"follow",headers:{
   "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
   "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
   "Accept-Language":"en-US,en;q=0.9,fr;q=0.8"
  }});
  if(!r.ok)throw new Error("SUPPLIER_HTTP_"+r.status);
  const html=await r.text();
  const title=(html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]
    ||html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||"Produit").replace(/\s+/g," ").trim().slice(0,180);
  const desc=(html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)/i)?.[1]||"Une sélection pensée pour simplifier votre quotidien.").slice(0,500);
  const images=extractImages(html,url);
  return {title,description:desc,images};
 }finally{clearTimeout(timer)}
}

async function aiCopy(data){
 if(!process.env.ANTHROPIC_API_KEY)return null;
 try{
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{
   "content-type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,
   "anthropic-version":"2023-06-01"
  },body:JSON.stringify({model:process.env.CLAUDE_MODEL||"claude-haiku-4-5-20251001",max_tokens:1200,
   system:"Return ONLY valid JSON with keys title,subtitle,description,benefits (array of 4 strings). Do not invent technical specs, certifications, prices or medical claims.",
   messages:[{role:"user",content:`Supplier product data:\n${JSON.stringify(data)}`}]
  })});
  if(!r.ok)return null;const j=await r.json();const txt=j.content?.map(x=>x.text||"").join("")||"";
  return JSON.parse(txt.replace(/^```json|```$/g,"").trim());
 }catch{return null}
}

app.post("/api/auth/register",async(req,res)=>{
 const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8)return res.status(400).json({error:"EMAIL_OR_PASSWORD_INVALID"});
 try{
  const hash=await bcrypt.hash(password,12);
  const info=db.prepare("INSERT INTO users(email,password_hash,credits) VALUES(?,?,?)").run(email,hash,email===process.env.ADMIN_EMAIL?.toLowerCase()?999999:0);
  const u=userRow(info.lastInsertRowid);res.cookie("cb_session",sign(u),{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:604800000});
  res.json({user:{email:u.email,credits:u.credits}});
 }catch(e){res.status(409).json({error:"EMAIL_ALREADY_EXISTS"})}
});
app.post("/api/auth/login",async(req,res)=>{
 const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");
 const u=db.prepare("SELECT * FROM users WHERE email=?").get(email);
 if(!u||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:"INVALID_LOGIN"});
 res.cookie("cb_session",sign(u),{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:604800000});
 res.json({user:{email:u.email,credits:u.credits}});
});
app.post("/api/auth/logout",(req,res)=>{res.clearCookie("cb_session");res.json({ok:true})});
app.get("/api/me",auth,(req,res)=>{const u=userRow(req.user.uid);res.json({email:u.email,credits:u.credits,shopify:!!db.prepare("SELECT 1 FROM shopify_sessions WHERE user_id=?").get(u.id)})});

app.get("/api/shopify/start",auth,(req,res)=>{
 const shop=String(req.query.shop||"").trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))return res.status(400).json({error:"INVALID_SHOP"});
 const state=crypto.randomBytes(24).toString("hex");
 res.cookie("shopify_state",state,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:600000});
 const redirect=`${process.env.APP_URL}/api/shopify/callback`;
 const p=new URLSearchParams({client_id:process.env.SHOPIFY_API_KEY||"",scope:process.env.SHOPIFY_SCOPES||"",redirect_uri:redirect,state});
 res.json({url:`https://${shop}/admin/oauth/authorize?${p}`});
});
app.get("/api/shopify/callback",async(req,res)=>{
 const {shop,code,state}=req.query;
 if(!shop||!code||state!==req.cookies.shopify_state)return res.status(400).send("Shopify OAuth state invalide.");
 const t=await fetch(`https://${shop}/admin/oauth/access_token`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({client_id:process.env.SHOPIFY_API_KEY,client_secret:process.env.SHOPIFY_API_SECRET,code})});
 if(!t.ok)return res.status(502).send("Shopify n'a pas retourné de token.");
 const j=await t.json();const sessionUser=req.cookies.cb_session?jwt.verify(req.cookies.cb_session,process.env.SESSION_SECRET):null;
 if(!sessionUser)return res.redirect("/?error=login_required");
 db.prepare(`INSERT INTO shopify_sessions(user_id,shop,access_token,scope) VALUES(?,?,?,?)
 ON CONFLICT(shop) DO UPDATE SET user_id=excluded.user_id,access_token=excluded.access_token,scope=excluded.scope`).run(sessionUser.uid,shop,j.access_token,j.scope||"");
 res.clearCookie("shopify_state");res.redirect("/?shopify=connected");
});

app.post("/api/generate",auth,async(req,res)=>{
 const url=safeUrl(req.body.productUrl);if(!url)return res.status(400).json({error:"INVALID_URL"});
 try{
  const p=await fetchSupplier(url);const ai=await aiCopy(p);
  const title=ai?.title||p.title, description=ai?.description||p.description;
  const info=db.prepare(`INSERT INTO generations(user_id,supplier_url,title,description,images_json) VALUES(?,?,?,?,?)`)
   .run(req.user.uid,url,title,description,JSON.stringify(p.images));
  res.json({id:info.lastInsertRowid,product:{title,subtitle:ai?.subtitle||"Une expérience pensée autour de votre produit.",description,benefits:ai?.benefits||[],images:p.images}});
 }catch(e){res.status(502).json({error:"SUPPLIER_FETCH_FAILED",message:"Le fournisseur a refusé ou bloqué la récupération. Essayez une autre URL."})}
});

async function shopifyGraphQL(shop,token,query,variables){
 const r=await fetch(`https://${shop}/admin/api/2026-07/graphql.json`,{method:"POST",headers:{"content-type":"application/json","X-Shopify-Access-Token":token},body:JSON.stringify({query,variables})});
 const j=await r.json();if(!r.ok||j.errors)throw new Error(JSON.stringify(j.errors||j));return j.data;
}
app.post("/api/export",auth,async(req,res)=>{
 const u=userRow(req.user.uid);if(u.credits<1)return res.status(402).json({error:"NO_CREDITS"});
 const s=db.prepare("SELECT * FROM shopify_sessions WHERE user_id=?").get(u.id);if(!s)return res.status(400).json({error:"SHOPIFY_NOT_CONNECTED"});
 const g=db.prepare("SELECT * FROM generations WHERE id=? AND user_id=?").get(req.body.generationId,u.id);if(!g)return res.status(404).json({error:"GENERATION_NOT_FOUND"});
 const images=JSON.parse(g.images_json||"[]");
 try{
  const mutation=`mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product:$product, media:$media) { product { id handle title onlineStoreUrl } userErrors { field message } }
  }`;
  const media=images.slice(0,10).map(src=>({originalSource:src,mediaContentType:"IMAGE"}));
  const data=await shopifyGraphQL(s.shop,s.access_token,mutation,{product:{title:g.title,descriptionHtml:g.description,handle:"clicboutique-"+g.id},media});
  const errs=data.productCreate.userErrors||[];if(errs.length)throw new Error(errs.map(x=>x.message).join("; "));
  db.prepare("UPDATE users SET credits=credits-1 WHERE id=? AND credits>0").run(u.id);
  db.prepare("INSERT INTO credit_events(user_id,type,amount,external_id) VALUES(?,?,?,?)").run(u.id,"export",-1,String(g.id));
  res.json({ok:true,product:data.productCreate.product});
 }catch(e){res.status(502).json({error:"SHOPIFY_EXPORT_FAILED",message:e.message})}
});

app.get("/api/paypal/links",(req,res)=>res.json({
 starter:{price:"9.90",credits:10,url:process.env.PAYPAL_STARTER_URL},
 creator:{price:"19.90",credits:25,url:process.env.PAYPAL_CREATOR_URL},
 pro:{price:"39.90",credits:60,url:process.env.PAYPAL_PRO_URL}
}));
app.post("/api/paypal/webhook",(req,res)=>{
 // IMPORTANT: production must verify the PayPal webhook signature before crediting anything.
 // Static payment links alone do not provide a safe mapping from a browser redirect to a user.
 res.status(501).json({error:"PAYPAL_WEBHOOK_REQUIRES_CONFIGURATION"});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(process.env.PORT||3000,()=>console.log(`ClicBoutique on ${process.env.PORT||3000}`));
