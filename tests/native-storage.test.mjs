import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureOwnedNativeSessions} from '../server/native-storage.mjs';
const id='agent_run_20261123-100000-abcdef12';
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'mi-storage-isolation-'));
 const upstreamRoot=join(root,'source'),privateRoot=join(root,'private'),indexFile=join(root,'index.json');
 const source=join(upstreamRoot,'data','agent_runs',id);
 try{
  await mkdir(source,{recursive:true});
  await writeFile(join(source,'run.json'),JSON.stringify({run_id:id}));
  await writeFile(join(source,'world_state.json'),JSON.stringify({world_simulation_session_id:id,revision:2}));
  await writeFile(join(source,'world_history.json'),JSON.stringify({world_simulation_session_id:id,turns:[]}));
  await writeFile(indexFile,JSON.stringify({version:1,worlds:{world1:{session_id:id}}}));
  await fn({upstreamRoot,privateRoot,indexFile,source});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('indexed Native world is copied, verified and can be reopened without mutating original',async()=>{
 await fixture(async x=>{
  const input={upstreamRoot:x.upstreamRoot,privateRoot:x.privateRoot,indexFile:x.indexFile};
  assert.deepEqual(await ensureOwnedNativeSessions(input),{migrated:1,existing:0});
  assert.deepEqual(await ensureOwnedNativeSessions(input),{migrated:0,existing:1});
  assert.equal(JSON.parse(await readFile(join(x.source,'world_state.json'),'utf8')).revision,2);
  assert.equal(JSON.parse(await readFile(join(x.privateRoot,'agent_runs',id,'world_state.json'),'utf8')).revision,2);
 });
});
test('conflicting or missing legacy records fail closed',async()=>{
 await fixture(async x=>{
  const input={upstreamRoot:x.upstreamRoot,privateRoot:x.privateRoot,indexFile:x.indexFile};
  const dest=join(x.privateRoot,'agent_runs',id);
  await mkdir(dest,{recursive:true});
  await writeFile(join(dest,'run.json'),JSON.stringify({run_id:id}));
  await writeFile(join(dest,'world_state.json'),JSON.stringify({world_simulation_session_id:id,revision:3}));
  await writeFile(join(dest,'world_history.json'),JSON.stringify({world_simulation_session_id:id,turns:[]}));
  await assert.rejects(ensureOwnedNativeSessions(input),{code:'NATIVE_MIGRATION_CONFLICT'});
  assert.equal(JSON.parse(await readFile(join(dest,'world_state.json'),'utf8')).revision,3);
  await rm(dest,{recursive:true,force:true});await rm(x.source,{recursive:true,force:true});
  await assert.rejects(ensureOwnedNativeSessions(input),{code:'NATIVE_MIGRATION_MISSING'});
 });
});
test('untrusted session ids cannot traverse out of indexed data',async()=>{
 await fixture(async x=>{
  await writeFile(x.indexFile,JSON.stringify({version:1,worlds:{x:{session_id:'../../outside'}}}));
  await assert.rejects(ensureOwnedNativeSessions(x),{code:'NATIVE_MIGRATION_LINEAGE'});
 });
});
