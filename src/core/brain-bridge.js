import {registerBrainDecision} from './brain-feedback.js';
import {PLACE_BY_ID} from '../data/atlas.js';
import {findRoute} from './routes.js';

// Public, observer-bounded input. Never transmit all World State to a character brain.
export function characterActionCatalog(world, actorId) {
 const actor=world.people.find(p=>p.id===actorId);
 if(!actor)return [];
 if(actor.targetId||actor.travel||world.brainOutcomes?.some(r=>r.actorId===actor.id&&r.state==='pending'))return [];
 const actions=[{action_id:'wait',intent:'留在目前地點，觀察周圍',kind:'wait',placeId:actor.placeId}];
 const destinations=[[actor.home,'回家休息','rest'],[actor.work,'前往工作或課程','routine'],[actor.favorite,'去自己喜歡的地點','leisure']];
 for(const [dest,label,kind] of destinations){
  if(!PLACE_BY_ID[dest]||dest===actor.placeId||actions.some(a=>a.placeId===dest))continue;
  try{findRoute(actor.placeId,dest);}catch{continue;}
  actions.push({action_id:`go:${dest}`,intent:label,kind,placeId:dest});
 }
 if(actor.energy>28){
  for(const fact of (actor.facts||[]).filter(x=>x.startsWith('lead:')).slice(0,4)){
   const [dest,signalId]=fact.slice(5).split(':');
   if(!PLACE_BY_ID[dest]||!signalId||actor.facts.includes(`checked:${signalId}`)||actor.facts.includes(`unverified:${signalId}`))continue;
   try{findRoute(actor.placeId,dest);}catch{continue;}
   actions.push({action_id:`check:${signalId}`,intent:'前往已知線索所在地查證',kind:'investigate',placeId:dest});
  }
 }
 if(actor.energy<=28)return actions.filter(a=>a.kind==='wait'||a.kind==='rest');
 return actions;
}
export function makeBoundedBrainRequest(world,actorId){
 const actor=world.people.find(p=>p.id===actorId);
 if(!actor||!PLACE_BY_ID[actor.placeId])throw new Error('找不到要思考的角色。');
 const signals=(world.signals||[]).filter(s=>s.placeId===actor.placeId&&world.minutes<=s.expiresAt).slice(-8);
 const observer={
  name:actor.name,role:actor.role,place:PLACE_BY_ID[actor.placeId].name,place_id:actor.placeId,
  nearby:world.people.filter(p=>p.id!==actorId&&p.placeId===actor.placeId&&!p.travel).slice(0,12).map(p=>p.name),
  visible_traces:signals.map(s=>s.title),
  known:(actor.facts||[]).filter(s=>s.startsWith('checked:')).slice(-16).map(()=> '曾經查證過一條線索'),
  uncertain:(actor.facts||[]).filter(s=>s.startsWith('lead:')).slice(-16).map(()=> '有一條尚未查證的線索'),
  energy:actor.energy,social:actor.social,curiosity:actor.curiosity,
  relationships:Object.fromEntries(Object.entries(actor.relationships||{}).filter(([id])=>world.people.some(p=>p.id===id&&p.placeId===actor.placeId)).map(([id,score])=>[world.people.find(p=>p.id===id).name,score]))
 };
 return {world_id:world.id,actor_id:actor.id,world_minute:world.minutes,observer,actions:characterActionCatalog(world,actorId).map(a=>({action_id:a.action_id,intent:a.intent,place_id:a.placeId}))};
}
export function applyBrainDecision(snapshot,actorId,actionId,decisionId=null){
 const world=structuredClone(snapshot),actor=world.people.find(p=>p.id===actorId);
 if(!actor)throw new Error('角色不存在');
 const allowed=characterActionCatalog(world,actorId);
 const chosen=allowed.find(a=>a.action_id===actionId);
 if(!chosen)throw new Error('角色腦選擇了不在當前可行清單中的行動。');
 if(chosen.kind==='wait'){
  actor.intent={type:'observe',placeId:actor.placeId,reason:'想留意周圍情況',startedMinute:world.minutes};
  actor.activity='正在觀察周圍';actor.lastActionMinute=world.minutes;
 }else{
  const route=chosen.placeId===actor.placeId?{legs:[]}:findRoute(actor.placeId,chosen.placeId);
  actor.intent={type:chosen.kind,placeId:chosen.placeId,reason:chosen.intent,startedMinute:world.minutes,...(chosen.kind==='investigate'?{signalId:chosen.action_id.slice(6)}:{})};
  actor.targetId=chosen.placeId===actor.placeId?null:chosen.placeId;actor.route=route.legs;actor.travel=null;
  actor.activity=chosen.placeId===actor.placeId?'準備在現場處理線索':`準備前往${PLACE_BY_ID[chosen.placeId].name}`;
 }
 world.logs.push({id:`${world.id}:${world.nextLogSeq++}`,minute:world.minutes,kind:'decision',placeId:actor.placeId,actorIds:[actor.id],text:`${actor.name}自行決定：${chosen.intent}。`});
 if(world.logs.length>400)world.logs=world.logs.slice(-400);
 registerBrainDecision(world,actor,chosen,decisionId);
 return world;
}
