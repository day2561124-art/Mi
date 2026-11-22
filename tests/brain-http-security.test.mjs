import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrainServer } from '../server/brain-api.mjs';

test('HTTP preview serves only built public assets, never project secrets or Native session indexes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beika-static-'));
  const dist = join(root, 'dist');
  await mkdir(dist);
  await mkdir(join(root, '.beika-private'));
  await writeFile(join(root, '.beika-private', 'brain-native-index.json'), '{"session_id":"PRIVATE"}');
  await writeFile(join(root, '.env'), 'PRIVATE_API_KEY=DO_NOT_SERVE');
  await writeFile(join(root, 'native-brain.mjs'), 'PRIVATE_SOURCE');
  await writeFile(join(dist, 'index.html'), '<h1>Public front page</h1>');
  const server = createBrainServer({ root: dist });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const front = await fetch(base + '/');
    assert.equal(front.status, 200);
    assert.match(await front.text(), /Public front page/);
    for (const path of ['/.env', '/.beika-private/brain-native-index.json', '/native-brain.mjs', '/server/native-brain.mjs', '/../.env']) {
      const res = await fetch(base + path);
      assert.notEqual(res.status, 200, `Private path exposed: ${path}`);
      assert.doesNotMatch(await res.text(), /PRIVATE_API_KEY|PRIVATE_SOURCE|PRIVATE/);
    }
    const status = await fetch(base + '/api/brain/status');
    assert.equal(status.status, 200);
    assert.equal((await status.json()).connected, false);
  } finally {
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('feedback endpoint accepts only native bridge, same origin, and bounded POST',async()=>{
 const calls=[];
 const bridge={status:()=>({connected:true,decision_provider:true,mode:'native_turn',feedback_ingress:true}),
  decide:async()=>({status:'rejected'}),acknowledge:async value=>{calls.push(value);return {ok:true,accepted:true};}};
 const server=createBrainServer({bridge});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/brain/feedback')).status,405);
  const badOrigin=await fetch(base+'/api/brain/feedback',{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:'{}'});
  assert.equal(badOrigin.status,403);
  const huge=await fetch(base+'/api/brain/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(25000)});
  assert.equal(huge.status,413);
  const answer=await fetch(base+'/api/brain/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"kind":"observed"}'});
  assert.equal(answer.status,200);assert.equal(calls.length,1);assert.equal(calls[0].kind,'observed');
 }finally{await new Promise(resolve=>server.close(resolve));}
 const capabilityServer=createBrainServer({bridge:{status:()=>({decision_provider:true,connected:true}),decide:async()=>({})}});
 try{
  await new Promise(resolve=>capabilityServer.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${capabilityServer.address().port}`;
  assert.equal((await fetch(base+'/api/brain/feedback',{method:'POST',body:'{}'})).status,503);
 }finally{await new Promise(resolve=>capabilityServer.close(resolve));}
});


test('direct public brain endpoints cannot impersonate a server-authoritative World lineage',async()=>{
 const calls=[];
 const bridge={status:()=>({decision_provider:true,connected:true,mode:'native_turn'}),
  decide:async value=>{calls.push(value);return {status:'rejected'};},acknowledge:async value=>{calls.push(value);return {ok:true};}};
 const server=createBrainServer({bridge});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/api/brain/decide','/api/brain/feedback']){
   const response=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({world_id:'srv_'+ 'b'.repeat(48)})});
   assert.equal(response.status,403);
   assert.equal((await response.json()).error,'RESERVED_WORLD_LINEAGE');
  }
  assert.equal(calls.length,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
