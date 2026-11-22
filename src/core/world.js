import {CAST,PLACE_BY_ID} from '../data/atlas.js';
import {CANON_BEATS,CANON_ARCS} from '../data/canon.js';
import {findRoute} from './routes.js';
export const SCHEMA_VERSION=2;
const DAY=1440,MAX_LOG=400,MAX_SIGNALS=120,MAX_OFFLINE_MINUTES=7*DAY;
export function worldClock(minutes){
 const value=Math.max(0,Math.floor(minutes)),total=480+value,within=total%DAY;
 return {day:1+Math.floor(total/DAY),hour:Math.floor(within/60),minute:within%60,label:`第 ${1+Math.floor(total/DAY)} 日 ${String(Math.floor(within/60)).padStart(2,'0')}:${String(within%60).padStart(2,'0')}`};
}
function id(){return globalThis.crypto?.randomUUID?.()??`world-${Date.now()}-${Math.random().toString(36).slice(2)}`;}
function hash(value){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function randomAt(world,actor,tick){return (hash(`${world.seed}|${actor.id}|${tick}`)%10000)/10000;}
function fact(actor,value){actor.facts ||= [];if(!actor.facts.includes(value)){actor.facts.push(value);if(actor.facts.length>100)actor.facts.shift();}}
function observerStart(){return {placeId:'agency',roomId:null,history:[{placeId:'agency',minute:0}],notes:[]};}
export function makeWorld(name='新的米花世界',withCustom=false,now=Date.now()){
 const worldId=id(),clean=String(name).trim().slice(0,60)||'新的米花世界';
 const people=CAST.map(cast=>({...cast,placeId:cast.home,targetId:null,route:[],travel:null,intent:null,activity:'準備開始今天的生活',energy:cast.energy,social:60,interests:[],facts:[],relationships:{},steps:0,lastActionMinute:0,aliases:cast.id==='kaito'?['黑羽快斗']:[]}));
 if(withCustom)people.push({id:'custom',name:'自訂角色',role:'自由居民',home:'apartment',work:'park',favorite:'park',placeId:'apartment',targetId:null,route:[],travel:null,intent:null,activity:'剛搬進米花町',color:'#e7b785',curiosity:65,energy:85,social:60,interests:[],facts:[],relationships:{},steps:0,lastActionMinute:0,aliases:[]});
 return {schemaVersion:SCHEMA_VERSION,id:worldId,name:clean,createdAt:now,savedAt:now,seed:hash(worldId),minutes:0,paused:true,speed:1,area:'米花町',observer:observerStart(),people,signals:[],nextLogSeq:1,logs:[{id:`start-${worldId}`,minute:0,kind:'system',placeId:null,actorIds:[],text:`「${clean}」建立完成，世界的時間從早上八點開始。`}],completedBeatIds:[],canonEnabled:true,metadata:{source:'independent-rebuild',baseCanonEpisode:882}};
}
export function appendLog(world,kind,text,placeId=null,actorIds=[]){
 world.logs.push({id:`${world.id}:${world.nextLogSeq++}`,minute:world.minutes,kind,text,placeId,actorIds});
 if(world.logs.length>MAX_LOG)world.logs=world.logs.slice(-MAX_LOG);
}
function activeSignal(world,placeId,signalId){return world.signals.find(s=>s.placeId===placeId&&(!signalId||s.id===signalId)&&world.minutes<=s.expiresAt);}
function pendingLead(actor){
 return (actor.facts||[]).find(f=>{
  if(!f.startsWith('lead:'))return false;
  const rest=f.slice(5),[placeId,signalId]=rest.split(':');
  return PLACE_BY_ID[placeId]&&!actor.facts.includes(`checked:${signalId||placeId}`)&&!actor.facts.includes(`unverified:${signalId||placeId}`);
 });
}
function setDestination(world,actor,dest,type,reason){
 if(!PLACE_BY_ID[dest])return;
 actor.intent={type,placeId:dest,reason,startedMinute:world.minutes};
 if(dest===actor.placeId){actor.targetId=null;actor.route=[];actor.travel=null;actor.activity=reason;return;}
 const route=findRoute(actor.placeId,dest);
 actor.targetId=dest;actor.route=route.legs;actor.travel=null;actor.activity=`準備前往${PLACE_BY_ID[dest].name}`;
 appendLog(world,'decision',`${actor.name}${reason}，決定前往${PLACE_BY_ID[dest].name}。`,actor.placeId,[actor.id]);
}
function moveActor(world,actor){
 if(!actor.targetId)return false;
 if(actor.placeId===actor.targetId){actor.targetId=null;actor.route=[];actor.travel=null;return false;}
 if(!Array.isArray(actor.route)||!actor.route.length){actor.route=findRoute(actor.placeId,actor.targetId).legs;actor.travel=null;}
 const next=actor.route[0];
 if(next.from!==actor.placeId){actor.route=findRoute(actor.placeId,actor.targetId).legs;actor.travel=null;}
 const leg=actor.route[0];
 if(!leg){actor.targetId=null;return false;}
 if(!actor.travel||actor.travel.to!==leg.to)actor.travel={from:leg.from,to:leg.to,remaining:leg.minutes};
 actor.travel.remaining-=30;actor.activity=`正經由道路前往${PLACE_BY_ID[leg.to].name}`;
 actor.energy=Math.max(0,actor.energy-1);
 if(actor.travel.remaining<=0){
  actor.placeId=leg.to;actor.route.shift();actor.travel=null;
  appendLog(world,'movement',`${actor.name}抵達${PLACE_BY_ID[leg.to].name}。`,leg.to,[actor.id]);
  if(!actor.route.length){actor.targetId=null;actor.activity=`已抵達${PLACE_BY_ID[leg.to].name}`;}
 }
 return true;
}
function noticeScene(world,actor){
 const signals=world.signals.filter(s=>s.placeId===actor.placeId&&world.minutes<=s.expiresAt);
 for(const signal of signals){
  const clue=`lead:${signal.placeId}:${signal.id}`;
  if(actor.curiosity<55||actor.facts.includes(clue)||actor.facts.includes(`checked:${signal.id}`))continue;
  fact(actor,clue);
  appendLog(world,'discovery',`${actor.name}在${PLACE_BY_ID[signal.placeId].name}注意到「${signal.title}」的現場跡象，決定記下來。`,actor.placeId,[actor.id]);
  return true;
 }
 return false;
}
function investigate(world,actor,lead){
 const [placeId,signalId]=lead.slice(5).split(':');
 if(actor.placeId!==placeId)return false;
 const signal=activeSignal(world,placeId,signalId);
 if(signal){
  fact(actor,`checked:${signalId||placeId}`);actor.activity='查核現場線索並寫下記錄';
  appendLog(world,'investigation',`${actor.name}在${PLACE_BY_ID[placeId].name}核對「${signal.title}」留下的現場跡象，整理成調查記錄。`,placeId,[actor.id]);
 }else{
  fact(actor,`unverified:${signalId||placeId}`);if(!signalId)fact(actor,`checked:${placeId}`);
  actor.activity='現場查核未取得足夠證據';
  appendLog(world,'investigation',`${actor.name}走訪${PLACE_BY_ID[placeId].name}，但現場沒有足夠證據支持先前的消息，暫時保留疑問。`,placeId,[actor.id]);
 }
 actor.facts=actor.facts.filter(f=>f!==lead);
 actor.intent=null;return true;
}
function meet(world,actor,other){
 actor.relationships ||= {};actor.relationships[other.id]=Math.min(100,Math.max(-100,(actor.relationships[other.id]||0)+2));actor.social=Math.min(100,actor.social+8);
 other.relationships ||= {};other.relationships[actor.id]=Math.min(100,Math.max(-100,(other.relationships[actor.id]||0)+1));other.social=Math.min(100,other.social+3);
 actor.activity=`和${other.name}聊了幾句`;
 const shared=(actor.facts||[]).find(f=>f.startsWith('lead:')&&!other.facts.includes(f))||(other.facts||[]).find(f=>f.startsWith('lead:')&&!actor.facts.includes(f));
 if(shared){
  const from=actor.facts.includes(shared)?actor:other,to=from===actor?other:actor;
  fact(to,shared);appendLog(world,'rumor',`${from.name}在${PLACE_BY_ID[actor.placeId].name}向${to.name}提到一條尚未查證的線索。`,actor.placeId,[actor.id,other.id]);
 }else appendLog(world,'social',`${actor.name}在${PLACE_BY_ID[actor.placeId].name}遇見${other.name}，短暫聊了幾句。`,actor.placeId,[actor.id,other.id]);
}
function chooseGoal(world,actor,tick){
 const clock=worldClock(world.minutes),lead=pendingLead(actor);
 if(actor.energy<=28||(actor.intent?.type==='rest'&&actor.energy<78))return {dest:actor.home,type:'rest',reason:'因為疲倦而想休息'};
 if(clock.hour<6||clock.hour>=23)return {dest:actor.home,type:'sleep',reason:'夜深了，準備回家睡覺'};
 if(lead&&actor.curiosity>=65){const [dest]=lead.slice(5).split(':');return {dest,type:'investigate',reason:'想查證自己掌握的線索'};}
 if(clock.hour>=8&&clock.hour<17&&actor.work)return {dest:actor.work,type:'routine',reason:'依日常作息前往工作或課程'};
 const options=[actor.favorite,'park','poiro',actor.home].filter(x=>PLACE_BY_ID[x]);
 return {dest:options[Math.floor(randomAt(world,actor,tick)*options.length)],type:'leisure',reason:'想安排自己的空閒時間'};
}
function progressActor(world,actor,tick){
 if(world.minutes-(actor.lastActionMinute||0)<30)return;
 actor.lastActionMinute=world.minutes;
 if(actor.targetId){moveActor(world,actor);return;}
 const clock=worldClock(world.minutes),asleep=clock.hour<6||clock.hour>=23;
 if(actor.placeId===actor.home&&(asleep||actor.energy<=28||actor.intent?.type==='rest'&&actor.energy<78)){
  actor.intent={type:'rest',placeId:actor.home,reason:'恢復體力',startedMinute:world.minutes};
  actor.activity=asleep?'在家睡覺':'在家休息';actor.energy=Math.min(100,actor.energy+(asleep?15:11));actor.social=Math.min(100,actor.social+1);
  if(actor.energy>=78&&!asleep)actor.intent=null;
  return;
 }
 // Perception precedes investigation. One actor cannot read global event state
 // unless physically present or a nearby character passes on a rumor.
 if(noticeScene(world,actor))return;
 const lead=pendingLead(actor);
 if(lead&&lead.slice(5).split(':')[0]===actor.placeId&&actor.curiosity>=65){investigate(world,actor,lead);return;}
 actor.energy=Math.max(0,actor.energy-2);actor.social=Math.max(0,actor.social-1);
 const others=world.people.filter(p=>p.id!==actor.id&&p.placeId===actor.placeId&&!p.targetId);
 const rnd=randomAt(world,actor,tick);
 if(others.length&&rnd>.64&&actor.social<90){meet(world,actor,others[Math.floor(rnd*others.length)]);return;}
 const goal=chooseGoal(world,actor,tick);
 if(goal.dest!==actor.placeId){
  // Don't re-announce the same intent every tick; a new intent is a causal decision.
  setDestination(world,actor,goal.dest,goal.type,goal.reason);
 }else{actor.intent={type:goal.type,placeId:goal.dest,reason:goal.reason,startedMinute:world.minutes};actor.activity=rnd>.6?'留意周圍的狀況':'繼續自己的日常安排';}
}
function applyCanon(world,beat){
 if(world.completedBeatIds.includes(beat.id))return;
 const arc=CANON_ARCS.find(a=>a.id===beat.arcId);
 const participants=beat.actorIds.filter(id=>world.people.some(p=>p.id===id));
 appendLog(world,'canon',`【${arc.title}】${beat.title}。事件按照自身的時間線推進。`,beat.placeId,participants);
 world.signals.push({id:beat.id,placeId:beat.placeId,title:beat.title,createdMinute:world.minutes,expiresAt:world.minutes+2*DAY});
 if(world.signals.length>MAX_SIGNALS)world.signals=world.signals.slice(-MAX_SIGNALS);
 world.completedBeatIds.push(beat.id);
 // Events are independent of NPC positions. They create discoverable local traces;
 // nobody learns the details through an omniscient global broadcast.
 for(const actor of world.people){if(actor.placeId===beat.placeId&&!actor.targetId&&actor.curiosity>=55)noticeScene(world,actor);}
}
export function advanceWorld(snapshot,deltaMinutes){
 if(!Number.isFinite(deltaMinutes)||deltaMinutes<0)throw new Error('無效的世界時間變化');
 const world=upgradeWorld(snapshot),desired=Math.floor(deltaMinutes);if(!desired)return world;
 const endpoint=world.minutes+Math.min(desired,MAX_OFFLINE_MINUTES);
 // Event and action boundaries only: equivalent results with split and batch advances.
 for(let minute=world.minutes+1;minute<=endpoint;minute++){
  world.minutes=minute;
  if(world.canonEnabled){for(const beat of CANON_BEATS){if(beat.atMinute===minute)applyCanon(world,beat);}}
  if(minute%30===0){const tick=minute/30;for(const actor of world.people)progressActor(world,actor,tick);}
 }
 if(desired>MAX_OFFLINE_MINUTES)appendLog(world,'system','離線時間超過七天；已先補算七個遊戲日，避免無限制推進。');
 return world;
}
export function visitPlace(snapshot,destination){
 const current=upgradeWorld(snapshot),route=findRoute(current.observer.placeId,destination);
 if(!route.minutes)return current;
 let world=current;
 for(const leg of route.legs){
  world=advanceWorld(world,leg.minutes);world.observer.placeId=leg.to;
  world.observer.history.push({placeId:leg.to,minute:world.minutes});
 }
 world.observer.roomId=null;
 world.observer.history=world.observer.history.slice(-80);
 appendLog(world,'exploration',`觀察者經由${route.nodes.map(x=>PLACE_BY_ID[x].name).join(' → ')}抵達${PLACE_BY_ID[destination].name}，路程耗時 ${route.minutes} 分鐘。`,destination,[]);
 return world;
}
export function inspectRoom(snapshot,roomName){
 const current=upgradeWorld(snapshot),place=PLACE_BY_ID[current.observer.placeId];
 if(!place?.inside.includes(roomName))throw new Error('目前無法進入這個房間。');
 const world=advanceWorld(current,5);world.observer.roomId=roomName;
 const people=world.people.filter(p=>p.placeId===place.id).map(p=>p.name);
 const signals=world.signals.filter(s=>s.placeId===place.id&&world.minutes<=s.expiresAt).map(s=>s.title);
 const note={placeId:place.id,room:roomName,minute:world.minutes,people,signals};
 world.observer.notes.push(note);world.observer.notes=world.observer.notes.slice(-80);
 appendLog(world,'exploration',`觀察者在${place.name}查看${roomName}；記下了${people.length}位在此場景活動的人物及${signals.length}條尚可見的事件跡象。`,place.id,[]);
 return world;
}
export function catchUpWorld(snapshot,now=Date.now()){
 const world=upgradeWorld(snapshot),elapsed=Math.max(0,now-(world.savedAt||now));
 if(world.paused||elapsed<1000)return {...world,savedAt:now};
 const minutes=Math.min(MAX_OFFLINE_MINUTES,Math.floor(elapsed/1000)*(world.speed||1));
 const out=advanceWorld(world,minutes);out.savedAt=now;return out;
}
function validateCommon(value){
 if(!value||typeof value!=='object'||typeof value.id!=='string'||!value.id||typeof value.name!=='string'||!Array.isArray(value.people)||!Array.isArray(value.logs)||!Array.isArray(value.completedBeatIds)||!Number.isSafeInteger(value.minutes)||value.minutes<0)throw new Error('存檔結構不相容或已損壞。');
 if(value.people.length>200||value.logs.length>1000||value.name.length>60||!Number.isFinite(value.savedAt))throw new Error('存檔內容超出允許範圍。');
 for(const p of value.people){if(typeof p.id!=='string'||typeof p.name!=='string'||typeof p.placeId!=='string'||!PLACE_BY_ID[p.placeId])throw new Error('存檔含有無效的人物或位置。');}
}
export function upgradeWorld(snapshot){
 if(!snapshot||![1,2].includes(snapshot.schemaVersion))throw new Error('存檔結構不相容或已損壞。');
 validateCommon(snapshot);
 const value=structuredClone(snapshot);
 if(value.schemaVersion===1){
  value.schemaVersion=2;value.observer=observerStart();value.signals=[];value.nextLogSeq=value.logs.length;
  for(const p of value.people){p.route=[];p.travel=null;p.intent=null;p.facts ||= [];p.relationships ||= {};}
 }
 validateWorld(value);return value;
}
export function validateWorld(value){
 if(value?.schemaVersion!==SCHEMA_VERSION)throw new Error('存檔結構不相容或已損壞。');
 validateCommon(value);
 if(!Number.isSafeInteger(value.nextLogSeq)||value.nextLogSeq<0||!value.observer||!PLACE_BY_ID[value.observer.placeId]||!Array.isArray(value.observer.notes)||!Array.isArray(value.observer.history)||!Array.isArray(value.signals)||value.signals.length>MAX_SIGNALS||value.observer.notes.length>80||value.observer.history.length>80)throw new Error('存檔地圖或觀察資料有誤。');
 for(const actor of value.people){
  if(!Array.isArray(actor.facts)||actor.facts.length>100||!Array.isArray(actor.route)||!Number.isFinite(actor.energy)||actor.energy<0||actor.energy>100||!Number.isFinite(actor.social)||actor.social<0||actor.social>100||actor.targetId&&!PLACE_BY_ID[actor.targetId])throw new Error('人物狀態或行動資料有誤。');
  for(const leg of actor.route){if(!PLACE_BY_ID[leg.from]||!PLACE_BY_ID[leg.to]||!Number.isFinite(leg.minutes)||leg.minutes<=0)throw new Error('存檔移動路線錯誤。');}
 }
 for(const signal of value.signals){if(typeof signal.id!=='string'||!PLACE_BY_ID[signal.placeId]||!Number.isFinite(signal.createdMinute)||!Number.isFinite(signal.expiresAt))throw new Error('存檔事件線索有誤。');}
 return true;
}
export function toExport(world){validateWorld(world);return JSON.stringify({...world,savedAt:Date.now()},null,2);}
export function fromImport(json,now=Date.now()){
 if(typeof json!=='string'||json.length>5_000_000)throw new Error('存檔檔案過大。');
 const imported=upgradeWorld(JSON.parse(json));
 return {...imported,id:id(),name:`${imported.name}（匯入）`.slice(0,60),savedAt:now,createdAt:now};
}