import { Comfy } from '@comfyorg/sdk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { comfyKey, root } from './config.ts';
import { one, run, now } from './db.ts';
import { swapWorkflow } from './openjutsu-graph.ts';
export const OPENJUTSU='openjutsu/minimax-h3-character-swap-v1.5';
export function deploymentReady(){try{const u=new URL(process.env.COMFY_BASE_URL||'');return u.protocol==='https:'&&u.hostname.endsWith('.run.comfy.app')&&!u.username&&!u.password;}catch{return false;}}
export async function openjutsuStep(job:any):Promise<string|null>{
 if(!deploymentReady())throw Object.assign(new Error('Configure the OPENjutsu deployment URL in COMFY_BASE_URL.'),{errorType:'deployment_missing'});
 const api=new Comfy({apiKey:comfyKey(),clientInfo:'recast-openjutsu'});
 let requestId=job.request_id;
 if(!requestId){
  const s=JSON.parse(job.snapshot);const source=one('SELECT * FROM media WHERE id=?',s.source);const photo=one('SELECT * FROM media WHERE id=?',s.photos[0]);
  if(!source||!photo||source.duration<5||source.duration>15)throw Object.assign(new Error('OPENjutsu needs a 5–15 second clip and a reference photo.'),{errorType:'invalid_input'});
  const graph=swapWorkflow(JSON.parse(readFileSync(resolve(root,'workflows/openjutsu.api.json'),'utf8')),{
   video:api.assets.fromBytes(readFileSync(source.path),{filename:'source.mp4',contentType:'video/mp4'}),
   character:api.assets.fromBytes(readFileSync(photo.path),{filename:'character.jpg',contentType:'image/jpeg'}),
   direction:'Preserve the surrounding scene and other people. '+s.host,start:0,seconds:source.duration,size:'480p',seed:s.seed
  });
  const submitted=await api.submit(api.workflows.fromJson(graph),{idempotencyKey:job.idempotency,metadata:{recast_job:job.id}});
  requestId=submitted.id;run("UPDATE jobs SET request_id=?,state='queued',error=NULL,error_type=NULL,updated=? WHERE id=?",requestId,now(),job.id);
 }
 const remote=await api.jobs.get(requestId);
 if(['failed','canceled','expired'].includes(remote.status))throw Object.assign(new Error('OPENjutsu job '+remote.status),{errorType:'workflow_'+remote.status});
 if(remote.status!=='succeeded'){run('UPDATE jobs SET state=?,queue_position=?,next_poll=?,updated=? WHERE id=?',remote.status==='queued'?'queued':'running',remote.queuePosition??null,Date.now()+10000,now(),job.id);return null;}
 const output=remote.outputs.find(o=>o.name.endsWith('.mp4'));
 if(!output)throw Object.assign(new Error('OPENjutsu returned no MP4 video.'),{errorType:'invalid_result'});
 return (await output.getDownloadUrl()).url;
}
