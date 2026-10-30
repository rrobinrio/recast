import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {request as httpRequest} from 'node:http';
import ffmpeg from 'ffmpeg-static';
const exec=promisify(execFile);
const temp=await mkdtemp(resolve(tmpdir(),'recast-test-'));
process.env.RECAST_DATA_DIR=temp;process.env.RECAST_ENV_PATH=resolve(temp,'.env');
process.env.COMFY_API_KEY='shell-value-must-not-enable-live-generation';
process.env.STRIPE_SECRET_KEY='';process.env.STRIPE_WEBHOOK_SECRET='';process.env.PUBLIC_MEDIA_BASE_URL='';
process.env.NODE_ENV='test';
const {app}=await import('../server/app.ts');
const {run,one,all,db,id,now}=await import('../server/db.ts');
const {hash}=await import('../server/auth.ts');
const {comfyKey}=await import('../server/config.ts');
const {mediaSignature,validSignature}=await import('../server/media.ts');
const {mediaGateway}=await import('../server/media-gateway.ts');
const {createSetupToken}=await import('../server/local-setup.ts');
let server:any,gateway:any,base:string,gatewayBase:string,seller:any,buyer:any,source:string,photo:string,voice:string,listing:string;
async function call(path:string,body?:any,user?:any,method?:string){const res=await fetch(base+'/api'+path,{method:method||(body?'POST':'GET'),headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(user?{cookie:user.cookie,'x-csrf-token':user.csrf}:{})},body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
async function setupRequest(headers:Record<string,string>,key?:string):Promise<{status:number,body:any}>{return new Promise((resolve,reject)=>{const request=httpRequest(base+'/api/local-setup',{method:key?'POST':'GET',headers},response=>{let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode!,body:JSON.parse(text)}));});request.on('error',reject);request.end(key?JSON.stringify({key}):undefined);});}
async function register(email:string){const invite=id();run('INSERT INTO invites VALUES(?,?,?,NULL)',hash(invite),email,Date.now()+60000);const r=await call('/register',{email,password:'test-password-long-enough',name:email.split('@')[0],invite});assert.equal(r.status,201);return {cookie:r.cookie,csrf:r.body.csrf,email,invite};}
async function upload(path:string,kind:string,user:any){const form=new FormData();form.append('kind',kind);form.append('file',new Blob([await readFile(path)]),path.split(/[\\/]/).at(-1)!);const r=await call('/uploads',form,user);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.id;}
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;gateway=mediaGateway.listen(0,'127.0.0.1');await new Promise<void>(r=>gateway.once('listening',r));gatewayBase=`http://127.0.0.1:${gateway.address().port}`;});
after(async()=>{await new Promise<void>(r=>server.close(r));await new Promise<void>(r=>gateway.close(r));db.close();await rm(temp,{recursive:true,force:true});});
test('host dubbing endpoints require authentication and ownership',async()=>{
 assert.equal((await call('/jobs/'+id()+'/dub')).status,401);
 const visitor=await register('voice-review@example.test');
 assert.equal((await call('/jobs/'+id()+'/dub',undefined,visitor)).status,404);
 assert.equal((await call('/jobs/'+id()+'/dub',{},visitor)).status,404);
 assert.equal((await call('/jobs/'+id()+'/dub/confirm',{consent:true,segments:[]},visitor)).status,404);
});
test('invitation registration, single use, password login, and authentication gate',async()=>{
 assert.equal((await call('/listings')).status,401);
 assert.equal((await call('/register',{email:'nobody@example.test',password:'test-password-long-enough',name:'No invite',invite:'invalid'})).status,400);
 seller=await register('seller@example.test');buyer=await register('buyer@example.test');
 assert.equal((await call('/register',{email:'seller@example.test',password:'test-password-long-enough',name:'Again',invite:seller.invite})).status,400);
 assert.equal((await call('/login',{email:buyer.email,password:'wrong'})).status,401);
 assert.equal((await call('/login',{email:buyer.email,password:'test-password-long-enough'})).status,200);
 assert.equal((await call('/profile')).status,401);
 assert.equal((await call('/profile',undefined,buyer)).body.user.email,buyer.email);
});
test('CSRF, cross-origin protection, and dotenv-only live gating',async()=>{
 assert.equal((await call('/profile',{name:'Bad',bio:''},{...buyer,csrf:'bad'},'PATCH')).status,403);
 const response=await fetch(base+'/api/logout',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json',cookie:buyer.cookie,'x-csrf-token':buyer.csrf},body:'{}'});assert.equal(response.status,403);
 assert.equal(comfyKey(),'');assert.equal((await call('/session')).body.setup.comfy,false);
});
test('validated local uploads create playable source, photo and voice; references remain private',async()=>{
 const mp4=resolve(temp,'fixture.mp4'),jpg=resolve(temp,'fixture.jpg'),mp3=resolve(temp,'fixture.mp3');
 await exec(ffmpeg!,['-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','5','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',mp4]);
 await exec(ffmpeg!,['-y','-f','lavfi','-i','color=c=green:s=400x400','-frames:v','1',jpg]);
 await exec(ffmpeg!,['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','5',mp3]);
 source=await upload(mp4,'source',seller);photo=await upload(jpg,'photo',buyer);voice=await upload(mp3,'voice',buyer);
 assert.equal((await fetch(base+'/api/media/'+photo,{headers:{cookie:seller.cookie}})).status,403);
 const range=await fetch(base+'/api/media/'+source,{headers:{cookie:seller.cookie,range:'bytes=0-127'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,128);
 const bad=resolve(temp,'invalid.mp4');await writeFile(bad,'not a video');const f=new FormData();f.append('kind','source');f.append('file',new Blob([await readFile(bad)]),'bad.mp4');assert.notEqual((await call('/uploads',f,seller)).status,201);
});
test('identity ownership, consent and reuse',async()=>{
 assert.equal((await call('/identity',{name:'Me',photos:[photo],voice,consent:false},buyer,'PUT')).status,400);
 assert.equal((await call('/identity',{name:'Stolen',photos:[photo],voice,consent:true},seller,'PUT')).status,400);
 assert.equal((await call('/identity',{name:'Test identity',photos:[photo],voice,consent:true},buyer,'PUT')).status,200);
 const p=(await call('/profile',undefined,buyer)).body;assert.deepEqual(p.identity.photos,[photo]);assert.equal(p.identity.voice,voice);
});
test('video sent as identity photo gives a useful 400; long footage offers an explicit trim',async()=>{
 const photoForm=new FormData();photoForm.append('kind','photo');photoForm.append('file',new Blob([await readFile(resolve(temp,'fixture.mp4'))]),'video.mov');const wrong=await call('/uploads',photoForm,buyer);assert.equal(wrong.status,400);assert.match(wrong.body.error,/Creator studio/);
 const long=resolve(temp,'long.mp4');await exec(ffmpeg!,['-y','-f','lavfi','-i','color=c=blue:s=320x320:r=12','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','34','-c:v','libx264','-c:a','aac','-shortest',long]);
 const make=async()=>{const f=new FormData();f.append('kind','source');f.append('file',new Blob([await readFile(long)]),'long.mov');return f;};
 const rejected=await call('/uploads',await make(),seller);assert.equal(rejected.status,422);assert.equal(rejected.body.code,'clip_required');assert.ok(rejected.body.duration>30);
 const invalid=await make();invalid.append('clipStart','31');invalid.append('clipDuration','10');assert.equal((await call('/uploads',invalid,seller)).status,400);
 const selected=await make();selected.append('clipStart','3');selected.append('clipDuration','8');const accepted=await call('/uploads',selected,seller);assert.equal(accepted.status,201);assert.equal(accepted.body.duration,8);
});
test('publish, watermark preview, free license claim, idempotency and private-source authorization',async()=>{
 const data={title:'TEST FIXTURE — NOT CREATOR CONTENT',description:'Technical color and sound bars used only for automated tests.',category:'Skits',price:0,source,host:'No real person; synthetic test fixture',usage:'Test only',consent:true};
 assert.equal((await call('/listings',{...data,consent:false},seller)).status,400);
 assert.equal((await call('/listings',{...data,price:5},seller)).status,400);
 const created=await call('/listings',data,seller);assert.equal(created.status,201,JSON.stringify(created.body));listing=created.body.id;
 const list=(await call('/listings',undefined,buyer)).body;assert.equal(list.length,1);assert.equal(list[0].price,0);
 assert.equal((await fetch(base+'/api/media/'+list[0].preview,{headers:{cookie:buyer.cookie}})).status,200);
 assert.equal((await fetch(base+'/api/media/'+source,{headers:{cookie:buyer.cookie}})).status,403);
 assert.equal((await call('/purchases',{listing,acceptLicense:false},buyer)).status,400);
 assert.equal((await call('/purchases',{listing,acceptLicense:true},buyer)).status,200);
 assert.equal((await call('/purchases',{listing,acceptLicense:true},buyer)).status,200);
 assert.equal((await call('/purchases',undefined,buyer)).body.length,1);
 assert.equal((await fetch(base+'/api/media/'+source,{headers:{cookie:buyer.cookie}})).status,200);
 assert.equal((await fetch(base+'/api/media/'+photo,{headers:{cookie:seller.cookie}})).status,403);
});
test('generation refuses missing key without network or fabricated job; expiring signed links',async()=>{
 const r=await call('/jobs',{listing,consent:true,disclosure:true,hostRegion:{x:0,y:0,width:.5,height:1}},buyer);assert.equal(r.status,503);assert.match(r.body.error,/COMFY_API_KEY/);assert.equal(all('SELECT id FROM jobs').length,0);
 const expires=Date.now()+60000;assert.equal(validSignature(source,expires,mediaSignature(source,expires)),true);assert.equal(validSignature(source,expires,'bad'),false);assert.equal(validSignature(source,Date.now()-1,mediaSignature(source,Date.now()-1)),false);
 const signed=await fetch(base+'/provider-media/'+source+'?expires='+expires+'&signature='+mediaSignature(source,expires));assert.equal(signed.status,200);
 assert.equal((await fetch(base+'/provider-media/'+source+'?expires='+expires+'&signature=bad')).status,403);
});
test('HTTPS gateway exposes only health and signed media, never accounts, keys or uploads',async()=>{
 assert.equal((await fetch(gatewayBase+'/health')).status,200);
 for(const route of ['/','/api/session','/api/local-setup','/api/uploads','/setup.html'])assert.equal((await fetch(gatewayBase+route)).status,404);
 assert.equal((await fetch(gatewayBase+'/provider-media/'+source)).status,403);
 const expires=Date.now()+60000;const url=gatewayBase+'/provider-media/'+source+'?expires='+expires+'&signature='+mediaSignature(source,expires);
 const r=await fetch(url,{headers:{range:'bytes=0-63'}});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,64);
});
test('one-time key setup requires private capability, local Host and Origin, saves without echo',async()=>{
 const token=createSetupToken();
 const headers={'content-type':'application/json',host:'localhost:3000',origin:'http://localhost:3000','x-recast-setup':token};
 assert.equal((await fetch(base+'/api/local-setup')).status,403);
 assert.equal((await fetch(base+'/api/local-setup',{headers:{...headers,host:'attacker.example'}})).status,403);
 assert.equal((await fetch(base+'/api/local-setup',{method:'POST',headers:{...headers,origin:'https://attacker.example'},body:JSON.stringify({key:'comfyui-test-only-1234567890'})})).status,403);
 await writeFile(process.env.RECAST_ENV_PATH!,'COMFY_API_KEY=\nPUBLIC_MEDIA_BASE_URL=https://example.test\n');
 const response=await setupRequest(headers,'comfyui-test-only-1234567890');assert.equal(response.status,200,JSON.stringify(response.body));assert.deepEqual(response.body,{saved:true});
 assert.equal(comfyKey(),'comfyui-test-only-1234567890');assert.match(await readFile(process.env.RECAST_ENV_PATH!,'utf8'),/PUBLIC_MEDIA_BASE_URL=https:\/\/example.test/);
 assert.equal((await fetch(base+'/api/local-setup',{headers})).status,403);
});

test('regeneration preserves the finished result and deduplicates active submissions',async()=>{
 process.env.PUBLIC_MEDIA_BASE_URL='https://example.test';
 const parent=id();const owner=one('SELECT seller FROM listings WHERE id=?',listing).seller;
 const snapshot=JSON.stringify({source,photos:[photo],voice,host:'Host',usage:'Test only',seed:42});
 run('INSERT INTO jobs(id,owner,listing,model,state,output,snapshot,idempotency,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',parent,owner,listing,'test-model','finished',source,snapshot,id(),now(),now());
 assert.equal((await call('/jobs/'+parent+'/regenerate',{direction:'Keep background',usesCredits:true,hostRegion:{x:0,y:0,width:.5,height:1}},buyer)).status,404);
 assert.equal((await call('/jobs/'+parent+'/regenerate',{direction:'Keep background'},seller)).status,400);
 const result=await call('/jobs/'+parent+'/regenerate',{direction:'Keep background',usesCredits:true,hostRegion:{x:0,y:0,width:.5,height:1}},seller);assert.equal(result.status,201);
 const newJob=one('SELECT * FROM jobs WHERE id=?',result.body.id);assert.equal(newJob.attempt,2);assert.equal(JSON.parse(newJob.snapshot).editMode,'person-recast-v4');assert.equal(JSON.parse(newJob.snapshot).hostRegion,undefined);assert.equal(newJob.output,null);assert.equal(JSON.parse(newJob.snapshot).direction,'Keep background');assert.equal(JSON.parse(newJob.snapshot).source,source);
 assert.equal(one('SELECT output FROM jobs WHERE id=?',parent).output,source);
 const duplicate=await call('/jobs/'+parent+'/regenerate',{direction:'Keep background',usesCredits:true,hostRegion:{x:0,y:0,width:.5,height:1}},seller);assert.equal(duplicate.body.id,newJob.id);
});

test('private workforce invitations, team footage, generation and removed-member isolation',async()=>{
 const ownerId=one('SELECT id FROM users WHERE email=?',seller.email).id;
 const memberId=one('SELECT id FROM users WHERE email=?',buyer.email).id;
 const outsider=await register('outside@example.test');
 const created=await call('/teams',{name:'Test workforce'},seller);assert.equal(created.status,201);const team=created.body.id;
 assert.equal((await call('/teams/'+team,undefined,buyer)).status,403);
 assert.equal((await call('/teams/'+team+'/invites',{email:buyer.email},buyer)).status,403);
 const invite=await call('/teams/'+team+'/invites',{email:buyer.email},seller);assert.equal(invite.status,201);
 assert.equal((await call('/teams/join',{code:invite.body.code},outsider)).status,400);
 assert.equal((await call('/teams/join',{code:invite.body.code},buyer)).status,200);
 assert.equal((await call('/teams/join',{code:invite.body.code},buyer)).status,400);
 assert.equal((await call('/teams/'+team,undefined,buyer)).body.members.length,2);
 const privateSource=await upload(resolve(temp,'fixture.mp4'),'source',buyer);
 const published=await call('/listings',{team,title:'Private team test',description:'Team fixture',category:'Skits',price:0,source:privateSource,host:'Synthetic fixture',usage:'Team use only',consent:true},buyer);assert.equal(published.status,201);
 const video=one('SELECT * FROM listings WHERE id=?',published.body.id);
 for(const account of [seller,buyer,outsider])assert.ok(!(await call('/listings',undefined,account)).body.some((v:any)=>v.id===video.id));
 for(const mediaId of [video.source,video.poster,video.preview]){
  assert.equal((await fetch(base+'/api/media/'+mediaId,{headers:{cookie:outsider.cookie!}})).status,403);
  assert.equal((await fetch(base+'/api/media/'+mediaId,{headers:{cookie:seller.cookie}})).status,200);
 }
 assert.equal((await call('/purchases',{listing:video.id,acceptLicense:true},outsider)).status,403);
 assert.equal((await call('/jobs',{listing:video.id,consent:true,disclosure:true,hostRegion:{x:0,y:0,width:.5,height:1}},outsider)).status,403);
 assert.equal((await call('/jobs',{listing:video.id,consent:true,disclosure:true,hostRegion:{x:0,y:0,width:.5,height:1}},buyer)).status,201);
 assert.equal((await call('/teams/'+team+'/members/'+ownerId,undefined,seller,'DELETE')).status,400);
 assert.equal((await call('/teams/'+team+'/members/'+memberId,undefined,seller,'DELETE')).status,200);
 assert.equal((await call('/teams/'+team,undefined,buyer)).status,403);
 assert.equal((await fetch(base+'/api/media/'+video.source,{headers:{cookie:buyer.cookie}})).status,403);
 assert.equal((await call('/jobs',{listing:video.id,consent:true,disclosure:true,hostRegion:{x:0,y:0,width:.5,height:1}},buyer)).status,403);
 assert.ok(one('SELECT id FROM media WHERE id=?',video.source));assert.ok(one('SELECT id FROM listings WHERE id=?',video.id));
 const freshInvite=await call('/teams/'+team+'/invites',{email:'newemployee@example.test'},seller);
 const registration=await call('/register',{email:'newemployee@example.test',name:'New employee',password:'test-password-long-enough',invite:freshInvite.body.code});assert.equal(registration.status,201);
 const newUser=one('SELECT id FROM users WHERE email=?','newemployee@example.test');assert.ok(one('SELECT * FROM team_members WHERE team=? AND user_id=?',team,newUser.id));
 const revoked=await call('/teams/'+team+'/invites',{email:buyer.email},seller);const invitationHash=hash(revoked.body.code);
 assert.equal((await call('/teams/'+team+'/invites/'+invitationHash,undefined,seller,'DELETE')).status,200);
 assert.equal((await call('/teams/join',{code:revoked.body.code},buyer)).status,400);
});




test('creator catalog, asking prices, following feed and private buyer identity',async()=>{
 const owner=one('SELECT id FROM users WHERE email=?',seller.email).id;
 const settings=await call('/community/settings',{anonymous:true,alias:'Quiet Buyer',specialties:'Comedy'},buyer,'PATCH');assert.equal(settings.status,200);
 assert.equal((await call('/community/listings/'+listing,{tags:['Funny','street'],setting:'street',tone:'funny',people:2,askingPrice:2500},buyer,'PATCH')).status,403);
 assert.equal((await call('/community/listings/'+listing,{tags:['Funny','street'],setting:'street',tone:'funny',people:2,askingPrice:2500},seller,'PATCH')).status,200);
 const creator=(await call('/community/creators/'+owner,undefined,buyer)).body;
 assert.ok(creator.listings.some((l:any)=>l.id===listing&&l.asking_price===2500&&l.price===0));
 assert.ok(!JSON.stringify(creator).includes(seller.email));assert.ok(!JSON.stringify(creator).includes('password'));
 assert.equal((await call('/community/creators/'+owner+'/follow',{following:true},buyer,'PUT')).status,200);
 await call('/community/creators/'+owner+'/follow',{following:true},buyer,'PUT');
 assert.equal(one('SELECT COUNT(*) n FROM follows WHERE seller=?',owner).n,1);
 const feed=(await call('/community/feed',undefined,buyer)).body;assert.equal(feed.following,1);assert.ok(feed.listings.some((l:any)=>l.id===listing));
 assert.ok(feed.listings.every((l:any)=>!one('SELECT listing FROM team_listings WHERE listing=?',l.id)));
 assert.equal((await call('/community/creators/'+owner+'/follow',{following:true},seller,'PUT')).status,400);
});

test('randomizer persists rounds, requires all feedback, rejects foreign votes and reserves fresh content',async()=>{
 const baseListing=one('SELECT * FROM listings WHERE id=?',listing);const ids:string[]=[];
 for(let i=0;i<6;i++){const lid=id();ids.push(lid);run('INSERT INTO listings VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',lid,baseListing.seller,'Discovery '+i,'Funny street conversations',baseListing.category,0,baseListing.source,baseListing.preview,baseListing.poster,baseListing.host,baseListing.usage,baseListing.consent,new Date(Date.now()+i).toISOString());run('INSERT INTO listing_metadata VALUES(?,?,?,?,?,?)',lid,JSON.stringify(['street','funny']),'street','funny',2,1200);}
 const a=await call('/community/discover',{category:''},buyer);assert.equal(a.status,200);assert.equal(a.body.items.length,4);assert.ok(a.body.items.some((l:any)=>l.id===ids.at(-1)));
 assert.equal((await call('/community/discover',{category:''},buyer)).body.id,a.body.id);
 assert.equal((await call('/community/discover',{category:'',previous:a.body.id},buyer)).status,400);
 assert.equal((await call('/community/discover/'+a.body.id+'/vote',{listing:a.body.items[0].id,vote:1},seller)).status,403);
 for(const l of a.body.items)assert.equal((await call('/community/discover/'+a.body.id+'/vote',{listing:l.id,vote:1},buyer)).status,200);
 assert.equal((await call('/community/discover/'+a.body.id+'/vote',{listing:a.body.items[0].id,vote:-1},buyer)).body.vote,1);
 const b=(await call('/community/discover',{category:'',previous:a.body.id},buyer)).body;
 assert.ok(b.items.length>0&&b.items.length<4);assert.ok(b.items.every((l:any)=>!a.body.items.some((old:any)=>old.id===l.id)));
 assert.equal(new Set(b.items.map((l:any)=>l.id)).size,b.items.length);
 const ranks=(await call('/community/creators',undefined,buyer)).body;assert.ok(ranks.trending.length);assert.match(ranks.ranking,/not paid sales/);
});

test('messages and work requests are participant-only and anonymous buyers do not leak account names',async()=>{
 const owner=one('SELECT id FROM users WHERE email=?',seller.email).id;
 const started=await call('/community/conversations',{seller:owner,body:'Can you film an original interview?',kind:'request',budget:5000},buyer);assert.equal(started.status,201);
 const cid=started.body.id;const threads=(await call('/community/conversations',undefined,seller)).body;assert.equal(threads.find((t:any)=>t.id===cid).name,'Quiet Buyer');assert.ok(!JSON.stringify(threads).includes(buyer.email));assert.ok(!JSON.stringify(threads).includes(one('SELECT id FROM users WHERE email=?',buyer.email).id));
 const outsider=await register('messages-outsider@example.test');
 assert.equal((await call('/community/conversations/'+cid,undefined,outsider)).status,404);
 assert.equal((await call('/community/conversations/'+cid,{body:'intrusion'},outsider)).status,404);
 assert.equal((await call('/community/conversations/'+cid,{body:'Yes, what location?'},seller)).status,201);
 const messages=(await call('/community/conversations/'+cid,undefined,buyer)).body;assert.equal(messages.length,2);assert.equal(messages[0].kind,'request');assert.equal(messages[0].budget,5000);assert.ok(!JSON.stringify(messages).includes('sender'));
});

test('person recast prompt targets one moving person and reference outfit without a patch',async()=>{
 const {buildRequest}=await import('../server/pipeline.ts');const b=buildRequest({source:'https://example.test/source',photos:['https://example.test/photo'],voice:'unused',host:'Host on left',usage:'Test',seed:1});assert.match(b.prompt,/Follow that same person continuously/);assert.match(b.prompt,/appearance and clothing/);assert.match(b.prompt,/Keep every other person unchanged/);assert.doesNotMatch(b.prompt,/input is a crop|Preserve the source clothing/);
});

test('saved videos persist privately, deduplicate, and exclude team-only footage',async()=>{
 assert.equal((await call('/community/saved/'+listing,{saved:true},buyer,'PUT')).status,200);
 await call('/community/saved/'+listing,{saved:true},buyer,'PUT');
 assert.equal((await call('/community/saved',undefined,buyer)).body.filter((l:any)=>l.id===listing).length,1);
 assert.equal((await call('/community/saved',undefined,seller)).body.length,0);
 const teamVideo=one('SELECT listing FROM team_listings LIMIT 1').listing;
 assert.equal((await call('/community/saved/'+teamVideo,{saved:true},buyer,'PUT')).status,404);
 assert.equal((await call('/community/saved/'+listing,{saved:false},buyer,'PUT')).status,200);
 assert.equal((await call('/community/saved',undefined,buyer)).body.length,0);
});

test('unread counts only include participant messages and read receipts are scoped',async()=>{
 const owner=one('SELECT id FROM users WHERE email=?',seller.email).id;
 const sent=await call('/community/conversations',{seller:owner,body:'Unread example',kind:'message'},buyer);
 const before=(await call('/community/unread',undefined,seller)).body.count;assert.ok(before>0);
 assert.equal((await call('/community/conversations/'+sent.body.id+'/read',{},seller)).status,200);
 assert.equal((await call('/community/unread',undefined,seller)).body.count,0);
 await call('/community/conversations/'+sent.body.id,{body:'Another unread message'},buyer);
 assert.equal((await call('/community/unread',undefined,seller)).body.count,1);
});
test('demo sessions copy references without sharing private account or archived results',async()=>{
 const owner=one('SELECT id FROM users WHERE email=?',buyer.email).id;
 await writeFile(resolve(temp,'demo.json'),JSON.stringify({sourceUser:owner}));
 assert.equal((await call('/demo',{consent:false})).status,400);
 const count=one('SELECT COUNT(*) n FROM media').n;
 const response=await fetch(base+'/api/demo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({consent:true})});assert.equal(response.status,201,await response.clone().text());
 const payload=await response.json();const guest={cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:payload.csrf};
 const profile=(await call('/profile',undefined,guest)).body;assert.notEqual(profile.user.id,owner);assert.equal(profile.identity.name,'Recast Demo Identity');assert.notEqual(profile.identity.photos[0],photo);
 assert.equal((await fetch(base+'/api/media/'+profile.identity.photos[0],{headers:{cookie:guest.cookie}})).status,200);
 assert.equal((await fetch(base+'/api/media/'+photo,{headers:{cookie:guest.cookie}})).status,403);
 assert.deepEqual((await call('/community/conversations',undefined,guest)).body,[]);
 assert.ok(one('SELECT COUNT(*) n FROM media').n>count);
 assert.equal((await call('/demo',{consent:true},guest)).status,409);
 const {demoQuota}=await import('../server/demo.ts');demoQuota(profile.user.id);
 run("INSERT INTO jobs(id,owner,listing,model,state,snapshot,idempotency,attempt,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)",id(),profile.user.id,listing,'test','failed','{}',id(),2,now(),now());demoQuota(profile.user.id);assert.throws(()=>demoQuota(profile.user.id),/allowance/);
});

test('voice cloning requires consent, uses saved owner reference, and keeps outputs private',async()=>{
 const {VOICE_MODEL,voiceBody}=await import('../server/voices.ts');
 assert.equal(VOICE_MODEL,'byteplus/seed-audio-1.0-multilingual');
 const body=voiceBody('Hello from Recast','sample-base64');assert.deepEqual(body.references,[{audio_data:'sample-base64'}]);assert.match(body.text_prompt,/@Audio1/);
 assert.equal((await call('/voice-jobs',{script:'Hello',consent:false},buyer)).status,400);
 const created=await call('/voice-jobs',{script:'Hello from Recast',consent:true},buyer);assert.equal(created.status,201);
 const duplicate=await call('/voice-jobs',{script:'Hello again',consent:true},buyer);assert.equal(duplicate.body.id,created.body.id);
 assert.equal((await call('/voice-jobs',undefined,seller)).body.length,0);
 assert.equal((await call('/voice-jobs',undefined,buyer)).body[0].id,created.body.id);
 const owner=one('SELECT id FROM users WHERE email=?',buyer.email).id;assert.equal(one('SELECT voice FROM voice_jobs WHERE id=?',created.body.id).voice,one('SELECT voice FROM identities WHERE user_id=?',owner).voice);
});
