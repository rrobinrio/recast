import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
const exec=promisify(execFile);
test('host compositor retains outside scene, source audio and duration while replacing only selected region',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'recast-region-'));process.env.RECAST_DATA_DIR=dir;process.env.RECAST_ENV_PATH=resolve(dir,'.env');
 const {compositeHost,cropHost,pixelRegion}=await import('../server/host-region.ts');const {probe}=await import('../server/media.ts');const {db}=await import('../server/db.ts');
 const source=resolve(dir,'original.mp4'),generated=resolve(dir,'generated.mp4'),out=resolve(dir,'result.mp4'),crop=resolve(dir,'crop.mp4');
 try{
 await exec(ffmpeg!,['-y','-v','error','-f','lavfi','-i','color=c=blue:s=320x240:r=24:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-shortest','-c:v','libx264','-c:a','aac',source]);
 await exec(ffmpeg!,['-y','-v','error','-f','lavfi','-i','color=c=red:s=160x240:r=24:d=3','-c:v','libx264',generated]);
 const region={x:0,y:0,width:.5,height:1};assert.deepEqual(pixelRegion(region,320,240),{x:0,y:0,width:160,height:240});
 await cropHost(source,crop,region);const cropped=await probe(crop);assert.equal(cropped.streams[0].width,160);
 await compositeHost(source,generated,out,region);const metadata=await probe(out);assert.ok(Math.abs(Number(metadata.format.duration)-4)<.1);assert.ok(metadata.streams.some((s:any)=>s.codec_type==='audio'));
 const sample=async(x:number)=>{const {stdout}=await exec(ffmpeg!,['-v','error','-ss','3.5','-i',out,'-vf',`crop=20:20:${x}:100,scale=1:1`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer'});return [...stdout];};
 const left=await sample(40),right=await sample(240);assert.ok(left[0]>200&&left[2]<30,'generated host stays in left region through end');assert.ok(right[2]>200&&right[0]<30,'original background stays blue outside region');
 const audioHash=async(path:string)=>(await exec(ffmpeg!,['-v','error','-i',path,'-map','0:a','-c','copy','-f','hash','-hash','sha256','pipe:1'])).stdout;assert.equal(await audioHash(source),await audioHash(out));
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
