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
