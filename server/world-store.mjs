import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { makeWorld, upgradeWorld, validateWorld, advanceWorld, visitPlace, inspectRoom, catchUpWorld } from '../src/core/world.js';
import { makeBoundedBrainRequest, applyBrainDecision } from '../src/core/brain-bridge.js';
import { readyBrainFeedback, markBrainFeedbackDelivered } from '../src/core/brain-feedback.js';

const idRule = /^[a-zA-Z0-9_-]{8,128}$/;
const opRule = /^[a-zA-Z0-9:_-]{8,128}$/;
const clone = value => structuredClone(value);
const checksum = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Keep browser-local and server-authoritative Native sessions separate.
const serverLineage = worldId => `srv_${checksum(worldId).slice(0, 48)}`;
const error = (code, message) => Object.assign(new Error(message), { code });
const normal = value => value && typeof value === 'object' && !Array.isArray(value);
const assertId = id => { if (typeof id !== 'string' || !idRule.test(id)) throw error('INVALID_WORLD_ID', '世界識別格式錯誤'); return id; };
const assertRevision = (entry, expectedRevision, expectedHash) => {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) throw error('INVALID_WORLD_PRECONDITION', '缺少有效的版本與雜湊前提');
  if (entry.revision !== expectedRevision || entry.hash !== expectedHash) throw error('WORLD_STALE_REVISION', '世界已更新，請先重新取得目前版本');
};
const clientEntry = entry => ({ world: clone(entry.world), revision: entry.revision, hash: entry.hash });

/** Node-only local authority. Never accept a client-supplied replacement World in mutate(). */
export function createWorldStore({ root = resolve('.beika-private/worlds'), now = () => Date.now(), brain = null } = {}) {
  const directory = resolve(root);
  let queue = Promise.resolve();
  function serialized(fn) {
    const running = queue.catch(() => {}).then(fn);
    queue = running.catch(() => {});
    return running;
  }
  const path = id => join(directory, `${assertId(id)}.json`);
  async function read(id) {
    let value;
    try { value = JSON.parse(await readFile(path(id), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') throw error('WORLD_NOT_FOUND', '伺服器找不到這個世界'); throw e; }
    if (!normal(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || !Array.isArray(value.operations) || !normal(value.world)) throw error('WORLD_STORE_CORRUPTED', '伺服器存檔格式不正確');
    validateWorld(value.world);
    if (checksum(value.world) !== value.hash || value.world.id !== id) throw error('WORLD_STORE_CORRUPTED', '伺服器存檔雜湊或識別不相符');
    return value;
  }
  async function persist(id, value, { exclusive = false } = {}) {
    const file = path(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (exclusive) {
      try {
        await writeFile(file, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      } catch (e) {
        if (e.code === 'EEXIST') throw error('WORLD_ALREADY_EXISTS', '伺服器已存在同識別的世界');
        throw e;
      }
      return;
    }
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      await rename(temporary, file);
    } catch (e) { await unlink(temporary).catch(() => {}); throw e; }
  }
  const newEntry = world => ({ version: 1, revision: 0, hash: checksum(world), world, operations: [] });
  async function create(name, custom = false) {
    return serialized(async () => {
      if (typeof name !== 'string' || !name.trim() || name.length > 60 || typeof custom !== 'boolean') throw error('INVALID_WORLD_REQUEST', '世界名稱或創建選項無效');
      const world = makeWorld(name, custom, now());
      assertId(world.id);
      const entry = newEntry(world);
      await persist(world.id, entry, { exclusive: true });
      return clientEntry(entry);
    });
  }
  async function migrate(world) {
    return serialized(async () => {
      // Explicit user-controlled one-time migration. No replacement, upsert, or silent overwrite.
      const upgraded = upgradeWorld(world);
      assertId(upgraded.id);
      const serializedSize = JSON.stringify(upgraded).length;
      if (serializedSize > 2_000_000) throw error('WORLD_TOO_LARGE', '世界資料超過伺服器遷移上限');
      const entry = newEntry({ ...upgraded, savedAt: now(), paused: true, brainEnabled: false, brainOutcomes: [],
        metadata: { ...(upgraded.metadata || {}), migrated_from_client_snapshot: true, historic_client_events_unverified: true } });
      validateWorld(entry.world);
      await persist(upgraded.id, entry, { exclusive: true });
      return clientEntry(entry);
    });
  }
  async function get(id) { return clientEntry(await read(id)); }
  async function list() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const names = (await readdir(directory)).filter(name => name.endsWith('.json')).slice(0, 500);
    const worlds = [];
    for (const name of names) {
      const id = name.slice(0, -5);
      if (!idRule.test(id)) continue;
      try {
        const entry = await read(id);
        worlds.push({ id, name: entry.world.name, minutes: entry.world.minutes, savedAt: entry.world.savedAt, revision: entry.revision, remote: true });
      } catch { /* A corrupt file must not hide unrelated healthy worlds. */ }
    }
    return worlds.sort((a, b) => b.savedAt - a.savedAt);
  }
  function checkOperation(entry, operationId, fingerprint, revision, hash) {
    if (typeof operationId !== 'string' || !opRule.test(operationId)) throw error('INVALID_WORLD_OPERATION', '操作識別無效');
    const prior = entry.operations.find(item => item.id === operationId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw error('WORLD_OPERATION_CONFLICT', '相同操作識別不能套用不同內容');
      return true;
    }
    assertRevision(entry, revision, hash);
    return false;
  }
  async function commit(entry, operationId, fingerprint, updated) {
    validateWorld(updated);
    const target = { ...entry, revision: entry.revision + 1, world: updated, hash: checksum(updated), operations: [...entry.operations, { id: operationId, fingerprint }].slice(-256) };
    await persist(updated.id, target);
    return target;
  }
  const withSavedAt = world => ({ ...world, savedAt: now() });
  function applyCommand(world, type, args) {
    if (!normal(args)) throw error('INVALID_WORLD_REQUEST', '指令參數格式錯誤');
    switch (type) {
      case 'advance': {
        if (!Number.isSafeInteger(args.minutes) || args.minutes < 1 || args.minutes > 1440) throw error('INVALID_WORLD_REQUEST', '每次推進限 1 至 1440 分鐘');
        if (world.paused && args.manual !== true) throw error('WORLD_PAUSED', '世界已暫停');
        return advanceWorld(world, args.minutes);
      }
      case 'catchup': return catchUpWorld(world, now());
      case 'visit': return visitPlace(world, args.place_id);
      case 'room': return inspectRoom(world, args.room_name);
      case 'pause': if (typeof args.paused !== 'boolean') break; return { ...world, paused: args.paused };
      case 'speed': if (![1, 4, 12].includes(args.speed)) break; return { ...world, speed: args.speed };
      case 'canon': if (typeof args.enabled !== 'boolean') break; return { ...world, canonEnabled: args.enabled };
      case 'brain_enabled': if (typeof args.enabled !== 'boolean') break; return { ...world, brainEnabled: args.enabled };
      default: throw error('WORLD_COMMAND_NOT_ALLOWED', '不支援這種世界操作');
    }
    throw error('INVALID_WORLD_REQUEST', '世界操作參數錯誤');
  }
  async function mutate(id, { operation_id, expected_revision, expected_hash, type, args = {} }) {
    return serialized(async () => {
      const entry = await read(id), fingerprint = checksum({ type, args });
      if (checkOperation(entry, operation_id, fingerprint, expected_revision, expected_hash)) return { ...clientEntry(entry), duplicate: true };
      const result = withSavedAt(applyCommand(entry.world, type, args));
      const changed = await commit(entry, operation_id, fingerprint, result);
      return { ...clientEntry(changed), duplicate: false };
    });
  }
  async function decide(id, { operation_id, expected_revision, expected_hash, actor_id }) {
    return serialized(async () => {
      const entry = await read(id), fingerprint = checksum({ type: 'brain_decide', actor_id });
      if (checkOperation(entry, operation_id, fingerprint, expected_revision, expected_hash)) return { ...clientEntry(entry), duplicate: true };
      if (!brain?.status?.().decision_provider) throw error('BRAIN_SELECTOR_NOT_CONFIGURED', '原生角色腦決策提供者尚未設定');
      const packet = { ...makeBoundedBrainRequest(entry.world, actor_id), world_id: serverLineage(id) };
      if (!packet.actions.length) throw error('NO_WORLD_CANDIDATES', '角色目前沒有可以執行的候選行動');
      const selected = await brain.decide(packet);
      const next = selected?.status === 'selected' && selected?.action_id
        ? applyBrainDecision(entry.world, actor_id, selected.action_id, selected.decision_id)
        : clone(entry.world);
      const changed = await commit(entry, operation_id, fingerprint, withSavedAt(next));
      return { ...clientEntry(changed), decision: { status: selected?.status, action_id: selected?.action_id ?? null }, duplicate: false };
    });
  }
  /** Feed only server-stored, engine-settled facts to the Native adapter. */
  async function reconcile(id) {
    return serialized(async () => {
      let entry = await read(id);
      if (typeof brain?.acknowledgeAuthoritative !== 'function') return { ...clientEntry(entry), delivered: 0 };
      let delivered = 0;
      for (const feedback of readyBrainFeedback(entry.world).slice(0, 12)) {
        try {
          const ack = await brain.acknowledgeAuthoritative({ ...feedback, world_id: serverLineage(id) });
          if (ack?.accepted !== true) break;
          const updated = withSavedAt(markBrainFeedbackDelivered(entry.world, feedback.decision_id));
          entry = await commit(entry, `receipt:${feedback.decision_id}`, checksum(feedback), updated);
          delivered++;
        } catch { break; /* Persisted ready records remain available for retry. */ }
      }
      return { ...clientEntry(entry), delivered };
    });
  }
  return { create, migrate, get, list, mutate, decide, reconcile };
}
