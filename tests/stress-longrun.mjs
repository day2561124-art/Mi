import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorldStore } from '../server/world-store.mjs';
import { expectedMiAcknowledgement } from '../server/reconciliation-ledger.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pre = value => ({ expected_revision: value.revision, expected_hash: value.hash });
const command = (state, id, type, args) => ({ ...pre(state), operation_id: id, type, args });
const fail = code => Object.assign(new Error(code), { code });

// Run independently of the unit-test suite. The simulated Native inbox is
// separate from the Mi World files, and deliberately survives World restarts.
test('long-run, fault-injected multi-world Native decisions remain causally consistent', { timeout: 180_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'beika-longrun-'));
  try {
    const totalTicks = Number(process.env.BEIKA_STRESS_TICKS ?? 2000);
    if (!Number.isSafeInteger(totalTicks) || totalTicks < 1 || totalTicks > 10000) throw Error('Invalid BEIKA_STRESS_TICKS');
    let wallTime = 1_900_000_000_000;
    const inbox = new Map(), selected = new Map(), seen = new Map();
    let brainCalls = 0, acceptCalls = 0, crashAfterAck = 0, errors = 0, retries = 0;
    const brain = {
      status: () => ({ mode: 'native_turn', decision_provider: true }),
      async decide(packet) {
        brainCalls++;
        if (brainCalls % 173 === 0) { errors++; throw fail('TRANSIENT_CHARACTER_BRAIN_FAILURE'); }
        assert.match(packet.world_id, /^srv_[a-f0-9]{48}$/);
        assert.equal(Object.hasOwn(packet, 'people'), false);
        assert.equal(Object.hasOwn(packet, 'signals'), false);
        assert.ok(packet.actions.some(action => action.action_id === 'wait'));
        const id = hash([packet.world_id,packet.actor_id,packet.world_minute,'wait']);
        const owner = `${packet.world_id}:${packet.actor_id}`;
        selected.set(owner, (selected.get(owner) || 0) + 1);
        const previous = seen.get(id);
        if (previous) assert.equal(previous, owner, 'replayed decision cannot cross actors');
        seen.set(id, owner);
        return { status: 'selected', committed: true, actor_id: packet.actor_id,
          world_minute: packet.world_minute, action_id: 'wait', decision_id: id };
      },
      async acknowledgeAuthoritative(packet) {
        acceptCalls++;
        if (acceptCalls % 101 === 0) throw fail('TRANSIENT_NATIVE_INBOX_FAILURE');
        const receipt = expectedMiAcknowledgement(packet);
        const previous = inbox.get(receipt.receipt_id);
        if (previous) {
          retries++;
          assert.deepEqual(previous, receipt, 'replayed receipt content must be immutable');
        } else inbox.set(receipt.receipt_id, receipt);
        return { accepted: true, acknowledgement: receipt, duplicate: Boolean(previous) };
      },
      async inspectAcknowledgement({ world_id, decision_id }) {
        const key = expectedMiAcknowledgement({ world_id, decision_id,
          actor_id: 'placeholder', action_id: 'wait', kind: 'observed',
          world_minute: 1, place_id: 'apartment' }).receipt_id;
        return inbox.get(key) || null;
      },
    };
    const reconciliationHooks = {
      afterRemoteAck() {
        crashAfterAck++;
        if (crashAfterAck % 137 === 0) throw fail('SIMULATED_POWER_LOSS_AFTER_NATIVE_ACK');
      },
    };
    const worlds = [];
    let store = createWorldStore({ root, now: () => wallTime, brain, reconciliationHooks });
    for (let index = 0; index < 4; index++) {
      let state = await store.create(`長時間背景世界 ${index}`);
      state = await store.mutate(state.world.id, command(state, `stress-activate-${index}`, 'brain_enabled', { enabled: true }));
      state = await store.mutate(state.world.id, command(state, `stress-resume-${index}`, 'pause', { paused: false }));
      worlds.push({ id: state.world.id, ticks: 0, previousMinute: 0, previousSave: state.world.savedAt, last: state });
    }
    let restarts = 0, duplicates = 0, interruptionIncidents = 0, decisions = 0;
    for (let tick = 0; tick < totalTicks; tick++) {
      if (tick > 0 && tick % 250 === 0) console.log(`BEIKA_STRESS_PROGRESS ${tick}/${totalTicks}`);
      const w = worlds[tick % worlds.length];
      // Include backwards wall-clock jumps. Game time still advances exactly once.
      wallTime += tick % 97 === 0 ? -7_000 : 1_000;
      const before = await store.get(w.id);
      const op = `stress-step-${tick}`;
      const advanced = await store.autonomousTick(w.id, {
        ...pre(before), operation_id: op, minutes: 5, max_actors: 3,
      });
      w.ticks++;
      decisions += advanced.decisions.length;
      assert.equal(advanced.world.minutes, w.previousMinute + 5, 'world time must progress exactly once');
      assert.ok(advanced.world.savedAt >= w.previousSave, 'wall clock rollback must not regress save anchor');
      assert.ok(advanced.world.logs.length <= 400, 'bounded World event log');
      assert.ok(advanced.world.brainOutcomes.length <= 48, 'bounded pending/outcome journal');
      w.previousMinute = advanced.world.minutes;
      w.previousSave = advanced.world.savedAt;
      if (tick % 23 === 0) {
        const duplicate = await store.autonomousTick(w.id, {
          ...pre(before), operation_id: op, minutes: 5, max_actors: 3,
        });
        assert.equal(duplicate.duplicate, true);
        assert.equal(duplicate.revision, advanced.revision);
        duplicates++;
      }
      const completed = await store.reconcile(w.id);
      interruptionIncidents += completed.issues.length;
      if (tick % 11 === 0 || completed.issues.length) await store.reconcile(w.id);
      if (tick % 67 === 0) {
        store = createWorldStore({ root, now: () => wallTime, brain, reconciliationHooks });
        restarts++;
        const persisted = await store.get(w.id);
        assert.equal(persisted.world.minutes, w.previousMinute);
        assert.equal(persisted.world.savedAt, w.previousSave);
      }
    }
    for (const world of worlds) {
      for (let i = 0; i < 3; i++) await store.reconcile(world.id);
      const saved = await store.get(world.id);
      assert.equal(saved.world.minutes, world.ticks * 5);
      assert.equal(saved.world.brainOutcomes.some(record => record.state === 'ready'), false,
        'committed action must not remain stranded after recovery');
      const audit = await store.auditReconciliation(world.id);
      assert.equal(audit.issues.length, 0, 'recent World/Native receipts must reconcile');
      assert.equal(audit.ready, 0);
      assert.equal(saved.world.brainOutcomes.filter(x => x.state === 'delivered').length, audit.verified);
      assert.ok(audit.verified > 0, 'Native inbox must have acknowledged actions');
      const actorCounts = [...selected.entries()]
        .filter(([owner]) => owner.startsWith(`srv_${hash(world.id).slice(0,48)}:`))
        .map(([,count])=>count);
      assert.equal(actorCounts.length, saved.world.people.length);
      assert.ok(Math.max(...actorCounts) - Math.min(...actorCounts) < 20,
        'round-robin must not starve characters over long periods');
    }
    assert.ok(errors > 0, 'provider faults must actually be injected');
    assert.ok(interruptionIncidents > 0, 'inbox / crash faults must actually be injected');
    assert.ok(retries > 0, 'a crash must exercise repeated receipt delivery');
    assert.equal(inbox.size, seen.size,
      'every committed Native decision eventually receives one unique inbox receipt');
    console.log('BEIKA_LONGRUN_REPORT', JSON.stringify({totalTicks, worlds:worlds.length,
      gameMinutes:worlds.map(w=>w.ticks*5), decisions,
      uniqueReceipts: inbox.size, providerFaults: errors,
      injectedIncidents: interruptionIncidents, receiptRetries:retries,
      restarts, duplicateOps: duplicates}));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
