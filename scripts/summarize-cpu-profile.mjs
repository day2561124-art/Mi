import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.argv[2] || '.profiles';
const files = (await readdir(directory)).filter(name => name.endsWith('.cpuprofile')).sort();
if (!files.length) throw new Error('No V8 CPU profiles were captured.');
const reports = [];
for (const name of files) {
  const profile = JSON.parse(await readFile(join(directory, name), 'utf8'));
  const nodes = new Map((profile.nodes || []).map(node => [node.id, node]));
  const counts = new Map();
  if (Array.isArray(profile.samples) && profile.samples.length) {
    for (const id of profile.samples) counts.set(id, (counts.get(id) || 0) + 1);
  } else {
    for (const node of nodes.values()) counts.set(node.id, node.hitCount || 0);
  }
  const functions = new Map();
  for (const [id, samples] of counts) {
    const frame = nodes.get(id)?.callFrame;
    if (!frame || !samples) continue;
    const source = String(frame.url || '').split('/').slice(-3).join('/');
    const key = (frame.functionName || '(anonymous)') + ' @ ' + source + ':' + (frame.lineNumber ?? 0);
    functions.set(key, (functions.get(key) || 0) + samples);
  }
  const sampled = [...counts.values()].reduce((a, b) => a + b, 0);
  const durationMs = Math.round((profile.endTime - profile.startTime) / 1000);
  const top = [...functions].sort((a, b) => b[1] - a[1]).slice(0, 25)
    .map(([functionName, selfSamples]) => ({
      functionName, selfSamples,
      selfPercent: sampled ? Number((100 * selfSamples / sampled).toFixed(2)) : 0
    }));
  reports.push({ file: name, durationMs, samples: sampled, top });
}
const primary = [...reports].sort((a, b) => b.samples - a.samples)[0];
console.log('BEIKA_CPU_PROFILE_SUMMARY', JSON.stringify({
  profileCount: reports.length, primary,
  otherProfiles: reports.filter(r => r !== primary)
    .map(r => ({file:r.file,durationMs:r.durationMs,samples:r.samples}))
}));
