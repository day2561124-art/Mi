import {validateWorld} from './world.js';
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
export const storage={
 async list(){
  try{return (await transaction('readonly',store=>store.getAll())).sort((a,b)=>b.savedAt-a.savedAt);}
  catch{return Object.values(localRead()).sort((a,b)=>b.savedAt-a.savedAt);}
 },
 async get(id){try{return await transaction('readonly',store=>store.get(id));}catch{return localRead()[id];}},
 async put(world){
  validateWorld(world);
  try{await transaction('readwrite',store=>store.put(world));return 'IndexedDB';}
  catch(e){const data=localRead();data[world.id]=world;if(!localWrite(data))throw new Error('瀏覽器無法寫入永久存檔，請檢查無痕模式或儲存權限。');return 'localStorage';}
 },
 async remove(id){
  try{await transaction('readwrite',store=>store.delete(id));}catch{const data=localRead();delete data[id];if(!localWrite(data))throw new Error('無法刪除存檔。');}
 }
};