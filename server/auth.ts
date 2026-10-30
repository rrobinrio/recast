import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { one, run } from './db.ts';
import { origin } from './config.ts';
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function passwordHash(s:string){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(s,salt,64).toString('hex');}
export function passwordValid(s:string,value:string){const [salt,key]=value.split(':');const expected=Buffer.from(key,'hex');const actual=scryptSync(s,salt,64);return expected.length===actual.length&&timingSafeEqual(expected,actual);}
export function userSession(req:Request,_res:Response,next:NextFunction){const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('recast_session='))?.slice(15);if(cookie){const s=one('SELECT sessions.*,users.name,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE hash=? AND expires>?',hash(cookie),Date.now());if(s){(req as any).auth=s;}}next();}
export function requireAuth(req:Request,res:Response,next:NextFunction){if(!(req as any).auth)return res.status(401).json({error:'Sign in to continue.'});next();}
export function csrf(req:Request,res:Response,next:NextFunction){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();if(req.headers.origin && req.headers.origin!==origin)return res.status(403).json({error:'Origin rejected.'});const session=(req as any).auth;if(session&&req.headers['x-csrf-token']!==session.csrf)return res.status(403).json({error:'Refresh the page and try again.'});next();}
export function startSession(res:Response,user:string){const token=randomBytes(32).toString('hex');const csrf=randomBytes(24).toString('hex');run('INSERT INTO sessions VALUES(?,?,?,?)',hash(token),user,csrf,Date.now()+7*86400000);res.cookie('recast_session',token,{httpOnly:true,sameSite:'strict',secure:origin.startsWith('https:'),maxAge:7*86400000,path:'/'});return csrf;}
