import test from 'node:test';
import assert from 'node:assert/strict';
import { startNativeCpuProfile, summarizeNativeCpuProfile } from './native-cpu-profiler.mjs';

test('CPU sampler accumulates self and inclusive stacks without leaking absolute paths', () => {
  const profile={
    nodes:[
      {id:1,callFrame:{functionName:'(root)',url:'',lineNumber:0},children:[2]},
      {id:2,callFrame:{functionName:'prepareWorldSimulationTurn',
        url:'file:///home/runner/work/Mi/Mi/vendor/wRITE/server/src/world-simulation-loop-service.mjs',
        lineNumber:5339},children:[3]},
      {id:3,callFrame:{functionName:'cloneJson',
        url:'file:///home/runner/work/Mi/Mi/vendor/wRITE/server/src/world-simulation-loop-service.mjs',
        lineNumber:765},children:[]},
    ],
    samples:[3,3,2],timeDeltas:[1000,2000,1000],
  };
  const summary=summarizeNativeCpuProfile(profile);
  assert.equal(summary.sampleCount,3);
  assert.equal(summary.totalSampledMs,4);
  assert.equal(summary.topSelf[0].sampledMs,3);
  assert.match(summary.topSelf[0].frame,/cloneJson @ wRITE\/server\/src/);
  assert.equal(summary.topInclusive.find(f=>f.frame.startsWith('prepareWorldSimulationTurn')).sampledMs,4);
  assert.ok(!JSON.stringify(summary).includes('/home/runner'));
  assert.equal(summarizeNativeCpuProfile({nodes:[],samples:[],timeDeltas:[]}).sampleCount,0);
  assert.throws(()=>summarizeNativeCpuProfile({nodes:[],samples:[]}),/Invalid V8/);
});

test('real inspector sampling is opt-in and produces aggregate-only function data', async () => {
  const stop=await startNativeCpuProfile();
  let result=0;
  const started=performance.now();
  while(performance.now()-started<30)result+=Math.sqrt(result+1);
  const summary=await stop();
  assert.ok(result>0);
  assert.ok(summary.sampleCount>=1);
  assert.ok(summary.totalSampledMs>0);
  assert.ok(Array.isArray(summary.topSelf));
  assert.equal(Object.hasOwn(summary,'nodes'),false);
  assert.equal(Object.hasOwn(summary,'samples'),false);
  await assert.rejects(stop(),/already stopped/);
});
