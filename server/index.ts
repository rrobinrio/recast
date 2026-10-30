import {dubTick} from './dubbing.ts';
import {voiceTick} from './voices.ts';
import { app } from './app.ts';
import { startWorker } from './worker.ts';
import { mediaGateway } from './media-gateway.ts';
const port=Number(process.env.PORT||3000);
const server=app.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Recast is running at http://localhost:${port}`));
const mediaServer=mediaGateway.listen(Number(process.env.MEDIA_PORT||3001),'127.0.0.1',()=>console.log('Private media gateway ready.'));
const timer=startWorker();const voiceTimer=setInterval(()=>void voiceTick().catch(()=>{}),8000);
const dubTimer=setInterval(()=>void dubTick().catch(()=>{}),5000);
function stop(){clearInterval(dubTimer);clearInterval(timer);clearInterval(voiceTimer);mediaServer.close();server.close(()=>process.exit(0));}
process.on('SIGINT',stop);process.on('SIGTERM',stop);

