import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld } from '../src/core/world.js';
import { makeBoundedBrainRequest } from '../src/core/brain-bridge.js';
import { nativeWorldProjection, validateNativeRequest, createNativeBrainBridge } from '../server/native-brain.mjs';

function mockNative() {
  const sessions = new Map();
  const counters = { created: 0, ran: 0, synced: 0, packets: [] };
  return {
    counters,
    async beginWorldSimulationSession({ initial_world_state }) {
      const id = `session-${++counters.created}`;
      sessions.set(id, { revision: 0, state_hash: 'h0', state: initial_world_state, turns: [] });
      return { world_simulation_session_id: id };
    },
    async getWorldSimulationState(id) {
      const session = sessions.get(id); if (!session) throw new Error('Session missing');
      return structuredClone({ revision: session.revision, state_hash: session.state_hash, state: session.state });
    },
    async getWorldSimulationHistory(id) { return { turns: structuredClone(sessions.get(id).turns) }; },
    async commitWorldSimulationTurn(id, data) {
      const x = sessions.get(id);
      assert.equal(x.revision, data.expected_revision);
      assert.equal(x.state_hash, data.expected_state_hash);
      x.state = structuredClone(data.next_world_state);
      x.revision += 1; x.state_hash = `h${x.revision}`;
      x.turns.push({ turn_id: data.turn_id, event: data.event, selected_action_intents: [] });
      counters.synced += 1;
    },
    createWorldSimulationCharacterRuntimeManager({ identityResolver }) {
      return { identityResolver };
    },
    async runWorldSimulationTurn({ world_simulation_session_id, event_id }, options) {
      counters.ran += 1;
      const session = sessions.get(world_simulation_session_id);
      const e = session.state.event_queue[0];
      assert.equal(e.event_id, event_id);
      const character = e.participants[0];
      const packet = { character, perception: session.state.scenes[e.scene_id].observable_by[character], candidate_action_intents: session.state.available_actions[character], cognition: { known: session.state.characters[character].known } };
      counters.packets.push(structuredClone(packet));
      const answer = await options.characterBrain(packet);
      const action_id = typeof answer === 'string' ? null : answer.action_id;
      const adjudication = await options.causalAdjudicator({ world_state: session.state, event: e, selected_action_intents: [] });
      session.state = structuredClone(adjudication.next_world_state);
      session.revision += 1; session.state_hash = `h${session.revision}`;
      session.turns.push({ turn_id: 'turn-' + counters.ran, event: e, selected_action_intents: [{ character, action_id }] });
      return { committed: true };
    },
  };
}

function request(world, id = 'conan') { return makeBoundedBrainRequest(world, id); }

// A new world must not expose a remote clue, secrets, other actors' mind or a full state.
test('native projection uses only local observations and preserves prior native memory', () => {
  const world = makeWorld('只看自己');
  world.signals.push({ id: 'distant', placeId: 'warehouse', title: '私人秘密線索', expiresAt: 500 });
  world.signals.push({ id: 'local', placeId: 'apartment', title: '自家門口鞋印', expiresAt: 500 });
  const packet = request(world);
  const previous = { memories: { '江戶川柯南 (conan)': [{ memory_id: 'm0', content: '過去經驗' }] }, private_internal: 'engine-side' };
  const state = nativeWorldProjection(packet, previous);
  assert.match(JSON.stringify(state.scenes), /鞋印/);
  assert.doesNotMatch(JSON.stringify(state.scenes), /私人秘密線索/);
  assert.equal(state.memories['江戶川柯南 (conan)'][0].content, '過去經驗');
  assert.equal(state.event_queue[0].participants.length, 1);
  assert.equal(packet.people, undefined);
});

test('native validates candidate identity, world id, and actor sensory input', () => {
  const packet = request(makeWorld('驗證'));
  assert.equal(validateNativeRequest(packet), packet);
  assert.throws(() => validateNativeRequest({ ...packet, world_minute: -1 }), { code: 'INVALID_BRAIN_REQUEST' });
  assert.throws(() => validateNativeRequest({ ...packet, actions: [...packet.actions, packet.actions[0]] }), { code: 'INVALID_BRAIN_REQUEST' });
  assert.throws(() => validateNativeRequest({ ...packet, observer: { ...packet.observer, nearby: ['X'.repeat(500)] } }), { code: 'INVALID_BRAIN_REQUEST' });
});

test('native turns commit, survive bridge restart, and are idempotent', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mi-native-'));
  try {
    const indexFile = join(folder, 'private', 'index.json');
    const upstream = mockNative();
    const decisions = [];
    const decider = async packet => { decisions.push(packet); return { action_id: 'wait' }; };
    const world = makeWorld('回合存檔');
    const first = request(world);
    const bridge = createNativeBrainBridge({ upstream, decider, indexFile });
    const output = await bridge.decide(first);
    assert.equal(output.action_id, 'wait');
    assert.equal(output.committed, true);
    assert.equal(output.mode, 'native_turn');
    assert.equal(upstream.counters.ran, 1);
    const duplicate = await bridge.decide(first);
    assert.deepEqual(duplicate, output);
    assert.equal(upstream.counters.ran, 1);
    const record = JSON.parse(await readFile(indexFile, 'utf8'));
    assert.equal(record.worlds[world.id].last_world_minute, 0);
    const restarted = createNativeBrainBridge({ upstream, decider, indexFile });
    const same = await restarted.decide(first);
    assert.deepEqual(same, output);
    world.minutes = 30;
    const next = await restarted.decide(request(world));
    assert.equal(next.status, 'selected');
    assert.equal(upstream.counters.created, 1);
    assert.equal(upstream.counters.ran, 2);
    assert.equal(upstream.counters.synced, 1);
    assert.equal(decisions.length, 2);
    assert.ok(decisions.every(p => !JSON.stringify(p).includes('world_state')));
    assert.ok(bridge.status().durable_session_index);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('invalid decisions cannot reach Native causal adjudication or move Mi actors', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mi-native-invalid-'));
  try {
    const world = makeWorld('拒絕動作');
    const native = mockNative();
    const bridge = createNativeBrainBridge({ upstream: native, decider: async () => ({ action_id: 'teleport:now' }), indexFile: join(folder, 'index.json') });
    await assert.rejects(bridge.decide(request(world)), { code: 'BRAIN_ACTION_NOT_ALLOWED' });
    assert.equal(native.counters.ran, 1);
    assert.equal(world.people.find(x => x.id === 'conan').targetId, null);
    const withoutSelector = createNativeBrainBridge({ upstream: mockNative(), indexFile: join(folder, 'empty.json') });
    await assert.rejects(withoutSelector.decide(request(world)), { code: 'BRAIN_SELECTOR_NOT_CONFIGURED' });
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('native history refuses time rewind under same world ID', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'mi-native-rewind-'));
  try {
    const w = makeWorld('時間一致');
    w.minutes = 60;
    const b = createNativeBrainBridge({ upstream: mockNative(), decider: async () => 'reject_all', indexFile: join(folder, 'index.json') });
    assert.equal((await b.decide(request(w))).status, 'rejected');
    w.minutes = 0;
    await assert.rejects(b.decide(request(w)), { code: 'NATIVE_WORLD_TIME_REWIND' });
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('Native feedback is idempotent, scope checked, and appears as unverified actor-only evidence on next turn',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'mi-native-feedback-'));
 try{
  const upstream=mockNative(),indexFile=join(folder,'index.json');
  const bridge=createNativeBrainBridge({upstream,decider:async packet=>({action_id:'wait'}),indexFile});
  const w=makeWorld('回饋');
  const first=await bridge.decide(request(w));
  assert.match(first.decision_id,/^[a-f0-9]{64}$/);
  const payload={world_id:w.id,actor_id:'conan',decision_id:first.decision_id,action_id:'wait',kind:'observed',world_minute:30,place_id:'apartment'};
  await assert.rejects(bridge.acknowledge({...payload,kind:'arrived'}),{code:'BRAIN_FEEDBACK_INVALID'});
  await assert.rejects(bridge.acknowledge({...payload,place_id:'school'}),{code:'BRAIN_FEEDBACK_INVALID'});
  await assert.rejects(bridge.acknowledge({...payload,actor_id:'kaito'}),{code:'BRAIN_FEEDBACK_INVALID'});
  const accepted=await bridge.acknowledge(payload);
  assert.equal(accepted.accepted,true);assert.equal(accepted.duplicate,false);
  const secondAck = await bridge.acknowledge(payload);
  assert.equal(secondAck.duplicate,true);
  assert.deepEqual(secondAck.acknowledgement, accepted.acknowledgement);
  assert.equal(accepted.acknowledgement.source, 'mi_client_reported');
  assert.deepEqual(await bridge.inspectAcknowledgement({world_id:w.id,decision_id:first.decision_id}), accepted.acknowledgement);
  await assert.rejects(bridge.acknowledge({...payload,world_minute:60}),{code:'BRAIN_FEEDBACK_CONFLICT'});
  const restarted=createNativeBrainBridge({upstream,decider:async()=>({action_id:'wait'}),indexFile});
  w.minutes=60;
  const second=await restarted.decide(request(w));
  assert.equal(second.committed,true);
  const record=JSON.parse(await readFile(indexFile,'utf8')).worlds[w.id];
  assert.equal(record.feedback[0].delivered_in?.startsWith('mi_evt_'),true);
  const state=await upstream.getWorldSimulationState(record.session_id);
  const char=state.state.characters['江戶川柯南 (conan)'];
  assert.ok(char.guessed.some(x=>x.includes('本機存檔回報（未經伺服器驗證）')));
  assert.ok(!JSON.stringify(state.state.memories).includes('本機存檔回報'));
  assert.equal((await restarted.acknowledge(payload)).duplicate,true);
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('Native crash after upstream committed turn recovers from history without another brain selection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mi-native-after-commit-'));
  try {
    const upstream = mockNative(), indexFile = join(root, 'native-index.json');
    const world = makeWorld('上游已提交但橋接尚未記帳');
    let crash = true, selections = 0;
    const decider = async () => { selections++; return {action_id:'wait'}; };
    const interrupted = createNativeBrainBridge({ upstream, decider, indexFile,
      recoveryHooks: { afterNativeTurnCommit() {
        if (crash) { crash = false; throw Object.assign(new Error('restart now'),{code:'SIMULATED_POST_NATIVE_COMMIT'}); }
      } },
    });
    const input = request(world);
    await assert.rejects(interrupted.decide(input), {code:'SIMULATED_POST_NATIVE_COMMIT'});
    assert.equal(upstream.counters.ran,1);
    assert.equal(selections,1);
    const recovered = createNativeBrainBridge({upstream,decider,indexFile});
    const result = await recovered.decide(input);
    assert.equal(result.status,'selected');
    assert.equal(result.recovered,true);
    assert.equal(upstream.counters.ran,1,'no duplicate upstream Native turn');
    assert.equal(selections,1,'no duplicate NPC choice');
    const repeat = await recovered.decide(input);
    assert.deepEqual(repeat,result);
  }finally{await rm(root,{recursive:true,force:true});}
});
