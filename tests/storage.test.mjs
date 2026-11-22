import test from 'node:test';import assert from 'node:assert/strict';
import {makeWorld} from '../src/core/world.js';
import {storage} from '../src/core/storage.js';

test('world creation falls back to persistent localStorage when IndexedDB is unavailable',async()=>{
 const record=new Map();
 globalThis.localStorage={getItem:key=>record.get(key)||null,setItem:(key,val)=>record.set(key,val)};
 delete globalThis.indexedDB;
 const world=makeWorld('持久化',false,2500);const layer=await storage.put(world);
 assert.equal(layer,'localStorage');assert.equal((await storage.list()).length,1);
 const loaded=await storage.get(world.id);assert.equal(loaded.name,world.name);
 // Re-import module to simulate leaving the page without keeping memoryFallback.
 const fresh=(await import('../src/core/storage.js?fresh=1')).storage;
 assert.equal((await fresh.get(world.id)).name,'持久化');
 await fresh.remove(world.id);assert.equal((await fresh.list()).length,0);
 delete globalThis.localStorage;
});
test('older 0.1 localStorage snapshots are upgraded on load, not erased',async()=>{
 const record=new Map();globalThis.localStorage={getItem:key=>record.get(key)||null,setItem:(key,val)=>record.set(key,val)};
 const world=makeWorld('舊版',false,3000);world.schemaVersion=1;delete world.observer;delete world.signals;delete world.nextLogSeq;
 for(const p of world.people){delete p.intent;delete p.travel;delete p.route;}
 record.set('beika-rebuild-worlds',JSON.stringify({[world.id]:world}));
 const loaded=await storage.get(world.id);assert.equal(loaded.schemaVersion,2);
 assert.equal(loaded.people.length,world.people.length);assert.equal(loaded.id,world.id);
 await storage.put(loaded);assert.equal((await storage.get(world.id)).schemaVersion,2);
 delete globalThis.localStorage;
});
