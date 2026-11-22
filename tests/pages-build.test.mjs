import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPages } from '../tools/build-pages.mjs';
import { verifyPages } from '../tools/verify-pages.mjs';

test('buildPages + verifyPages produces a clean Cloudflare Pages bundle and catches regressions', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kz-pages-test-'));
  try {
    const info = buildPages({ outDir: tmp, origin: 'https://day98.rairakku.com' });
    assert.ok(info.fileCount > 50);
    assert.ok(info.maxBytes < 25 * 1024 * 1024);

    const ok = verifyPages({ outDir: tmp, origin: 'https://day98.rairakku.com' });
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.ok, true);

    // Mutation 1: removing blob: from connect-src must fail verifyPages
    const headersPath = path.join(tmp, '_headers');
    const origHeaders = fs.readFileSync(headersPath, 'utf8');
    fs.writeFileSync(headersPath, origHeaders.replace("connect-src 'self' blob:", "connect-src 'self'"));
    const m1 = verifyPages({ outDir: tmp, origin: 'https://day98.rairakku.com' });
    assert.equal(m1.ok, false);
    assert.ok(m1.errors.some(e => e.includes('blob:')));
    fs.writeFileSync(headersPath, origHeaders);

    // Mutation 2: corrupting importmap hash in CSP must fail
    fs.writeFileSync(headersPath, origHeaders.replace(/sha256-[A-Za-z0-9+/=]+/, 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='));
    const m2 = verifyPages({ outDir: tmp, origin: 'https://day98.rairakku.com' });
    assert.equal(m2.ok, false);
    assert.ok(m2.errors.some(e => e.includes('hash mismatch')));
    fs.writeFileSync(headersPath, origHeaders);

    // Mutation 3: shipping legacy v18 scene.glb must fail
    fs.writeFileSync(path.join(tmp, 'assets/scene.glb'), 'dummy');
    const m3 = verifyPages({ outDir: tmp, origin: 'https://day98.rairakku.com' });
    assert.equal(m3.ok, false);
    assert.ok(m3.errors.some(e => e.includes('assets/scene.glb')));
    fs.rmSync(path.join(tmp, 'assets/scene.glb'));

    // Mutation 4: leaking /Users/ local path must fail
    const noticePath = path.join(tmp, 'NOTICE.md');
    const origNotice = fs.readFileSync(noticePath, 'utf8');
    fs.writeFileSync(noticePath, origNotice + '\n/Users/example/leak\n');
    const m4 = verifyPages({ outDir: tmp, origin: 'https://day98.rairakku.com' });
    assert.equal(m4.ok, false);
    assert.ok(m4.errors.some(e => e.includes('/Users/')));
    fs.writeFileSync(noticePath, origNotice);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
