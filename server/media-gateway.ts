import express from 'express';
import helmet from 'helmet';
import { one } from './db.ts';
import { validSignature } from './media.ts';

// Only this small surface is exposed through the development HTTPS tunnel.
// It has no authentication, upload, configuration, account or generation routes.
export const mediaGateway = express();
mediaGateway.disable('x-powered-by');
mediaGateway.use(helmet());
mediaGateway.get('/health', (_req,res)=>res.json({service:'recast-media',ok:true}));
mediaGateway.get('/provider-media/:id',(req,res)=>{
  if(!validSignature(req.params.id,Number(req.query.expires),String(req.query.signature||'')))
    return res.status(403).json({error:'Invalid or expired media link.'});
  const media=one('SELECT mime,path FROM media WHERE id=?',req.params.id);
  if(!media)return res.status(404).json({error:'Media not found.'});
  res.set('Cache-Control','private, no-store').type(media.mime).sendFile(media.path);
});
mediaGateway.use((_req,res)=>res.status(404).json({error:'Not found.'}));
mediaGateway.use((_error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(500).json({error:'Media unavailable.'}));
