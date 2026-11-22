import test from 'node:test';
import assert from 'node:assert/strict';
import {makeWorld,upgradeWorld,visitPlace,inspectRoom,advanceWorld,toExport,fromImport,validateWorld} from '../src/core/world.js';
import {findRoute,ROAD_EDGES} from '../src/core/routes.js';
import {PLACES,PLACE_BY_ID} from '../src/data/atlas.js';

test('every place is connected through actual road legs with positive travel cost',()=>{
 for(const place of PLACES){
  const route=findRoute('agency',place.id);
  assert.equal(route.nodes[0],'agency');assert.equal(route.nodes.at(-1),place.id);
  assert.equal(route.legs.reduce((total,leg)=>total+leg.minutes,0),route.minutes);
  for(const leg of route.legs){assert.ok(ROAD_EDGES.some(([a,b,t])=>t===leg.minutes&&(a===leg.from&&b===leg.to||a===leg.to&&b===leg.from)),`${leg.from} → ${leg.to} must be a linked street`);}
 }
 assert.throws(()=>findRoute('agency','unknown'),/找不到/);
});
test('observer exploration advances world at each intermediate stop and does not command NPCs',()=>{
 const old=makeWorld('走訪');const before=structuredClone(old.people);
 const route=findRoute('agency','hospital');const next=visitPlace(old,'hospital');
 assert.equal(next.observer.placeId,'hospital');assert.equal(next.minutes,route.minutes);
 assert.equal(next.observer.history.length,route.nodes.length);
 let elapsed=0;for(const [i,leg] of route.legs.entries()){
  elapsed+=leg.minutes;assert.deepEqual(next.observer.history[i+1],{placeId:leg.to,minute:elapsed});
 }
 assert.deepEqual(old.people,before);
 assert.ok(next.logs.some(x=>x.kind==='exploration'&&x.placeId==='hospital'));
 assert.equal(visitPlace(next,'hospital').minutes,next.minutes);
});
test('room inspection requires physical presence and writes only observed local facts',()=>{
 const first=makeWorld('室內');assert.throws(()=>inspectRoom(first,'月台'),/無法進入/);
 const station=visitPlace(first,'station');
 station.signals.push({id:'sample',title:'遺落物',placeId:'station',createdMinute:station.minutes,expiresAt:station.minutes+500});
 station.signals.push({id:'remote',title:'別處的事件',placeId:'police',createdMinute:station.minutes,expiresAt:station.minutes+500});
 const next=inspectRoom(station,'月台');
 assert.equal(next.minutes,station.minutes+5);assert.equal(next.observer.roomId,'月台');
 assert.deepEqual(next.observer.notes.at(-1).signals,['遺落物']);
 assert.equal(next.observer.notes.at(-1).placeId,'station');
 assert.equal(station.observer.roomId,null);
});
test('an NPC only notices local signals and later investigates them, no global knowledge',()=>{
 let world=makeWorld('真實查證');world.canonEnabled=false;
 const detective=world.people.find(x=>x.id==='conan');
 detective.home='agency';detective.work='agency';detective.favorite='agency';detective.placeId='agency';
 world.signals.push({id:'clue-1',title:'破掉的玻璃',placeId:'park',createdMinute:0,expiresAt:500});
 world=advanceWorld(world,60);
 assert.ok(!world.people.find(x=>x.id==='conan').facts.some(x=>x.includes('clue-1')));
 const inPerson=world.people.find(x=>x.id==='conan');inPerson.placeId='park';inPerson.targetId=null;inPerson.route=[];inPerson.travel=null;
 world=advanceWorld(world,30);
 assert.ok(world.people.find(x=>x.id==='conan').facts.includes('lead:park:clue-1'));
 world=advanceWorld(world,30);
 assert.ok(world.people.find(x=>x.id==='conan').facts.includes('checked:clue-1'));
 assert.ok(world.logs.some(x=>x.kind==='investigation'&&x.text.includes('玻璃')));
});
test('rumor can spread between co-located actors but not into remote minds',()=>{
 let w=makeWorld('傳聞');w.canonEnabled=false;
 const source=w.people.find(p=>p.id==='ran'),other=w.people.find(p=>p.id==='azusa'),remote=w.people.find(p=>p.id==='takagi');
 // Fixed small cast and schedules make the sharing opportunity reproducible.
 w.people=[source,other,remote];for(const p of w.people){p.home='agency';p.work='agency';p.favorite='agency';p.placeId='agency';p.energy=95;p.social=0;}
 source.curiosity=25;source.facts.push('lead:park:rumor');other.curiosity=65;remote.placeId='police';remote.home='police';remote.work='police';remote.favorite='police';
 w=advanceWorld(w,300);
 assert.ok(w.logs.some(x=>x.kind==='rumor'&&x.actorIds.includes('ran')),'expected a co-located rumor exchange');
 assert.ok(!w.people.find(x=>x.id==='takagi').facts.includes('lead:park:rumor'));
});
test('tired people recover during daytime when they have reached home',()=>{
 let w=makeWorld('休息');w.canonEnabled=false;
 const actor=w.people.find(p=>p.id==='conan');w.people=[actor];actor.placeId=actor.home;actor.energy=12;
 w=advanceWorld(w,30);assert.ok(w.people[0].energy>12);assert.equal(w.people[0].intent.type,'rest');
});
test('NPC route cannot skip roads even when traveling across regions',()=>{
 let w=makeWorld('移動');w.canonEnabled=false;
 const actor=w.people.find(p=>p.id==='conan');w.people=[actor];actor.placeId='agency';actor.home='agency';actor.energy=90;
 actor.targetId='yamaguchi';actor.route=[];actor.travel=null;
 let prior=actor.placeId;
 for(let tick=0;tick<16;tick++){
  w=advanceWorld(w,30);const now=w.people[0].placeId;
  if(now!==prior){assert.ok(ROAD_EDGES.some(([a,b])=>a===prior&&b===now||a===now&&b===prior),`${prior}→${now} skipped a road`);prior=now;}
 }
 assert.equal(w.people[0].placeId,'yamaguchi');
});
test('old 0.1 world upgrades in memory without losing canon progress or residents',()=>{
 const w=makeWorld('舊檔');w.schemaVersion=1;delete w.observer;delete w.signals;delete w.nextLogSeq;
 for(const p of w.people){delete p.route;delete p.travel;delete p.intent;}
 w.completedBeatIds=['conan-tv-883-884-stage-1'];
 const upgraded=upgradeWorld(w);validateWorld(upgraded);
 assert.equal(upgraded.schemaVersion,2);assert.deepEqual(upgraded.completedBeatIds,w.completedBeatIds);
 assert.equal(upgraded.people.length,w.people.length);assert.equal(upgraded.observer.placeId,'agency');
 assert.equal(w.schemaVersion,1);
 const copy=fromImport(JSON.stringify(w));assert.equal(copy.schemaVersion,2);assert.notEqual(copy.id,w.id);
 assert.doesNotThrow(()=>toExport(copy));
});
test('invalid map state in imported save is rejected',()=>{
 const w=makeWorld('損壞');w.observer.placeId='made-up';assert.throws(()=>fromImport(JSON.stringify(w)),/觀察/);
});
test('batch and split world advancement are deterministic with stable causal logs',()=>{
 const init=makeWorld('分段一致');
 let split=init;for(let i=0;i<24;i++)split=advanceWorld(split,30);
 const batch=advanceWorld(init,720);
 assert.deepEqual(split,batch);
 assert.equal(new Set(batch.logs.map(x=>x.id)).size,batch.logs.length);
});