import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { makeWorld } from '../src/core/world.js';
import { createWorldStore } from '../server/world-store.mjs';
import { loadNativeRuntime, createNativeBrainBridge } from '../server/native-brain.mjs';
import { createMiMemoryRetrievalResolver } from '../server/memory-retrieval.mjs';
import { startNativeCpuProfile } from './native-cpu-profiler.mjs';

const pre = state => ({expected_revision:state.revision, expected_hash:state.hash});
const contextItems = packet => {
  const mind=packet.cognition?.working_context??{};
  return [mind.focus,...(mind.active_context??[]),...(mind.peripheral_context??[]),
    ...(mind.fading_context??[]),...(mind.suspended_context??[])].filter(Boolean);
};
const hasRecollection = packet => contextItems(packet).some(item =>
  item.context_origin==='recovered_memory' &&
  item.content?.kind==='post_outcome_action_experience');
const actorName = actor => actor.name+' ('+actor.id+')';
async function fixture(prefix,fn) {
  const parent=join(process.env.WRITE_ROOT,'tests','.tmp');
  await mkdir(parent,{recursive:true});
  const root=await mkdtemp(join(parent,prefix));
  try{return await fn(root);}finally{await rm(root,{recursive:true,force:true});}
}
async function setup(store) {
  const world=makeWorld('Native three-NPC endurance');
  world.people=world.people.filter(p=>['conan','ran','ai'].includes(p.id));
  world.canonEnabled=false;
  let saved=await store.migrate(world);
  const id=saved.world.id;
  for(const [name,type,args] of [['enable-native','brain_enabled',{enabled:true}],
    ['unpause-world','pause',{paused:false}]]) {
    saved=await store.mutate(id,{...pre(saved),operation_id:name,type,args});
  }
  return {id,saved,people:world.people};
}
test('real pinned Native: three independent NPC memories and receipts survive repeated restarts',
  {skip:!process.env.WRITE_ROOT,timeout:1500000},async()=>{
  const ticks=Number(process.env.BEIKA_NATIVE_TICKS??8);
  assert.ok(Number.isInteger(ticks)&&ticks>=4&&ticks<=16);
  await fixture('mi-native-endurance-',async root=>{
    const native=await loadNativeRuntime(process.env.WRITE_ROOT);
    const phaseStats={};
    const callbackStats={selector:{calls:0,ms:0},retrieval:{calls:0,ms:0}};
    const tickTimes=[];
    const retrievalResolver=createMiMemoryRetrievalResolver();
    const timedRetrieval=async (...args)=>{
      const started=performance.now();
      try{return await retrievalResolver(...args);}
      finally{callbackStats.retrieval.calls++;callbackStats.retrieval.ms+=performance.now()-started;}
    };
    const upstream={...native};
    for(const name of ['beginWorldSimulationSession','getWorldSimulationState',
      'getWorldSimulationHistory','commitWorldSimulationTurn','runWorldSimulationTurn']){
      upstream[name]=async(...args)=>{
        const started=Date.now();
        try{return await native[name](...args);}
        finally{
          const stat=phaseStats[name]??={calls:0,ms:0};
          stat.calls++;
          stat.ms+=Date.now()-started;
        }
      };
    }
    const indexFile=join(root,'index.json'),options={fixtureRoot:join(root,'upstream')};
    const worldRoot=join(root,'worlds'),packets=[];
    const makeBrain=()=>createNativeBrainBridge({upstream,indexFile,sessionOptions:options,
      memoryRetrievalResolver:timedRetrieval,
      decider:async packet=>{
        const started=performance.now();
        try{
          packets.push(structuredClone(packet));
          assert.equal(Object.hasOwn(packet,'world_state'),false);
          assert.equal(Object.hasOwn(packet,'world_simulation_session_id'),false);
          assert.ok(packet.candidate_action_intents.some(x=>x.action_id==='wait'));
          return {action_id:'wait'};
        }finally{callbackStats.selector.calls++;callbackStats.selector.ms+=performance.now()-started;}
      },
    });
    let store=createWorldStore({root:worldRoot,brain:makeBrain()});
    let {id,saved,people}=await setup(store);
    const ids=new Set();
    let restarts=0;
    for(let i=0;i<ticks;i++){
      const tickStart=performance.now();
      const preceding=structuredClone(phaseStats);
      const priorCallbacks=structuredClone(callbackStats);
      const cpuStart=process.cpuUsage();
      console.log('BEIKA_NATIVE_TICK_START',JSON.stringify({tick:i+1,total:ticks}));
      // CPU sampling is test-only and deliberately limited to the first and
      // final turns so sampling overhead does not cover the entire endurance run.
      const stopCpuProfile=process.env.BEIKA_NATIVE_CPU_PROFILE==='1' &&
        (i===0 || i===ticks-1) ? await startNativeCpuProfile() : null;
      try {
      if(i&&i%3===0){
        store=createWorldStore({root:worldRoot,brain:makeBrain()});
        saved=await store.get(id);
        restarts++;
      }
      const operation_id='native-endurance-'+i;
      const before=saved;
      saved=await store.autonomousTick(id,{...pre(before),operation_id,minutes:30,max_actors:3});
      assert.equal(saved.world.minutes,(i+1)*30);
      assert.deepEqual(saved.failures,[]);
      assert.equal(saved.decisions.length,3);
      for(const d of saved.decisions){
        assert.equal(d.action_id,'wait');
        assert.equal(ids.has(d.decision_id),false);
        ids.add(d.decision_id);
      }
      const beforeDup=packets.length;
      const duplicate=await store.autonomousTick(id,{...pre(before),operation_id,minutes:30,max_actors:3});
      assert.equal(duplicate.duplicate,true);
      assert.equal(packets.length,beforeDup);
      saved=await store.reconcile(id);
      assert.equal(saved.delivered,3);
      assert.equal(saved.pending,0);
      assert.deepEqual(saved.issues,[]);
      const index=JSON.parse(await readFile(indexFile,'utf8'));
      const lineage=index.worlds[Object.keys(index.worlds)[0]];
      const state=await upstream.getWorldSimulationState(lineage.session_id,options);
      for(const person of people){
        const records=state.state.memories?.[actorName(person)]??[];
        const experiences=records.filter(m=>m.memory_type==='episodic_action_experience' &&
          m.source?.kind==='post_outcome_subjective_experience');
        if(i>0)assert.ok(experiences.length>=i,'missing native memory for '+person.id+' at tick '+i);
        assert.ok(experiences.every(m=>m.subjective_memory_not_world_truth===true));
        assert.ok(experiences.every(m=>!JSON.stringify(m).includes('未經伺服器驗證')));
      }
      if(i>0)assert.ok(packets.slice(i*3,(i+1)*3).every(p=>
        JSON.stringify(p).includes('post_outcome_action_experience')));
      const elapsedMs=Math.round(performance.now()-tickStart);
      tickTimes.push(elapsedMs);
      const profile=Object.fromEntries(Object.entries(phaseStats).map(([name,item])=>[name,{
        calls:item.calls-(preceding[name]?.calls??0),ms:item.ms-(preceding[name]?.ms??0)}]));
      const callbacks=Object.fromEntries(Object.entries(callbackStats).map(([name,item])=>[name,{
        calls:item.calls-(priorCallbacks[name]?.calls??0),
        ms:Math.round(item.ms-(priorCallbacks[name]?.ms??0))}]));
      const cpu=process.cpuUsage(cpuStart);
      const stateBytes=Buffer.byteLength(JSON.stringify(state.state));
      const memoryCount=people.reduce((total,person)=>total+
        (state.state.memories?.[actorName(person)]??[]).length,0);
      console.log('BEIKA_NATIVE_PHASE_TIMES',JSON.stringify({tick:i+1,elapsedMs,profile}));
      console.log('BEIKA_NATIVE_DIAGNOSTIC',JSON.stringify({tick:i+1,
        cpuMs:Math.round((cpu.user+cpu.system)/1000),heapMiB:Math.round(process.memoryUsage().heapUsed/1048576),
        stateBytes,memoryCount,callbacks}));
      console.log('BEIKA_NATIVE_TICK_DONE',JSON.stringify({tick:i+1,worldMinutes:saved.world.minutes,elapsedMs}));
      } finally {
        if(stopCpuProfile){
          const cpuProfile=await stopCpuProfile();
          console.log('BEIKA_NATIVE_CPU_SAMPLE',JSON.stringify({tick:i+1,...cpuProfile}));
        }
      }
    }
    if(ticks>=8){
      const growthRatio=Number((tickTimes.at(-1)/Math.max(1,tickTimes[0])).toFixed(1));
      // Intentionally generous, runner-independent gross-regression tripwire.
      // Current long-run growth is still a known performance defect (#14).
      const grossRegressionThreshold=300;
      console.log('BEIKA_NATIVE_PERF_GUARD',JSON.stringify({firstMs:tickTimes[0],
        lastMs:tickTimes.at(-1),growthRatio,grossRegressionThreshold,
        knownSuperlinearGrowth:growthRatio>40}));
      assert.ok(growthRatio<=grossRegressionThreshold,
        'Native duration grew beyond the gross regression guard (see Issue #14)');
    }
    const index=JSON.parse(await readFile(indexFile,'utf8'));
    const lineage=index.worlds[Object.keys(index.worlds)[0]];
    assert.equal(lineage.feedback.length,ticks*3);
    assert.equal(ids.size,ticks*3);
    const state=await upstream.getWorldSimulationState(lineage.session_id,options);
    const memorySets=people.map(p=>new Set((state.state.memories?.[actorName(p)]??[]).map(m=>m.memory_id)));
    for(let a=0;a<memorySets.length;a++)for(let b=a+1;b<memorySets.length;b++)
      assert.equal([...memorySets[a]].some(x=>memorySets[b].has(x)),false,'cross-NPC memory leakage');
    const history=await upstream.getWorldSimulationHistory(lineage.session_id,options);
    assert.equal(history.turns.filter(t=>(t.selected_action_intents??[]).length>0).length,ticks*3);
    const audit=await store.auditReconciliation(id);
    assert.equal(audit.ready,0);
    assert.deepEqual(audit.issues,[]);
    assert.equal(audit.verified,ticks*3);
    console.log('BEIKA_NATIVE_ENDURANCE',JSON.stringify({ticks,actors:3,turns:ids.size,restarts,
      worldMinutes:saved.world.minutes,verified:audit.verified,selector:'controlled-wait'}));
  });
});
test('real Phase63C retrieval changes a server-committed Mi action after a quiet turn',
  {skip:!process.env.WRITE_ROOT,timeout:900000},async()=>{
  await fixture('mi-native-recall-world-',async root=>{
    const upstream=await loadNativeRuntime(process.env.WRITE_ROOT);
    const results=[];
    for(const enabled of [true,false]){
      const dir=join(root,enabled?'memory-enabled':'control');
      const decisions=[],calls=new Map();
      const brain=createNativeBrainBridge({
        upstream,indexFile:join(dir,'index.json'),
        sessionOptions:{fixtureRoot:join(dir,'upstream')},
        memoryRetrievalResolver:enabled?createMiMemoryRetrievalResolver():
          async()=>({process_occurred:false}),
        decider:async packet=>{
          const n=(calls.get(packet.character)??0)+1;
          calls.set(packet.character,n);
          const recall=hasRecollection(packet);
          let action_id='wait';
          if(packet.character.endsWith(' (conan)')&&n===2)action_id='reject_all';
          if(packet.character.endsWith(' (conan)')&&n===3&&recall)
            action_id=packet.candidate_action_intents.find(a=>a.action_id.startsWith('go:'))?.action_id??'wait';
          decisions.push({character:packet.character,turn:n,action_id,recalled:recall,
            retrieval:packet.retrieval_experience?.process_occurred===true});
          return {action_id};
        },
      });
      const store=createWorldStore({root:join(dir,'worlds'),brain});
      let {id,saved}=await setup(store);
      let actual=null;
      for(let cycle=0;cycle<3;cycle++){
        saved=await store.autonomousTick(id,{...pre(saved),
          operation_id:'memory-cycle-'+cycle,minutes:30,max_actors:3});
        if(cycle===2)actual=saved.decisions.find(d=>d.actor_id==='conan')?.action_id;
        saved=await store.reconcile(id);
        assert.deepEqual(saved.issues,[]);
      }
      const conan=decisions.filter(d=>d.character.endsWith(' (conan)'));
      assert.equal(conan.length,3);
      assert.equal(conan[0].action_id,'wait');
      assert.equal(conan[1].action_id,'reject_all');
      const index=JSON.parse(await readFile(join(dir,'index.json'),'utf8'));
      const lineage=index.worlds[Object.keys(index.worlds)[0]];
      const state=await upstream.getWorldSimulationState(lineage.session_id,
        {fixtureRoot:join(dir,'upstream')});
      assert.ok((state.state.memories?.['江戶川柯南 (conan)']??[])
        .some(m=>m.memory_type==='episodic_action_experience'));
      results.push({enabled,third:conan[2],actual});
    }
    assert.equal(results[0].third.recalled,true);
    assert.equal(results[0].third.retrieval,true);
    assert.ok(results[0].third.action_id.startsWith('go:'));
    assert.equal(results[0].actual,results[0].third.action_id);
    assert.equal(results[1].third.recalled,false);
    assert.equal(results[1].third.retrieval,false);
    assert.equal(results[1].third.action_id,'wait');
    assert.equal(results[1].actual,'wait');
    console.log('BEIKA_NATIVE_RECALL_CONTRAST',JSON.stringify(results));
  });
});
