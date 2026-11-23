import { verifyMiAcknowledgement } from './reconciliation-ledger.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, open, link, unlink } from 'node:fs/promises';
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
export function createWorldStore({ root = resolve('.beika-private/worlds'), now = () => Date.now(), brain = null, reconciliationHooks = {} } = {}) {
  const directory = resolve(root);
  // Each world has an independent queue. A slow/erroring NPC brain for A
  // must not block valid writes to unrelated world B in the same process.
  const queues = new Map();
  function serialized(fn, worldKey = '_world_creation') {
    const previous = queues.get(worldKey) ?? Promise.resolve();
    const running = previous.catch(() => {}).then(fn);
    const tail = running.catch(() => {});
    queues.set(worldKey, tail);
    void tail.then(() => { if (queues.get(worldKey) === tail) queues.delete(worldKey); });
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
  // A rename is atomic for readers, but does not by itself make a write
  // durable across an OS crash. Sync the new file before publishing it; on
  // POSIX also sync the containing directory after the rename/creation.
  async function syncDirectory() {
    if (process.platform === 'win32') return; // Windows does not support directory open/fsync consistently.
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async function syncWrite(file, data) {
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(data, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
  }
  async function persist(id, value, { exclusive = false } = {}) {
    const file = path(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await syncWrite(temporary, JSON.stringify(value));
      if (exclusive) {
        // A durable temporary inode is published with an exclusive hard link.
        // A failed/partial write never becomes a visible new World, and an
        // existing World is never overwritten during create or migrate.
        try { await link(temporary, file); }
        catch (e) {
          if (e.code === 'EEXIST') throw error('WORLD_ALREADY_EXISTS', '伺服器已存在同識別的世界');
          throw e;
        }
        await unlink(temporary);
      } else {
        await rename(temporary, file);
      }
      await syncDirectory();
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
  // Clock corrections may move wall time backwards. Never regress the save
  // anchor, or future background ticks may replay already-accounted time.
  const withSavedAt = world => ({ ...world, savedAt: Math.max(world.savedAt, now()) });
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
      case 'brain_enabled': {
        if(typeof args.enabled!=='boolean')break;
        if(args.enabled && (!brain?.status?.().decision_provider||brain?.status?.().mode!=='native_turn'))
          throw error('BRAIN_SELECTOR_NOT_CONFIGURED','只有完整 Native 決策提供者就緒時才能啟用背景角色腦');
        return {...world,brainEnabled:args.enabled};
      }
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
    }, id);
  }
  async function decide(id, { operation_id, expected_revision, expected_hash, actor_id }) {
    return serialized(async () => {
      const entry = await read(id), fingerprint = checksum({ type: 'brain_decide', actor_id });
      if (checkOperation(entry, operation_id, fingerprint, expected_revision, expected_hash)) return { ...clientEntry(entry), duplicate: true };
      if (!brain?.status?.().decision_provider) throw error('BRAIN_SELECTOR_NOT_CONFIGURED', '原生角色腦決策提供者尚未設定');
      if (brain?.status?.().mode === 'native_turn' && entry.world.brainEnabled !== true)
        throw error('AUTONOMY_DISABLED', '原生角色腦決策前，必須明確啟用 Native 模式');
      if (entry.world.brainOutcomes?.some(item => item.actorId === actor_id && (item.state === 'pending' || item.state === 'ready')))
        throw error('BRAIN_OUTCOME_UNRECONCILED', '角色上一筆行動尚未結算或對帳');
      const packet = { ...makeBoundedBrainRequest(entry.world, actor_id), world_id: serverLineage(id) };
      if (!packet.actions.length) throw error('NO_WORLD_CANDIDATES', '角色目前沒有可以執行的候選行動');
      const selected = await brain.decide(packet);
      if (selected?.status === 'selected' &&
          (selected.committed !== true || selected.actor_id !== actor_id ||
          selected.world_minute !== packet.world_minute ||
          !/^[a-f0-9]{64}$/.test(selected.decision_id ?? ''))) {
        throw error('BRAIN_RESPONSE_INVALID', '原生決策尚未提交或身分與世界不符');
      }
      if (selected?.status !== 'selected' && selected?.status !== 'rejected' && selected?.status !== 'no_candidate')
        throw error('BRAIN_RESPONSE_INVALID', '原生決策未回傳可確認的狀態');
      await reconciliationHooks.afterNativeDecision?.({ world_id: id, actor_id });
      const next = selected?.status === 'selected' && selected?.action_id
        ? applyBrainDecision(entry.world, actor_id, selected.action_id, selected.decision_id)
        : clone(entry.world);
      const changed = await commit(entry, operation_id, fingerprint, withSavedAt(next));
      return { ...clientEntry(changed), decision: { status: selected?.status, action_id: selected?.action_id ?? null }, duplicate: false };
    }, id);
  }
  /** Bounded round-robin multi-NPC step. Only the server may select the World state
   * and apply the consequences; Native chooses intents through its own runtime. */
  async function autonomousTick(id, {
    operation_id, expected_revision, expected_hash, minutes = 10, max_actors = 3,
  } = {}) {
    return serialized(async () => {
      const entry = await read(id);
      const fingerprint = checksum({ type: 'native_autonomy_tick', minutes, max_actors });
      if (checkOperation(entry, operation_id, fingerprint, expected_revision, expected_hash)) {
        return { ...clientEntry(entry), duplicate: true, decisions: [], failures: [] };
      }
      if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 120
          || !Number.isSafeInteger(max_actors) || max_actors < 1 || max_actors > 4)
        throw error('INVALID_AUTONOMY_STEP', '角色背景回合超出允許時間或角色數量');
      if (entry.world.paused || entry.world.brainEnabled !== true)
        throw error('AUTONOMY_DISABLED', '世界已暫停或未啟用原生角色腦');
      if (brain?.status?.().mode !== 'native_turn' || brain?.status?.().decision_provider !== true)
        throw error('BRAIN_SELECTOR_NOT_CONFIGURED', '角色決策提供者未就緒');
      let next = clone(entry.world);
      const people = next.people;
      const priorCursor = next.metadata?.nativeCursor;
      const start = people.length && Number.isSafeInteger(priorCursor) && priorCursor >= 0
        ? priorCursor % people.length : 0;
      const decisions = [], failures = [];
      let visited = 0;
      while (visited < people.length && decisions.length < max_actors) {
        const actor = people[(start + visited) % people.length];
        visited++;
        // A prior action must settle before another Brain choice. This also
        // avoids rerunning cognition for actors that are still on the road.
        if (actor.targetId || actor.travel || next.brainOutcomes?.some(r =>
          r.actorId === actor.id && ['pending','ready'].includes(r.state))) continue;
        const request = makeBoundedBrainRequest(next, actor.id);
        if (!request.actions.length) continue;
        try {
          const selected = await brain.decide({ ...request, world_id: serverLineage(id) });
          if (selected?.status !== 'selected' || !selected.action_id) continue;
          if (selected.committed !== true || selected.actor_id !== actor.id || selected.world_minute !== next.minutes
              || !/^[a-f0-9]{64}$/.test(selected.decision_id ?? ''))
            throw error('BRAIN_RESPONSE_INVALID', '角色決策身分、時間或憑證不符合目前世界');
          // applyBrainDecision rechecks the exact World-available candidate.
          next = applyBrainDecision(next, actor.id, selected.action_id, selected.decision_id);
          decisions.push({ actor_id: actor.id, action_id: selected.action_id,
            decision_id: selected.decision_id });
        } catch (e) {
          // One NPC provider failure must not stop other actors or World time.
          failures.push({ actor_id: actor.id, code: String(e?.code || 'BRAIN_PROVIDER_FAILED').slice(0, 80) });
        }
      }
      next.metadata = { ...next.metadata, nativeCursor: people.length ? (start + visited) % people.length : 0 };
      next = withSavedAt(advanceWorld(next, minutes));
      const committed = await commit(entry, operation_id, fingerprint, next);
      return { ...clientEntry(committed), duplicate: false, decisions, failures };
    }, id);
  }
  /** Write-ahead outbox is the committed World.brainOutcomes ready record.
   * A Native acknowledgement is persisted first, then the World marks delivery.
   * A crash between those commits is repaired by replaying the same bounded
   * evidence; Native must return the same immutable receipt on duplicate.
   */
  async function reconcile(id) {
    return serialized(async () => {
      let entry = await read(id);
      const issues = [];
      if (typeof brain?.acknowledgeAuthoritative !== 'function') {
        return { ...clientEntry(entry), delivered: 0, pending: readyBrainFeedback(entry.world).length,
          issues: [{ code: 'BRAIN_FEEDBACK_UNAVAILABLE' }] };
      }
      let delivered = 0;
      for (const feedback of readyBrainFeedback(entry.world).slice(0, 12)) {
        const input = { ...feedback, world_id: serverLineage(id) };
        try {
          const ack = await brain.acknowledgeAuthoritative(input);
          if (ack?.accepted !== true) throw error('MI_RECEIPT_NOT_ACCEPTED', '上游尚未接受這項行動結果');
          const proof = verifyMiAcknowledgement(input, ack.acknowledgement);
          // Test-only fault boundary: simulates process termination after
          // Native's durable ACK but before the local World commit.
          await reconciliationHooks.afterRemoteAck?.({ world_id: id, decision_id: feedback.decision_id });
          const updated = markBrainFeedbackDelivered(entry.world, feedback.decision_id, proof);
          entry = await commit(entry, `receipt:${feedback.decision_id}`, checksum(feedback), updated);
          delivered++;
        } catch (e) {
          issues.push({ decision_id: feedback.decision_id,
            code: String(e?.code || 'MI_RECONCILIATION_INTERRUPTED').slice(0, 80) });
          continue; // Quarantine one receipt; other NPC receipts can still reconcile.
        }
      }
      return { ...clientEntry(entry), delivered, pending: readyBrainFeedback(entry.world).length, issues };
    }, id);
  }
  /** Audit already delivered records against the durable Native inbox.
   * Returns only bounded status, no private character memory or World truth.
   * Missing receipts are reported, not silently fabricated or deleted.
   */
  async function auditReconciliation(id) {
    return serialized(async () => {
      const entry = await read(id), issues = [];
      let verified = 0, legacy = 0, ready = 0;
      const outcomes = entry.world.brainOutcomes || [];
      for (const record of outcomes) {
        if (record.state === 'ready') { ready++; continue; }
        if (record.state !== 'delivered') continue;
        if (!record.acknowledgement) {
          legacy++;
          issues.push({ decision_id: record.decisionId, code: 'MI_LEGACY_UNPROVEN_DELIVERY' });
          continue;
        }
        const input = { ...record.outcome, world_id: serverLineage(id),
          actor_id: record.actorId, decision_id: record.decisionId, action_id: record.actionId };
        try {
          verifyMiAcknowledgement(input, record.acknowledgement);
          if (typeof brain?.inspectAcknowledgement !== 'function') {
            issues.push({ decision_id: record.decisionId, code: 'MI_NATIVE_AUDIT_UNAVAILABLE' });
            continue;
          }
          const observed = await brain.inspectAcknowledgement({
            world_id: serverLineage(id), decision_id: record.decisionId,
          });
          if (!observed) {
            issues.push({ decision_id: record.decisionId, code: 'MI_NATIVE_RECEIPT_MISSING' });
            continue;
          }
          verifyMiAcknowledgement(input, observed);
          verified++;
        } catch (e) {
          issues.push({ decision_id: record.decisionId,
            code: String(e?.code || 'MI_NATIVE_AUDIT_FAILED').slice(0, 80) });
        }
      }
      return { world_id: id, revision: entry.revision, ready, verified, legacy, issues };
    }, id);
  }
  return { create, migrate, get, list, mutate, decide, autonomousTick, reconcile, auditReconciliation };
}
