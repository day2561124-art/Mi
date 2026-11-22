import {upgradeWorld,validateWorld} from './world.js';
const DB='beika-stage-rebuild-worlds-v1',TABLE='worlds',FALLBACK='beika-rebuild-worlds';
let memoryFallback={};
function localRead(){try{return JSON.parse(localStorage.getItem(FALLBACK)||'{}');}catch{return memoryFallback;}}
function localWrite(value){memoryFallback=value;try{localStorage.setItem(FALLBACK,JSON.stringify(value));return true;}catch{return false;}}
function database(){
 return new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(new Error('IndexedDB 不可用'));return;}
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(TABLE))request.result.createObjectStore(TABLE,{keyPath:'id'});};
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>resolve(request.result);
 });
}
async function transaction(mode,operation){
 const db=await database();
 try{
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction(TABLE,mode),req=operation(tx.objectStore(TABLE));
   let value;req.onsuccess=()=>{value=req.result;};req.onerror=()=>reject(req.error);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('儲存交易被中止'));
  });
 }finally{db.close();}
}
// Keep successful fallback saves visible even after IndexedDB becomes available
// again. Older IndexedDB copies must never shadow newer fallback progress.
function preferLatest(...lists){
 const merged=new Map();
 for(const source of lists.flat()){
  if(!source||![1,2].includes(source.schemaVersion))continue;
  const existing=merged.get(source.id);
  if(!existing||(source.savedAt||0)>(existing.savedAt||0))merged.set(source.id,source);
 }
 return [...merged.values()].sort((a,b)=>b.savedAt-a.savedAt);
}
export const storage={
 async list(){
  let indexed=[];try{indexed=await transaction('readonly',store=>store.getAll());}catch{ /* Use the fallback alone. */ }
  return preferLatest(Object.values(localRead()),indexed);
 },
 async get(id){
  let indexed=null;try{indexed=await transaction('readonly',store=>store.get(id));}catch{ /* Use the fallback alone. */ }
  const latest=preferLatest(localRead()[id],indexed)[0];
  return latest?upgradeWorld(latest):null;
 },
 async put(world){
  validateWorld(world);
  try{
   await transaction('readwrite',store=>store.put(world));
   const fallback=localRead();
   // An old fallback copy may still exist; it is harmless if localStorage is
   // unavailable, since preferLatest() picks the more recent savedAt.
   if(Object.prototype.hasOwnProperty.call(fallback,world.id)){delete fallback[world.id];localWrite(fallback);}
   return 'IndexedDB';
  }catch{
   const data=localRead();data[world.id]=world;
   if(!localWrite(data))throw new Error('瀏覽器無法寫入永久存檔，請檢查無痕模式或儲存權限。');
   return 'localStorage';
  }
 },
 async remove(id){
  let indexedRemoved=false;
  try{await transaction('readwrite',store=>store.delete(id));indexedRemoved=true;}catch{ /* Try fallback deletion too. */ }
  const fallback=localRead(),hadFallback=Object.prototype.hasOwnProperty.call(fallback,id);
  if(hadFallback){delete fallback[id];if(!localWrite(fallback))throw new Error('無法刪除備援存檔。');}
  if(!indexedRemoved&&!hadFallback)throw new Error('無法確認存檔已刪除，請檢查瀏覽器儲存權限。');
 }
};
