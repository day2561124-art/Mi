import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorldStore } from '../server/world-store.mjs';
import { expectedMiAcknowledgement } from '../server/reconciliation-ledger.mjs';
import { createWorldAutonomyScheduler } from '../server/world-scheduler.mjs';
import { advanceWorld, makeWorld } from '../src/core/world.js';
import { characterActionCatalog, makeBoundedBrainRequest } from '../src/core/brain-bridge.js';

const workspace = async fn => {
  const root = await mkdtemp(join(tmpdir(), 'beika-autonomy-'));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
};
const pre = state => ({ expected_revision: state.revision, expected_hash: state.hash });
const command = (state, id, type, args) => ({ ...pre(state), operation_id: id, type, args });
const key = (packet, number) => createHash('sha256').update(`${packet.world_id}|${packet.actor_id}|${packet.world_minute}|${number}`).digest('hex');

function nativeMock({failActor = null, choose = () => 'wait'} = {}) {
  const seen = [], received = [];
  const brain = {
    status: () => ({ mode: 'native_turn', decision_provider: true }),
    decide: async request => {
      seen.push(request);
      assert.match(request.world_id, /^srv_[a-f0-9]{48}$/);
      assert.equal(Object.hasOwn(request, 'people'), false);
      assert.equal(Object.hasOwn(request, 'signals'), false);
      if (request.actor_id === failActor) throw Object.assign(new Error('intentional NPC failure'), { code: 'ACTOR_BRAIN_OFFLINE' });
      const action_id = choose(request);
      assert.ok(request.actions.some(a => a.action_id === action_id));
      return { status: 'selected', committed: true, actor_id: request.actor_id, world_minute: request.world_minute, action_id,
        decision_id: key(request, seen.length) };
    },
    acknowledgeAuthoritative: async input => { received.push(input); return { accepted: true, acknowledgement: expectedMiAcknowledgement(input) }; },
  };
  return { brain, seen, received };
}

async function active(store, name = '背景運行') {
  let state = await store.create(name);
  state = await store.mutate(state.world.id, command(state, 'activate-native', 'brain_enabled', { enabled: true }));
  state = await store.mutate(state.world.id, command(state, 'resume-native', 'pause', { paused: false }));
  return state;
}

test('Native multi-NPC World step commits multiple separate choices, advances physics, and reopens', () => workspace(async root => {
  const { brain, seen } = nativeMock({ choose: packet => packet.actor_id === 'conan' ? 'go:agency' : 'wait' });
  const store = createWorldStore({ root, brain });
  let state = await active(store);
  const worldId = state.world.id;
  const first = await store.autonomousTick(worldId, { ...pre(state), operation_id: 'autonomy-step-1', minutes: 30, max_actors: 3 });
  assert.equal(first.duplicate, false);
  assert.equal(first.decisions.length, 3);
  assert.equal(new Set(first.decisions.map(d => d.actor_id)).size, 3);
  assert.equal(first.world.minutes, 30);
  assert.equal(first.world.metadata.nativeCursor, 3);
  assert.ok(first.world.brainOutcomes.length >= 3);
  assert.ok(first.world.logs.some(x => x.kind === 'decision' && x.actorIds.includes('conan')));
  assert.equal(first.world.logs.filter(x => x.kind === 'decision').length, 3, 'rules cannot issue extra actor intentions in Native mode');
  const recovered = await createWorldStore({ root, brain }).get(worldId);
  assert.deepEqual(recovered.world, first.world);
  const same = await store.autonomousTick(worldId, { ...pre(state), operation_id: 'autonomy-step-1', minutes: 30, max_actors: 3 });
  assert.equal(same.duplicate, true);
  assert.equal(seen.length, 3);
  await assert.rejects(store.autonomousTick(worldId, { ...pre(state), operation_id: 'autonomy-step-1', minutes: 60, max_actors: 3 }), { code: 'WORLD_OPERATION_CONFLICT' });
  await assert.rejects(store.autonomousTick(worldId, { ...pre(state), operation_id: 'autonomy-step-2', minutes: 30, max_actors: 3 }), { code: 'WORLD_STALE_REVISION' });
  state = first;
  const next = await store.autonomousTick(worldId, { ...pre(state), operation_id: 'autonomy-step-3', minutes: 30, max_actors: 3 });
  assert.ok(next.decisions.some(d => !first.decisions.some(previous => previous.actor_id === d.actor_id)));
  assert.equal(next.world.metadata.nativeCursor, 6);
}));

test('World decision mode does not generate scripted goals while the brain is in control', () => {
  const snapshot = makeWorld('Core scheduler isolation');
  const normal = advanceWorld(snapshot, 30);
  snapshot.brainEnabled = true;
  const native = advanceWorld(snapshot, 30);
  assert.equal(native.logs.filter(x => x.kind === 'decision').length, 0);
  assert.ok(normal.people.some(x => x.targetId) || normal.logs.some(x => x.kind === 'decision'));
  assert.ok(native.people.every(x => !x.targetId));
});

test('Native scheduler isolates a failing actor, then delivers only committed outcomes', () => workspace(async root => {
  const { brain, seen, received } = nativeMock({ failActor: 'conan' });
  const store = createWorldStore({ root, brain });
  const state = await active(store);
  const first = await store.autonomousTick(state.world.id, { ...pre(state), operation_id: 'with-failing-actor', minutes: 30, max_actors: 2 });
  assert.equal(first.failures.length, 1);
  assert.equal(first.failures[0].actor_id, 'conan');
  assert.equal(first.decisions.length, 2);
  assert.ok(first.world.minutes === 30);
  assert.equal(first.world.logs.filter(x => x.kind === 'decision').length, 2);
  const ack = await store.reconcile(state.world.id);
  assert.equal(ack.delivered, 2);
  assert.equal(received.length, 2);
  assert.ok(received.every(x => x.kind === 'observed'));
  assert.equal(seen.length, 3);
  assert.ok((await store.get(state.world.id)).world.brainOutcomes.every(x => x.state === 'delivered'));
}));

test('World scheduler runs without browser tab, rotates worlds, honors pause and disallows overlap', () => workspace(async root => {
  let time = 1_900_000_000_000;
  const { brain, seen } = nativeMock();
  const store = createWorldStore({ root, now: () => time, brain });
  const first = await active(store, 'A');
  const second = await active(store, 'B');
  const third = await store.create('暫停的世界');
  const scheduler = createWorldAutonomyScheduler({ store, now: () => time, maxWorlds: 2, maxActors: 2 });
  try {
    let result = await scheduler.tickOnce();
    assert.equal(result.processed, 0, 'no wall time elapsed');
    time += 10_000;
    result = await scheduler.tickOnce();
    assert.equal(result.processed, 2);
    assert.equal(seen.length, 4);
    assert.equal((await store.get(first.world.id)).world.minutes, 10);
    assert.equal((await store.get(second.world.id)).world.minutes, 10);
    assert.equal((await store.get(third.world.id)).world.minutes, 0);
    scheduler.start(); assert.equal(scheduler.running, true);
    scheduler.stop(); assert.equal(scheduler.running, false);
    time += 12_000;
    result = await scheduler.tickOnce();
    assert.equal(result.processed, 2);
    assert.equal((await store.get(first.world.id)).world.minutes, 22);
    assert.equal((await store.get(second.world.id)).world.minutes, 22);
  } finally { scheduler.stop(); }
}));

test('Native mode cannot be enabled without a configured Native chooser', () => workspace(async root => {
  const store = createWorldStore({ root });
  const created = await store.create('角色腦未就緒');
  await assert.rejects(store.mutate(created.world.id, command(created, 'attempt-enable', 'brain_enabled', { enabled: true })), { code: 'BRAIN_SELECTOR_NOT_CONFIGURED' });
  const still = await store.get(created.world.id);
  assert.equal(still.revision, created.revision);
  assert.equal(still.world.brainEnabled, undefined);
  await assert.rejects(store.autonomousTick(created.world.id, { ...pre(created), operation_id: 'attempt-step', minutes: 30 }), { code: 'AUTONOMY_DISABLED' });
}));

test('While NPC action pending, planner is not allowed to issue competing intents', () => {
  const world = makeWorld('同角色不可同時做兩件事');
  const actor = world.people[0];
  world.brainOutcomes = [{ actorId: actor.id, state: 'pending', decisionId: 'a'.repeat(64) }];
  assert.deepEqual(characterActionCatalog(world, actor.id), []);
  assert.deepEqual(makeBoundedBrainRequest(world, actor.id).actions, []);
});

test('Slow Character Brain on world A does not block independent world B writes', () => workspace(async root => {
  let resolveStarted, releaseBrain;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const gate = new Promise(resolve => { releaseBrain = resolve; });
  const { brain } = nativeMock();
  const normalDecide = brain.decide;
  let delayedWorldId = null;
  brain.decide = async packet => {
    if (packet.world_id === delayedWorldId) {
      resolveStarted();
      await gate;
    }
    return normalDecide(packet);
  };
  const store = createWorldStore({ root, brain });
  const worldA = await active(store, 'Slow A');
  const worldB = await active(store, 'Independent B');
  const crypto = await import('node:crypto');
  delayedWorldId = 'srv_' + crypto.createHash('sha256').update(JSON.stringify(worldA.world.id)).digest('hex').slice(0, 48);
  const blocked = store.autonomousTick(worldA.world.id, { ...pre(worldA), operation_id: 'slow-native-a', minutes: 30, max_actors: 1 });
  await started;
  try {
    const b = await Promise.race([
      store.mutate(worldB.world.id, command(worldB, 'write-b-while-a-blocked', 'advance', { minutes: 15, manual: true })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('World B blocked by World A')), 250)),
    ]);
    assert.equal(b.world.minutes, 15);
    assert.equal((await store.get(worldA.world.id)).world.minutes, 0);
  } finally { releaseBrain(); }
  const a = await blocked;
  assert.equal(a.world.minutes, 30);
}));

test('Scheduler prevents overlapping scans and lets World B finish while World A Native brain waits', () => workspace(async root => {
  let time = 1_900_000_000_000;
  const { brain } = nativeMock();
  let release, signalReady;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { signalReady = resolve; });
  let blockedLineage = null;
  const ordinary = brain.decide;
  brain.decide = async packet => {
    if (packet.world_id === blockedLineage) { signalReady(); await gate; }
    return ordinary(packet);
  };
  const store = createWorldStore({ root, now: () => time, brain });
  const a = await active(store, 'A blocked cognition');
  const b = await active(store, 'B free cognition');
  blockedLineage = 'srv_' + createHash('sha256').update(JSON.stringify(a.world.id)).digest('hex').slice(0, 48);
  const scheduler = createWorldAutonomyScheduler({ store, now: () => time, maxWorlds: 2, maxActors: 1 });
  time += 10_000;
  const inProgress = scheduler.tickOnce();
  await ready;
  try {
    const duplicate = await scheduler.tickOnce();
    assert.equal(duplicate.skipped, 'busy');
    const bProgress = await Promise.race([
      (async () => {
        for (let i = 0; i < 20; i++) {
          const snapshot = await store.get(b.world.id);
          if (snapshot.world.minutes >= 10) return snapshot;
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        throw new Error('B failed to progress while A was waiting');
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('B was blocked by A')), 250)),
    ]);
    assert.equal(bProgress.world.minutes, 10);
    assert.equal((await store.get(a.world.id)).world.minutes, 0);
  } finally { release(); }
  const result = await inProgress;
  assert.equal(result.processed, 2);
  assert.equal((await store.get(a.world.id)).world.minutes, 10);
}));
