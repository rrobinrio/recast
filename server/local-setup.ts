import express from 'express';
import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {comfyKey,dataDir,envPath,origin} from './config.ts';

const tokenPath=resolve(dataDir,'setup-token');
export function createSetupToken(){if(!existsSync(tokenPath))writeFileSync(tokenPath,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});return readFileSync(tokenPath,'utf8').trim();}
export const localSetup=express.Router();
localSetup.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  const allowedHost=new URL(origin).host;
  if(req.headers.host!==allowedHost||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')||!existsSync(tokenPath))return res.status(403).json({error:'Open the private local setup link supplied for this computer.'});
  const expected=Buffer.from(readFileSync(tokenPath,'utf8').trim());const actual=Buffer.from(String(req.headers['x-recast-setup']||''));
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return res.status(403).json({error:'Invalid setup link.'});
  if(req.method!=='GET'&&req.headers.origin!==origin)return res.status(403).json({error:'Local origin required.'});
  next();
});
localSetup.get('/',(_req,res)=>res.json({configured:!!comfyKey(),mediaConfigured:!!process.env.PUBLIC_MEDIA_BASE_URL}));
localSetup.post('/',(req,res)=>{
  const value=typeof req.body?.key==='string'?req.body.key.trim():'';
  if(!/^comfyui-[A-Za-z0-9._-]{10,1000}$/.test(value))return res.status(400).json({error:'Paste the complete Comfy API key beginning with comfyui-.'});
  if(comfyKey())return res.status(409).json({error:'A key is already configured. No existing credential was replaced.'});
  let contents=existsSync(envPath)?readFileSync(envPath,'utf8'):'';
  contents=/^COMFY_API_KEY=.*$/m.test(contents)?contents.replace(/^COMFY_API_KEY=.*$/m,()=>`COMFY_API_KEY=${value}`):contents+`\nCOMFY_API_KEY=${value}\n`;
  writeFileSync(envPath,contents,{mode:0o600});
  unlinkSync(tokenPath);
  res.json({saved:true});
});
