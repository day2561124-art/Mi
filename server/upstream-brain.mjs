import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {access} from 'node:fs/promises';

const DEFAULT_UPSTREAM=resolve(process.cwd(),'vendor/wRITE');
// The upstream is imported directly. We do not maintain a fork of its cognition algorithms.
export async function loadWriteRuntime(root=process.env.WRITE_ROOT||DEFAULT_UPSTREAM){
 const file=join(resolve(root),'server','src','world-simulation-session-service.mjs');
 await access(file);
 const runtime=await import(pathToFileURL(file).href);
 if(typeof runtime.beginWorldSimulationSession!=='function'||typeof runtime.useWorldSimulationCapability!=='function')throw new Error('wRITE 的正式 World Simulation 入口不相容。');
 return runtime;
}

export function createBrainBridge({upstream,decider,sessionOptions={}}){
 if(!upstream||typeof upstream.beginWorldSimulationSession!=='function'||typeof upstream.useWorldSimulationCapability!=='function')throw new Error('需要真正的 wRITE capability runtime。');
 const sessions=new Map();
 let lock=Promise.resolve();
 async function session(worldId){
  if(!sessions.has(worldId)){
   sessions.set(worldId,upstream.beginWorldSimulationSession({simulation_label:'beika-brain-'+worldId,metadata:{integration:'beika-rebuild',source:'upstream-wRITE'}},sessionOptions)
    .then(x=>x.world_simulation_session_id).catch(e=>{sessions.delete(worldId);throw e;}));
  }
  return sessions.get(worldId);
 }
 async function prepare(input){
  if(!input||typeof input.world_id!=='string'||!input.world_id||typeof input.actor_id!=='string'||!input.actor_id||!Number.isSafeInteger(input.world_minute)||input.world_minute<0)throw new Error('缺少世界與角色的有效識別。');
  const p=input.observer;
  if(!p||typeof p.name!=='string'||!p.name||!Array.isArray(p.nearby)||!Array.isArray(p.visible_traces)||!Array.isArray(p.known)||!Array.isArray(p.uncertain)||!Array.isArray(input.actions)||input.actions.length>24)throw new Error('角色感知資料不相容。');
  const id=await session(input.world_id);
  const run=async(capability_name,capability_input)=>{
   const response=await upstream.useWorldSimulationCapability(capability_name,{world_simulation_session_id:id,capability_input},sessionOptions);
   if(!response.ok||!response.output)throw new Error('上游角色腦未回傳有效能力結果。');
   return response.output;
  };
  const perception=await run('world_perception_filter',{character:p.name,scene_state:{scene_id:'bounded-current-place',observable_by:{[p.name]:{visual:[`目前在${String(p.place).slice(0,80)}`,...p.nearby.slice(0,12).map(name=>`看見${String(name).slice(0,80)}`),...p.visible_traces.slice(0,8).map(s=>`現場跡象：${String(s).slice(0,160)}`)]}}}});
  const cognition=await run('world_character_cognition',{character:p.name,character_state:{known:p.known.slice(-16),guessed:p.uncertain.slice(-16),current_goal:'自主安排日常',needs:{energy:p.energy,social:p.social},relationships:p.relationships||{}},perception,recovered_memories:[]});
  const proposals=await run('world_action_proposer',{character:p.name,cognition,available_actions:input.actions.map(a=>({action_id:a.action_id,intent:a.intent}))});
  const offered=new Set(input.actions.map(a=>a.action_id));
  const candidates=(proposals.candidate_action_intents||[]).filter(a=>offered.has(a.action_id)&&!a.blocked_by?.length).map(a=>({action_id:a.action_id,intent:a.intent}));
  return {character:p.name,world_id:input.world_id,actor_id:input.actor_id,world_minute:input.world_minute,perception,cognition,candidates};
 }
 async function decide(input){
  // Session-scoped execution serializes this bridge; no double decision for a simultaneous call.
  const running=lock.catch(()=>{}).then(async()=>{
   if(typeof decider!=='function')throw Object.assign(new Error('尚未設定 Character Brain 決策提供者。'),{code:'BRAIN_SELECTOR_NOT_CONFIGURED'});
   const data=await prepare(input);
   if(!data.candidates.length)return {action_id:null,status:'no_candidate'};
   const result=await decider({character:data.character,perception:data.perception,cognition:data.cognition,candidate_action_intents:data.candidates});
   const actionId=typeof result==='string'?result:result?.action_id;
   if(actionId==='reject_all')return {action_id:null,status:'rejected'};
   if(!data.candidates.some(a=>a.action_id===actionId))throw Object.assign(new Error('角色腦回傳未被允許的行動。'),{code:'BRAIN_ACTION_NOT_ALLOWED'});
   return {action_id:actionId,status:'selected',actor_id:data.actor_id,world_minute:data.world_minute};
  });lock=running.catch(()=>{});return running;
 }
 return {prepare,decide,status:()=>({upstream:'wRITE',connected:true,decision_provider:typeof decider==='function'})};
}

export async function loadLocalDecider(env=process.env){
 if(!env.BRAIN_SELECTOR_MODULE)return null;
 const path=resolve(env.BRAIN_SELECTOR_MODULE);
 const module=await import(pathToFileURL(path).href);
 if(typeof module.default!=='function')throw new Error('BRAIN_SELECTOR_MODULE 須預設匯出 async function(packet)。');
 return module.default;
}
