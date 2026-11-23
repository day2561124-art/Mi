import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorldStore } from '../server/world-store.mjs';
import { expectedMiAcknowledgement, verifyMiAcknowledgement } from '../server/reconciliation-ledger.mjs';

async function workspace(fn) {
  const root = await mkdtemp(join(tmpdir(), 'beika-reconcile-'));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const pre = x => ({ expected_revision: x.revision, expected_hash: x.hash });
const command = (state, id, type, args) => ({ ...pre(state), operation_id: id, type, args });
const decisionId = 'a'.repeat(64);

function brainInbox() {
  const journal = new Map();
  let tries = 0, badReply = false, outage = false;
  return {
    journal,
    get tries() { return tries; },
    setBadReply(value) { badReply = value; },
    setOutage(value) { outage = value; },
    status: () => ({ mode: 'native_turn', decision_provider: true }),
    decide: async packet => ({ status: 'selected', committed: true,
      actor_id: packet.actor_id, world_minute: packet.world_minute, action_id: 'wait', decision_id: decisionId }),
    async acknowledgeAuthoritative(packet) {
      tries++;
      if (outage) throw Object.assign(new Error('upstream interrupted'), { code: 'NATIVE_UNAVAILABLE' });
      const ack = expectedMiAcknowledgement(packet);
      const prior = journal.get(ack.receipt_id);
      if (prior && prior.evidence_hash !== ack.evidence_hash)
        throw Object.assign(new Error('same receipt changed'), { code: 'NATIVE_RECEIPT_CONFLICT' });
      if (!prior) journal.set(ack.receipt_id, ack);
      return { accepted: true, duplicate: Boolean(prior), acknowledgement: badReply
        ? { ...ack, evidence_hash: '0'.repeat(64) } : ack };
    },
    async inspectAcknowledgement({ world_id, decision_id }) {
      const id = expectedMiAcknowledgement({world_id, decision_id, actor_id: 'conan',
        action_id: 'wait', kind: 'observed', world_minute: 1, place_id: 'apartment'}).receipt_id;
      return journal.get(id) || null;
    },
  };
}

async function ready(store) {
  let state = await store.create('測試對帳');
  const id = state.world.id;
  state = await store.mutate(id, command(state, 'enable-native-001', 'brain_enabled', { enabled: true }));
  state = await store.decide(id, { ...pre(state), operation_id: 'native-decision-001', actor_id: 'conan' });
  assert.equal(state.world.brainOutcomes[0].state, 'pending');
  state = await store.mutate(id, command(state, 'advance-native-001', 'advance', { minutes: 30, manual: true }));
  assert.equal(state.world.brainOutcomes[0].state, 'ready');
  return state;
}

test('cross-system receipt binds actor, world, decision, evidence and source', () => {
  const packet = { world_id:'srv_'+'a'.repeat(48), actor_id:'conan', decision_id:decisionId,
    action_id:'wait', kind:'observed', world_minute:1, place_id:'apartment' };
  const ack = expectedMiAcknowledgement(packet);
  assert.deepEqual(verifyMiAcknowledgement(packet, ack), ack);
  assert.deepEqual(expectedMiAcknowledgement(packet), ack);
  for (const change of [{ actor_id:'kaito' }, { world_id:'srv_'+'b'.repeat(48) },
    { kind:'arrived' }, { place_id:'school' }, { world_minute:2 }, { action_id:'go:school' }]) {
    assert.throws(() => verifyMiAcknowledgement({ ...packet, ...change }, ack), { code:'MI_RECEIPT_MISMATCH' });
  }
  assert.throws(() => verifyMiAcknowledgement(packet, { ...ack, evidence_hash:'f'.repeat(64) }), { code:'MI_RECEIPT_MISMATCH' });
  assert.notEqual(expectedMiAcknowledgement(packet,'mi_client_reported').evidence_hash, ack.evidence_hash);
});

test('a crash AFTER durable Native acknowledgement and BEFORE World commit resumes without duplicate inbox writes', () => workspace(async root => {
  const brain = brainInbox();
  let failOnce = true;
  const store = createWorldStore({ root, brain, reconciliationHooks: {
    afterRemoteAck: () => { if (failOnce) { failOnce = false; throw Object.assign(new Error('power loss'), {code:'SIMULATED_POWER_LOSS'}); } },
  }});
  const previous = await ready(store), id = previous.world.id;
  const first = await store.reconcile(id);
  assert.equal(first.delivered, 0);
  assert.equal(first.pending, 1);
  assert.deepEqual(first.issues.map(x => x.code), ['SIMULATED_POWER_LOSS']);
  assert.equal(brain.journal.size, 1, 'Native has already committed its acknowledgement');
  assert.equal((await store.get(id)).revision, previous.revision, 'World must stay ready');
  const restarted = createWorldStore({ root, brain });
  const second = await restarted.reconcile(id);
  assert.equal(second.delivered, 1);
  assert.equal(second.pending, 0);
  assert.equal(brain.tries, 2, 'exact same acknowledgement was retried');
  assert.equal(brain.journal.size, 1, 'only one durable Native entry exists');
  assert.equal(second.world.brainOutcomes[0].state, 'delivered');
  assert.ok(second.world.brainOutcomes[0].acknowledgement);
  assert.deepEqual(await restarted.auditReconciliation(id), {
    world_id:id, revision:second.revision, ready:0, verified:1, legacy:0, issues:[],
  });
  const third = await restarted.reconcile(id);
  assert.equal(third.delivered, 0);
  assert.equal(brain.tries, 2);
}));

test('Native outage BEFORE acknowledgement leaves a durable World outbox for restart retry', () => workspace(async root => {
  const brain = brainInbox(); brain.setOutage(true);
  const store = createWorldStore({ root, brain });
  const previous = await ready(store), id = previous.world.id;
  const first = await store.reconcile(id);
  assert.equal(first.delivered, 0);
  assert.equal(first.pending, 1);
  assert.equal(first.issues[0].code, 'NATIVE_UNAVAILABLE');
  assert.equal(brain.journal.size, 0);
  brain.setOutage(false);
  const resumed = createWorldStore({ root, brain });
  assert.equal((await resumed.reconcile(id)).delivered, 1);
  assert.equal((await resumed.auditReconciliation(id)).verified, 1);
}));

test('forged / mismatched Native receipts never mark World outcomes delivered', () => workspace(async root => {
  const brain = brainInbox(); brain.setBadReply(true);
  const store = createWorldStore({ root, brain });
  const old = await ready(store), id = old.world.id;
  const failed = await store.reconcile(id);
  assert.equal(failed.delivered, 0);
  assert.equal(failed.issues[0].code, 'MI_RECEIPT_MISMATCH');
  assert.equal((await store.get(id)).world.brainOutcomes[0].state, 'ready');
  brain.setBadReply(false);
  assert.equal((await store.reconcile(id)).delivered, 1);
}));

test('post-commit audit identifies erased Native receipt without inventing a new one', () => workspace(async root => {
  const brain = brainInbox(), store = createWorldStore({ root, brain });
  const old = await ready(store), id = old.world.id;
  const delivered = await store.reconcile(id);
  assert.equal(delivered.delivered, 1);
  assert.equal((await store.auditReconciliation(id)).verified, 1);
  brain.journal.clear();
  const report = await createWorldStore({ root, brain }).auditReconciliation(id);
  assert.equal(report.verified, 0);
  assert.deepEqual(report.issues.map(x => x.code), ['MI_NATIVE_RECEIPT_MISSING']);
  assert.equal((await store.get(id)).world.brainOutcomes[0].state, 'delivered', 'audit must not rewrite authoritative history');
}));

test('a crash after Native intent commit but before Mi World update replays only one World decision', () => workspace(async root => {
  const brain = brainInbox();
  const worldRoot = join(root,'worlds');
  let failOnce = true;
  let oldStore = createWorldStore({ root:worldRoot, brain, reconciliationHooks: {
    afterNativeDecision() {
      if (failOnce) { failOnce = false; throw Object.assign(new Error('crash after native decision'), {code:'SIMULATED_DECISION_CRASH'}); }
    },
  } });
  let state = await oldStore.create('意圖回合權威提交故障');
  state = await oldStore.mutate(state.world.id, command(state, 'enable-for-decision', 'brain_enabled', {enabled:true}));
  const original = state;
  const payload = { ...pre(original), operation_id:'same-native-decision-retry', actor_id:'conan' };
  await assert.rejects(oldStore.decide(original.world.id, payload), { code:'SIMULATED_DECISION_CRASH' });
  assert.equal((await oldStore.get(original.world.id)).hash, original.hash, 'crash must leave original committed World intact');
  oldStore = createWorldStore({ root:worldRoot, brain });
  const recovered = await oldStore.decide(original.world.id, payload);
  assert.equal(recovered.revision, original.revision+1);
  assert.equal(recovered.world.brainOutcomes.length, 1);
  assert.equal(recovered.world.brainOutcomes[0].decisionId, decisionId);
  assert.equal((await oldStore.decide(original.world.id, payload)).duplicate, true);
  assert.equal((await oldStore.get(original.world.id)).world.brainOutcomes.length, 1);
}));

test('audit is available on same-origin local HTTP but cannot disclose another upstream World history', () => workspace(async root => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { createBrainServer } = await import('../server/brain-api.mjs');
  const dist=join(root,'dist');await mkdir(dist);await writeFile(join(dist,'index.html'),'safe');
  const store=createWorldStore({root:join(root,'worlds')});
  const created=await store.create('對帳 API');
  const server=createBrainServer({root:dist,worldStore:store});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const url=`http://127.0.0.1:${server.address().port}/api/worlds/${created.world.id}/reconciliation-status`;
    assert.equal((await fetch(url,{headers:{Origin:'https://attacker.invalid'}})).status,403);
    const response=await fetch(url);
    assert.equal(response.status,200);
    const report=await response.json();
    assert.equal(report.world_id,created.world.id);
    assert.equal(report.verified,0);
    assert.deepEqual(report.issues,[]);
    assert.equal(Object.hasOwn(report,'world'),false);
  } finally { await new Promise(resolve=>server.close(resolve)); }
}));

test('a forged Native decision identity is rejected before World stores any pending action', () => workspace(async root => {
  const brain = brainInbox();
  const real = brain.decide;
  const world = createWorldStore({ root, brain });
  let snapshot = await world.create('錯誤身分');
  snapshot = await world.mutate(snapshot.world.id, command(snapshot, 'enable-forged-check', 'brain_enabled', {enabled:true}));
  const baseline = snapshot;
  brain.decide = async input => ({ ...(await real(input)), actor_id:'other_person' });
  await assert.rejects(world.decide(snapshot.world.id, { ...pre(snapshot),operation_id:'forged-actor-001',actor_id:'conan' }), {code:'BRAIN_RESPONSE_INVALID'});
  assert.equal((await world.get(snapshot.world.id)).hash, baseline.hash);
  assert.deepEqual((await world.get(snapshot.world.id)).world.brainOutcomes || [], []);
}));

test('pre-upgrade delivered records remain readable but are never counted as audited proof', () => workspace(async root => {
  const store=createWorldStore({root,brain:brainInbox()});
  const state=await ready(store),id=state.world.id;
  const { markBrainFeedbackDelivered } = await import('../src/core/brain-feedback.js');
  // Simulate a legacy local record with no attached cross-system receipt.
  const file=join(root,`${id}.json`);
  const fs=await import('node:fs/promises');
  const crypto=await import('node:crypto');
  const current=JSON.parse(await fs.readFile(file,'utf8'));
  current.world=markBrainFeedbackDelivered(current.world,decisionId);
  current.hash=crypto.createHash('sha256').update(JSON.stringify(current.world)).digest('hex');
  await fs.writeFile(file,JSON.stringify(current));
  const audit=await createWorldStore({root,brain:brainInbox()}).auditReconciliation(id);
  assert.equal(audit.verified,0);
  assert.equal(audit.legacy,1);
  assert.deepEqual(audit.issues.map(x=>x.code),['MI_LEGACY_UNPROVEN_DELIVERY']);
}));

test('one broken actor receipt cannot block other NPC receipts in the same World', () => workspace(async root => {
  const { makeWorld } = await import('../src/core/world.js');
  const source = makeWorld('兩個角色各自對帳');
  source.people=source.people.slice(0,2);
  const ledger=new Map();let breakOne=true;
  const brain={
    status:()=>({mode:'native_turn',decision_provider:true}),
    decide:async packet=>({status:'selected',committed:true,actor_id:packet.actor_id,
      world_minute:packet.world_minute,action_id:'wait',
      decision_id: (packet.actor_id==='conan'?'a':'b').repeat(64)}),
    async acknowledgeAuthoritative(packet) {
      const proof=expectedMiAcknowledgement(packet);
      if(breakOne && packet.actor_id==='conan') throw Object.assign(new Error('Conan inbox unavailable'),{code:'CONAN_INBOX_FAILED'});
      ledger.set(`${packet.world_id}:${packet.decision_id}`,proof);
      return {accepted:true,acknowledgement:proof};
    },
    async inspectAcknowledgement({world_id,decision_id}) {
      return ledger.get(`${world_id}:${decision_id}`) || null;
    },
  };
  const store=createWorldStore({root,brain});
  let state=await store.migrate(source),id=state.world.id;
  state=await store.mutate(id,command(state,'enable-two-actors','brain_enabled',{enabled:true}));
  state=await store.mutate(id,command(state,'unpause-two-actors','pause',{paused:false}));
  const tick=await store.autonomousTick(id,{...pre(state),operation_id:'two-actor-test-tick',minutes:30,max_actors:2});
  assert.equal(tick.decisions.length,2);
  const first=await store.reconcile(id);
  assert.equal(first.delivered,1);
  assert.deepEqual(first.issues.map(x=>x.code),['CONAN_INBOX_FAILED']);
  assert.equal(first.pending,1);
  const ready=first.world.brainOutcomes.find(x=>x.state==='ready');
  assert.equal(ready.actorId,'conan');
  await assert.rejects(store.decide(id,{ ...pre(first),operation_id:'blocked-same-actor',actor_id:'conan'}),{code:'BRAIN_OUTCOME_UNRECONCILED'});
  breakOne=false;
  const fixed=await store.reconcile(id);
  assert.equal(fixed.delivered,1);
  assert.equal(fixed.pending,0);
  assert.equal((await store.auditReconciliation(id)).verified,2);
}));
