import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWriteRuntime,createBrainBridge,loadLocalDecider} from './upstream-brain.mjs';
import {loadNativeRuntime,createNativeBrainBridge} from './native-brain.mjs';
import {ensureOwnedNativeSessions} from './native-storage.mjs';
import {createWorldStore} from './world-store.mjs';
import {createWorldAutonomyScheduler} from './world-scheduler.mjs';
const MIME={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const maxBody=20_000;
// Serve only compiled/public assets. Serving the repository root could expose
// .env, private Native session indexes or the Node server source.
export function createBrainServer({root=resolve('dist'),bridge=null,worldStore=null}={}){
 return createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const sameOrigin = () => {
   if (req.headers['sec-fetch-site'] === 'cross-site') return false;
   const origin=req.headers.origin;
   if(!origin)return true;
   try{return new URL(origin).host===req.headers.host && ['http:','https:'].includes(new URL(origin).protocol);}catch{return false;}
  };
  const bodyJson = async cap => {
   if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw Object.assign(new Error('只接受 JSON 請求'),{code:'JSON_REQUIRED',status:415});
   let size=0;const chunks=[];
   for await(const chunk of req){size+=chunk.length;if(size>cap)throw Object.assign(new Error('請求內容過大'),{code:'REQUEST_TOO_LARGE',status:413});chunks.push(chunk);}
   try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('JSON 無法解析'),{code:'INVALID_JSON',status:400});}
  };
  if(url.pathname==='/api/worlds'||url.pathname==='/api/worlds/migrate'||/^\/api\/worlds\/[a-zA-Z0-9_-]{8,128}(?:\/(?:commands|brain-turn|reconcile|reconciliation-status))?$/.test(url.pathname)){
   if(!worldStore)return json(503,{error:'WORLD_SERVER_NOT_CONFIGURED'});
   if(!sameOrigin())return json(403,{error:'CROSS_ORIGIN_FORBIDDEN'});
   const segments=url.pathname.split('/').filter(Boolean);
   try{
    if(segments.length===2&&req.method==='GET')return json(200,{worlds:await worldStore.list()});
    if(segments.length===2&&req.method==='POST'){
     const data=await bodyJson(20000);
     return json(201,await worldStore.create(data?.name,data?.custom??false));
    }
    if(segments[2]==='migrate'&&segments.length===3&&req.method==='POST'){
     const data=await bodyJson(2_500_000);
     return json(201,await worldStore.migrate(data?.world));
    }
    if(segments.length===3&&req.method==='GET')return json(200,await worldStore.get(segments[2]));
    if(segments.length===4&&segments[3]==='reconciliation-status'&&req.method==='GET')
     return json(200,await worldStore.auditReconciliation(segments[2]));
    if(segments.length===4&&req.method==='POST'){
     const data=await bodyJson(20000);
     let result;
     if(segments[3]==='commands')result=await worldStore.mutate(segments[2],data);
     else if(segments[3]==='brain-turn')result=await worldStore.decide(segments[2],data);
     else if(segments[3]==='reconcile')result=await worldStore.reconcile(segments[2]);
     else return json(404,{error:'NOT_FOUND'});
     return json(200,result);
    }
    return json(405,{error:'METHOD_NOT_ALLOWED'});
   }catch(e){const status=e.status||(e.code==='WORLD_NOT_FOUND'?404:e.code==='WORLD_ALREADY_EXISTS'||e.code==='WORLD_STALE_REVISION'||e.code==='WORLD_OPERATION_CONFLICT'?409:400);return json(status,{error:e.code||'WORLD_OPERATION_FAILED',message:e.message});}
  }
  if(url.pathname==='/api/brain/status')return json(200,bridge?bridge.status():{upstream:'wRITE',connected:false,decision_provider:false});
  if(url.pathname==='/api/brain/decide'||url.pathname==='/api/brain/feedback'){
   const isFeedback=url.pathname==='/api/brain/feedback';
   if(req.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
   if(!bridge)return json(503,{error:'UPSTREAM_NOT_CONFIGURED'});
   if(isFeedback&&typeof bridge.acknowledge!=='function')return json(503,{error:'FEEDBACK_NOT_SUPPORTED'});
   if(!isFeedback&&!bridge.status().decision_provider)return json(503,{error:'BRAIN_SELECTOR_NOT_CONFIGURED'});
   const origin=req.headers.origin;
   if(origin){try{if(new URL(origin).host!==req.headers.host)return json(403,{error:'CROSS_ORIGIN_FORBIDDEN'});}catch{return json(403,{error:'CROSS_ORIGIN_FORBIDDEN'});}}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>maxBody)return json(413,{error:'REQUEST_TOO_LARGE'});}
   try{const packet=JSON.parse(body);
    if (String(packet?.world_id??'').startsWith('srv_')) return json(403,{error:'RESERVED_WORLD_LINEAGE'});
    return json(200,await (isFeedback?bridge.acknowledge(packet):bridge.decide(packet)));
   }catch(e){return json(400,{error:e.code||(isFeedback?'BRAIN_FEEDBACK_FAILED':'BRAIN_DECISION_FAILED'),message:e.message});}
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json(405,{error:'METHOD_NOT_ALLOWED'});
  try{
   const file=resolve(root,decodeURIComponent(url.pathname).replace(/^\/+/,'' )||'index.html');
   if(file!==root&&!file.startsWith(root+sep))return json(403,{error:'FORBIDDEN'});
   const s=await stat(file);if(!s.isFile())return json(404,{error:'NOT_FOUND'});
   const data=await readFile(file);
   res.writeHead(200,{'Content-Type':(MIME[extname(file)]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-store'});
   res.end(req.method==='HEAD'?'':data);
  }catch{return json(404,{error:'NOT_FOUND'});}
 });
}
// All storage options are set before any upstream module is imported.
export async function configureMiUpstreamStorage(env=process.env){
 const upstreamRoot=resolve(env.WRITE_ROOT||'vendor/wRITE');
 const privateRoot=resolve(env.MI_WRITE_DATA_ROOT||'.beika-private/write-data');
 const indexFile=resolve(env.BRAIN_INDEX_FILE||'.beika-private/brain-native-index.json');
 if(env.BRAIN_NATIVE==='1')await ensureOwnedNativeSessions({upstreamRoot,privateRoot,indexFile});
 if(process.env.WRITE_DATA_ROOT&&resolve(process.env.WRITE_DATA_ROOT)!==privateRoot)
  throw Object.assign(new Error('米花角色腦資料目錄衝突。'),{code:'NATIVE_DATA_ROOT_CONFLICT'});
 process.env.WRITE_DATA_ROOT=privateRoot;
 return {upstreamRoot,privateRoot,indexFile};
}
export async function startBrainServer(env=process.env){
 const port=Number(env.PORT||4173);
 // Storage validation is mandatory, not an optional integration failure.
 const {indexFile}=await configureMiUpstreamStorage(env);
 let bridge=null;
 try{
  const chooser=await loadLocalDecider(env);
  if(env.BRAIN_NATIVE==='1'){
   const runtime=await loadNativeRuntime(env.WRITE_ROOT);
   bridge=createNativeBrainBridge({upstream:runtime,decider:chooser,indexFile});
  }else{
   const runtime=await loadWriteRuntime(env.WRITE_ROOT);
   bridge=createBrainBridge({upstream:runtime,decider:chooser});
  }
 }catch(e){console.error('wRITE 未就緒，仍提供原本的本地規則模擬：',e.message);}
 const worldStore=createWorldStore({root:env.WORLD_STORE_ROOT||resolve('.beika-private/worlds'),brain:bridge});
 const server=createBrainServer({bridge,worldStore});
 if(bridge?.status().mode==='native_turn'&&bridge?.status().decision_provider){
  const scheduler=createWorldAutonomyScheduler({store:worldStore});
  scheduler.start();server.on('close',()=>scheduler.stop());
 }
 return server.listen(port,'127.0.0.1',()=>console.log(`Mi preview at http://127.0.0.1:${port} (upstream=${Boolean(bridge)}, chooser=${Boolean(bridge?.status().decision_provider)})`));
}
