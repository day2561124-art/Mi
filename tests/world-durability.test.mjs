import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorldStore } from '../server/world-store.mjs';

const workspace = async fn => {
  const root = await mkdtemp(join(tmpdir(), 'beika-durability-'));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
};
const command = (state, id, type, args) => ({ operation_id: id,
  expected_revision: state.revision, expected_hash: state.hash, type, args });

test('server World save anchor never rewinds with wall-clock correction, including after restart', () => workspace(async root => {
  let clock = 1_900_000_100_000;
  let store = createWorldStore({ root, now: () => clock });
  let state = await store.create('時鐘回撥驗收');
  const id = state.world.id;
  const savedAt = state.world.savedAt;
  state = await store.mutate(id, command(state, 'forward-physical-clock', 'advance', { minutes: 30, manual: true }));
  assert.equal(state.world.savedAt, savedAt);
  clock -= 60_000;
  state = await store.mutate(id, command(state, 'backwards-physical-clock', 'advance', { minutes: 30, manual: true }));
  assert.equal(state.world.minutes, 60);
  assert.equal(state.world.savedAt, savedAt, 'rollback must not change simulation catchup anchor');
  store = createWorldStore({ root, now: () => clock });
  const reopened = await store.get(id);
  assert.equal(reopened.world.savedAt, savedAt);
  assert.equal(reopened.world.minutes, 60);
  clock = savedAt + 2_000;
  state = await store.mutate(id, command(reopened, 'wall-clock-recovered', 'advance', { minutes: 5, manual: true }));
  assert.equal(state.world.savedAt, clock);
  assert.equal(state.world.minutes, 65);
}));

test('exclusive world creation and restart preserve a complete private file without temporary debris', () => workspace(async root => {
  const store = createWorldStore({ root });
  const created = await store.create('持久化原子建檔');
  const again = await createWorldStore({ root }).get(created.world.id);
  assert.deepEqual(again, created);
  await assert.rejects(store.migrate(created.world), { code: 'WORLD_ALREADY_EXISTS' });
  assert.deepEqual(await createWorldStore({ root }).get(created.world.id), created,
    'failed duplicate migration must never replace existing World');
  assert.deepEqual(await readdir(root), [`${created.world.id}.json`], 'no orphaned temporary files');
  if (process.platform !== 'win32') {
    const file = await stat(join(root, `${created.world.id}.json`));
    assert.equal(file.mode & 0o777, 0o600, 'world file must not be group/world readable');
  }
}));
