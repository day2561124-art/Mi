import test from 'node:test';
import assert from 'node:assert/strict';
import {makeWorld,advanceWorld,validateWorld} from '../src/core/world.js';
import {characterActionCatalog,makeBoundedBrainRequest,applyBrainDecision} from '../src/core/brain-bridge.js';
import {createBrainBridge} from '../server/upstream-brain.mjs';

function upstreamMock(record){
 return {
  async beginWorldSimulationSession(){return {world_simulation_session_id:'test-run'};},
  async useWorldSimulationCapability(name,{capability_input}){
   record.push({name,input:capability_input});
   const output=name==='world_perception_filter'
    ?{observed:capability_input.scene_state.observable_by[capability_input.character].visual,audible:[],other_senses:[]}
    :name==='world_character_cognition'?{known:capability_input.character_state.known,uncertain:capability_input.character_state.guessed,perception:capability_input.perception}
    :{candidate_action_intents:[...capability_input.available_actions,{action_id:'forged:move',intent:'直接瞬移'}]};
   return {ok:true,output};
  }
 };
}

test('brain request has observer-only perception, never the hidden global world state',()=>{
 let world=makeWorld('局部感知');
 world.signals.push({id:'secret',placeId:'warehouse',title:'遠方秘密事件',createdMinute:0,expiresAt:100});
 world.signals.push({id:'local',placeId:'apartment',title:'門口的腳印',createdMinute:0,expiresAt:100});
 const packet=makeBoundedBrainRequest(world,'conan');
 const raw=JSON.stringify(packet);
 assert.ok(raw.includes('門口的腳印'));
 assert.ok(!raw.includes('遠方秘密事件'));
 assert.equal(Object.hasOwn(packet,'people'),false);
 assert.equal(Object.hasOwn(packet,'signals'),false);
 assert.ok(!raw.includes('completedBeatIds'));
});

test('brain can choose only a candidate from the current feasible action set; World executes route',()=>{
 const w=makeWorld('候選行動');
 const choices=characterActionCatalog(w,'conan');
 assert.ok(choices.some(a=>a.action_id==='go:school'));
 assert.throws(()=>applyBrainDecision(w,'conan','go:warehouse'),/不在當前可行清單/);
 const next=applyBrainDecision(w,'conan','go:school');
 validateWorld(next);
 assert.equal(next.people.find(p=>p.id==='conan').placeId,'apartment');
 assert.equal(next.people.find(p=>p.id==='conan').targetId,'school');
 assert.ok(next.people.find(p=>p.id==='conan').route.length);
 assert.equal(w.people.find(p=>p.id==='conan').targetId,null);
 const moved=advanceWorld(next,30);
 assert.notEqual(moved.people.find(p=>p.id==='conan').targetId,'warehouse');
});

test('upstream modules are used for perception, cognition, and action proposals without exposing private data',async()=>{
 const calls=[],world=makeWorld('上游串接');
 let selectedPacket;
 const bridge=createBrainBridge({upstream:upstreamMock(calls),decider:async packet=>{selectedPacket=packet;return {action_id:'go:school'};}});
 const req=makeBoundedBrainRequest(world,'conan');
 const result=await bridge.decide(req);
 assert.deepEqual(calls.map(x=>x.name),['world_perception_filter','world_character_cognition','world_action_proposer']);
 assert.equal(result.action_id,'go:school');
 assert.equal(bridge.status().decision_provider,true);
 assert.ok(selectedPacket.candidate_action_intents.every(x=>x.action_id!=='forged:move'));
 assert.equal(JSON.stringify(calls).includes('world_state'),false);
 assert.equal(Object.hasOwn(selectedPacket,'world_id'),false);
});

test('upstream cannot force impossible actions or work without an actual chooser',async()=>{
 const world=makeWorld('拒絕越權');
 const input=makeBoundedBrainRequest(world,'conan');
 const noChooser=createBrainBridge({upstream:upstreamMock([])});
 await assert.rejects(noChooser.decide(input),{code:'BRAIN_SELECTOR_NOT_CONFIGURED'});
 const bridge=createBrainBridge({upstream:upstreamMock([]),decider:async()=>({action_id:'forged:move'})});
 await assert.rejects(bridge.decide(input),{code:'BRAIN_ACTION_NOT_ALLOWED'});
});

test('tired NPC cannot be sent to investigate and already moving NPC cannot be redirected',()=>{
 const w=makeWorld('合理限制');
 const actor=w.people.find(p=>p.id==='conan');
 actor.energy=18;actor.facts.push('lead:warehouse:clue-1');
 assert.ok(!characterActionCatalog(w,'conan').some(a=>a.kind==='investigate'));
 assert.throws(()=>applyBrainDecision(w,'conan','go:school'));
 actor.energy=90;
 const moving=applyBrainDecision(w,'conan','go:school');
 assert.equal(characterActionCatalog(moving,'conan').length,0);
 assert.throws(()=>applyBrainDecision(moving,'conan','wait'));
});
