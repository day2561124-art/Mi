import {PLACES,CAST,PLACE_BY_ID} from '../data/atlas.js';
import {CANON_BEATS,CANON_ARCS} from '../data/canon.js';
export const SCHEMA_VERSION=1;
const MINUTES_PER_DAY=1440;
const MAX_LOG=300;
const MAX_OFFLINE_MINUTES=7*MINUTES_PER_DAY;
export function worldClock(minutes){
 const value=Math.max(0,Math.floor(minutes));
 const total=480+value;
 const day=1+Math.floor(total/MINUTES_PER_DAY);
 const within=total%MINUTES_PER_DAY;
 return {day,hour:Math.floor(within/60),minute:within%60,label:`第 ${day} 日 ${String(Math.floor(within/60)).padStart(2,'0')}:${String(within%60).padStart(2,'0')}`};
}
function id(){return globalThis.crypto?.randomUUID?.()??`world-${Date.now()}-${Math.random().toString(36).slice(2)}`;}
function hash(value){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function randomAt(world,actor,tick){return (hash(`${world.seed}|${actor.id}|${tick}`)%10000)/10000;}
export function makeWorld(name='新的米花世界',withCustom=false,now=Date.now()){
 const worldId=id();const clean=String(name).trim().slice(0,60)||'新的米花世界';
 const people=CAST.map((cast,index)=>({
  ...cast,placeId:cast.home,targetId:null,activity:'準備開始今天的生活',energy:cast.energy,social:60,
  interests:[],facts:[],relationships:{},steps:0,lastActionMinute:0,
  // actors have one identity; aliases aren't extra NPC objects
  aliases:cast.id==='kaito'?['黑羽快斗']:[]
 }));
 if(withCustom)people.push({id:'custom',name:'自訂角色',role:'自由居民',home:'apartment',work:'park',favorite:'park',placeId:'apartment',targetId:null,activity:'剛搬進米花町',color:'#e7b785',curiosity:65,energy:85,social:60,interests:[],facts:[],relationships:{},steps:0,lastActionMinute:0,aliases:[]});
 return {schemaVersion:SCHEMA_VERSION,id:worldId,name:clean,createdAt:now,savedAt:now,seed:hash(worldId),minutes:0,paused:true,speed:1,area:'米花町',people,logs:[{id:`start-${worldId}`,minute:0,kind:'system',placeId:null,actorIds:[],text:`「${clean}」建立完成，世界的時間從早上八點開始。`}],completedBeatIds:[],canonEnabled:true,metadata:{source:'independent-rebuild',baseCanonEpisode:882}};
}
export function appendLog(world,kind,text,placeId=null,actorIds=[]){
 world.logs.push({id:`${world.minutes}-${world.logs.length}-${kind}`,minute:world.minutes,kind,text,placeId,actorIds});
 if(world.logs.length>MAX_LOG)world.logs=world.logs.slice(-MAX_LOG);
}
function chooseGoal(world,actor,tick){
 const clock=worldClock(world.minutes);
 if(actor.energy<=25 || clock.hour<6 || clock.hour>=23)return {dest:actor.home,activity:'打算回家休息'};
 const nearbyLeads=actor.facts.filter(x=>x.startsWith('lead:'));
 if(nearbyLeads.length && actor.curiosity>=70){
  const recent=nearbyLeads[0].split(':')[1];
  if(PLACE_BY_ID[recent])return {dest:recent,activity:'打算查證先前聽說的線索'};
 }
 if(clock.hour>=8 && clock.hour<17 && actor.work)return {dest:actor.work,activity:'前往日常工作或課程'};
 const options=[actor.favorite,'park','poiro',actor.home].filter(x=>PLACE_BY_ID[x]);
 return {dest:options[Math.floor(randomAt(world,actor,tick)*options.length)],activity:'安排一段自己的空閒時間'};
}
function progressActor(world,actor,tick){
 if(world.minutes-actor.lastActionMinute<30)return;
 const clock=worldClock(world.minutes);actor.lastActionMinute=world.minutes;
 if(actor.targetId && actor.targetId!==actor.placeId){
  const source=PLACE_BY_ID[actor.placeId],target=PLACE_BY_ID[actor.targetId];
  if(!source||!target){actor.targetId=null;return;}
  // Crossing between regions takes multiple ticks, instead of teleporting on event activation.
  const travelTicks=source.area===target.area?1:3;
  actor.steps=(actor.steps||0)+1;
  actor.activity=`正在前往${target.name}`;
  actor.energy=Math.max(0,actor.energy-2);
  if(actor.steps>=travelTicks){actor.placeId=target.id;actor.targetId=null;actor.steps=0;actor.activity=`來到了${target.name}`;appendLog(world,'movement',`${actor.name}來到了${target.name}。`,target.id,[actor.id]);}
  return;
 }
 const isSleeping=clock.hour<6||clock.hour>=23;
 if(isSleeping && actor.placeId===actor.home){actor.activity='在家休息';actor.energy=Math.min(100,actor.energy+14);return;}
 if(actor.energy<25){actor.targetId=actor.home;actor.activity='有些疲倦，決定回去休息';return;}
 const others=world.people.filter(p=>p.id!==actor.id&&p.placeId===actor.placeId);
 const rnd=randomAt(world,actor,tick);
 if(others.length && rnd>.52 && actor.social<90){
  const other=others[Math.floor(rnd*others.length)];const curr=actor.relationships[other.id]||0;
  actor.relationships[other.id]=Math.max(-100,Math.min(100,curr+2));actor.social=Math.min(100,actor.social+8);
  actor.activity=`和${other.name}聊了幾句`;
  appendLog(world,'social',`${actor.name}在${PLACE_BY_ID[actor.placeId]?.name||'附近'}遇見${other.name}，短暫聊了幾句。`,actor.placeId,[actor.id,other.id]);
  return;
 }
 actor.energy=Math.max(0,actor.energy-3);
 actor.social=Math.max(0,actor.social-2);
 if(actor.facts.some(f=>f===`lead:${actor.placeId}`)){
  actor.facts=actor.facts.filter(f=>f!==`lead:${actor.placeId}`);
  const fact=`checked:${actor.placeId}`;if(!actor.facts.includes(fact))actor.facts.push(fact);
  actor.activity='核對了線索與現場狀況';
  appendLog(world,'investigation',`${actor.name}到現場比對先前的消息，留下了自己的調查筆記。`,actor.placeId,[actor.id]);
  return;
 }
 const {dest,activity}=chooseGoal(world,actor,tick);
 if(dest!==actor.placeId){actor.targetId=dest;actor.steps=0;actor.activity=activity;}
 else actor.activity=rnd>.6?'留意著周圍的動靜':'繼續手上的日常事務';
}
function applyCanon(world,beat){
 if(world.completedBeatIds.includes(beat.id))return;
 const arc=CANON_ARCS.find(a=>a.id===beat.arcId);
 // Canon events don't forcibly move arbitrary player-created characters or all involved actors.
 const participants=beat.actorIds.filter(id=>world.people.some(p=>p.id===id));
 appendLog(world,'canon',`【${arc.title}】${beat.title}。事件按照自身的時間線推進。`,beat.placeId,participants);
 for(const actor of world.people){
  if(participants.includes(actor.id) && actor.placeId===beat.placeId){
   const fact=`event:${beat.id}`;if(!actor.facts.includes(fact))actor.facts.push(fact);
  }else if(actor.curiosity>=75 && actor.placeId===beat.placeId && !participants.includes(actor.id)){
   const clue=`lead:${beat.placeId}`;if(!actor.facts.includes(clue))actor.facts.push(clue);
  }
 }
 world.completedBeatIds.push(beat.id);
}
export function advanceWorld(snapshot,deltaMinutes){
 if(!Number.isFinite(deltaMinutes)||deltaMinutes<0)throw new Error('無效的世界時間變化');
 const world=structuredClone(snapshot);const desired=Math.floor(deltaMinutes);if(!desired)return world;
 const endpoint=world.minutes+Math.min(desired,MAX_OFFLINE_MINUTES);const start=world.minutes;
 // Events are triggered only once as time crosses their anchors, including offline catch-up.
 for(let minute=start+1;minute<=endpoint;minute++){
  world.minutes=minute;
  if(world.canonEnabled){for(const beat of CANON_BEATS){if(beat.atMinute===minute)applyCanon(world,beat);}}
  if(minute%30===0){const tick=Math.floor(minute/30);for(const actor of world.people)progressActor(world,actor,tick);}
 }
 if(desired>MAX_OFFLINE_MINUTES)appendLog(world,'system','離線時間超過七天；已先補算七個遊戲日，避免無限制推進。');
 return world;
}
export function catchUpWorld(snapshot,now=Date.now()){
 const elapsed=Math.max(0,now-(snapshot.savedAt||now));
 if(snapshot.paused || elapsed<1000)return {...snapshot,savedAt:now};
 const minutes=Math.min(MAX_OFFLINE_MINUTES,Math.floor(elapsed/1000)*(snapshot.speed||1));
 const out=advanceWorld(snapshot,minutes);
 out.savedAt=now;return out;
}
export function validateWorld(value){
 if(!value||typeof value!=='object'||value.schemaVersion!==SCHEMA_VERSION||typeof value.id!=='string'||typeof value.name!=='string'||!Array.isArray(value.people)||!Array.isArray(value.logs)||!Array.isArray(value.completedBeatIds)||!Number.isInteger(value.minutes)||value.minutes<0)throw new Error('存檔結構不相容或已損壞。');
 if(value.people.length>200||value.logs.length>1000||value.name.length>60)throw new Error('存檔內容超出允許範圍。');
 for(const p of value.people){if(typeof p.id!=='string'||typeof p.name!=='string'||typeof p.placeId!=='string'||!PLACE_BY_ID[p.placeId])throw new Error('存檔含有無效的人物或位置。');}
 return true;
}
export function toExport(world){validateWorld(world);return JSON.stringify({...world,savedAt:Date.now()},null,2);}
export function fromImport(json,now=Date.now()){
 if(typeof json!=='string'||json.length>5_000_000)throw new Error('存檔檔案過大。');
 const imported=JSON.parse(json);validateWorld(imported);
 return {...imported,id:id(),name:`${imported.name}（匯入）`.slice(0,60),savedAt:now,createdAt:now};
}