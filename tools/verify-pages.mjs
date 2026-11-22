// tools/verify-pages.mjs — Cloudflare Pages 公開用出力（.pages-dist/）の公開ゲート検査。
// 容量上限・禁止ファイル除外・相対リンク実在・OGP/canonical/share契約・CSPハッシュ一致・JS構文・秘密漏洩を検証する。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ORIGIN, sha256Base64 } from './build-pages.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_FILE_BYTES = 25 * 1024 * 1024; // Cloudflare Pages single-file limit (25 MiB)
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 20000;

function fileExistsExactly(base, rel) {
  let cur = base;
  for (const part of String(rel).split('/')) {
    if (!part || part === '.' || part === '..') return false;
    let names;
    try {
      names = fs.readdirSync(cur);
    } catch {
      return false;
    }
    if (!names.includes(part)) return false;
    cur = path.join(cur, part);
  }
  try {
    return fs.statSync(cur).isFile();
  } catch {
    return false;
  }
}

export function verifyPages({
  outDir = path.join(DEFAULT_ROOT, '.pages-dist'),
  origin = DEFAULT_ORIGIN,
} = {}) {
  const errors = [];
  const base = path.resolve(outDir);
  const pageUrl = `${origin.replace(/\/+$/, '')}/`;
  if (!fs.existsSync(base)) return { ok: false, errors: [`Output directory does not exist: ${base}`], stats: null };

  // 1. Required files
  const required = [
    'index.html',
    '404.html',
    '_headers',
    '_redirects',
    'favicon.svg',
    'og.jpg',
    'LICENSE',
    'LICENSE-ASSETS.md',
    'NOTICE.md',
    'licenses/THREE-LICENSE.txt',
    'audio.js',
    'valley/main.js',
    'valley/valley.css',
    'valley/valley-touch.css',
    'valley/share-ui.css',
    'vendor/three.module.min.js',
  ];
  for (const rel of required) {
    if (!fileExistsExactly(base, rel)) errors.push(`Missing required file: ${rel}`);
  }

  // 2. Walk all files, enforce limits & forbidden items
  const allFiles = [];
  let totalBytes = 0;
  let maxBytes = 0;
  const walk = d => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, entry.name);
      const rel = path.relative(base, abs).split(path.sep).join('/');
      if (entry.name.startsWith('.') && entry.name !== '.') {
        errors.push(`Hidden file shipped: ${rel}`);
      }
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        const size = fs.statSync(abs).size;
        allFiles.push({ rel, abs, size });
        totalBytes += size;
        if (size > maxBytes) maxBytes = size;
        if (size >= MAX_FILE_BYTES) errors.push(`File exceeds 25 MiB Cloudflare limit: ${rel} (${size} bytes)`);
      }
    }
  };
  walk(base);

  if (allFiles.length > MAX_FILES) errors.push(`Too many files for Cloudflare Pages: ${allFiles.length}`);
  if (totalBytes > MAX_TOTAL_BYTES) errors.push(`Total bundle exceeds 100 MiB budget: ${(totalBytes / 1048576).toFixed(1)} MiB`);

  const forbidden = [
    /^assets\/scene\.glb$/,
    /^assets\/collision\.json$/,
    /^assets\/kamakura\//,
    /^assets\/terrain\//,
    /^assets\/foliage\//,
    /^valley\/kamakura-/,
    /^valley\/entry\.js$/,
    /^valley\/world-kamakura\.js$/,
    /^valley\/hud-kamakura\.js$/,
    /^valley\/lab\./,
    /^valley\/viewer\./,
    /^valley\/world\./,
  ];
  for (const { rel } of allFiles) {
    for (const re of forbidden) {
      if (re.test(rel)) errors.push(`Forbidden non-public/legacy file shipped: ${rel}`);
    }
  }

  // 3. index.html checks: OGP, canonical, share:text, relative refs, importmap hash
  let importMapHash = '';
  if (fileExistsExactly(base, 'index.html')) {
    const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
    const canonicalMatches = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)];
    if (canonicalMatches.length !== 1 || canonicalMatches[0][1] !== pageUrl) {
      errors.push(`canonical mismatch: expected single "${pageUrl}"`);
    }
    const metaCheck = (attr, key, expected) => {
      const re = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]+)"`, 'g');
      const m = [...html.matchAll(re)];
      if (m.length !== 1) errors.push(`Expected exactly 1 meta ${attr}="${key}", found ${m.length}`);
      else if (expected && m[0][1] !== expected) errors.push(`meta ${key} mismatch: got "${m[0][1]}", expected "${expected}"`);
      return m[0]?.[1] || '';
    };
    const ogTitle = metaCheck('property', 'og:title', '残火の鎌倉 — 隠れ谷の灯');
    metaCheck('property', 'og:url', pageUrl);
    metaCheck('property', 'og:image', `${origin.replace(/\/+$/, '')}/og.jpg`);
    metaCheck('name', 'twitter:card', 'summary_large_image');
    const shareText = metaCheck('name', 'share:text');
    if (ogTitle && !shareText.includes(ogTitle)) errors.push(`share:text must contain og:title ("${ogTitle}")`);

    const mapMatch = html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/);
    if (!mapMatch) {
      errors.push('Missing importmap script in index.html');
    } else {
      importMapHash = sha256Base64(mapMatch[1]);
      try {
        const parsed = JSON.parse(mapMatch[1]);
        const threePath = parsed?.imports?.three?.replace(/^\.\//, '');
        if (!threePath || !fileExistsExactly(base, threePath)) errors.push(`importmap three target missing: ${threePath}`);
      } catch {
        errors.push('Invalid JSON inside importmap');
      }
    }

    for (const m of html.matchAll(/\b(?:href|src)="(\.\/[^"]+)"/g)) {
      const rel = m[1].slice(2);
      if (!fileExistsExactly(base, rel)) errors.push(`Broken relative reference in index.html: ${m[1]}`);
    }
    if (html.includes('/world-private')) errors.push('index.html references /world-private');
  }

  // 4. _headers checks
  if (fileExistsExactly(base, '_headers')) {
    const headers = fs.readFileSync(path.join(base, '_headers'), 'utf8');
    if (!headers.includes('X-Frame-Options: DENY')) errors.push('_headers missing X-Frame-Options: DENY');
    if (!headers.includes('X-Content-Type-Options: nosniff')) errors.push('_headers missing X-Content-Type-Options: nosniff');
    if (!headers.includes('camera=()') || !headers.includes('microphone=()')) errors.push('_headers missing strict Permissions-Policy');
    const cspLine = headers.split('\n').find(l => l.trim().startsWith('Content-Security-Policy:')) || '';
    if (!cspLine) {
      errors.push('_headers missing Content-Security-Policy');
    } else {
      if (importMapHash && !cspLine.includes(`script-src 'self' 'sha256-${importMapHash}'`)) {
        errors.push(`CSP script-src hash mismatch (expected sha256-${importMapHash})`);
      }
      if (/script-src[^;]*'unsafe-inline'|script-src[^;]*'unsafe-eval'/.test(cspLine)) {
        errors.push('CSP script-src must not permit unsafe-inline or unsafe-eval');
      }
      if (!cspLine.includes("connect-src 'self' blob:")) errors.push("CSP connect-src must permit 'self' blob: for GLB embedded textures");
      if (!cspLine.includes("frame-ancestors 'none'")) errors.push("CSP missing frame-ancestors 'none'");
      if (!cspLine.includes("object-src 'none'")) errors.push("CSP missing object-src 'none'");
    }
  }

  // 5. JS syntax, import resolution, and secret/local-path leak checks
  const textExts = new Set(['.html', '.js', '.css', '.json', '.md', '.txt', '.svg', '']);
  for (const { rel, abs } of allFiles) {
    const ext = path.extname(rel).toLowerCase();
    if (ext === '.js') {
      const syn = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
      if (syn.status !== 0) errors.push(`JS syntax error in ${rel}: ${syn.stderr.trim()}`);
      const src = fs.readFileSync(abs, 'utf8');
      if (src.includes('/world-private')) errors.push(`Shipped JS references /world-private: ${rel}`);
      if (!rel.startsWith('vendor/')) {
        const dir = path.posix.dirname(rel);
        for (const m of src.matchAll(/(?:import|export)\s+(?:[^'"]+from\s+)?['"](\.[^'"]+)['"]/g)) {
          const spec = m[1];
          if (!spec.endsWith('.js')) continue;
          const target = path.posix.normalize(path.posix.join(dir, spec));
          if (!fileExistsExactly(base, target)) errors.push(`Broken JS import in ${rel}: ${spec} -> ${target}`);
        }
      }
    }
    if (textExts.has(ext) && !rel.startsWith('vendor/')) {
      const text = fs.readFileSync(abs, 'utf8');
      if (/\/Users\//.test(text)) errors.push(`Local /Users/ path leaked in ${rel}`);
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(ghp_|github_pat_|sk-[A-Za-z0-9_-]{16,})/.test(text)) {
        errors.push(`Secret pattern leaked in ${rel}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: { fileCount: allFiles.length, totalBytes, maxBytes, importMapHash },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const pick = flag => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const res = verifyPages({
    outDir: pick('--out'),
    origin: pick('--origin') || DEFAULT_ORIGIN,
  });
  if (!res.ok) {
    console.error(`Pages verification FAILED (${res.errors.length} issue(s)):`);
    for (const err of res.errors) console.error(' - ' + err);
    process.exit(1);
  }
  console.log(
    `Pages verification PASSED: ${res.stats.fileCount} files, ` +
      `${(res.stats.totalBytes / 1048576).toFixed(1)} MiB total, ` +
      `max file ${(res.stats.maxBytes / 1048576).toFixed(2)} MiB, CSP/OGP/imports/security clean.`,
  );
}
