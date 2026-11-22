import {cp,mkdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
const out='dist';await rm(out,{force:true,recursive:true});await mkdir(out,{recursive:true});
await cp('index.html',join(out,'index.html'));await cp('src',join(out,'src'),{recursive:true});
const s=await stat(join(out,'index.html'));console.log(`Built ${out}/ with static modules (${s.size} byte entry).`);