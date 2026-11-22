import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld } from '../src/core/world.js';
import { createWorldStore } from '../server/world-store.mjs';
import { createBrainServer } from '../server/brain-api.mjs';

const temp = async fn => {
  const root = await mkdtemp(join(tmpdir(), 'beika-server-world-'));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
};
const precondition = value => ({ expected_revision: value.revision, expected_hash: value.hash });
const operation = (value, id, type, args = {}) => ({ ...precondition(value), operation_id: id, type, args });

test('authoritative world creates, survives a fresh service instance, and preserves local saves during migration', () => temp(async root => {
  const file = join(root, 'worlds');
  const first = createWorldStore({ root: file });
  const created = await first.create('米花伺服器世界');
  assert.equal(created.revision, 0);
  assert.match(created.hash, /^[a-f0-9]{64}$/);
  assert.equal((await first.list())[0].id, created.world.id);
  const reopened = await createWorldStore({ root: file }).get(created.world.id);
  assert.deepEqual(reopened, created);
  const local = makeWorld('原本裝置的世界');
  local.brainEnabled = true;
  local.brainOutcomes = [{ decisionId: 'a'.repeat(64), actorId: 'conan', actionId: 'wait', kind: 'wait', startedMinute: 0, originPlaceId: 'apartment', destinationId: 'apartment', state: 'ready', outcome: { kind: 'observed', world_minute: 1, place_id: 'apartment' } }];
  const migrated = await first.migrate(local);
  assert.equal(migrated.world.id, local.id);
  assert.equal(migrated.world.paused, true);
  assert.equal(migrated.world.brainEnabled, false);
  assert.deepEqual(migrated.world.brainOutcomes, []);
  assert.equal(migrated.world.metadata.historic_client_events_unverified, true);
  assert.equal(local.paused, true);
  await assert.rejects(first.migrate(local), { code: 'WORLD_ALREADY_EXISTS' });
  assert.equal((await first.list()).length, 2);
}));

test('world commands are server-executed with strict compare-and-swap, duplicate safety and restart replay', () => temp(async root => {
  const store = createWorldStore({ root });
  const initial = await store.create('不可寫入偽造成功');
  const id = initial.world.id;
  const one = await store.mutate(id, operation(initial, 'command-0001', 'advance', { minutes: 60, manual: true }));
  assert.equal(one.revision, 1);
  assert.equal(one.world.minutes, 60);
  assert.ok(one.world.logs.some(l => l.minute <= 60));
  const replay = await createWorldStore({ root }).mutate(id, operation(initial, 'command-0001', 'advance', { minutes: 60, manual: true }));
  assert.equal(replay.duplicate, true);
  assert.equal(replay.world.minutes, 60);
  await assert.rejects(store.mutate(id, operation(initial, 'command-0001', 'advance', { minutes: 120, manual: true })), { code: 'WORLD_OPERATION_CONFLICT' });
  await assert.rejects(store.mutate(id, operation(initial, 'command-0002', 'advance', { minutes: 60, manual: true })), { code: 'WORLD_STALE_REVISION' });
  await assert.rejects(store.mutate(id, operation(one, 'command-0003', 'overwrite', { world: { ...one.world, minutes: 999 } })), { code: 'WORLD_COMMAND_NOT_ALLOWED' });
  assert.equal((await store.get(id)).world.minutes, 60);
  const changed = await store.mutate(id, operation(one, 'command-0004', 'visit', { place_id: 'poiro' }));
  assert.equal(changed.world.observer.placeId, 'poiro');
  assert.ok(changed.world.minutes > one.world.minutes);
}));

test('concurrent commands serialize and reject one stale writer', () => temp(async root => {
  const store = createWorldStore({ root });
  const initial = await store.create('版本競態');
  const inputA = operation(initial, 'concurrent-a', 'advance', { minutes: 30, manual: true });
  const inputB = operation(initial, 'concurrent-b', 'advance', { minutes: 30, manual: true });
  const results = await Promise.allSettled([store.mutate(initial.world.id, inputA), store.mutate(initial.world.id, inputB)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter(x => x.status === 'rejected' && x.reason.code === 'WORLD_STALE_REVISION').length, 1);
  assert.equal((await store.get(initial.world.id)).world.minutes, 30);
}));

test('server-derived consequence is delivered to Native adapter only after actual world progress', () => temp(async root => {
  const receipts = [];
  let shouldFail = true;
  const brain = {
    status: () => ({ decision_provider: true }),
    decide: async request => {
      assert.equal(request.actor_id, 'conan');
      assert.equal(request.world_minute, 0);
      assert.ok(!JSON.stringify(request).includes('private-world-secret'));
      return { status: 'selected', action_id: 'wait', decision_id: 'a'.repeat(64) };
    },
    acknowledgeAuthoritative: async feedback => {
      receipts.push(feedback);
      if (shouldFail) throw new Error('simulated Native outage');
      return { accepted: true };
    },
  };
  const store = createWorldStore({ root, brain });
  const first = await store.create('真正的世界後果');
  const id = first.world.id;
  const selected = await store.decide(id, { ...precondition(first), operation_id: 'brain-decision-1', actor_id: 'conan' });
  assert.equal(selected.decision.action_id, 'wait');
  assert.equal(selected.world.brainOutcomes[0].state, 'pending');
  assert.equal((await store.reconcile(id)).delivered, 0);
  assert.equal(receipts.length, 0);
  const advanced = await store.mutate(id, operation(selected, 'advance-after-brain-1', 'advance', { minutes: 30, manual: true }));
  assert.equal(advanced.world.brainOutcomes[0].state, 'ready');
  assert.equal((await store.reconcile(id)).delivered, 0);
  assert.equal((await store.get(id)).world.brainOutcomes[0].state, 'ready');
  shouldFail = false;
  const committed = await createWorldStore({ root, brain }).reconcile(id);
  assert.equal(committed.delivered, 1);
  assert.equal(committed.world.brainOutcomes[0].state, 'delivered');
  assert.deepEqual(receipts.at(-1), {
    world_id: receipts.at(-1).world_id, actor_id: 'conan', decision_id: 'a'.repeat(64), action_id: 'wait',
    kind: 'observed', world_minute: 1, place_id: 'apartment',
  });
  assert.match(receipts.at(-1).world_id, /^srv_[a-f0-9]{48}$/);
  assert.notEqual(receipts.at(-1).world_id, id);
  assert.equal((await store.reconcile(id)).delivered, 0);
  assert.equal((await store.get(id)).revision, committed.revision);
}));

test('corrupted authority snapshot fails closed, without changing other worlds', () => temp(async root => {
  const store = createWorldStore({ root });
  const a = await store.create('A'), b = await store.create('B');
  const file = join(root, `${a.world.id}.json`);
  const original = JSON.parse(await readFile(file, 'utf8'));
  original.world.minutes = 999;
  await writeFile(file, JSON.stringify(original));
  await assert.rejects(store.get(a.world.id), { code: 'WORLD_STORE_CORRUPTED' });
  assert.equal((await store.list()).length, 1);
  assert.equal((await store.get(b.world.id)).world.name, 'B');
}));

test('HTTP world endpoint validates origin, JSON payload, stale revision and does not expose private records', () => temp(async root => {
  const dist = join(root, 'dist'); await mkdir(dist); await writeFile(join(dist, 'index.html'), 'Public only');
  const store = createWorldStore({ root: join(root, 'private-worlds') });
  const server = createBrainServer({ root: dist, worldStore: store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const options = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await fetch(url + '/api/worlds', { ...options({ name: 'X' }), headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await fetch(url + '/api/worlds', { method: 'POST', body: 'name=bad' })).status, 415);
    const response = await fetch(url + '/api/worlds', options({ name: 'HTTP 世界' }));
    assert.equal(response.status, 201);
    const created = await response.json();
    const endpoint = `${url}/api/worlds/${created.world.id}`;
    assert.equal((await fetch(endpoint)).status, 200);
    assert.equal((await fetch(url + '/api/worlds')).status, 200);
    const changed = await fetch(endpoint + '/commands', options(operation(created, 'http-command-001', 'advance', { minutes: 5, manual: true })));
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).world.minutes, 5);
    const stale = await fetch(endpoint + '/commands', options(operation(created, 'http-command-002', 'advance', { minutes: 3, manual: true })));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, 'WORLD_STALE_REVISION');
    const malicious = await fetch(endpoint + '/commands', options({ ...operation(created, 'http-command-003', 'overwrite'), world: { minutes: 100000 } }));
    assert.equal(malicious.status, 409); // stale check rejects before command application
    assert.equal((await fetch(url + '/private-worlds/' + created.world.id + '.json')).status, 404);
    assert.equal((await fetch(url + '/api/worlds/../../server/native-brain.mjs')).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
}));
