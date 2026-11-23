import {createHash,randomUUID} from 'node:crypto';
import {cp,copyFile,lstat,mkdir,open,readFile,readdir,rename,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,relative,resolve,isAbsolute} from 'node:path';

const sessionPattern=/^agent_run_\d{8}-\d{6}-[a-f0-9]{8}$/;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const hash=b=>createHash('sha256').update(b).digest('hex');
const inside=(a,b)=>{const r=relative(a,b);return r===''||(r!=='..'&&!r.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(r));};
async function exists(p){try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function inventory(root){
 const files={};
 async function walk(dir){
  for(const ent of await readdir(dir,{withFileTypes:true})){
   const p=join(dir,ent.name),st=await lstat(p);
   if(st.isSymbolicLink())throw fail('NATIVE_MIGRATION_LINK','拒絕搬移含符號連結的角色腦資料。');
   if(st.isDirectory())await walk(p);
   else if(st.isFile())files[relative(root,p)]=hash(await readFile(p));
   else throw fail('NATIVE_MIGRATION_FILE','角色腦資料含不支援的項目。');
  }
 }
 await walk(root);return JSON.stringify(Object.entries(files).sort());
}
async function verified(dir,id){
 const names=['run.json','world_state.json','world_history.json'];
 const [run,state,history]=await Promise.all(names.map(n=>readFile(join(dir,n),'utf8').then(JSON.parse)));
 if(run.run_id!==id||state.world_simulation_session_id!==id||history.world_simulation_session_id!==id)
  throw fail('NATIVE_MIGRATION_LINEAGE','角色腦世界回合身分不一致。');
 return inventory(dir);
}
async function copyExact(source,target){
 const data=await readFile(source);await mkdir(dirname(target),{recursive:true});
 try{await copyFile(source,target,constants.COPYFILE_EXCL);}
 catch(e){if(e.code!=='EEXIST')throw e;}
 if(hash(await readFile(target))!==hash(data))throw fail('NATIVE_MIGRATION_CONFLICT','角色腦輔助紀錄不一致。');
}
async function migrationReceipt(file){
 try{return JSON.parse(await readFile(file,'utf8'));}
 catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function saveMigrationReceipt(file,id,fingerprint,source){
 const state=JSON.parse(await readFile(join(source,'world_state.json'),'utf8'));
 const history=JSON.parse(await readFile(join(source,'world_history.json'),'utf8'));
 if(!Number.isSafeInteger(state.revision)||!Array.isArray(history.turns))
  throw fail('NATIVE_MIGRATION_LINEAGE','來源世界的歷史基準無效。');
 const receipt={version:2,session_id:id,source_fingerprint:fingerprint,
  baseline_revision:state.revision,baseline_turn_count:history.turns.length,
  baseline_history_hash:hash(JSON.stringify(history.turns))};
 await mkdir(dirname(file),{recursive:true});
 const h=await open(file,'wx',0o600);
 try{await h.writeFile(JSON.stringify(receipt));await h.sync();}
 finally{await h.close();}
}
async function requireReceiptContinuation(receipt,target){
 if(receipt.version!==2||!Number.isSafeInteger(receipt.baseline_revision)
   ||!Number.isSafeInteger(receipt.baseline_turn_count)||typeof receipt.baseline_history_hash!=='string')
   throw fail('NATIVE_MIGRATION_CONFLICT','私有世界缺少可核對的歷史基準。');
 const state=JSON.parse(await readFile(join(target,'world_state.json'),'utf8'));
 const history=JSON.parse(await readFile(join(target,'world_history.json'),'utf8'));
 if(!Number.isSafeInteger(state.revision)||state.revision<receipt.baseline_revision
   ||!Array.isArray(history.turns)||history.turns.length<receipt.baseline_turn_count
   ||hash(JSON.stringify(history.turns.slice(0,receipt.baseline_turn_count)))!==receipt.baseline_history_hash)
  throw fail('NATIVE_MIGRATION_CONFLICT','米花私有世界的已提交歷史發生回退或遭修改。');
}
async function requireAppendOnlyContinuation(source,target){
 const srcHistory=JSON.parse(await readFile(join(source,'world_history.json'),'utf8'));
 const dstHistory=JSON.parse(await readFile(join(target,'world_history.json'),'utf8'));
 const srcState=JSON.parse(await readFile(join(source,'world_state.json'),'utf8'));
 const dstState=JSON.parse(await readFile(join(target,'world_state.json'),'utf8'));
 if(!Array.isArray(srcHistory.turns)||!Array.isArray(dstHistory.turns)
   ||!Number.isSafeInteger(srcState.revision)||!Number.isSafeInteger(dstState.revision)
   ||dstState.revision<srcState.revision||dstHistory.turns.length<srcHistory.turns.length
   ||srcHistory.turns.some((x,i)=>hash(JSON.stringify(x))!==hash(JSON.stringify(dstHistory.turns[i]))))
    throw fail('NATIVE_MIGRATION_CONFLICT','新位置的角色腦歷史不是舊歷史的有效延續。');
}
export async function ensureOwnedNativeSessions({upstreamRoot,privateRoot,indexFile}){
 const from=resolve(upstreamRoot),to=resolve(privateRoot),index=resolve(indexFile);
 if(inside(from,to)||inside(to,from))throw fail('NATIVE_DATA_ROOT_INVALID','米花角色腦資料目錄不可與上游程式碼重疊。');
 let raw;try{raw=await readFile(index,'utf8');}catch(e){if(e.code==='ENOENT')return {migrated:0,existing:0};throw e;}
 const saved=JSON.parse(raw);
 if(saved.version!==1||!saved.worlds||typeof saved.worlds!=='object'||Array.isArray(saved.worlds))
  throw fail('NATIVE_MIGRATION_INDEX','角色腦索引格式無效。');
 const ids=[...new Set(Object.values(saved.worlds).map(w=>w?.session_id).filter(Boolean))];
 if(ids.some(id=>typeof id!=='string'||!sessionPattern.test(id)))throw fail('NATIVE_MIGRATION_LINEAGE','索引存在無效的回合識別。');
 if(!ids.length)return {migrated:0,existing:0};
 await mkdir(to,{recursive:true});
 const lock=join(to,'.migration.lock');
 let handle;try{handle=await open(lock,'wx',0o600);}
 catch(e){if(e.code==='EEXIST')throw fail('NATIVE_MIGRATION_BUSY','遷移上鎖，拒絕同時處理。');throw e;}
 let migrated=0,existing=0;
 try{
  for(const id of ids){
   const source=join(from,'data','agent_runs',id),target=join(to,'agent_runs',id);
   const receiptFile=join(to,'.mi-migration-receipts',id+'.json');
   const hasOld=await exists(source),hasNew=await exists(target);
   if(!hasOld&&!hasNew)throw fail('NATIVE_MIGRATION_MISSING','舊角色腦存檔遺失，拒絕建立替代回合。');
   const original=hasOld?await verified(source,id):null;
   if(hasNew){
    const current=await verified(target,id);
    const receipt=await migrationReceipt(receiptFile);
    if(receipt){
     if(receipt.session_id!==id)
      throw fail('NATIVE_MIGRATION_CONFLICT','遷移證明與角色腦回合身分不符。');
     await requireReceiptContinuation(receipt,target);
     if(hasOld){
      if(receipt.source_fingerprint!==original)
       throw fail('NATIVE_MIGRATION_CONFLICT','舊來源資料與遷移證明不一致。');
      await requireAppendOnlyContinuation(source,target);
     }
    }else if(hasOld){
     if(original!==current)throw fail('NATIVE_MIGRATION_CONFLICT','缺少遷移證明且新舊存檔不一致。');
     await saveMigrationReceipt(receiptFile,id,original,source);
    }else{
     throw fail('NATIVE_MIGRATION_CONFLICT','舊來源已消失，但私有世界缺少可核對的遷移證明。');
    }
    existing++;continue;
   }
   await mkdir(dirname(target),{recursive:true});
   const stage=target+'.migration-'+randomUUID();
   try{
    await cp(source,stage,{recursive:true,dereference:false,force:false,errorOnExist:true});
    if(original!==await verified(stage,id))throw fail('NATIVE_MIGRATION_VERIFY','搬移後雜湊不一致。');
    if(await exists(target))throw fail('NATIVE_MIGRATION_CONFLICT','目的地已被其他程序建立。');
    await rename(stage,target);
    await saveMigrationReceipt(receiptFile,id,original,source);
    migrated++;
   }finally{await rm(stage,{recursive:true,force:true}).catch(()=>{});}
  }
  const traces=join(from,'data','agent_runs','neural_traces');
  if(await exists(traces)){
   for(const name of await readdir(traces)){
    if(!/^neural_trace_[\w-]+\.json$/.test(name))continue;
    const f=join(traces,name),st=await lstat(f);
    if(!st.isFile()||st.isSymbolicLink())throw fail('NATIVE_MIGRATION_FILE','上游軌跡不是一般檔案。');
    const record=JSON.parse(await readFile(f,'utf8'));
    if(ids.includes(record.run_id))await copyExact(f,join(to,'agent_runs','neural_traces',name));
   }
  }
  return {migrated,existing};
 }finally{await handle.close();await rm(lock,{force:true});}
}
