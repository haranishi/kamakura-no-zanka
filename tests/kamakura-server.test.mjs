import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHandler } from '../tools/serve.mjs';
// Exercise the real HTTP handler without bind/listen, which workspace sandboxes may prohibit.
async function request(handler, url, method = 'GET') {
  const res = { status: 0, headers: {}, body: undefined, writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  await handler({ url, method }, res); return res;
}
test('private server mount is opt-in, read-only, typed, uncached and confines symlinks', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kz-server-test-')), inside = path.join(dir, 'private');
  try {
    await fs.mkdir(inside); await fs.writeFile(path.join(dir, 'outside.json'), 'private outside');
    for (const name of ['meta.json', 'height.bin', 'README.md']) await fs.writeFile(path.join(inside, name), 'synthetic');
    await fs.symlink(path.join(dir, 'outside.json'), path.join(inside, 'escape.json'));
    await fs.symlink(dir, path.join(inside, 'escape-dir'));
    const off = createHandler({ worldDir: '' }), on = createHandler({ worldDir: inside });
    assert.equal((await request(off, '/world-private/meta.json')).status, 404);
    for (const [file, type] of [['meta.json', 'application/json'], ['height.bin', 'application/octet-stream'], ['README.md', 'text/markdown']]) {
      const get = await request(on, '/world-private/' + file), head = await request(on, '/world-private/' + file, 'HEAD');
      assert.equal(get.status, 200); assert.equal(head.status, 200); assert.equal(head.body, undefined);
      assert(get.headers['Content-Type'].startsWith(type)); assert.equal(get.headers['Cache-Control'], 'no-store');
      assert.equal(get.body.toString(), 'synthetic'); assert.equal(head.headers['Content-Length'], get.body.length);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) { const r = await request(on, '/world-private/meta.json', method); assert.equal(r.status, 405); assert.equal(r.headers.Allow, 'GET, HEAD'); }
    for (const url of ['/world-private/../outside.json', '/world-private/%2e%2e/outside.json', '/world-private/%2e%2e%2foutside.json', '/world-private/..%5coutside.json', '/world-private/a\\b', '/world-private/%00']) assert.equal((await request(on, url)).status, 403, url);
    assert.equal((await request(on, '/world-private/%zz')).status, 400);
    for (const url of ['/world-private/escape.json', '/world-private/escape-dir/outside.json']) assert.equal((await request(on, url)).status, 403);
    for (const url of ['/world-private/', '/world-private', '/world-private/missing', '/world-private-other/meta.json']) assert.equal((await request(on, url)).status, 404);
    assert.equal(await fs.readFile(path.join(inside, 'meta.json'), 'utf8'), 'synthetic');
    // Normal routes behave identically when the private mount is enabled or absent.
    for (const url of ['/', '/valley/', '/valley', '/valley/main.js', '/missing']) {
      const a = await request(off, url), b = await request(on, url);
      assert.equal(a.status, b.status); assert.deepEqual(a.headers, b.headers); assert.deepEqual(a.body, b.body);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
