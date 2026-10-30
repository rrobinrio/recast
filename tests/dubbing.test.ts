import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
const temp=await mkdtemp(resolve(tmpdir(),'recast-dub-test-'));
process.env.RECAST_DATA_DIR=temp;process.env.RECAST_ENV_PATH=resolve(temp,'.env');
await writeFile(process.env.RECAST_ENV_PATH,'');
const {validateLines,mixDub,dialogueBody,normalizeDraft,tempoFilters}=await import('../server/dubbing.ts');
const exec=promisify(execFile);
const host={start:1,end:2,text:'Hello',speaker:'host',overlap:false,selected:true};
test('rejects non-host, overlapping, out-of-bounds, and invalid timing selections',()=>{
 assert.equal(validateLines([host],4).length,1);
 for(const line of [{...host,speaker:'other'},{...host,overlap:true},{...host,end:8},{...host,end:.5}])assert.throws(()=>validateLines([line],4));
 assert.throws(()=>validateLines([host,{...host,start:1.8,end:2.5,speaker:'other',selected:false}],4));
 assert.equal(dialogueBody('Person on left','abc').contents[0].parts[0].inlineData?.mimeType,'video/mp4');
 const draft=normalizeDraft([{...host,startMs:0,endMs:1000},{...host,startMs:1000,endMs:2200}],2);
 assert.equal(draft.length,1);assert.equal(draft[0].end,2);assert.equal(draft[0].selected,false);
 assert.equal(tempoFilters(.4),'atempo=0.5,atempo=0.8');assert.throws(()=>tempoFilters(.2));
});
test('mix replaces only chosen interval and copies video frames unchanged',async()=>{
 const source=resolve(temp,'source.mp4'),voice=resolve(temp,'voice.wav'),out=resolve(temp,'dub.mp4');
 await exec(ffmpeg!,['-y','-v','error','-f','lavfi','-i','color=c=blue:s=160x120:r=24:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-c:v','libx264','-c:a','aac','-shortest',source]);
 await exec(ffmpeg!,['-y','-v','error','-f','lavfi','-i','sine=frequency=880:duration=1',voice]);
 await mixDub(source,source,out,[{start:1,end:2,path:voice}]);
 async function videoHash(path:string){return (await exec(ffmpeg!,['-v','error','-i',path,'-map','0:v','-c','copy','-f','md5','-'])).stdout.trim();}
 assert.equal(await videoHash(source),await videoHash(out));
 async function samples(path:string,start:string){const p=resolve(temp,'samples-'+path.split(/[\\/]/).at(-1)+'-'+start+'.raw');await exec(ffmpeg!,['-y','-v','error','-i',path,'-ss',start,'-t','0.4','-vn','-ac','1','-ar','8000','-f','f32le',p]);const b=await readFile(p);return Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4));}
 const original=await samples(source,'0.2'),unchanged=await samples(out,'0.2');const error=original.reduce((sum,v,i)=>sum+(v-unchanged[i])**2,0)/original.length;assert.ok(error<.0001,'Other speaker interval must retain original audio');
 const changed=await samples(out,'1.2');function energy(freq:number){return Math.hypot(changed.reduce((a,v,i)=>a+v*Math.cos(2*Math.PI*freq*i/8000),0),changed.reduce((a,v,i)=>a+v*Math.sin(2*Math.PI*freq*i/8000),0));}assert.ok(energy(880)>energy(440)*10,'Selected host interval uses replacement voice');
});

