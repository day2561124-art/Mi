import test from 'node:test';
import assert from 'node:assert/strict';
import {makeWorld} from '../src/core/world.js';
import {makeBoundedBrainRequest} from '../src/core/brain-bridge.js';
import {nativeWorldProjection} from '../server/native-brain.mjs';
const report=(actor_id,source,id)=>({actor_id,source,decision_id:id,action_id:'wait',kind:'observed',world_minute:30,place_id:'apartment'});
test('verified consequence is only actor-owned observed evidence; Mi never writes Native memory',()=>{
 const world=makeWorld('主觀記憶');const packet=makeBoundedBrainRequest(world,'conan');
 const old={memories:{'江戶川柯南 (conan)':[ {memory_id:'prior',content:'過去經驗'}]}};
 const state=nativeWorldProjection(packet,old,[report('kaito','mi_server_verified','f'.repeat(64)),report('conan','mi_client_reported','b'.repeat(64)),report('conan','mi_server_verified','a'.repeat(64))]);
 const visual=state.scenes.mi_observation_scene.observable_by['江戶川柯南 (conan)'].visual.join(' ');
 assert.match(visual,/查閱自己的行動紀錄/);
 assert.match(visual,/米花伺服器已保存並核對/);
 assert.doesNotMatch(visual,/本機存檔回報/);
 assert.equal((visual.match(/查閱自己的行動紀錄/g)||[]).length,1);
 assert.match(state.characters['江戶川柯南 (conan)'].guessed.join(' '),/本機存檔回報/);
 assert.deepEqual(state.memories,old.memories);
 assert.deepEqual(state.event_queue[0].participants,['江戶川柯南 (conan)']);
});
test('another NPC cannot see the first NPC personal action history',()=>{
 const w=makeWorld('個人隔離');const packet=makeBoundedBrainRequest(w,'kaito');
 const projected=nativeWorldProjection(packet,{},[report('conan','mi_server_verified','c'.repeat(64))]);
 assert.doesNotMatch(JSON.stringify(projected),/米花伺服器已保存並核對/);
 assert.deepEqual(projected.event_queue[0].participants,[packet.observer.name+' ('+packet.actor_id+')']);
});
