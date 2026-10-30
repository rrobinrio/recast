import {basename,resolve,sep} from 'node:path';
import {existsSync} from 'node:fs';
import {all,run,transaction,db} from '../server/db.ts';
import {dataDir} from '../server/config.ts';
const rows=all('SELECT id,path FROM media').map(m=>{const name=basename(m.path.replaceAll('\\','/'));const path=resolve(dataDir,'media',name);if(!path.startsWith(resolve(dataDir,'media')+sep)||!existsSync(path))throw new Error('Missing media '+m.id);return {...m,path};});
transaction(()=>{for(const m of rows)run('UPDATE media SET path=? WHERE id=?',m.path,m.id);});
console.log(`Verified and relocated ${rows.length} media records.`);db.close();
