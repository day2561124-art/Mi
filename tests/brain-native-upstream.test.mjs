import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeWorld } from '../src/core/world.js';
import { makeBoundedBrainRequest } from '../src/core/brain-bridge.js';
import { loadNativeRuntime, createNativeBrainBridge } from '../server/native-brain.mjs';

test('pinned wRITE Native Loop executes two committed turns with durable experience lineage', async t => {
  if (!process.env.WRITE_ROOT) return t.skip('wRITE checkout absent; GitHub upstream CI runs this test');
  // wRITE only admits fixture roots beneath its own checked-out project.
  const parent = join(process.env.WRITE_ROOT, 'tests', '.tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'mi-native-upstream-'));
  try {
    const runtime = await loadNativeRuntime(process.env.WRITE_ROOT);
    const world = makeWorld('上游原生回合');
    const packets = [];
    const native = createNativeBrainBridge({
      upstream: runtime,
      decider: async packet => {
        packets.push(packet);
        assert.ok(Array.isArray(packet.candidate_action_intents));
        assert.equal(Object.hasOwn(packet, 'world_state'), false);
        assert.equal(Object.hasOwn(packet, 'world_simulation_session_id'), false);
        return { action_id: 'wait' };
      },
      sessionOptions: { fixtureRoot: join(root, 'upstream') },
      indexFile: join(root, 'private-index.json'),
    });
    const first = await native.decide(makeBoundedBrainRequest(world, 'conan'));
    assert.equal(first.committed, true);
    assert.equal(first.action_id, 'wait');
    assert.match(first.decision_id,/^[a-f0-9]{64}$/);
    const receipt=await native.acknowledge({world_id:world.id,actor_id:'conan',decision_id:first.decision_id,action_id:'wait',kind:'observed',world_minute:1,place_id:'apartment'});
    assert.equal(receipt.accepted,true);
    // Recreate the bridge as if the Node process was restarted. Its session
    // index must reconnect to the already persisted Native world lineage.
    const restarted = createNativeBrainBridge({
      upstream: runtime,
      decider: async packet => {
        packets.push(packet);
        return { action_id: 'wait' };
      },
      sessionOptions: { fixtureRoot: join(root, 'upstream') },
      indexFile: join(root, 'private-index.json'),
    });
    world.minutes = 30;
    const second = await restarted.decide(makeBoundedBrainRequest(world, 'conan'));
    assert.equal(second.committed, true);
    assert.equal(second.action_id, 'wait');
    assert.equal(packets.length, 2);
    assert.match(JSON.stringify(packets[1]),/本機存檔回報/);
    const index = JSON.parse(await readFile(join(root, 'private-index.json'), 'utf8'));
    const sessionId = index.worlds[world.id].session_id;
    assert.equal(index.worlds[world.id].feedback[0].delivered_in?.startsWith('mi_evt_'),true);
    const history = await runtime.getWorldSimulationHistory(sessionId, { fixtureRoot: join(root, 'upstream') });
    assert.equal(history.turns.filter(turn => (turn.selected_action_intents || []).length > 0).length, 2);
    const again = await restarted.decide(makeBoundedBrainRequest(world, 'conan'));
    assert.equal(again.action_id, 'wait');
    assert.equal(packets.length, 2);
    assert.match(JSON.stringify(packets[1]),/本機存檔回報/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('pinned Native loop receives only server-committed Mi outcome after authoritative World tick', async t => {
  if (!process.env.WRITE_ROOT) return t.skip('真實 wRITE checkout 只在 GitHub upstream CI 提供');
  const { createWorldStore } = await import('../server/world-store.mjs');
  const parent = join(process.env.WRITE_ROOT, 'tests', '.tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'mi-authoritative-native-'));
  try {
    const upstream = await loadNativeRuntime(process.env.WRITE_ROOT);
    const packets = [];
    const native = createNativeBrainBridge({
      upstream,
      decider: async packet => { packets.push(structuredClone(packet)); return { action_id: 'wait' }; },
      sessionOptions: { fixtureRoot: join(root, 'upstream') },
      indexFile: join(root, 'native-index.json'),
    });
    const store = createWorldStore({ root: join(root, 'worlds'), brain: native });
    let state = await store.create('伺服器真實回饋');
    const worldId = state.world.id;
    const call = (previous, operation_id, type, args) => store.mutate(worldId, {
      operation_id, expected_revision: previous.revision, expected_hash: previous.hash, type, args,
    });
    state = await call(state, 'native-unpause', 'pause', { paused: false });
    const first = await store.decide(worldId, {
      operation_id: 'server-native-decision-1', expected_revision: state.revision,
      expected_hash: state.hash, actor_id: 'conan',
    });
    assert.equal(first.decision.action_id, 'wait');
    assert.equal(first.world.brainOutcomes[0].state, 'pending');
    const progressed = await call(first, 'server-native-step-1', 'advance', { minutes: 30, manual: true });
    assert.equal(progressed.world.brainOutcomes[0].state, 'ready');
    const delivered = await store.reconcile(worldId);
    assert.equal(delivered.delivered, 1);
    assert.equal(delivered.world.brainOutcomes[0].state, 'delivered');
    const second = await store.decide(worldId, {
      operation_id: 'server-native-decision-2', expected_revision: delivered.revision,
      expected_hash: delivered.hash, actor_id: 'conan',
    });
    assert.equal(second.decision.action_id, 'wait');
    assert.equal(packets.length, 2);
    assert.match(JSON.stringify(packets[1]), /米花伺服器已保存並核對的歷史行動紀錄/);
    assert.doesNotMatch(JSON.stringify(packets[1]), /未經伺服器驗證/);
    const index = JSON.parse(await readFile(join(root, 'native-index.json'), 'utf8'));
    assert.equal(index.worlds[Object.keys(index.worlds)[0]].feedback[0].source, 'mi_server_verified');
    assert.equal(index.worlds[Object.keys(index.worlds)[0]].feedback[0].delivered_in?.startsWith('mi_evt_'), true);
    const third = await store.decide(worldId, {
      operation_id: 'server-native-decision-2', expected_revision: delivered.revision,
      expected_hash: delivered.hash, actor_id: 'conan',
    });
    assert.equal(third.duplicate, true);
    assert.equal(packets.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
