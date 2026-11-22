import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrainServer } from '../server/brain-api.mjs';
import { createWorldStore } from '../server/world-store.mjs';

const clickHandler = (listeners, dataset) => listeners.click({ target: { closest: name => name === 'button' ? { dataset } : null } });

test('actual UI delegates server World operations, survives reload and preserves local migration backup', async () => {
 const folder=await mkdtemp(join(tmpdir(),'beika-remote-ui-'));
 const dist=join(folder,'dist');await mkdir(dist);await writeFile(join(dist,'index.html'),'ok');
 const store=createWorldStore({root:join(folder,'worlds')});
 const server=createBrainServer({root:dist,worldStore:store});
 const old={document:globalThis.document,FormData:globalThis.FormData,fetch:globalThis.fetch,localStorage:globalThis.localStorage,setInterval:globalThis.setInterval};
 const listeners={};const data=new Map();const root={innerHTML:''};
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  globalThis.fetch=(url,opts)=>old.fetch(url.startsWith('/')?base+url:url,opts);
  globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,v)=>data.set(key,v)};
  delete globalThis.indexedDB;
  globalThis.document={hidden:false,getElementById(){return root;},addEventListener(name,fn){listeners[name]=fn;}};
  globalThis.setInterval=()=>0;
  globalThis.FormData=class{constructor(){this.fields=new Map([['worldName','遠端驗收世界'],['server','on']]);}get(key){return this.fields.get(key)??null;}};
  await import('../src/app.js?ui-server-world-smoke');
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.match(root.innerHTML,/儲存至本機伺服器/);
  await listeners.submit({target:{id:'create-world'},preventDefault(){}});
  assert.match(root.innerHTML,/遠端驗收世界/);
  await clickHandler(listeners,{action:'step'});
  const [entry]=await store.list();
  let snapshot=await store.get(entry.id);
  assert.equal(snapshot.world.minutes,60);
  await clickHandler(listeners,{place:'park'});
  await clickHandler(listeners,{action:'travel'});
  snapshot=await store.get(entry.id);
  assert.equal(snapshot.world.observer.placeId,'park');
  assert.ok(snapshot.world.minutes>60);
  await clickHandler(listeners,{view:'settings'});
  assert.match(root.innerHTML,/伺服器權威（本機單使用者）/);
  await clickHandler(listeners,{action:'worlds'});
  assert.match(root.innerHTML,/伺服器權威/);
  await clickHandler(listeners,{open:entry.id,source:'server'});
  assert.match(root.innerHTML,/觀察者目前在米花公園/);
  assert.equal(data.get('beika-rebuild-worlds'),undefined,'server mode does not forge a browser save');
  await clickHandler(listeners,{action:'worlds'});
  globalThis.FormData=class{constructor(){this.fields=new Map([['worldName','移轉備份世界']]);}get(key){return this.fields.get(key)??null;}};
  await listeners.submit({target:{id:'create-world'},preventDefault(){}});
  await clickHandler(listeners,{view:'settings'});
  assert.match(root.innerHTML,/移轉至伺服器/);
  const savedBefore=JSON.parse(data.get('beika-rebuild-worlds'));
  const backupId=Object.values(savedBefore).find(w=>w.name==='移轉備份世界').id;
  await clickHandler(listeners,{action:'migrate-server'});
  const migrated=await store.get(backupId);
  assert.equal(migrated.world.paused,true);
  assert.equal(migrated.world.metadata.historic_client_events_unverified,true);
  assert.ok(JSON.parse(data.get('beika-rebuild-worlds'))[backupId],'original IndexedDB/localStorage backup remains');
  await clickHandler(listeners,{action:'worlds'});
  assert.match(root.innerHTML,/移轉備份世界/);
 }finally{
  Object.assign(globalThis,{document:old.document,FormData:old.FormData,fetch:old.fetch,localStorage:old.localStorage,setInterval:old.setInterval});
  await new Promise(resolve=>server.close(resolve));
  await rm(folder,{recursive:true,force:true});
 }
});
