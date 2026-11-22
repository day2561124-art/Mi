import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld } from '../src/core/world.js';
import { makeBoundedBrainRequest } from '../src/core/brain-bridge.js';
import { loadNativeRuntime, createNativeBrainBridge } from '../server/native-brain.mjs';

test('pinned wRITE Native Loop executes two committed turns with durable experience lineage', async t => {
  if (!process.env.WRITE_ROOT) return t.skip('wRITE checkout absent; GitHub upstream CI runs this test');
  const root = await mkdtemp(join(tmpdir(), 'mi-native-upstream-'));
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
    world.minutes = 30;
    const second = await native.decide(makeBoundedBrainRequest(world, 'conan'));
    assert.equal(second.committed, true);
    assert.equal(second.action_id, 'wait');
    assert.equal(packets.length, 2);
    const again = await native.decide(makeBoundedBrainRequest(world, 'conan'));
    assert.equal(again.action_id, 'wait');
    assert.equal(packets.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
