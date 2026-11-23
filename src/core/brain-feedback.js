// Mi-local consequence journal. This is not wRITE's authoritative World
// Experience Receipt: these observations originate in the browser's save.
const MAX_RECORDS=48;
const MAX_AGE=7*1440;
const COMPLETED=new Set(['observed','arrived','investigated','not_confirmed','interrupted']);
const clone=value=>structuredClone(value);

export function registerBrainDecision(world,actor,chosen,decisionId){
 if(!decisionId)return world; // Legacy direct-capability decisions remain compatible.
 if(!/^[a-f0-9]{32,64}$/.test(decisionId))throw new Error('無效的角色腦決策憑證。');
 world.brainOutcomes ||= [];
 if(world.brainOutcomes.some(x=>x.decisionId===decisionId))throw new Error('角色腦決策憑證重複。');
 if(world.brainOutcomes.length>=MAX_RECORDS){
  world.brainOutcomes=world.brainOutcomes.filter(x=>x.state!=='delivered');
  if(world.brainOutcomes.length>=MAX_RECORDS)throw new Error('尚有過多未完成或未同步的角色結果，請先完成同步。');
 }
 world.brainOutcomes.push({
  decisionId,actorId:actor.id,actionId:chosen.action_id,kind:chosen.kind,
  startedMinute:world.minutes,originPlaceId:actor.placeId,
  destinationId:chosen.placeId,state:'pending',outcome:null,
 });
 return world;
}
function finish(record,kind,minute,placeId){
 record.state='ready';record.outcome={kind,world_minute:minute,place_id:placeId};
}
export function settleBrainOutcomes(world){
 if(!Array.isArray(world.brainOutcomes))return world;
 for(const record of world.brainOutcomes){
  if(record.state!=='pending')continue;
  const actor=world.people.find(p=>p.id===record.actorId);
  if(!actor)continue;
  const logs=world.logs.filter(l=>l.minute>record.startedMinute&&l.actorIds?.includes(record.actorId));
  const investigation=logs.find(l=>l.kind==='investigation'&&l.placeId===record.destinationId&&l.signalId===record.actionId.slice(6));
  const arrival=logs.find(l=>l.kind==='movement'&&l.placeId===record.destinationId);
  if(record.kind==='wait'){
   if(world.minutes>record.startedMinute)finish(record,'observed',record.startedMinute+1,record.originPlaceId);
  }else if(record.kind==='investigate'){
   if(investigation)finish(record,actor.facts.includes(`checked:${record.actionId.slice(6)}`)?'investigated':'not_confirmed',investigation.minute,record.destinationId);
  }else if(arrival){
   finish(record,'arrived',arrival.minute,record.destinationId);
  }
  if(record.state==='pending'&&world.minutes-record.startedMinute>MAX_AGE){
   finish(record,'interrupted',world.minutes,actor.placeId);
  }
 }
 return world;
}
export function readyBrainFeedback(world){
 return (world.brainOutcomes||[]).filter(x=>x.state==='ready'&&x.outcome&&COMPLETED.has(x.outcome.kind)).map(x=>({
  world_id:world.id,actor_id:x.actorId,decision_id:x.decisionId,
  action_id:x.actionId,...x.outcome,
 }));
}
export function markBrainFeedbackDelivered(snapshot,decisionId,acknowledgement=null){
 const world=clone(snapshot);
 const record=(world.brainOutcomes||[]).find(x=>x.decisionId===decisionId);
 if(!record||record.state!=='ready')throw new Error('找不到等待回饋的角色行動結果。');
 record.state='delivered';
 if(acknowledgement)record.acknowledgement=structuredClone(acknowledgement);
 return world;
}
