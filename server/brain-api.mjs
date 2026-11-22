import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWriteRuntime,createBrainBridge,loadLocalDecider} from './upstream-brain.mjs';
import {loadNativeRuntime,createNativeBrainBridge} from './native-brain.mjs';
const MIME={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const maxBody=20_000;
// Serve only compiled/public assets. Serving the repository root could expose
// .env, private Native session indexes or the Node server source.
export function createBrainServer({root=resolve('dist'),bridge=null}={}){
 return createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
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
   try{return json(200,await (isFeedback?bridge.acknowledge(JSON.parse(body)):bridge.decide(JSON.parse(body))));}catch(e){return json(400,{error:e.code||(isFeedback?'BRAIN_FEEDBACK_FAILED':'BRAIN_DECISION_FAILED'),message:e.message});}
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
export async function startBrainServer(env=process.env){
 const port=Number(env.PORT||4173);
 let bridge=null;
 try{
  const chooser=await loadLocalDecider(env);
  if(env.BRAIN_NATIVE==='1'){
   const runtime=await loadNativeRuntime(env.WRITE_ROOT);
   bridge=createNativeBrainBridge({upstream:runtime,decider:chooser,indexFile:env.BRAIN_INDEX_FILE||resolve('.beika-private/brain-native-index.json')});
  }else{
   const runtime=await loadWriteRuntime(env.WRITE_ROOT);
   bridge=createBrainBridge({upstream:runtime,decider:chooser});
  }
 }catch(e){console.error('wRITE 未就緒，仍提供原本的本地規則模擬：',e.message);}
 return createBrainServer({bridge}).listen(port,'127.0.0.1',()=>console.log(`Mi preview at http://127.0.0.1:${port} (upstream=${Boolean(bridge)}, chooser=${Boolean(bridge?.status().decision_provider)})`));
}
