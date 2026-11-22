import test from 'node:test';
import assert from 'node:assert/strict';
import {makeWorld} from '../src/core/world.js';
import {makeBoundedBrainRequest} from '../src/core/brain-bridge.js';
import {loadWriteRuntime,createBrainBridge} from '../server/upstream-brain.mjs';

test('upstream wRITE runtime really processes a bounded Beika character packet',async(t)=>{
 if(!process.env.WRITE_ROOT){t.skip('wRITE checkout not present in this local test environment');return;}
 const runtime=await loadWriteRuntime(process.env.WRITE_ROOT);
 const input=makeBoundedBrainRequest(makeWorld('真實上游驗證'),'conan');
 const bridge=createBrainBridge({upstream:runtime,decider:async ({candidate_action_intents})=>({action_id:candidate_action_intents.find(x=>x.action_id==='wait')?.action_id??'reject_all'})});
 const prepared=await bridge.prepare(input);
 assert.equal(prepared.character,'江戶川柯南');
 assert.ok(prepared.candidates.some(x=>x.action_id==='wait'));
 assert.equal(prepared.perception.information_boundary?.observer_scoped,true);
 const result=await bridge.decide(input);
 assert.equal(result.action_id,'wait');
});
