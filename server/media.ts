import { createHmac, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { stat, unlink } from 'node:fs/promises';
import ffmpegPath from 'ffmpeg-static';
// @ts-ignore package has no declarations
import ffprobe from 'ffprobe-static';
import { dataDir, signingSecret, mediaBaseUrl } from './config.ts';
import { id, now, run, one } from './db.ts';
const exec=promisify(execFile);
export async function probe(path:string){const {stdout}=await exec(ffprobe.path,['-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,avi,mpegts,mp3,wav,ogg,flac,aac,image2,jpeg_pipe,png_pipe,webp_pipe','-show_format','-show_streams','-of','json',path],{timeout:30000,maxBuffer:1024*1024});return JSON.parse(stdout);}
export async function insertMedia(owner:string,kind:string,path:string,mime:string,metadata:any={}) {const mediaId=id();run('INSERT INTO media VALUES(?,?,?,?,?,?,?,?,?,?)',mediaId,owner,kind,mime,path,(await stat(path)).size,metadata.duration??null,metadata.width??null,metadata.height??null,now());return mediaId;}
export async function normalizeUpload(owner:string,kind:string,input:string,clip?:{start:number,duration:number}){
  const invalid=(message:string,status=400,details:Record<string,unknown>={})=>Object.assign(new Error(message),{status,...details});
  let metadata:any;try{metadata=await probe(input);}catch{throw invalid('This file could not be read. Choose a JPG/PNG/WebP photo, an audio recording, or an MP4/MOV/WebM video for the matching uploader.');}
  const video=metadata.streams.find((s:any)=>s.codec_type==='video'); const audio=metadata.streams.find((s:any)=>s.codec_type==='audio');
  const duration=Number(metadata.format.duration||video?.duration||0);let suffix,mime,args:string[];let outputDuration=duration;
  if(kind==='photo') {
    if(audio||duration>1)throw invalid('This is a video, not a reference photo. Upload it in Creator studio. My identity needs still photos of the person you want to become the host.');
    if(!video||video.width<300||video.height<300)throw invalid('Reference photos must be JPG, PNG, or WebP images at least 300 × 300 pixels.');
    suffix='.jpg';mime='image/jpeg';args=['-frames:v','1','-vf','scale=1200:1200:force_original_aspect_ratio=decrease','-q:v','3'];
  }
  else if(kind==='voice'){if(!audio||duration<3||duration>30)throw invalid('Use a clear voice recording between 3 and 30 seconds. Upload original videos in Creator studio.');suffix='.mp3';mime='audio/mpeg';args=['-vn','-ar','44100','-ac','1','-c:a','libmp3lame','-b:a','128k'];}
  else {
    if(!video)throw invalid('Choose a video file for Creator studio.');
    if(!audio)throw invalid('This video has no audio track. Choose a video with the original dialogue.');
    if(!Number.isFinite(duration)||duration<4)throw invalid('Choose a video at least 4 seconds long.');
    if(clip){if(!Number.isFinite(clip.start)||!Number.isFinite(clip.duration)||clip.start<0||clip.duration<4||clip.duration>30||clip.start+clip.duration>duration+0.05)throw invalid('Choose a 4–30 second section within the original video.');outputDuration=clip.duration;}
    else if(duration>30)throw invalid(`This video is ${duration.toFixed(1)} seconds long. Select a 4–30 second section to upload.`,422,{code:'clip_required',duration});
    suffix='.mp4';mime='video/mp4';args=[...(clip?['-ss',String(clip.start),'-t',String(clip.duration)]:[]),'-map','0:v:0','-map','0:a:0','-vf','scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart'];
  }
  const path=resolve(dataDir,'media',id()+suffix);
  try{await exec(ffmpegPath!,['-y','-nostats','-loglevel','error','-protocol_whitelist','file,pipe','-i',input,...args,path],{timeout:180000,maxBuffer:2*1024*1024});}
  catch{await removeFile(path);throw invalid('The file was readable but could not be converted. Try exporting it as H.264 MP4, JPG, or MP3 for the matching uploader.');}
  const mediaId=await insertMedia(owner,kind,path,mime,{duration:kind==='photo'?null:outputDuration,width:video?.width,height:video?.height});
  return one('SELECT id,kind,mime,duration,width,height FROM media WHERE id=?',mediaId);
}
export async function previewFor(owner:string,source:any){
 const preview=resolve(dataDir,'media',id()+'.mp4'),poster=resolve(dataDir,'media',id()+'.jpg');
 await exec(ffmpegPath!,['-y','-i',source.path,'-t','8','-vf',"scale=640:-2,drawbox=x=0:y=ih-56:w=iw:h=56:color=black@0.5:t=fill,drawtext=text='RECAST  /  PREVIEW':fontcolor=white:fontsize=20:x=20:y=h-38",'-c:v','libx264','-preset','fast','-crf','27','-c:a','aac','-movflags','+faststart',preview],{timeout:120000,maxBuffer:2*1024*1024});
 await exec(ffmpegPath!,['-y','-ss','0.5','-i',source.path,'-frames:v','1','-vf','scale=960:-2','-q:v','3',poster],{timeout:30000,maxBuffer:1024*1024});
 return {preview:await insertMedia(owner,'preview',preview,'video/mp4'),poster:await insertMedia(owner,'poster',poster,'image/jpeg')};
}
export function mediaSignature(mediaId:string,expires:number){return createHmac('sha256',signingSecret).update(`${mediaId}:${expires}`).digest('hex');}
export function signedMediaUrl(mediaId:string,expires=Date.now()+72*3600000){const base=mediaBaseUrl();const url=new URL(base);if(url.protocol!=='https:'||['localhost','127.0.0.1','::1'].includes(url.hostname))throw new Error('Configure a publicly reachable HTTPS PUBLIC_MEDIA_BASE_URL before generation.');return `${base.replace(/\/$/,'')}/provider-media/${mediaId}?expires=${expires}&signature=${mediaSignature(mediaId,expires)}`;}
export function validSignature(mediaId:string,expires:number,signature:string){if(!Number.isFinite(expires)||expires<Date.now()||expires>Date.now()+73*3600000)return false;const expected=Buffer.from(mediaSignature(mediaId,expires));const actual=Buffer.from(signature);return actual.length===expected.length&&timingSafeEqual(actual,expected);}
export const removeFile=(path:string)=>unlink(path).catch(()=>{});

