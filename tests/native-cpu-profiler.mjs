import { Session } from 'node:inspector';

// Test-only CPU sampler. Store only aggregate function/stack time, never
// runtime World snapshots, character memories or full inspector profiles.
function publicModule(url) {
  const value=String(url??'').replaceAll('\\','/');
  const upstream='/vendor/wRITE/';
  const pos=value.indexOf(upstream);
  if(pos>=0)return 'wRITE/'+value.slice(pos+upstream.length);
  const local='/Mi/';
  const localPos=value.lastIndexOf(local);
  if(localPos>=0)return 'Mi/'+value.slice(localPos+local.length);
  if(value.startsWith('node:'))return value;
  return value.split('/').at(-1)||'[unknown]';
}
function frameKey(node) {
  const frame=node?.callFrame??{};
  const name=String(frame.functionName||'[anonymous]').slice(0,90);
  const file=publicModule(frame.url);
  const line=Number.isSafeInteger(frame.lineNumber)?frame.lineNumber+1:0;
  return name+' @ '+file+':'+line;
}
function rounded(ms) {return Math.round(ms*10)/10;}

export function summarizeNativeCpuProfile(profile, limit=15) {
  if(!profile||!Array.isArray(profile.nodes) || !Array.isArray(profile.samples) ||
    !Array.isArray(profile.timeDeltas))throw new Error('Invalid V8 CPU sample profile');
  const nodes=new Map(profile.nodes.map(node=>[node.id,node]));
  const parent=new Map();
  for(const node of profile.nodes)for(const child of node.children??[])parent.set(child,node.id);
  const self=new Map(),inclusive=new Map();
  let totalUs=0, accepted=0;
  const add=(table,key,us)=>table.set(key,(table.get(key)??0)+us);
  for(let i=0;i<profile.samples.length;i++){
    const delta=Number(profile.timeDeltas[i]);
    const id=profile.samples[i];
    if(!Number.isFinite(delta)||delta<=0||!nodes.has(id))continue;
    totalUs+=delta;accepted++;
    add(self,frameKey(nodes.get(id)),delta);
    const visited=new Set(),seenKeys=new Set();
    let current=id;
    while(nodes.has(current)&&!visited.has(current)){
      visited.add(current);
      const key=frameKey(nodes.get(current));
      // One sample contributes at most once per function+location, even
      // if recursion repeats the frame on the same sampled stack.
      if(!seenKeys.has(key)){add(inclusive,key,delta);seenKeys.add(key);}
      current=parent.get(current);
    }
  }
  const sorted=(table,predicate=()=>true)=>[...table.entries()]
    .filter(([frame])=>predicate(frame)).sort((a,b)=>b[1]-a[1]).slice(0,limit)
    .map(([frame,us])=>({frame,sampledMs:rounded(us/1000),
      percent:totalUs?rounded(us*100/totalUs):0}));
  const upstream=frame=>frame.includes(' @ wRITE/');
  const nonRoot=frame=>!frame.startsWith('(root) @');
  return {sampleCount:accepted,totalSampledMs:rounded(totalUs/1000),
    topSelf:sorted(self,nonRoot),topInclusive:sorted(inclusive,nonRoot),
    topUpstreamSelf:sorted(self,upstream),topUpstreamInclusive:sorted(inclusive,upstream)};
}

export async function startNativeCpuProfile() {
  const session=new Session();
  session.connect();
  const post=(name,params={})=>new Promise((resolve,reject)=>
    session.post(name,params,(error,result)=>error?reject(error):resolve(result)));
  try {
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval',{interval:1000});
    await post('Profiler.start');
  } catch(error){session.disconnect();throw error;}
  let stopped=false;
  return async function finish() {
    if(stopped)throw new Error('CPU profiler already stopped');
    stopped=true;
    try {
      const {profile}=await post('Profiler.stop');
      return summarizeNativeCpuProfile(profile);
    } finally {
      try {await post('Profiler.disable');} catch { /* preserving original failure */ }
      session.disconnect();
    }
  };
}
