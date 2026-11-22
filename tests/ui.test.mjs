import test from 'node:test';
import assert from 'node:assert/strict';

test('delegated UI flow creates, travels, inspects and reopens a persistent world',async()=>{
 const root={innerHTML:''},listeners={},data=new Map();
 const oldDocument=globalThis.document,oldStorage=globalThis.localStorage,oldFormData=globalThis.FormData,oldTimer=globalThis.setInterval;
 try{
  globalThis.localStorage={getItem(key){return data.get(key)??null;},setItem(key,value){data.set(key,value);}};
  delete globalThis.indexedDB;
  globalThis.document={hidden:false,getElementById(id){assert.equal(id,'app');return root;},addEventListener(name,fn){listeners[name]=fn;}};
  globalThis.setInterval=()=>0;
  globalThis.FormData=class{constructor(){this.fields=new Map([['worldName','驗收世界']]);}get(name){return this.fields.get(name)??null;}};
  await import('../src/app.js?ui-smoke');
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(root.innerHTML,/創建新世界/);
  await listeners.submit({target:{id:'create-world'},preventDefault(){}});
  assert.match(root.innerHTML,/目前的世界/);assert.match(root.innerHTML,/驗收世界/);
  assert.match(root.innerHTML,/觀察者目前在毛利偵探事務所/);
  const click=async dataset=>listeners.click({target:{closest:selector=>selector==='button'?{dataset}:null}});
  await click({place:'park'});assert.match(root.innerHTML,/走訪此處/);
  await click({action:'travel'});assert.match(root.innerHTML,/觀察者目前在米花公園/);
  await click({action:'enter'});assert.match(root.innerHTML,/data-room="長椅"/);
  await click({room:'長椅'});assert.match(root.innerHTML,/最近現場觀察/);
  await click({action:'worlds'});assert.match(root.innerHTML,/我的世界/);
  assert.match(root.innerHTML,/驗收世界/);
  const saves=JSON.parse(data.get('beika-rebuild-worlds'));const [worldId]=Object.keys(saves);
  assert.equal(saves[worldId].observer.placeId,'park');
  assert.equal(saves[worldId].observer.roomId,'長椅');
  await click({open:worldId});assert.match(root.innerHTML,/觀察者目前在米花公園/);
  assert.match(root.innerHTML,/最近現場觀察/);
 }finally{
  globalThis.document=oldDocument;globalThis.localStorage=oldStorage;globalThis.FormData=oldFormData;globalThis.setInterval=oldTimer;
 }
});
