import { randomBytes } from 'node:crypto';
import { hash } from '../server/auth.ts';
import { run } from '../server/db.ts';
const code=randomBytes(18).toString('base64url');
const email=process.argv[2]?.trim().toLowerCase()||null;
run('INSERT INTO invites VALUES(?,?,?,NULL)',hash(code),email,Date.now()+7*86400000);
console.log(`Single-use invite (expires in 7 days)${email?' for '+email:''}: ${code}`);
