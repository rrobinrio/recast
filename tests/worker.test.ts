import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import {comfy} from '@comfyorg/sdk';
test('new person recast ignores legacy crop selection, sends original video and resumes without resubmission',async()=>{
 const temp=await mkdtemp(resolve(tmpdir(),'recast-worker-'));process.env.RECAST_DATA_DIR=temp;process.env.RECAST_ENV_PATH=resolve(temp,'.env');await writeFile(process.env.RECAST_ENV_PATH,'COMFY_API_KEY=local-test-only\nPUBLIC_MEDIA_BASE_URL=https://inputs.example.test');
 const {run,one,id,now,db}=await import('../server/db.ts');const {insertMedia,probe}=await import('../server/media.ts');const {tick}=await import('../server/worker.ts');
 let submissions=0,body:any;const mock=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.method==='POST'){submissions++;let data='';for await(const chunk of req)data+=chunk;body=JSON.parse(data);res.statusCode=201;res.end(JSON.stringify({request_id:'test-only-request',status:'IN_QUEUE'}));}else res.end(JSON.stringify({request_id:'test-only-request',status:'IN_PROGRESS'}));});mock.listen(0,'127.0.0.1');await new Promise<void>(r=>mock.once('listening',r));
 const realFetch=globalThis.fetch;let heads=0;globalThis.fetch=async(input,init)=>{if(String(input).startsWith('https://inputs.example.test/')&&init?.method==='HEAD'){heads++;return new Response(null,{status:200});}return realFetch(input,init);};comfy.config({baseUrl:`http://127.0.0.1:${(mock.address() as any).port}`,credentials:'local-test-only'});
 try{const user=id();run('INSERT INTO users(id,email,name,password,created) VALUES(?,?,?,?,?)',user,'test@example.test','Test','unused',now());const path=resolve(temp,'source.mp4');await promisify(execFile)(ffmpeg!,['-y','-v','error','-f','lavfi','-i','color=c=blue:s=320x240:r=24:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-shortest','-c:v','libx264','-c:a','aac',path]);const source=await insertMedia(user,'source',path,'video/mp4');const listing=id();run('INSERT INTO listings VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',listing,user,'Test','Test','Interviews',0,source,source,source,'Host left','Test','{}',now());const job=id();run('INSERT INTO jobs(id,owner,listing,model,state,snapshot,idempotency,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',job,user,listing,'higgsfield/higgsfield-genjutsu-motion-transfer-v1.0','submitting',JSON.stringify({source,photos:[source],voice:source,host:'Host left',usage:'test',seed:1,editMode:'person-recast-v4',cropInput:'stale-crop-id',hostRegion:{x:0,y:0,width:.5,height:1}}),id(),now(),now());
 await tick();let saved=one('SELECT * FROM jobs WHERE id=?',job);assert.equal(saved.state,'running');assert.equal(saved.request_id,'test-only-request');const snapshot=JSON.parse(saved.snapshot);assert.ok(body.video_url.includes(source));assert.ok(!body.video_url.includes('stale-crop-id'));assert.equal(heads,2);assert.equal(one("SELECT COUNT(*) n FROM media WHERE kind='generation_input'").n,0);
 run('UPDATE jobs SET next_poll=0 WHERE id=?',job);await tick();assert.equal(submissions,1);assert.equal(heads,2);
 }finally{globalThis.fetch=realFetch;comfy.config({baseUrl:undefined,credentials:undefined});await new Promise<void>(r=>mock.close(()=>r()));db.close();await rm(temp,{recursive:true,force:true});}
});
