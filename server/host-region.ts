import {z} from 'zod';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import {probe} from './media.ts';
export const regionSchema=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().min(.02).max(1),height:z.number().min(.02).max(1)}).refine(r=>r.x+r.width<=1.001&&r.y+r.height<=1.001&&r.width*r.height<=.9,'Select a host region within the frame, covering less than 90% of it.');
export type HostRegion=z.infer<typeof regionSchema>;
const exec=promisify(execFile);
export function pixelRegion(r:HostRegion,w:number,h:number){regionSchema.parse(r);const x=Math.floor(r.x*w/2)*2,y=Math.floor(r.y*h/2)*2;return {x,y,width:Math.max(2,Math.min(w-x,Math.floor(r.width*w/2)*2)),height:Math.max(2,Math.min(h-y,Math.floor(r.height*h/2)*2))};}
export async function cropHost(source:string,output:string,r:HostRegion){const metadata=await probe(source);const stream=metadata.streams.find((s:any)=>s.codec_type==='video');const b=pixelRegion(r,stream.width,stream.height);await exec(ffmpeg!,['-y','-v','error','-i',source,'-map','0:v:0','-map','0:a:0?','-vf',`crop=${b.width}:${b.height}:${b.x}:${b.y},scale=trunc(iw/2)*2:trunc(ih/2)*2`,'-c:v','libx264','-crf','18','-preset','fast','-c:a','copy','-movflags','+faststart',output],{timeout:120000,maxBuffer:1024*1024});return metadata;}
export async function compositeHost(source:string,generated:string,output:string,r:HostRegion){const metadata=await probe(source);const stream=metadata.streams.find((s:any)=>s.codec_type==='video');const b=pixelRegion(r,stream.width,stream.height);const duration=Number(metadata.format.duration);await exec(ffmpeg!,['-y','-v','error','-i',source,'-i',generated,'-filter_complex',`[1:v]setpts=PTS-STARTPTS,scale=${b.width}:${b.height},setsar=1,tpad=stop_mode=clone:stop_duration=${duration}[host];[0:v]setpts=PTS-STARTPTS[original];[original][host]overlay=${b.x}:${b.y}:eof_action=repeat[v]`,'-map','[v]','-map','0:a:0?','-t',String(duration),'-c:v','libx264','-crf','18','-preset','fast','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',output],{timeout:180000,maxBuffer:1024*1024});}
