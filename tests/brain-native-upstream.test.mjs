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
    // Recreate the bridge as if Node restarted; it must reconnect to the
    // already persisted Native world lineage through the private index.
    const restarted = createNativeBrainBridge({
      upstream: runtime,
      decider: async packet => { packets.push(packet); return { action_id: 'wait' }; },
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
  } finally { await rm(root, { recursive: true, force: true }); }
});
