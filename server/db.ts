import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir } from './config.ts';
export const db = new DatabaseSync(resolve(dataDir, 'recast.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,bio TEXT NOT NULL DEFAULT '',stripe_account TEXT,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,email TEXT,expires INTEGER NOT NULL,used_by TEXT);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,mime TEXT NOT NULL,path TEXT NOT NULL,bytes INTEGER NOT NULL,duration REAL,width INTEGER,height INTEGER,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS identities(user_id TEXT PRIMARY KEY REFERENCES users(id),name TEXT NOT NULL,photos TEXT NOT NULL,voice TEXT NOT NULL,consent TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS listings(id TEXT PRIMARY KEY,seller TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL,source TEXT NOT NULL REFERENCES media(id),preview TEXT NOT NULL REFERENCES media(id),poster TEXT NOT NULL REFERENCES media(id),host TEXT NOT NULL,usage TEXT NOT NULL,consent TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY,buyer TEXT NOT NULL REFERENCES users(id),listing TEXT NOT NULL REFERENCES listings(id),amount INTEGER NOT NULL,status TEXT NOT NULL,checkout TEXT UNIQUE,license TEXT NOT NULL,created TEXT NOT NULL,UNIQUE(buyer,listing));
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),listing TEXT NOT NULL REFERENCES listings(id),model TEXT NOT NULL,request_id TEXT,state TEXT NOT NULL,queue_position INTEGER,error_type TEXT,error TEXT,output TEXT REFERENCES media(id),snapshot TEXT NOT NULL,body TEXT,idempotency TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 1,next_poll INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stripe_events(id TEXT PRIMARY KEY,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,user_id TEXT,action TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS archived_jobs(job TEXT PRIMARY KEY REFERENCES jobs(id),archived TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS team_members(team TEXT NOT NULL REFERENCES teams(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('owner','member')),created TEXT NOT NULL,PRIMARY KEY(team,user_id));
CREATE TABLE IF NOT EXISTS team_invites(hash TEXT PRIMARY KEY,team TEXT NOT NULL REFERENCES teams(id),email TEXT NOT NULL,expires INTEGER NOT NULL,used_by TEXT,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS team_listings(listing TEXT PRIMARY KEY REFERENCES listings(id),team TEXT NOT NULL REFERENCES teams(id));
`);
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function one(sql:string,...args:any[]):any {return db.prepare(sql).get(...args);}
export function all(sql:string,...args:any[]):any[] {return db.prepare(sql).all(...args);}
export function run(sql:string,...args:any[]) {return db.prepare(sql).run(...args);}
export function transaction<T>(fn:()=>T):T {db.exec('BEGIN IMMEDIATE');try {const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
export function audit(user:string,action:string,detail:unknown){run('INSERT INTO audit VALUES(?,?,?,?,?)',id(),user,action,JSON.stringify(detail),now());}
