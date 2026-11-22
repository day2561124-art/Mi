import test from 'node:test';
import assert from 'node:assert/strict';
import { createMiPhase76Receipt, readMiPhase76Observations, phase76Available } from '../server/post-outcome.mjs';
import { createMiMemoryRetrievalResolver } from '../server/memory-retrieval.mjs';

const id = 'a'.repeat(64);
const selection = {
  actor_id: 'conan', actor_name: '江戶川柯南', intent: '觀察周遭', action_id: 'wait', world_minute: 0,
};
const outcome = {
  source: 'mi_server_verified', decision_id: id, actor_id: 'conan', action_id: 'wait',
  kind: 'observed', world_minute: 30, place_id: 'apartment',
};
function fakePhase76() {
  return {
    projectWorldSimulationPostOutcomeSubjectivePerception({ turn_id, selected_action_intents, action_outcomes }) {
      const experience=action_outcomes[0].character_experience;
      return { turn_id, version:'fake-canonical-phase76', projection_hash:'test-hash',
        character_experiences:[{character:selected_action_intents[0].character, experience}] };
    },
    bridgeWorldSimulationPostOutcomeSubjectiveExperienceToMemory({turn_id,selected_action_intents,post_outcome_subjective_perception_projection: projection}) {
      if (projection.turn_id !== turn_id || projection.projection_hash !== 'test-hash') throw Error('tampered source');
      const character=selected_action_intents[0].character;
      return { memory_formation_packets:[{character,perception:{other_senses:[{
        kind:'post_outcome_action_experience',action:selected_action_intents[0].intent,
        ...projection.character_experiences[0].experience,
      }]}}]};
    },
  };
}

test('Phase76 adapter accepts only settled, owned Mi action evidence', () => {
  const upstream=fakePhase76();
  assert.equal(phase76Available(upstream),true);
  const receipt=createMiPhase76Receipt({feedback:outcome,selection,upstream});
  assert.match(receipt.turn_id,/^mi_settled_[a-f0-9]{24}$/);
  const sensed=readMiPhase76Observations(receipt,upstream,'江戶川柯南 (conan)');
  assert.equal(sensed.length,1);
  assert.equal(sensed[0].performed,true);
  assert.match(sensed[0].perceived_result,/原地/);
  assert.deepEqual(receipt,createMiPhase76Receipt({feedback:outcome,selection,upstream}));
  assert.throws(()=>createMiPhase76Receipt({feedback:{...outcome,source:'mi_client_reported'},selection,upstream}),{code:'MI_PHASE76_SOURCE_INVALID'});
  assert.throws(()=>createMiPhase76Receipt({feedback:{...outcome,actor_id:'kaito'},selection,upstream}),{code:'MI_PHASE76_SOURCE_INVALID'});
  assert.throws(()=>readMiPhase76Observations(receipt,upstream,'黑羽快斗 (kaito)'),{code:'MI_PHASE76_ROLE_MISMATCH'});
  assert.throws(()=>readMiPhase76Observations({...receipt,post_outcome_subjective_perception_projection:{...receipt.post_outcome_subjective_perception_projection,projection_hash:'tampered'}},upstream,'江戶川柯南 (conan)'),/tampered/);
});

test('interrupted action never claims execution and unverified world state cannot create a receipt', () => {
  const upstream=fakePhase76();
  const feedback={...outcome,kind:'interrupted',action_id:'go:school'};
  const picked={...selection,action_id:'go:school',intent:'前往學校'};
  const receipt=createMiPhase76Receipt({feedback,selection:picked,upstream});
  const view=readMiPhase76Observations(receipt,upstream,'江戶川柯南 (conan)')[0];
  assert.equal(Object.hasOwn(view,'performed'),false);
  assert.match(view.perceived_result,/尚未完成/);
});

test('Phase63C selects a real later Phase76 subjective memory, never fresh same-turn perception',async()=>{
  const resolver=createMiMemoryRetrievalResolver();
  const record={ memory_id:`memory_${'a'.repeat(24)}`, engine_persisted_trace:true,
    source:{kind:'post_outcome_subjective_experience'},
    content:{kind:'post_outcome_action_experience',performed:true,perceived_result:'我已抵達目的地。'},
    encoded_at:'2026-01-01T00:00:00Z'};
  const input={character:'江戶川柯南 (conan)',character_state:{current_goal:'安排下一步'},
    perception:{observed:[],other_senses:[]},candidate_memory_records:[record]};
  const resolution=await resolver(input);
  assert.equal(resolution.process_occurred,true);
  assert.equal(resolution.recovered_selections[0].source_memory_ref,record.memory_id);
  assert.equal((await resolver({...input,perception:{observed:[],other_senses:[{kind:'post_outcome_action_experience'}]}})).process_occurred,false);
  assert.equal((await resolver({...input,candidate_memory_records:[{...record,source:{kind:'world_internal'}}]})).process_occurred,false);
});
