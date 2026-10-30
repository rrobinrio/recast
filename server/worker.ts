import {queueDialogue} from './dubbing.ts';
import { comfy } from '@comfyorg/sdk';
import { resolve } from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { comfyKey, dataDir } from './config.ts';
import { all, one, run, now, id } from './db.ts';
import { insertMedia, probe, removeFile, signedMediaUrl } from './media.ts';
import { cropHost, compositeHost } from './host-region.ts';
import { buildRequest, outputUrl, classifyError } from './pipeline.ts';
let busy=false;
function publicAddress(ip:string){return !(ip==='::1'||ip.startsWith('fc')||ip.startsWith('fd')||ip.startsWith('fe80')||ip.startsWith('::ffff:')||/^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(ip));}
async function download(url:string,path:string){
 for(let hop=0;hop<5;hop++){
  const target=new URL(url);if(target.protocol!=='https:'||target.username||target.password)throw new Error('Invalid output URL');
  const addresses=await lookup(target.hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('Non-public output URL');
  const response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(180000)});
  if([301,302,303,307,308].includes(response.status)){url=new URL(response.headers.get('location')!,target).href;continue;}
  if(!response.ok||!response.body)throw new Error('Could not download generated result');let size=0;
  await pipeline(Readable.fromWeb(response.body as any),new Transform({transform(chunk,_,cb){size+=chunk.length;cb(size>300*1024*1024?new Error('Result exceeds storage limit'):null,chunk);}}),createWriteStream(path,{flags:'w',mode:0o600}));return;
 }throw new Error('Too many output redirects');
}
export async function tick(){
 if(busy||!comfyKey())return;busy=true;
 try {comfy.config({credentials:comfyKey()});
 for(const job of all("SELECT * FROM jobs WHERE state IN ('submitting','queued','running','saving') AND next_poll<=? ORDER BY created LIMIT 4",Date.now())) {
 try {
  let requestId=job.request_id;
  if(!requestId){
   let body=job.body?JSON.parse(job.body):null;
   if(!body){const s=JSON.parse(job.snapshot);
    if(s.editMode!=='person-recast-v4'&&s.hostRegion&&!s.cropInput){const source=one('SELECT * FROM media WHERE id=?',s.source);const cropPath=resolve(dataDir,'media',job.id+'-host.mp4');try{await cropHost(source.path,cropPath,s.hostRegion);}catch{await removeFile(cropPath);throw Object.assign(new Error('Host crop could not be prepared'),{errorType:'media_processing_error'});}s.cropInput=await insertMedia(job.owner,'generation_input',cropPath,'video/mp4');run('UPDATE jobs SET snapshot=? WHERE id=?',JSON.stringify(s),job.id);}
    body=buildRequest({source:signedMediaUrl(s.editMode==='person-recast-v4'?s.source:(s.cropInput||s.source)),photos:s.photos.map((p:string)=>signedMediaUrl(p)),voice:signedMediaUrl(s.voice),host:s.host,usage:s.usage,seed:s.seed,direction:s.direction});run('UPDATE jobs SET body=? WHERE id=?',JSON.stringify(body),job.id);}
   // Verify the expiring inputs before submitting a billable request.
   try {
    for (const url of [body.video_url,...(body.image_urls||[])]) {
     const response=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(15000)});
     if(!response.ok)throw new Error('Media unavailable');
    }
   } catch {throw Object.assign(new Error('Media unavailable'),{errorType:'media_unavailable'});}
   const handle=await comfy.models.submit(job.model,body,{idempotencyKey:job.idempotency});requestId=handle.requestId;
   run("UPDATE jobs SET request_id=?,state='queued',error=NULL,error_type=NULL,updated=? WHERE id=?",requestId,now(),job.id);
  }
  const handle=comfy.models.handle(job.model,requestId);const status=await handle.status();
  if(status.errorType){run("UPDATE jobs SET state='failed',error_type=?,error=?,updated=? WHERE id=?",status.errorType,classifyError({errorType:status.errorType}).message,now(),job.id);continue;}
  if(status.status!=='COMPLETED'){run('UPDATE jobs SET state=?,queue_position=?,next_poll=?,error=NULL,updated=? WHERE id=?',status.status==='IN_QUEUE'?'queued':'running',status.queuePosition??null,Date.now()+Math.max(status.retryAfterMs??10000,5000),now(),job.id);continue;}
  run("UPDATE jobs SET state='saving',updated=? WHERE id=?",now(),job.id);
  const result=await handle.get();if(result.kind!=='json')throw Object.assign(new Error('Unexpected result type'),{errorType:'invalid_result'});
  const url=outputUrl(result.data);const path=resolve(dataDir,'media',job.id+'.mp4');
  try{const snapshot=JSON.parse(one('SELECT snapshot FROM jobs WHERE id=?',job.id).snapshot);if(snapshot.editMode!=='person-recast-v4'&&snapshot.hostRegion){const rawPath=resolve(dataDir,'media',job.id+'-raw.mp4');try{await download(url,rawPath);const source=one('SELECT path FROM media WHERE id=?',snapshot.source);try{await compositeHost(source.path,rawPath,path,snapshot.hostRegion);}catch{throw Object.assign(new Error('The host result could not be composited'),{errorType:'media_processing_error'});}}finally{await removeFile(rawPath);}}else{await download(url,path);}const metadata=await probe(path);if(!metadata.streams.some((s:any)=>s.codec_type==='video'))throw new Error('Output is not a video');const output=await insertMedia(job.owner,'result',path,'video/mp4',{duration:Number(metadata.format.duration)});run("UPDATE jobs SET output=?,state='finished',error=NULL,error_type=NULL,updated=? WHERE id=?",output,now(),job.id);if(snapshot.prepareDialogue)queueDialogue(job);}catch(e){await removeFile(path);throw e;}
 }catch(e:any){const failure=classifyError(e);run('UPDATE jobs SET state=?,error_type=?,error=?,next_poll=?,updated=? WHERE id=?',failure.retry?job.state:'failed',failure.type,failure.message,Date.now()+Math.max(30000,(e.retryAfter||0)*1000),now(),job.id);}
 }
 }finally{busy=false;}
}
export function startWorker(){const timer=setInterval(()=>void tick().catch(()=>{}),3000);timer.unref();return timer;}

