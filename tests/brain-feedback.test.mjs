import test from 'node:test';
import assert from 'node:assert/strict';
import {makeWorld,advanceWorld,fromImport,validateWorld} from '../src/core/world.js';
import {applyBrainDecision,makeBoundedBrainRequest} from '../src/core/brain-bridge.js';
import {readyBrainFeedback,markBrainFeedbackDelivered} from '../src/core/brain-feedback.js';

const id=n=>String(n).padStart(64,'a');

test('a selected intent is not falsely acknowledged as a completed journey',()=>{
 const original=makeWorld('行動完成後才回饋');
 const started=applyBrainDecision(original,'conan','go:school',id(1));
 assert.equal(readyBrainFeedback(started).length,0);
 assert.equal(started.people.find(x=>x.id==='conan').placeId,'apartment');
 const after=advanceWorld(started,30);
 assert.equal(after.people.find(x=>x.id==='conan').placeId,'school');
 const [feedback]=readyBrainFeedback(after);
 assert.deepEqual(feedback,{world_id:after.id,actor_id:'conan',decision_id:id(1),action_id:'go:school',kind:'arrived',world_minute:30,place_id:'school'});
 validateWorld(after);
 const delivered=markBrainFeedbackDelivered(after,id(1));
 assert.equal(readyBrainFeedback(delivered).length,0);
 assert.equal(readyBrainFeedback(after).length,1);
});

test('investigation feedback is triggered by actor-own investigation, not an unrelated event or remote clue',()=>{
 const w=makeWorld('實際調查');
 const actor=w.people.find(x=>x.id==='conan');
 actor.placeId='warehouse';
 actor.facts.push('lead:warehouse:trace01');
 w.signals.push({id:'trace01',placeId:'warehouse',title:'可見鞋印',createdMinute:0,expiresAt:180});
 w.signals.push({id:'secret',placeId:'school',title:'不應知道的秘密',createdMinute:0,expiresAt:180});
 const req=makeBoundedBrainRequest(w,'conan');
 assert.ok(req.actions.some(a=>a.action_id==='check:trace01'));
 assert.doesNotMatch(JSON.stringify(req),/不應知道的秘密/);
 const started=applyBrainDecision(w,'conan','check:trace01',id(2));
 assert.equal(readyBrainFeedback(started).length,0);
 const after=advanceWorld(started,30);
 assert.equal(readyBrainFeedback(after)[0].kind,'investigated');
 assert.equal(readyBrainFeedback(after)[0].place_id,'warehouse');
 assert.doesNotMatch(JSON.stringify(readyBrainFeedback(after)),/秘密|鞋印/);
});

test('unconfirmed lead is not fabricated into a verified discovery',()=>{
 const w=makeWorld('空白線索');
 const actor=w.people.find(x=>x.id==='conan');actor.placeId='warehouse';actor.facts.push('lead:warehouse:expired');
 const started=applyBrainDecision(w,'conan','check:expired',id(3));
 const after=advanceWorld(started,30);
 assert.equal(readyBrainFeedback(after)[0].kind,'not_confirmed');
});

test('wait needs actual elapsed world time; imported world gets independent feedback lineage',()=>{
 const w=makeWorld('觀察');
 const started=applyBrainDecision(w,'conan','wait',id(4));
 assert.equal(readyBrainFeedback(started).length,0);
 assert.equal(readyBrainFeedback(advanceWorld(started,1))[0].kind,'observed');
 const imported=fromImport(JSON.stringify(advanceWorld(started,30)));
 assert.equal(imported.brainOutcomes.length,0);
 assert.notEqual(imported.id,w.id);
 assert.equal(imported.brainEnabled,false);
});

test('a chosen lead is not confused with a different lead in the same place',()=>{
 const w=makeWorld('定向調查');
 const actor=w.people.find(x=>x.id==='conan');actor.placeId='warehouse';
 actor.facts.push('lead:warehouse:lead1','lead:warehouse:lead2');
 w.signals.push({id:'lead1',placeId:'warehouse',title:'第一筆',createdMinute:0,expiresAt:120});
 w.signals.push({id:'lead2',placeId:'warehouse',title:'第二筆',createdMinute:0,expiresAt:120});
 const started=applyBrainDecision(w,'conan','check:lead2',id(5));
 const after=advanceWorld(started,30);
 assert.equal(after.logs.filter(x=>x.kind==='investigation'&&x.actorIds.includes('conan')).at(-1).signalId,'lead2');
 assert.ok(after.people.find(x=>x.id==='conan').facts.includes('lead:warehouse:lead1'));
 assert.equal(readyBrainFeedback(after)[0].kind,'investigated');
});
