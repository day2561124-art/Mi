import test from 'node:test';
import assert from 'node:assert/strict';
import { createMiMemoryRetrievalResolver, MI_VERIFIED_RECORD_CUE } from '../server/memory-retrieval.mjs';

const mem = (id, content, extra={}) => ({
  memory_id: id, content, source:{kind:'direct_perception',sense:'visual'},
  engine_persisted_trace:true, encoded_at:'2026-11-22T00:00:00Z',...extra,
});
const A='memory_'+'a'.repeat(24), B='memory_'+'b'.repeat(24);
const input = (records, current='依自己掌握的資訊安排下一步')=>({
  character:'江戶川柯南 (conan)',
  candidate_memory_records:records,
  character_state:{current_goal:current},
  perception:{observed:['目前所在：公寓']},
});

test('Phase63C resolver selects an actual, encoded personal experience source, not authored content', async()=>{
  const seen=[];
  const resolver=createMiMemoryRetrievalResolver({onResolution:x=>seen.push(x)});
  const result=await resolver(input([
    mem(A,`查閱自己的行動紀錄：${MI_VERIFIED_RECORD_CUE}：已抵達。`),
    mem(B,'另一段無關記憶'),
  ]));
  assert.equal(result.process_occurred,true);
  assert.equal(result.target.memory_id,A);
  assert.equal(result.recovered_selections[0].source_memory_ref,A);
  assert.deepEqual(result.recovered_selections[0].selector,{kind:'whole_content'});
  assert.equal(Object.hasOwn(result.recovered_selections[0],'content'),false);
  assert.equal(Object.hasOwn(result,'world_state'),false);
  assert.equal(seen.length,1);
});

test('Phase63C resolver requires source evidence and genuine encoding, never converts guesses or foreign content', async()=>{
  const resolver=createMiMemoryRetrievalResolver();
  for(const record of [
    mem(B,'未經伺服器核實的行動結果'),
    mem(B,MI_VERIFIED_RECORD_CUE,{engine_persisted_trace:false}),
    mem(B,MI_VERIFIED_RECORD_CUE,{source:{kind:'caller_claim'}}),
    mem(B,MI_VERIFIED_RECORD_CUE,{suppressed:true}),
    mem(B,MI_VERIFIED_RECORD_CUE,{accessible:false}),
    mem('fake',{text:MI_VERIFIED_RECORD_CUE}),
  ])assert.equal((await resolver(input([record]))).process_occurred,false);
  assert.equal((await resolver(input([mem(A,MI_VERIFIED_RECORD_CUE)],'和朋友聊天'))).process_occurred,false);
  assert.equal((await resolver({...input([mem(A,MI_VERIFIED_RECORD_CUE)]),perception:{observed:[MI_VERIFIED_RECORD_CUE]}})).process_occurred,false);
  assert.equal((await resolver(input([]))).process_occurred,false);
});

test('Phase63C resolver prefers newest grounded record and is stable under ties', async()=>{
  const resolver=createMiMemoryRetrievalResolver();
  const oldest=mem(A,MI_VERIFIED_RECORD_CUE);
  const latest=mem(B,MI_VERIFIED_RECORD_CUE,{encoded_at:'2026-11-23T00:00:00Z'});
  assert.equal((await resolver(input([oldest,latest]))).target.memory_id,B);
  assert.equal((await resolver(input([latest,oldest]))).target.memory_id,B);
});
