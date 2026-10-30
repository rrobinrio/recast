import {Router} from 'express';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {all,one,run,id,now,transaction,audit} from './db.ts';
import {hash} from './auth.ts';
export const teams=Router();
const fail=(message:string,status=403)=>Object.assign(new Error(message),{status});
const user=(req:any)=>req.auth.user_id;
export function teamMembership(team:string,userId:string){return one('SELECT role FROM team_members WHERE team=? AND user_id=?',team,userId);}
export function listingTeam(listing:string){return one('SELECT team FROM team_listings WHERE listing=?',listing)?.team;}
export function teamAccess(listing:string,userId:string){const team=listingTeam(listing);return team?!!teamMembership(team,userId):null;}
export function acceptTeamInvite(code:string,userId:string,email:string){
 const invitation=one('SELECT * FROM team_invites WHERE hash=? AND expires>? AND used_by IS NULL',hash(code),Date.now());
 if(!invitation||invitation.email!==email)throw fail('This team invitation is invalid, expired, or belongs to another email.',400);
 run("INSERT OR IGNORE INTO team_members VALUES(?,?,'member',?)",invitation.team,userId,now());
 run('UPDATE team_invites SET used_by=? WHERE hash=?',userId,hash(code));run('UPDATE invites SET used_by=? WHERE hash=?',userId,hash(code));
 return invitation.team;
}
teams.get('/',(req,res)=>res.json(all('SELECT t.*,m.role,(SELECT COUNT(*) FROM team_members x WHERE x.team=t.id) member_count,(SELECT COUNT(*) FROM team_listings x WHERE x.team=t.id) video_count FROM teams t JOIN team_members m ON m.team=t.id WHERE m.user_id=? ORDER BY t.created',user(req))));
teams.post('/',(req,res)=>{const p=z.object({name:z.string().trim().min(2).max(80)}).parse(req.body);const team=id();transaction(()=>{run('INSERT INTO teams VALUES(?,?,?,?)',team,p.name,user(req),now());run("INSERT INTO team_members VALUES(?,?,'owner',?)",team,user(req),now());});res.status(201).json({id:team});});
teams.post('/join',(req,res)=>{const p=z.object({code:z.string().trim().min(10).max(200)}).parse(req.body);const email=one('SELECT email FROM users WHERE id=?',user(req)).email;const team=transaction(()=>acceptTeamInvite(p.code,user(req),email));res.json({id:team});});
teams.get('/:team',(req,res)=>{if(!teamMembership(String(req.params.team),user(req)))throw fail('Team access required.');res.json({team:one('SELECT * FROM teams WHERE id=?',req.params.team),members:all('SELECT u.id,u.name,u.email,m.role,m.created FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team=? ORDER BY m.role DESC,m.created',req.params.team),invitations:teamMembership(String(req.params.team),user(req)).role==='owner'?all('SELECT hash,email,expires,used_by FROM team_invites WHERE team=? AND used_by IS NULL AND expires>?',req.params.team,Date.now()):[],videos:all('SELECT l.*,u.name seller_name,m.duration,1 purchased FROM listings l JOIN team_listings t ON t.listing=l.id JOIN users u ON u.id=l.seller JOIN media m ON m.id=l.source WHERE t.team=? ORDER BY l.created DESC',req.params.team)});});
teams.post('/:team/invites',(req,res)=>{if(teamMembership(String(req.params.team),user(req))?.role!=='owner')throw fail('Only the team owner can invite employees.');const p=z.object({email:z.email().max(254)}).parse(req.body);const email=p.email.toLowerCase();const code=randomBytes(24).toString('base64url'),expires=Date.now()+7*86400000;transaction(()=>{run('INSERT INTO team_invites VALUES(?,?,?,?,NULL,?)',hash(code),req.params.team,email,expires,now());run('INSERT INTO invites VALUES(?,?,?,NULL)',hash(code),email,expires);});audit(user(req),'team_invite',{team:req.params.team,email});res.status(201).json({code,email,expires});});
teams.delete('/:team/invites/:hash',(req,res)=>{if(teamMembership(String(req.params.team),user(req))?.role!=='owner')throw fail('Only the team owner can revoke invitations.');transaction(()=>{const invite=one('SELECT hash FROM team_invites WHERE team=? AND hash=? AND used_by IS NULL',req.params.team,req.params.hash);if(!invite)throw fail('Invitation not found.',404);run('UPDATE team_invites SET expires=0 WHERE hash=?',invite.hash);run('UPDATE invites SET expires=0 WHERE hash=?',invite.hash);});res.json({ok:true});});
teams.delete('/:team/members/:member',(req,res)=>{if(teamMembership(String(req.params.team),user(req))?.role!=='owner')throw fail('Only the team owner can remove employees.');if(teamMembership(String(req.params.team),String(req.params.member))?.role==='owner')throw fail('The owner cannot be removed.',400);run('DELETE FROM team_members WHERE team=? AND user_id=?',req.params.team,req.params.member);audit(user(req),'team_member_removed',{team:req.params.team,member:req.params.member});res.json({ok:true});});
