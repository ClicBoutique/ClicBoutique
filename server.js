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
app.set("trust proxy",1); // nécessaire derrière Render/Vercel pour détecter https correctement
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
app.use("/api/",rateLimit({windowMs:60_000,max:100,skip:req=>req.path.startsWith("/image-proxy")}));
app.use("/api/image-proxy",rateLimit({windowMs:60_000,max:400}));

const GUEST_RE=/^guest_[0-9a-f]{20}@guest\.local$/;
// Admin par défaut : peut être surchargé avec la variable d'env ADMIN_EMAIL,
// mais fonctionne même sans configuration Render/Vercel.
const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||"lucarega1304@gmail.com").trim().toLowerCase();
// Les connexions par email/mot de passe restent connectées 30 jours par défaut,
// pour qu'un même email n'ait pas à se reconnecter à chaque visite.
const sign=(u,remember)=>jwt.sign({uid:u.id,email:u.email},process.env.SESSION_SECRET,{expiresIn:"30d"});
function setSession(res,u,remember){
 const opt={httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:2592000000};
 res.cookie("cb_session",sign(u,remember),opt);
}
function auth(req,res,next){
 const t=req.cookies.cb_session;
 if(!t)return res.status(401).json({error:"AUTH_REQUIRED"});
 try{req.user=jwt.verify(t,process.env.SESSION_SECRET)}catch{return res.status(401).json({error:"AUTH_REQUIRED"})}
 next();
}
function userRow(id){return db.prepare("SELECT * FROM users WHERE id=?").get(id)}
function safeUrl(u){try{const x=new URL(u);return /^https?:$/.test(x.protocol)?x.toString():null}catch{return null}}
function unique(a){return [...new Set(a.filter(Boolean))]}
function isPrivateHost(host){
 return /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/i.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host==='::1' || host==='';
}
// Transforme une URL d'image externe (AliExpress, alicdn…) en URL passant par notre propre
// serveur : ça évite le blocage par referer/anti-hotlink du fournisseur, et ça donne à Shopify
// une image qu'il peut toujours récupérer (au lieu d'un lien direct qui peut être refusé).
function proxyImageUrl(origin,u){
 const safe=safeUrl(u); if(!safe) return null;
 return `${origin}/api/image-proxy?url=${encodeURIComponent(safe)}`;
}

function decodeHtmlText(v){
 return String(v||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\\\//g,'/').trim();
}
function cleanProductTitle(v,fallback){
 let t=decodeHtmlText(v).replace(/\s+/g,' ').trim();
 t=t.replace(/^AliExpress\s*[:\-|–—]?\s*/i,'').replace(/\s*[|–—-]\s*AliExpress.*$/i,'').trim();
 if(!t || /^\d{10,}\.html$/i.test(t) || /^\d+\.html$/i.test(t)) return fallback;
 return t.slice(0,180)||fallback;
}
function extractImages(html,base){
 const out=[];
 const add=u=>{try{
   if(!u)return;
   u=decodeHtmlText(u).replace(/^\\\//,'/').trim();
   if(u.startsWith('//'))u='https:'+u;
   const abs=new URL(u,base).toString();
   if(/^https?:/i.test(abs) && (/(alicdn|aliexpress|ae01|ae04|ae0[1-9]|kwcdn|temu|media-amazon|ssl-images-amazon)/i.test(abs) || /\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(abs))) out.push(abs);
 }catch{}};
 const patterns=[
  /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi,
  /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/gi,
  /<img[^>]+(?:src|data-src|data-original|data-lazy-src|data-ks-lazyload)=["']([^"']+)["']/gi,
  /(?:imagePathList|imageUrlList|skuImages|galleryImages|imageList|images)\s*[:=]\s*(\[[\s\S]{0,30000}?\])/gi,
  /(?:imageUrl|imagePath|imageURL)\s*[:=]\s*["']([^"']+)["']/gi,
  /https?:\\?\/\\?\/[^"'\\\s]+(?:alicdn|aliexpress)[^"'\\\s]+/gi,
  // Amazon : miniatures cliquables encodées en JSON dans l'attribut data-a-dynamic-image
  /data-a-dynamic-image=["'](\{[^"']+\})["']/gi,
  // Amazon : blocs colorImages/imageGalleryData embarqués dans le JS de la page ("hiRes"/"large")
  /"(?:hiRes|large|mainUrl)"\s*:\s*"([^"]+)"/gi
 ];
 for(const re of patterns){for(const m of html.matchAll(re)){
   const block=m[1]||m[0];
   if(re===patterns[3]) for(const x of block.matchAll(/["'](https?:[^"']+|\/\/[^"']+)["']/g)) add(x[1]);
   else if(re===patterns[6]){ try{ Object.keys(JSON.parse(decodeHtmlText(block))).forEach(add) }catch{} }
   else add(block);
 }}
 return unique(out).slice(0,20);
}
function extractJsonLd(html){
 const items=[];
 for(const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{items.push(JSON.parse(m[1].trim().replace(/\u002F/g,'/')))}catch{}
 }
 return items.flatMap(x=>Array.isArray(x)?x:[x]);
}
function looksBlocked(html){
 return /id=["']nocaptcha["']|punish\.aliexpress|login\.aliexpress|verify you are a human|slider.{0,20}captcha|请完成安全验证|robot check|to discuss automated access|api-services-support@amazon|captcha.{0,20}amazon|enter the characters you see|access denied|attention required.{0,20}cloudflare/i.test(html||'');
}
async function fetchHtml(url,extraHeaders={}){
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),12000);
 try{
  const r=await fetch(url,{signal:c.signal,redirect:'follow',headers:{
   'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
   'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
   'Accept-Language':'fr-FR,fr;q=0.9,en-US,en;q=0.8',
   'Referer':'https://www.google.com/',
   ...extraHeaders
  }});
  if(!r.ok)return null;
  return await r.text();
 }catch{return null}finally{clearTimeout(timer)}
}
function mobileVariant(url){
 try{
  const u=new URL(url);
  if(/aliexpress\.com$/i.test(u.hostname.replace(/^www\./,'')) && !/^m\./i.test(u.hostname)){
   u.hostname='m.'+u.hostname.replace(/^www\./,'');
   return u.toString();
  }
 }catch{}
 return null;
}
async function fetchSupplier(url){
 const slug=decodeURIComponent(url.split('?')[0].split('/').filter(Boolean).pop()||'Produit').replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
 const fallbackTitle=/^\d+(?:\.html)?$/i.test(slug)?'Produit AliExpress':(slug.replace(/\.html$/i,'').slice(0,120)||'Produit');
 const fallback={title:fallbackTitle,description:'Découvrez ce produit dans une présentation claire et professionnelle.',images:[],imagesBlocked:true,price:'',currency:'EUR',brand:'Maison Nova'};
 // 1ère tentative : l'URL telle quelle. Si le fournisseur bloque (anti-bot) ou ne renvoie aucune
 // image, on retente sur la version mobile qui est souvent moins protégée.
 let html=await fetchHtml(url);
 let effectiveUrl=url;
 if(!html || looksBlocked(html)){
  const mUrl=mobileVariant(url);
  if(mUrl){const mHtml=await fetchHtml(mUrl,{'Sec-Fetch-Mode':'navigate'});if(mHtml && !looksBlocked(mHtml)){html=mHtml;effectiveUrl=mUrl;}}
 }
 if(!html)return fallback;
 // Même quand la page charge sans être détectée comme bloquée, il arrive qu'aucune image
 // exploitable n'en ressorte (variante desktop très allégée en JS côté fournisseur) : on retente
 // alors la version mobile une fois, avant d'abandonner la récupération des photos.
 if(effectiveUrl===url && extractImages(html,url).length===0){
  const mUrl=mobileVariant(url);
  if(mUrl){const mHtml=await fetchHtml(mUrl,{'Sec-Fetch-Mode':'navigate'});if(mHtml && !looksBlocked(mHtml) && extractImages(mHtml,mUrl).length>0){html=mHtml;effectiveUrl=mUrl;}}
 }
 const jsonld=extractJsonLd(html).find(x=>x && (x['@type']==='Product'||Array.isArray(x['@type'])&&x['@type'].includes('Product')))||{};
 const embeddedTitle=html.match(/(?:productTitle|subject|productName)\s*[:=]\s*["']([^"']{8,300})["']/i)?.[1];
 const title=cleanProductTitle(jsonld.name || embeddedTitle ||
   html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ||
   html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],fallbackTitle);
 const desc=decodeHtmlText(jsonld.description || html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)/i)?.[1] || fallback.description).slice(0,1000);
 const offer=Array.isArray(jsonld.offers)?jsonld.offers[0]:(jsonld.offers||{});
 const price=String(offer.price||html.match(/(?:"price"|"salePrice"|"minPrice")\s*:\s*["']?([0-9]+(?:[.,][0-9]{1,2})?)/i)?.[1]||'').replace(',','.');
 const currency=String(offer.priceCurrency||html.match(/(?:"currency"|"priceCurrency")\s*:\s*["']([A-Z]{3})["']/i)?.[1]||'EUR');
 const brand=decodeHtmlText(typeof jsonld.brand==='string'?jsonld.brand:(jsonld.brand?.name||'')) || 'Maison Nova';
 const found=[];
 const jsonImages=jsonld.image?(Array.isArray(jsonld.image)?jsonld.image:[jsonld.image]):[];
 found.push(...jsonImages);
 found.push(...extractImages(html,effectiveUrl));
 const images=unique(found).slice(0,12);
 return {title,description:desc,images,imagesBlocked:images.length===0,price,currency,brand};
}

async function aiCopy(data){
 if(!process.env.ANTHROPIC_API_KEY)return null;
 try{
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{
   "content-type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,
   "anthropic-version":"2023-06-01"
  },body:JSON.stringify({model:process.env.CLAUDE_MODEL||"claude-haiku-4-5-20251001",max_tokens:1200,
   system:"Return ONLY valid JSON with keys title,subtitle,description,benefits (array of 4 strings),brandName,faq (array of 4 objects with q and a). Do not invent technical specs, certifications, prices, ratings or medical claims. Use only information present in the supplier data. If information is missing, write useful general ecommerce copy without making factual claims.",
   messages:[{role:"user",content:`Supplier product data:\n${JSON.stringify(data)}`}]
  })});
  if(!r.ok)return null;const j=await r.json();const txt=j.content?.map(x=>x.text||"").join("")||"";
  return JSON.parse(txt.replace(/^```json|```$/g,"").trim());
 }catch{return null}
}

app.post("/api/auth/register",async(req,res)=>{
 const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||""),remember=!!req.body.remember;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8)return res.status(400).json({error:"EMAIL_OR_PASSWORD_INVALID"});
 try{
  const hash=await bcrypt.hash(password,12);
  const info=db.prepare("INSERT INTO users(email,password_hash,credits) VALUES(?,?,?)").run(email,hash,email===ADMIN_EMAIL?999999:0);
  const u=userRow(info.lastInsertRowid);setSession(res,u,remember);
  res.json({user:{email:u.email,credits:u.credits,guest:false}});
 }catch(e){res.status(409).json({error:"EMAIL_ALREADY_EXISTS"})}
});
app.post("/api/auth/login",async(req,res)=>{
 const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||""),remember=!!req.body.remember;
 const u=db.prepare("SELECT * FROM users WHERE email=?").get(email);
 if(!u||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:"INVALID_LOGIN"});
 setSession(res,u,remember);
 res.json({user:{email:u.email,credits:u.credits,guest:false}});
});
app.post("/api/auth/logout",(req,res)=>{res.clearCookie("cb_session");res.json({ok:true})});
// Compte invité créé en silence dès que l'utilisateur commence (URL / Shopify / génération),
// pour ne demander la création de compte qu'à l'écran juste avant l'affichage de la boutique.
app.post("/api/auth/guest",async(req,res)=>{
 const existing=req.cookies.cb_session;
 if(existing){try{jwt.verify(existing,process.env.SESSION_SECRET);return res.json({ok:true})}catch{}}
 const email=`guest_${crypto.randomBytes(10).toString("hex")}@guest.local`;
 const hash=await bcrypt.hash(crypto.randomBytes(24).toString("hex"),10);
 const info=db.prepare("INSERT INTO users(email,password_hash,credits) VALUES(?,?,?)").run(email,hash,0);
 const u=userRow(info.lastInsertRowid);setSession(res,u,false);
 res.json({user:{email:u.email,credits:u.credits,guest:true}});
});
// Transforme le compte invité en vrai compte (garde le même id : crédits, Shopify et boutique générée restent liés).
app.post("/api/auth/claim",auth,async(req,res)=>{
 const cur=userRow(req.user.uid);if(!cur)return res.status(401).json({error:"AUTH_REQUIRED"});
 const email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||""),remember=!!req.body.remember;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8)return res.status(400).json({error:"EMAIL_OR_PASSWORD_INVALID"});
 if(!GUEST_RE.test(cur.email))return res.status(409).json({error:"ALREADY_REGISTERED"});
 try{
  const hash=await bcrypt.hash(password,12);
  db.prepare("UPDATE users SET email=?,password_hash=? WHERE id=?").run(email,hash,cur.id);
  const u=userRow(cur.id);setSession(res,u,remember);
  res.json({user:{email:u.email,credits:u.credits,guest:false}});
 }catch(e){res.status(409).json({error:"EMAIL_ALREADY_EXISTS"})}
});

async function paypalToken(){
 const base=(process.env.PAYPAL_ENV||'live').toLowerCase()==='sandbox'?'https://api-m.sandbox.paypal.com':'https://api-m.paypal.com';
 if(!process.env.PAYPAL_CLIENT_ID||!process.env.PAYPAL_CLIENT_SECRET) return null;
 const basic=Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
 const r=await fetch(`${base}/v1/oauth2/token`,{method:'POST',headers:{Authorization:`Basic ${basic}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
 if(!r.ok) throw new Error('PAYPAL_AUTH_FAILED');
 return {base,token:(await r.json()).access_token};
}

app.get('/api/auth/google/start',async(req,res)=>{
 if(!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET) return res.status(503).json({error:'GOOGLE_NOT_CONFIGURED'});
 const state=crypto.randomBytes(24).toString('hex');
 res.cookie('google_state',state,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:600000});
 const redirect=`${process.env.APP_URL}/api/auth/google/callback`;
 const q=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:'openid email profile',state,access_type:'offline',prompt:'select_account'});
 res.json({url:`https://accounts.google.com/o/oauth2/v2/auth?${q}`});
});
app.get('/api/auth/google/callback',async(req,res)=>{
 try{
  if(!req.query.code||!req.query.state||req.query.state!==req.cookies.google_state) return res.redirect('/?error=google_state');
  const redirect=`${process.env.APP_URL}/api/auth/google/callback`;
  const body=new URLSearchParams({code:String(req.query.code),client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:redirect,grant_type:'authorization_code'});
  const tr=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  if(!tr.ok) throw new Error('GOOGLE_TOKEN_FAILED');
  const tok=await tr.json();
  const ur=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${tok.access_token}`}});
  if(!ur.ok) throw new Error('GOOGLE_USER_FAILED');
  const profile=await ur.json(); const email=String(profile.email||'').trim().toLowerCase();
  if(!email) throw new Error('GOOGLE_EMAIL_MISSING');
  let u=db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if(!u){
   const hash=await bcrypt.hash(crypto.randomBytes(32).toString('hex'),12);
   const credits=email===ADMIN_EMAIL?999999:0;
   const info=db.prepare('INSERT INTO users(email,password_hash,credits) VALUES(?,?,?)').run(email,hash,credits); u=userRow(info.lastInsertRowid);
  }
  setSession(res,u,true); res.clearCookie('google_state'); res.redirect('/?social=google');
 }catch(e){res.redirect('/?error=google_login');}
});

app.get("/api/image-proxy",async(req,res)=>{
 const src=safeUrl(req.query.url);
 if(!src)return res.status(400).end();
 let host;try{host=new URL(src).hostname}catch{return res.status(400).end()}
 if(isPrivateHost(host))return res.status(400).end();
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),10000);
 try{
  const r=await fetch(src,{signal:c.signal,redirect:"follow",headers:{
   "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
   "Accept":"image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
   "Referer":"https://www.aliexpress.com/"
  }});
  if(!r.ok)return res.status(502).end();
  const ct=r.headers.get("content-type")||"";
  if(!/^image\//i.test(ct))return res.status(502).end();
  const buf=Buffer.from(await r.arrayBuffer());
  if(buf.length>8_000_000)return res.status(502).end();
  res.setHeader("Content-Type",ct);
  res.setHeader("Cache-Control","public, max-age=604800, immutable");
  res.send(buf);
 }catch{res.status(502).end();}finally{clearTimeout(timer)}
});

app.get("/api/me",auth,(req,res)=>{const u=userRow(req.user.uid);if(u.email.toLowerCase()===ADMIN_EMAIL && u.credits<999999)db.prepare("UPDATE users SET credits=999999 WHERE id=?").run(u.id);const fresh=userRow(u.id);res.json({email:fresh.email,credits:fresh.credits,guest:GUEST_RE.test(fresh.email),shopify:!!db.prepare("SELECT 1 FROM shopify_sessions WHERE user_id=?").get(fresh.id)})});

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
  const origin=`${req.protocol}://${req.get("host")}`;
  const images=unique(p.images.map(u=>proxyImageUrl(origin,u)));
  const info=db.prepare(`INSERT INTO generations(user_id,supplier_url,title,description,images_json) VALUES(?,?,?,?,?)`)
   .run(req.user.uid,url,title,description,JSON.stringify(images));
  res.json({id:info.lastInsertRowid,product:{title,subtitle:ai?.subtitle||"Une expérience pensée autour de votre produit.",description,benefits:ai?.benefits||[],faq:ai?.faq||[],brandName:ai?.brandName||p.brand||"Maison Nova",price:p.price||"",currency:p.currency||"EUR",images,imagesBlocked:images.length===0}});
 }catch(e){res.status(502).json({error:"SUPPLIER_FETCH_FAILED",message:"Le fournisseur a refusé ou bloqué la récupération. Essayez une autre URL."})}
});

app.post("/api/edit",auth,async(req,res)=>{
 const u=userRow(req.user.uid);if(u.credits<1)return res.status(402).json({error:"NO_CREDITS"});
 const g=db.prepare("SELECT * FROM generations WHERE id=? AND user_id=?").get(req.body.generationId,u.id);if(!g)return res.status(404).json({error:"GENERATION_NOT_FOUND"});
 try{
  const images=JSON.parse(g.images_json||"[]");
  const ai=await aiCopy({title:g.title,description:g.description,images,instruction:"Propose une nouvelle variante (titre et description différents) pour ce même produit."});
  if(!ai)return res.status(502).json({error:"EDIT_FAILED",message:"La régénération a échoué. Réessaie."});
  const title=ai.title||g.title,description=ai.description||g.description;
  db.prepare("UPDATE generations SET title=?,description=? WHERE id=?").run(title,description,g.id);
  db.prepare("UPDATE users SET credits=credits-1 WHERE id=? AND credits>0").run(u.id);
  db.prepare("INSERT INTO credit_events(user_id,type,amount,external_id) VALUES(?,?,?,?)").run(u.id,"edit",-1,String(g.id));
  res.json({id:g.id,credits:u.credits-1,product:{title,subtitle:ai.subtitle||"Une expérience pensée autour de votre produit.",description,benefits:ai.benefits||[],faq:ai.faq||[],brandName:ai.brandName||"Maison Nova",price:"",currency:"EUR",images,imagesBlocked:images.length===0}});
 }catch(e){res.status(502).json({error:"EDIT_FAILED",message:"La régénération a échoué. Réessaie."})}
});

// Solution de secours quand AliExpress bloque la récupération automatique des photos :
// l'utilisateur colle lui-même les liens d'images. Gratuit (aucun crédit débité).
app.post("/api/generations/:id/images",auth,(req,res)=>{
 const g=db.prepare("SELECT * FROM generations WHERE id=? AND user_id=?").get(req.params.id,req.user.uid);
 if(!g)return res.status(404).json({error:"GENERATION_NOT_FOUND"});
 const list=Array.isArray(req.body.images)?req.body.images:[];
 const origin=`${req.protocol}://${req.get("host")}`;
 const images=unique(list.map(safeUrl).filter(u=>u && /\.(jpg|jpeg|png|webp|avif|gif)(\?|$)/i.test(u)).map(u=>proxyImageUrl(origin,u))).slice(0,12);
 if(!images.length)return res.status(400).json({error:"NO_VALID_IMAGE_URL"});
 db.prepare("UPDATE generations SET images_json=? WHERE id=?").run(JSON.stringify(images),g.id);
 res.json({ok:true,images});
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


app.post('/api/paypal/order',auth,async(req,res)=>{
 const pack=String(req.body.pack||'').toLowerCase();
 const packs={starter:{name:'Starter',credits:10,value:'4.99'},pro:{name:'Pro',credits:50,value:'14.99'},business:{name:'Business',credits:150,value:'29.99'}};
 const p=packs[pack]; if(!p)return res.status(400).json({error:'INVALID_PACK'});
 try{
  const pp=await paypalToken(); if(!pp)return res.status(503).json({error:'PAYPAL_API_NOT_CONFIGURED'});
  const returnUrl=`${process.env.APP_URL}/api/paypal/callback`;
  const r=await fetch(`${pp.base}/v2/checkout/orders`,{method:'POST',headers:{Authorization:`Bearer ${pp.token}`,'Content-Type':'application/json'},body:JSON.stringify({intent:'CAPTURE',purchase_units:[{reference_id:`cb-${p.credits}-${req.user.uid}`,custom_id:String(req.user.uid),description:`ClicBoutique ${p.name} - ${p.credits} crédits`,amount:{currency_code:'EUR',value:p.value}}],application_context:{brand_name:'ClicBoutique',user_action:'PAY_NOW',return_url:returnUrl,cancel_url:`${process.env.APP_URL}/?payment=cancelled`}})});
  const j=await r.json(); if(!r.ok) throw new Error(j.message||'PAYPAL_ORDER_FAILED');
  const approve=j.links?.find(x=>x.rel==='approve')?.href; if(!approve) throw new Error('PAYPAL_APPROVAL_MISSING');
  db.prepare('INSERT INTO credit_events(user_id,type,amount,external_id) VALUES(?,?,?,?)').run(req.user.uid,'purchase_pending',p.credits,j.id);
  res.json({url:approve});
 }catch(e){res.status(502).json({error:'PAYPAL_ORDER_FAILED',message:e.message});}
});
app.get('/api/paypal/callback',auth,async(req,res)=>{
 try{
  const orderId=String(req.query.token||''); if(!orderId) return res.redirect('/?payment=failed');
  const pp=await paypalToken(); if(!pp) return res.redirect('/?payment=not_configured');
  const r=await fetch(`${pp.base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,{method:'POST',headers:{Authorization:`Bearer ${pp.token}`,'Content-Type':'application/json'}});
  const j=await r.json(); if(!r.ok) throw new Error(j.message||'PAYPAL_CAPTURE_FAILED');
  const pu=j.purchase_units?.[0]; const ref=String(pu?.reference_id||''); const credits=Number((ref.match(/cb-(\d+)-/)||[])[1]||0);
  if(j.status==='COMPLETED' && credits>0){
   const exists=db.prepare('SELECT 1 FROM credit_events WHERE user_id=? AND external_id=? AND type="purchase"').get(req.user.uid,orderId);
   if(!exists){db.prepare('UPDATE users SET credits=credits+? WHERE id=?').run(credits,req.user.uid);db.prepare('INSERT INTO credit_events(user_id,type,amount,external_id) VALUES(?,?,?,?)').run(req.user.uid,'purchase',credits,orderId);}
  }
  res.redirect(`/?payment=${j.status==='COMPLETED'?'success':'failed'}`);
 }catch(e){res.redirect('/?payment=failed');}
});

app.get("/api/paypal/links",(req,res)=>res.json({
 starter:{name:"Starter",price:"4,99",credits:10,url:"https://www.paypal.com/ncp/payment/74YS39Z9ZWXRC"},
 pro:{name:"Pro",price:"14,99",credits:50,url:"https://www.paypal.com/ncp/payment/9ZWBE2LBENKFG"},
 business:{name:"Business",price:"29,99",credits:150,url:"https://www.paypal.com/ncp/payment/3QC7C8SQMS9SE"}
}));
app.post("/api/paypal/webhook",(req,res)=>{
 // IMPORTANT: production must verify the PayPal webhook signature before crediting anything.
 // Static payment links alone do not provide a safe mapping from a browser redirect to a user.
 res.status(501).json({error:"PAYPAL_WEBHOOK_REQUIRES_CONFIGURATION"});
});

app.use((req, res) => {
 res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.listen(process.env.PORT||3000,()=>console.log(`ClicBoutique on ${process.env.PORT||3000}`));
