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
    // Explicit Native ownership: otherwise legacy routine AI can assign
    // Conan a new destination during the intervening 30-minute World step.
    state = await call(state, 'native-mode-on', 'brain_enabled', { enabled: true });
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
    assert.match(JSON.stringify(packets[1]), /post_outcome_action_experience/);
    assert.doesNotMatch(JSON.stringify(packets[1]), /未經伺服器驗證/);
    assert.doesNotMatch(JSON.stringify(packets[1]), /engine-only hidden/);
    // The verified consequence is newly READ by this actor in the next Native
    // turn. Phase63A may now encode it as a subjective memory; Mi must NOT
    // directly insert anything into upstream memories.
    const nativeIndex = JSON.parse(await readFile(join(root, 'native-index.json'), 'utf8'));
    const nativeSessionId = nativeIndex.worlds[Object.keys(nativeIndex.worlds)[0]].session_id;
    const nativeState = await upstream.getWorldSimulationState(nativeSessionId, { fixtureRoot: join(root, 'upstream') });
    const conanMemories = nativeState.state.memories['江戶川柯南 (conan)'] || [];
    assert.ok(conanMemories.some(memory => memory.memory_type === 'episodic_action_experience'
      && memory.source?.kind === 'post_outcome_subjective_experience'
      && memory.content?.kind === 'post_outcome_action_experience'),
      'Upstream Phase63A must commit a canonical Phase76B subjective action experience');
    assert.ok(conanMemories.every(memory => !JSON.stringify(memory).includes('本機存檔回報（未經伺服器驗證）')));
    const nativeHistory = await upstream.getWorldSimulationHistory(nativeSessionId, { fixtureRoot: join(root, 'upstream') });
    assert.ok(nativeHistory.turns.some(turn => (turn.subjective_memory_formation?.result?.created_memory_count ?? 0) > 0),
      'Native memory formation, rather than Mi manual memory mutation, owns this step');
    const index = JSON.parse(await readFile(join(root, 'native-index.json'), 'utf8'));
    assert.equal(index.worlds[Object.keys(index.worlds)[0]].feedback[0].source, 'mi_server_verified');
    assert.match(index.worlds[Object.keys(index.worlds)[0]].feedback[0].post_outcome_receipt?.post_outcome_subjective_perception_projection?.version ?? '', /phase76a-post-outcome/);
    assert.equal(index.worlds[Object.keys(index.worlds)[0]].feedback[0].delivered_in?.startsWith('mi_evt_'), true);
    const third = await store.decide(worldId, {
      operation_id: 'server-native-decision-2', expected_revision: delivered.revision,
      expected_hash: delivered.hash, actor_id: 'conan',
    });
    assert.equal(third.duplicate, true);
    assert.equal(packets.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real wRITE Native alternates two independent NPC memories and replays only each actor’s verified Mi experience', async t => {
  if (!process.env.WRITE_ROOT) return t.skip('Real wRITE checkout only on integration CI');
  const { createWorldStore } = await import('../server/world-store.mjs');
  const { makeWorld } = await import('../src/core/world.js');
  const parent = join(process.env.WRITE_ROOT, 'tests', '.tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'mi-native-autonomy-'));
  try {
    const upstream = await loadNativeRuntime(process.env.WRITE_ROOT);
    const packets = [];
    const native = createNativeBrainBridge({
      upstream,
      decider: async packet => {
        packets.push(structuredClone(packet));
        assert.ok(Array.isArray(packet.candidate_action_intents));
        assert.equal(Object.hasOwn(packet, 'world_state'), false);
        assert.ok(packet.candidate_action_intents.some(a => a.action_id === 'wait'));
        return { action_id: 'wait' };
      },
      sessionOptions: { fixtureRoot: join(root, 'upstream') },
      indexFile: join(root, 'native-index.json'),
    });
    const store = createWorldStore({ root: join(root, 'worlds'), brain: native });
    const source = makeWorld('多角色真實 Native 連續性');
    source.people = source.people.slice(0, 2);
    let saved = await store.migrate(source);
    const id = saved.world.id;
    const execute = async (operation_id, type, args) => {
      saved = await store.mutate(id, { operation_id, expected_revision: saved.revision, expected_hash: saved.hash, type, args });
    };
    await execute('native-autonomy-enabled', 'brain_enabled', { enabled: true });
    await execute('native-autonomy-start', 'pause', { paused: false });
    const tick = async operation_id => {
      saved = await store.autonomousTick(id, {
        operation_id, expected_revision: saved.revision, expected_hash: saved.hash,
        minutes: 30, max_actors: 2,
      });
      assert.equal(saved.decisions.length, 2);
      const report = await store.reconcile(id);
      assert.equal(report.delivered, 2);
      saved = report;
    };
    await tick('upstream-native-multi-1');
    assert.equal(packets.length, 2);
    // Service and Native bridge restarted with same durable on-disk identity.
    const restarted = createNativeBrainBridge({
      upstream,
      decider: async packet => { packets.push(structuredClone(packet)); return { action_id: 'wait' }; },
      sessionOptions: { fixtureRoot: join(root, 'upstream') },
      indexFile: join(root, 'native-index.json'),
    });
    const resumed = createWorldStore({ root: join(root, 'worlds'), brain: restarted });
    saved = await resumed.get(id);
    const second = await resumed.autonomousTick(id, {
      operation_id: 'upstream-native-multi-2', expected_revision: saved.revision,
      expected_hash: saved.hash, minutes: 30, max_actors: 2,
    });
    assert.equal(second.decisions.length, 2);
    assert.equal(packets.length, 4);
    for (const character of source.people) {
      assert.ok(packets.some(p => p.character === `${character.name} (${character.id})`));
    }
    const later = packets.slice(2);
    assert.ok(later.every(p => JSON.stringify(p).includes('post_outcome_action_experience')));
    assert.ok(later.every(p => !JSON.stringify(p).includes('本機存檔回報（未經伺服器驗證）')));
    const index = JSON.parse(await readFile(join(root, 'native-index.json'), 'utf8'));
    const nativeSession = index.worlds[Object.keys(index.worlds)[0]].session_id;
    const history = await upstream.getWorldSimulationHistory(nativeSession, { fixtureRoot: join(root, 'upstream') });
    assert.equal(history.turns.filter(turn => (turn.selected_action_intents || []).length > 0).length, 4);
    // Both actors should encode their OWN subsequent verified outcome.
    // One NPC must not read the other actor's subjective history.
    const persisted = await upstream.getWorldSimulationState(nativeSession, { fixtureRoot: join(root, 'upstream') });
    for (const actor of source.people) {
      const key = `${actor.name} (${actor.id})`;
      const records = persisted.state.memories[key] || [];
      assert.ok(records.some(record => record.memory_type === 'episodic_action_experience'
        && record.source?.kind === 'post_outcome_subjective_experience'),
        `Native Phase63A must form a Phase76B subjective experience for ${key}`);
      const nextActor = source.people.find(other => other.id !== actor.id);
      assert.ok(!records.some(record => JSON.stringify(record).includes(`${nextActor.name} (${nextActor.id})`)),
        'An actor memory must not contain another actor runtime identity');
    }
    // A returned historical report is NOT being claimed as wRITE's official
    // Experience Receipt / automatic long-term memory consolidation.
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('real Phase63C controlled contrast: the same later decision changes only when an encoded Mi experience is actually recalled', async t => {
  if (!process.env.WRITE_ROOT) return t.skip('Actual wRITE checkout only on upstream CI');
  const { createMiMemoryRetrievalResolver, MI_PHASE76_EXPERIENCE } = await import('../server/memory-retrieval.mjs');
  const { createWorldStore } = await import('../server/world-store.mjs');
  const parent = join(process.env.WRITE_ROOT, 'tests', '.tmp');
  await mkdir(parent, {recursive:true});
  const fixture = await mkdtemp(join(parent,'mi-phase63c-controlled-'));
  try {
    const upstream = await loadNativeRuntime(process.env.WRITE_ROOT);
    const run = async (enabled,label) => {
      const root = join(fixture,label);
      const packets=[];
      const selectionHistory=[];
      const recalled=[];
      const decider=async packet => {
        packets.push(structuredClone(packet));
        const mind=packet.cognition?.working_context ?? {};
        const items=[mind.focus,...(mind.active_context??[]),...(mind.peripheral_context??[]),
          ...(mind.fading_context??[]),...(mind.suspended_context??[])].filter(Boolean);
        const hasRecollection=items.some(item=>item.context_origin==='recovered_memory'
          && item.content?.kind === MI_PHASE76_EXPERIENCE);
        const options=packet.candidate_action_intents;
        const choice=hasRecollection ? options.find(item=>item.action_id.startsWith('go:'))?.action_id : 'wait';
        const action_id=choice ?? 'wait';
        selectionHistory.push({action_id,hasRecollection,retrieval:packet.retrieval_experience??null});
        return {action_id};
      };
      const native=createNativeBrainBridge({upstream,decider,
        memoryRetrievalResolver:enabled?createMiMemoryRetrievalResolver({onResolution:x=>recalled.push(x)}):async()=>({process_occurred:false}),
        sessionOptions:{fixtureRoot:join(root,'upstream')},indexFile:join(root,'native-index.json')});
      const store=createWorldStore({root:join(root,'worlds'),brain:native});
      let saved=await store.create(`記憶決策對照 ${label}`);
      const id=saved.world.id;
      const mutate=async(operation_id,type,args)=>{
        saved=await store.mutate(id,{operation_id,expected_revision:saved.revision,expected_hash:saved.hash,type,args});
      };
      await mutate('enable-native-phase63c','brain_enabled',{enabled:true});
      await mutate('unpause-native-phase63c','pause',{paused:false});
      const decide=async(num)=>{
        saved=await store.decide(id,{operation_id:`phase63c-decision-${num}`,
          expected_revision:saved.revision,expected_hash:saved.hash,actor_id:'conan'});
      };
      await decide(1);
      assert.equal(selectionHistory[0].action_id,'wait');
      await mutate('phase63c-progress-1','advance',{minutes:30,manual:true});
      saved=await store.reconcile(id);
      assert.equal(saved.delivered,1);
      await decide(2);
      assert.equal(selectionHistory[1].action_id,'wait');
      const index=JSON.parse(await readFile(join(root,'native-index.json'),'utf8'));
      const session=index.worlds[Object.keys(index.worlds)[0]].session_id;
      let nativeState=await upstream.getWorldSimulationState(session,{fixtureRoot:join(root,'upstream')});
      const memoryList=nativeState.state.memories['江戶川柯南 (conan)']??[];
      assert.ok(memoryList.some(m=>m.memory_type === 'episodic_action_experience'
        && m.content?.kind === MI_PHASE76_EXPERIENCE),
        'Native Phase63A must first encode verified past evidence before a future retrieval can occur');
      // Second observation should be settled, but not reconciled yet: the third
      // opportunity must not receive a fresh event with identical text.
      await mutate('phase63c-progress-2','advance',{minutes:30,manual:true});
      const before=packets.length;
      // This is an isolated Phase63C cognition contrast, not an additional
      // authoritative Mi World action. The second action is deliberately
      // unacknowledged, so World correctly prohibits a new World decision.
      // Invoke only the Native decision probe at the same saved clock without
      // mutating Mi's World state or declaring the prior action successful.
      const thirdInput={...makeBoundedBrainRequest(saved.world,'conan'),
        world_id:Object.keys(index.worlds)[0]};
      const third=await native.decide(thirdInput);
      assert.equal(third.committed,true);
      assert.equal(packets.length,before+1);
      assert.equal(JSON.stringify(packets[2].perception??{}).includes(MI_PHASE76_EXPERIENCE),false,
        'This third decision must be grounded in memory retrieval, not the record being read again');
      nativeState=await upstream.getWorldSimulationState(session,{fixtureRoot:join(root,'upstream')});
      return {selectionHistory,recalled,memoryCount:nativeState.state.memories['江戶川柯南 (conan)']?.length??0,
        packets};
    };
    const withMemory=await run(true,'retrieval-enabled');
    const noRetrieval=await run(false,'retrieval-disabled');
    assert.equal(withMemory.selectionHistory[2].hasRecollection,true,
      'Phase63C recalled record must be reinstated in Current Mind');
    assert.equal(withMemory.selectionHistory[2].retrieval?.process_occurred,true);
    assert.ok(withMemory.recalled.length>0,'engine-source evidence resolver must be exercised');
    assert.ok(withMemory.selectionHistory[2].action_id.startsWith('go:'),
      'controlled downstream decider must make a different valid choice when prior evidence is actually recalled');
    assert.equal(noRetrieval.selectionHistory[2].hasRecollection,false);
    assert.equal(noRetrieval.selectionHistory[2].action_id,'wait');
    assert.equal(noRetrieval.selectionHistory[2].retrieval?.process_occurred,false);
    assert.ok(noRetrieval.memoryCount>0,'control has memories too, but no successful retrieval');
  } finally {await rm(fixture,{recursive:true,force:true});}
});

test('real pinned wRITE reconciles crash after Phase76 ACK without duplicate outcome memories', async t => {
  if (!process.env.WRITE_ROOT) return t.skip('Real wRITE checkout is provided by GitHub upstream CI');
  const { createWorldStore } = await import('../server/world-store.mjs');
  const parent = join(process.env.WRITE_ROOT, 'tests', '.tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'mi-phase76-crash-recovery-'));
  try {
    const upstream = await loadNativeRuntime(process.env.WRITE_ROOT);
    const sessionOptions = { fixtureRoot: join(root, 'upstream') };
    const indexFile = join(root, 'native-index.json');
    const buildNative = () => createNativeBrainBridge({
      upstream, decider: async () => ({ action_id: 'wait' }), sessionOptions, indexFile,
    });
    let native = buildNative();
    let crash = true;
    const worldRoot=join(root,'worlds');
    let store=createWorldStore({root:worldRoot,brain:native,reconciliationHooks:{
      afterRemoteAck(){ if(crash){crash=false;throw Object.assign(new Error('simulated crash'),{code:'SIMULATED_AFTER_ACK_CRASH'});} },
    }});
    let state=await store.create('Native 實際回執復原');
    const id=state.world.id;
    const command=(name,type,args)=>store.mutate(id,{operation_id:name,expected_revision:state.revision,expected_hash:state.hash,type,args});
    state=await command('crash-native-enabled','brain_enabled',{enabled:true});
    state=await store.decide(id,{operation_id:'crash-intent-1',expected_revision:state.revision,
      expected_hash:state.hash,actor_id:'conan'});
    state=await command('crash-world-advance','advance',{minutes:30,manual:true});
    assert.equal(state.world.brainOutcomes[0].state,'ready');
    const before=await store.reconcile(id);
    assert.equal(before.delivered,0);
    assert.equal(before.pending,1);
    assert.deepEqual(before.issues.map(x=>x.code),['SIMULATED_AFTER_ACK_CRASH']);
    const firstIndex=JSON.parse(await readFile(indexFile,'utf8'));
    const lineage=Object.keys(firstIndex.worlds)[0];
    assert.equal(firstIndex.worlds[lineage].feedback.length,1,'Native ACK was durably written');
    native=buildNative();
    store=createWorldStore({root:worldRoot,brain:native});
    const resumed=await store.reconcile(id);
    assert.equal(resumed.delivered,1);
    assert.equal(resumed.pending,0);
    const audit=await store.auditReconciliation(id);
    assert.equal(audit.verified,1);
    assert.deepEqual(audit.issues,[]);
    const secondIndex=JSON.parse(await readFile(indexFile,'utf8'));
    assert.equal(secondIndex.worlds[lineage].feedback.length,1,'retry cannot duplicate Phase76 receipt');
    const next=await store.decide(id,{operation_id:'crash-intent-2',expected_revision:resumed.revision,
      expected_hash:resumed.hash,actor_id:'conan'});
    assert.equal(next.decision.action_id,'wait');
    const upstreamState=await upstream.getWorldSimulationState(secondIndex.worlds[lineage].session_id,sessionOptions);
    const actionMemories=(upstreamState.state.memories['江戶川柯南 (conan)']||[]).filter(item=>
      item.memory_type==='episodic_action_experience' && item.source?.kind==='post_outcome_subjective_experience');
    assert.equal(actionMemories.length,1,'the recovered Phase76 receipt creates exactly one Native action memory');
    assert.equal((await store.reconcile(id)).delivered,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('real upstream boot writes Native World state only to Mi private directory', async t => {
 if(!process.env.WRITE_ROOT)return t.skip('requires pinned upstream checkout');
 const {spawnSync}=await import('node:child_process');
 const {tmpdir}=await import('node:os');
 const {resolve}=await import('node:path');
 const privateFixture=await mkdtemp(join(tmpdir(),'mi-runtime-private-'));
 try {
  const entry=`
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {configureMiUpstreamStorage} from './server/brain-api.mjs';
const configured=await configureMiUpstreamStorage(process.env);
const project=join(resolve(process.env.WRITE_ROOT),'server','src');
const paths=await import(pathToFileURL(join(project,'project-paths.mjs')).href);
const service=await import(pathToFileURL(join(project,'world-simulation-session-service.mjs')).href);
assert.equal(paths.projectDataRoot,configured.privateRoot);
const session=await service.beginWorldSimulationSession({
 simulation_label:'isolated Mi boot test',
 initial_world_state:{scenes:{},characters:{},event_queue:[],memories:{},available_actions:{}}
});
const id=session.world_simulation_session_id;
assert.equal(JSON.parse(await readFile(join(configured.privateRoot,'agent_runs',id,'world_state.json'),'utf8')).world_simulation_session_id,id);
await assert.rejects(access(join(paths.projectRoot,'data','agent_runs',id)),{code:'ENOENT'});
console.log('BOOT_PRIVATE_SESSION='+id);
`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',entry],{
   cwd:resolve('.'),encoding:'utf8',timeout:90000,env:{...process.env,BRAIN_NATIVE:'1',MI_WRITE_DATA_ROOT:join(privateFixture,'data'),
    BRAIN_INDEX_FILE:join(privateFixture,'index.json'),WRITE_DATA_ROOT:''}
  });
  assert.equal(child.status,0,child.stderr||child.stdout);
  assert.match(child.stdout,/BOOT_PRIVATE_SESSION=agent_run_/);
 }finally{await rm(privateFixture,{recursive:true,force:true});}
});
