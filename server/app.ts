import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import Stripe from 'stripe';
import { z } from 'zod';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes, randomInt } from 'node:crypto';
import { all, one, run, transaction, id, now, audit } from './db.ts';
import { root, dataDir, origin, comfyKey, mediaBaseUrl } from './config.ts';
import { userSession, requireAuth, csrf, hash, passwordHash, passwordValid, startSession } from './auth.ts';
import { normalizeUpload, previewFor, validSignature, removeFile } from './media.ts';
import { MODEL, classifyError } from './pipeline.ts';
import { teams, teamMembership, teamAccess, listingTeam, acceptTeamInvite } from './teams.ts';
import { community, catalog, metadataSchema, saveMetadata } from './community.ts';
import { localSetup } from './local-setup.ts';
import {voices} from './voices.ts';
import {dubbing} from './dubbing.ts';
import {demo,demoSource,demoQuota} from './demo.ts';
export const app=express();app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'blob:','data:'],mediaSrc:["'self'",'blob:'],connectSrc:["'self'"],upgradeInsecureRequests:null}},crossOriginEmbedderPolicy:false}));
const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;
const uid=(req:any)=>req.auth.user_id;
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});
const text=z.string().trim().min(1).max(500);
export function fulfillCheckout(session:any){
 if(session.payment_status!=='paid')return;
 const purchase=one('SELECT * FROM purchases WHERE id=?',session.metadata?.purchaseId||'');
 if(!purchase||purchase.checkout!==session.id||purchase.amount!==session.amount_total||session.currency!=='usd')throw fail('Payment details do not match the purchase.');
 run("UPDATE purchases SET status='paid' WHERE id=?",purchase.id);
}
app.post('/api/stripe/webhook',express.raw({type:'application/json'}),(req,res)=>{
 if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET)return res.status(503).json({error:'Payments are not configured.'});
 let event:Stripe.Event;try{event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'] as string,process.env.STRIPE_WEBHOOK_SECRET);}catch{return res.status(400).json({error:'Invalid webhook signature.'});}
 try{transaction(()=>{if(one('SELECT id FROM stripe_events WHERE id=?',event.id))return;
 if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))fulfillCheckout(event.data.object);
 if(event.type==='charge.refunded'){const charge=event.data.object as any;if(charge.refunded&&charge.metadata?.purchaseId)run("UPDATE purchases SET status='refunded' WHERE id=?",charge.metadata.purchaseId);}
 run('INSERT INTO stripe_events VALUES(?,?)',event.id,now());});res.json({received:true});}catch{res.status(400).json({error:'Payment reconciliation failed.'});}
});
app.use(express.json({limit:'64kb'}));
if(process.env.NODE_ENV!=='production')app.use('/api/local-setup',localSetup);
app.get('/health',(_req,res)=>res.json({ok:true}));
app.use(userSession,csrf);
app.use('/api',rateLimit({windowMs:60000,limit:240,standardHeaders:'draft-8',legacyHeaders:false}));
app.get('/api/session',(req,res)=>{const s=(req as any).auth;res.json({user:s?{id:s.user_id,name:s.name,email:s.email}:null,csrf:s?.csrf||null,freeMode:true,demoAvailable:!!demoSource(),setup:{comfy:!!comfyKey(),media:!!mediaBaseUrl()},model:MODEL});});
const authLimit=rateLimit({windowMs:15*60000,limit:15,standardHeaders:'draft-8',legacyHeaders:false});
app.use('/api/demo',authLimit);app.use('/api',demo);
app.post('/api/register',authLimit,(req,res)=>{
 const p=z.object({email:z.email().max(254),password:z.string().min(12).max(128),name:text.max(80),invite:text}).parse(req.body);p.email=p.email.toLowerCase();const userId=id();
 transaction(()=>{const invite=one('SELECT * FROM invites WHERE hash=? AND expires>? AND used_by IS NULL',hash(p.invite),Date.now());if(!invite||(invite.email&&invite.email!==p.email))throw fail('This invitation is invalid, expired, or belongs to another email.');if(one('SELECT id FROM users WHERE email=?',p.email))throw fail('An account already exists for this email.');run('INSERT INTO users(id,email,name,password,created) VALUES(?,?,?,?,?)',userId,p.email,p.name,passwordHash(p.password),now());run('UPDATE invites SET used_by=? WHERE hash=?',userId,hash(p.invite));if(one('SELECT hash FROM team_invites WHERE hash=?',hash(p.invite)))acceptTeamInvite(p.invite,userId,p.email);});
 res.status(201).json({csrf:startSession(res,userId)});
});
app.post('/api/login',authLimit,(req,res)=>{const p=z.object({email:z.email().max(254),password:z.string().max(128)}).parse(req.body);const user=one('SELECT * FROM users WHERE email=?',p.email.toLowerCase());if(!user||!passwordValid(p.password,user.password))throw fail('Email or password is incorrect.',401);res.json({csrf:startSession(res,user.id)});});
app.post('/api/logout',requireAuth,(req,res)=>{run('DELETE FROM sessions WHERE hash=?',(req as any).auth.hash);res.clearCookie('recast_session',{path:'/'}).json({ok:true});});
app.use('/api',requireAuth);
app.use('/api/teams',teams);
app.use('/api',community);app.use('/api',voices);app.use('/api',dubbing);
app.get('/api/listings',(req,res)=>res.json(catalog(uid(req)).filter(l=>(!req.query.category||l.category===req.query.category)&&(!req.query.q||(l.title+' '+l.description).toLowerCase().includes(String(req.query.q).toLowerCase())))));
app.get('/api/profile',(req,res)=>{const user=one('SELECT id,name,email,bio,stripe_account FROM users WHERE id=?',uid(req));const identity=one('SELECT * FROM identities WHERE user_id=?',uid(req));res.json({user,identity:identity?{...identity,photos:JSON.parse(identity.photos)}:null,media:all("SELECT id,kind,duration FROM media WHERE owner=? AND kind IN ('photo','voice','source') ORDER BY created DESC",uid(req))});});
app.patch('/api/profile',(req,res)=>{const p=z.object({name:text.max(80),bio:z.string().max(1000)}).parse(req.body);run('UPDATE users SET name=?,bio=? WHERE id=?',p.name,p.bio,uid(req));res.json({ok:true});});
app.get('/api/sellers/:seller',(req,res)=>{const seller=one('SELECT id,name,bio,created FROM users WHERE id=?',req.params.seller);if(!seller)throw fail('Creator not found.',404);res.json(seller);});
function ownedMedia(user:string,mediaId:string,kind:string){const media=one('SELECT * FROM media WHERE id=? AND owner=? AND kind=?',mediaId,user,kind);if(!media)throw fail('Select one of your own '+kind+' uploads.');return media;}
app.put('/api/identity',(req,res)=>{const p=z.object({name:text.max(80),photos:z.array(z.uuid()).min(1).max(3),voice:z.uuid(),consent:z.literal(true)}).parse(req.body);p.photos.forEach(photo=>ownedMedia(uid(req),photo,'photo'));ownedMedia(uid(req),p.voice,'voice');const consent=JSON.stringify({version:1,accepted:now(),statement:'I am this person or have explicit permission to use their face, body, and voice for these AI transformations.'});run('INSERT INTO identities VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,photos=excluded.photos,voice=excluded.voice,consent=excluded.consent,updated=excluded.updated',uid(req),p.name,JSON.stringify(p.photos),p.voice,consent,now());audit(uid(req),'identity_consent',{photos:p.photos,voice:p.voice,consent});res.json({ok:true});});
const upload=multer({dest:resolve(dataDir,'media'),limits:{fileSize:150*1024*1024,files:1}});
app.post('/api/uploads',upload.single('file'),async(req,res)=>{if(!req.file)throw fail('Choose a file.');try{const kind=z.enum(['photo','voice','source']).parse(req.body.kind);const clip=req.body.clipStart!==undefined?z.object({start:z.coerce.number().min(0),duration:z.coerce.number().min(4).max(30)}).parse({start:req.body.clipStart,duration:req.body.clipDuration}):undefined;const media=await normalizeUpload(uid(req),kind,req.file.path,clip);res.status(201).json(media);}finally{await removeFile(req.file.path);}});
app.post('/api/listings',async(req,res)=>{const p=z.object({metadata:metadataSchema.optional(),team:z.uuid().optional(),title:text.max(120),description:text.max(500),category:z.enum(['Interviews','Pranks','Skits']),price:z.literal(0),source:z.uuid(),host:text.max(500),usage:text.max(500),consent:z.literal(true)}).parse(req.body);if(p.team&&!teamMembership(p.team,uid(req)))throw fail('Team membership required.',403);const source=ownedMedia(uid(req),p.source,'source');if(one('SELECT id FROM listings WHERE source=?',p.source))throw fail('This upload is already published. Upload a separate original to change its audience.');const preview=await previewFor(uid(req),source);const listingId=id();const consent=JSON.stringify({version:1,accepted:now(),statement:'I own or am authorized to license this footage, all featured participants consent to the stated uses, and the designated host authorizes identity replacement.'});transaction(()=>{if(p.team&&!teamMembership(p.team,uid(req)))throw fail('Team membership required.',403);if(one('SELECT id FROM listings WHERE source=?',p.source))throw fail('This upload is already published.');run('INSERT INTO listings VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',listingId,uid(req),p.title,p.description,p.category,p.price,p.source,preview.preview,preview.poster,p.host,p.usage,consent,now());if(p.team)run('INSERT INTO team_listings VALUES(?,?)',listingId,p.team);if(p.metadata)saveMetadata(listingId,p.metadata);});audit(uid(req),'listing_consent',{listingId,consent});res.status(201).json({id:listingId});});
app.post('/api/connect',async(req,res)=>{if(!stripe)throw fail('Add STRIPE_SECRET_KEY to configure seller payouts.',503);let user=one('SELECT * FROM users WHERE id=?',uid(req));if(!user.stripe_account){const account=await stripe.accounts.create({type:'express',email:user.email,capabilities:{transfers:{requested:true}}},{idempotencyKey:'connect-'+user.id});run('UPDATE users SET stripe_account=? WHERE id=?',account.id,user.id);user.stripe_account=account.id;}const link=await stripe.accountLinks.create({account:user.stripe_account,refresh_url:origin+'/#sell',return_url:origin+'/#sell',type:'account_onboarding'});res.json({url:link.url});});
app.post('/api/purchases',async(req,res)=>{
 const p=z.object({listing:z.uuid(),acceptLicense:z.literal(true)}).parse(req.body);const listing=one('SELECT l.*,u.stripe_account FROM listings l JOIN users u ON u.id=l.seller WHERE l.id=?',p.listing);if(!listing)throw fail('Video not found.',404);if(listingTeam(listing.id))throw fail('Team footage is available only inside its team.',403);if(listing.seller===uid(req))return res.json({owned:true});
 let purchase=one('SELECT * FROM purchases WHERE buyer=? AND listing=?',uid(req),p.listing);if(purchase?.status==='paid')return res.json({owned:true});if(purchase?.status==='refunded')throw fail('This purchase was refunded. Contact the seller before repurchasing.');
 if(listing.price>0&&(!stripe||!process.env.STRIPE_WEBHOOK_SECRET))throw fail('Payments are not configured. Add Stripe test credentials and webhook secret.',503);
 if(listing.price>0){if(!listing.stripe_account)throw fail('This seller must connect their payout account before purchases are available.');const account=await stripe!.accounts.retrieve(listing.stripe_account);if(!account.payouts_enabled||account.capabilities?.transfers!=='active')throw fail('Seller payout onboarding is not complete.');}
 if(!purchase){const purchaseId=id();run('INSERT INTO purchases VALUES(?,?,?,?,?,?,?,?)',purchaseId,uid(req),listing.id,listing.price,listing.price===0?'paid':'pending',null,JSON.stringify({usage:listing.usage,title:listing.title,seller:listing.seller,accepted:now(),aiDisclosure:true}),now());purchase=one('SELECT * FROM purchases WHERE id=?',purchaseId);}
 if(!listing.price)return res.json({owned:true});
 if(purchase.checkout){const existing=await stripe!.checkout.sessions.retrieve(purchase.checkout);if(existing.status==='open')return res.json({url:existing.url});if(existing.payment_status==='paid'){fulfillCheckout(existing);return res.json({owned:true});}if(existing.status==='complete')throw fail('Payment is processing. Check purchase history shortly.');}
 const session=await stripe!.checkout.sessions.create({mode:'payment',client_reference_id:purchase.id,metadata:{purchaseId:purchase.id},line_items:[{price_data:{currency:'usd',unit_amount:purchase.amount,product_data:{name:listing.title,description:'Licensed original footage for an authorized Recast transformation'}},quantity:1}],payment_intent_data:{metadata:{purchaseId:purchase.id},transfer_data:{destination:listing.stripe_account}},success_url:origin+'/?checkout=success#purchases',cancel_url:origin+'/#purchases'},{idempotencyKey:'checkout-'+purchase.id+'-'+(purchase.checkout||'first')});run('UPDATE purchases SET checkout=? WHERE id=?',session.id,purchase.id);res.json({url:session.url});
});
app.get('/api/purchases',(req,res)=>res.json(all('SELECT p.*,l.title,l.poster,u.name seller_name FROM purchases p JOIN listings l ON l.id=p.listing JOIN users u ON u.id=l.seller WHERE buyer=? ORDER BY p.created DESC',uid(req))));
app.post('/api/purchases/:id/reconcile',async(req,res)=>{const p=one('SELECT * FROM purchases WHERE id=? AND buyer=?',req.params.id,uid(req));if(!p)throw fail('Purchase not found.',404);if(p.checkout&&stripe)fulfillCheckout(await stripe.checkout.sessions.retrieve(p.checkout));res.json({ok:true});});
function canGenerate(user:string,listing:any){const access=teamAccess(listing.id,user);if(access!==null)return access;return listing.seller===user||one("SELECT id FROM purchases WHERE buyer=? AND listing=? AND status='paid'",user,listing.id);}
app.post('/api/jobs',(req,res)=>{
 const p=z.object({listing:z.uuid(),consent:z.literal(true),disclosure:z.literal(true)}).parse(req.body);if(!comfyKey())throw fail('Add COMFY_API_KEY to the local .env file before generating.',503);if(!mediaBaseUrl())throw fail('Configure PUBLIC_MEDIA_BASE_URL so the model can read expiring signed input links.',503);
 const listing=one('SELECT * FROM listings WHERE id=?',p.listing);if(!listing||!canGenerate(uid(req),listing))throw fail('Purchase a license before generating.',403);const identity=one('SELECT * FROM identities WHERE user_id=?',uid(req));if(!identity)throw fail('Save your identity with photos and a voice recording first.');
 const active=one("SELECT id FROM jobs WHERE owner=? AND listing=? AND state IN ('submitting','queued','running','saving')",uid(req),listing.id);if(active)return res.json({id:active.id});
 demoQuota(uid(req));const jobId=id();const snapshot=JSON.stringify({editMode:'person-recast-v4',prepareDialogue:true,source:listing.source,photos:JSON.parse(identity.photos),voice:identity.voice,host:listing.host,usage:listing.usage,identityConsent:identity.consent,footageConsent:listing.consent,disclosure:true,accepted:now(),seed:randomInt(0,2147483647)});
 run('INSERT INTO jobs(id,owner,listing,model,state,snapshot,idempotency,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',jobId,uid(req),listing.id,MODEL,'submitting',snapshot,id(),now(),now());audit(uid(req),'generation_consent',{jobId,disclosure:true});res.status(201).json({id:jobId});
});
app.post('/api/jobs/:id/regenerate',(req,res)=>{
 const p=z.object({direction:z.string().trim().max(1500),usesCredits:z.literal(true)}).parse(req.body);
 const previous=one('SELECT * FROM jobs WHERE id=? AND owner=?',req.params.id,uid(req));
 if(!previous)throw fail('Video not found.',404);
 if(teamAccess(previous.listing,uid(req))===false)throw fail('Team membership required.',403);
 if(previous.state!=='finished')throw fail('Regenerate a finished video.');
 if(!comfyKey())throw fail('Configure your Comfy key first.',503);
 if(!mediaBaseUrl())throw fail('Configure the HTTPS media address first.',503);
 const active=one("SELECT id FROM jobs WHERE owner=? AND listing=? AND state IN ('submitting','queued','running','saving')",uid(req),previous.listing);
 if(active)return res.json({id:active.id});
 demoQuota(uid(req));const snapshot={...JSON.parse(previous.snapshot),cropInput:undefined,hostRegion:undefined,editMode:'person-recast-v4',prepareDialogue:true,direction:p.direction,parentJob:previous.id,accepted:now()};
 const jobId=id();const attempt=one('SELECT MAX(attempt) n FROM jobs WHERE owner=? AND listing=?',uid(req),previous.listing).n+1;
 run('INSERT INTO jobs(id,owner,listing,model,state,snapshot,idempotency,attempt,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',jobId,uid(req),previous.listing,MODEL,'submitting',JSON.stringify(snapshot),id(),attempt,now(),now());
 audit(uid(req),'generation_regenerate',{jobId,parent:previous.id});res.status(201).json({id:jobId});
});
app.get('/api/jobs',(req,res)=>res.json(all('SELECT j.id,j.listing,j.model,j.request_id,j.state,j.queue_position,j.error_type,j.error,j.output,j.attempt,j.created,j.updated,j.snapshot,l.title,l.poster FROM jobs j JOIN listings l ON l.id=j.listing WHERE owner=? AND NOT EXISTS(SELECT 1 FROM archived_jobs a WHERE a.job=j.id) ORDER BY j.created DESC',uid(req)).map(j=>({...j,started:JSON.parse(j.snapshot).accepted||j.created,protection:JSON.parse(j.snapshot).editMode==='person-recast-v4'?'Single-person recast (no box)':JSON.parse(j.snapshot).hostRegion?'Legacy fixed-region composite':'Legacy full-frame generation',snapshot:undefined,error:j.error_type==='content_policy_violation'?classifyError({errorType:j.error_type}).message:j.error}))));
app.post('/api/jobs/:id/retry',(req,res)=>{const job=one('SELECT * FROM jobs WHERE id=? AND owner=?',req.params.id,uid(req));if(job&&teamAccess(job.listing,uid(req))===false)throw fail('Team membership required.',403);if(!job||job.state!=='failed')throw fail('Only failed jobs can be retried.');if(['content_policy_violation','not_enabled','invalid_input'].includes(job.error_type))throw fail('Correct the input or account issue before making another generation.');if(!comfyKey())throw fail('Configure your Comfy key first.');demoQuota(uid(req));run('UPDATE jobs SET snapshot=? WHERE id=?',JSON.stringify({...JSON.parse(job.snapshot),hostRegion:undefined,cropInput:undefined,editMode:'person-recast-v4',accepted:now()}),job.id);run("UPDATE jobs SET state='submitting',request_id=NULL,body=NULL,idempotency=?,attempt=attempt+1,error=NULL,error_type=NULL,next_poll=0,updated=? WHERE id=?",id(),now(),job.id);audit(uid(req),'generation_retry',{job:job.id});res.json({ok:true});});
app.get('/api/jobs/:id/manifest',(req,res)=>{const j=one('SELECT * FROM jobs WHERE id=? AND owner=?',req.params.id,uid(req));if(!j)throw fail('Not found.',404);if(teamAccess(j.listing,uid(req))===false)throw fail('Team membership required.',403);const s=JSON.parse(j.snapshot);res.attachment('recast-disclosure-'+j.id+'.json').json({application:'Recast',aiTransformed:true,model:j.model,requestId:j.request_id,created:j.created,hostRegion:s.hostRegion||null,sceneProtection:s.hostRegion?'Fixed-region composite over original footage':'Legacy full-frame generation',authorizedUsage:s.usage,disclosure:j.model===MODEL?'The host’s appearance was transformed using AI. Original audio is retained. Review the entire scene before publishing.':'AI-transformed video. Review appearance and audio before publishing.'});});
app.get('/api/listings/:id/source',(req,res)=>{const l=one('SELECT * FROM listings WHERE id=?',req.params.id);if(!l||!canGenerate(uid(req),l))throw fail('A purchased license is required.',403);res.json({id:l.source});});
app.get('/api/media/:id',(req,res)=>{const m=one('SELECT * FROM media WHERE id=?',req.params.id);if(!m)throw fail('Media not found.',404);const teamVideo=one('SELECT t.team FROM team_listings t JOIN listings l ON l.id=t.listing WHERE l.source=? OR l.preview=? OR l.poster=? UNION SELECT t.team FROM team_listings t JOIN jobs j ON j.listing=t.listing WHERE j.output=? UNION SELECT t.team FROM team_listings t JOIN jobs j ON j.listing=t.listing JOIN dubs d ON d.job=j.id WHERE d.output=?',m.id,m.id,m.id,m.id,m.id);if(teamVideo&&!teamMembership(teamVideo.team,uid(req)))throw fail('This media is private to its team.',403);const preview=['preview','poster'].includes(m.kind)&&one('SELECT id FROM listings WHERE preview=? OR poster=?',m.id,m.id);const licensed=m.kind==='source'&&one("SELECT l.id FROM listings l JOIN purchases p ON p.listing=l.id WHERE l.source=? AND p.buyer=? AND p.status='paid'",m.id,uid(req));if(m.owner!==uid(req)&&!preview&&!licensed&&!teamVideo)throw fail('This media is private.',403);res.set('Cache-Control','private, no-store');if(req.query.download==='1')res.attachment('recast-'+m.id+(m.mime==='video/mp4'?'.mp4':m.mime==='image/jpeg'?'.jpg':'.mp3'));res.type(m.mime).sendFile(m.path);});
app.get('/provider-media/:id',(req,res)=>{if(!validSignature(String(req.params.id),Number(req.query.expires),String(req.query.signature||'')))throw fail('This media link has expired or is invalid.',403);const m=one('SELECT * FROM media WHERE id=?',req.params.id);if(!m)throw fail('Not found.',404);res.set('Cache-Control','private, no-store').type(m.mime).sendFile(m.path);});
app.use('/api',(_req,res)=>res.status(404).json({error:'Endpoint not found.'}));
app.use(express.static(resolve(root,'dist')));
app.get('/{*path}',(_req,res)=>{if(!existsSync(resolve(root,'dist/index.html')))return res.status(503).send('Run npm run build first.');res.sendFile(resolve(root,'dist/index.html'));});
app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if(error instanceof z.ZodError)return res.status(400).json({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')});const status=error.status|| (error instanceof multer.MulterError?400:500);res.status(status).json({error:status<500?error.message:status===503?error.message:'The operation could not be completed. Check your file format and configuration, then try again.',...(error.code==='clip_required'?{code:error.code,duration:error.duration}:{})});});







