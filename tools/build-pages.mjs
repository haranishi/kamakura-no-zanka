// tools/build-pages.mjs — 第一章「隠れ谷の灯」の Cloudflare Pages 公開用パッケージ（.pages-dist/）を組み立てる。
// 依存ゼロ（Node.js 標準機能のみ）。dist/ 内の JS ファイルを書き換えず、valley/ をそのまま配置して
// ルートの index.html から起動する（buildings.js 等の ../assets/ と audio-valley.js の ../audio.js が無改変で解決する）。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_ORIGIN = 'https://day98.rairakku.com';
const SITE_TITLE = '残火の鎌倉 — 隠れ谷の灯';
const SITE_DESC =
  '1333年、鎌倉幕府滅亡後の信濃の隠れ谷。旧臣の侍として里を守り、負傷した仲間と廃寺へ帰る三人称3D時代劇アクション。登録なし・無料でブラウザだけで遊べます。';

/** dist/valley/main.js から到達できる相対 JS モジュール集合（dist/ からの相対パス）を返す。 */
export function collectValleyClosure(distDir, entryRel = 'valley/main.js') {
  const seen = new Set();
  function visit(relPath) {
    const norm = relPath.split(path.sep).join('/');
    if (seen.has(norm)) return;
    const abs = path.resolve(distDir, norm);
    if (!abs.startsWith(path.resolve(distDir) + path.sep)) {
      throw new Error(`Import escapes dist/: ${norm}`);
    }
    if (!fs.existsSync(abs)) {
      throw new Error(`Missing imported module: ${norm}`);
    }
    seen.add(norm);
    const src = fs.readFileSync(abs, 'utf8');
    const dir = path.posix.dirname(norm);
    const patterns = [
      /(?:import|export)\s+(?:[^'"]+from\s+)?['"](\.[^'"]+)['"]/g,
      /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    ];
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        const spec = m[1];
        if (!spec.endsWith('.js')) continue;
        const resolved = path.posix.normalize(path.posix.join(dir, spec));
        visit(resolved);
      }
    }
  }
  visit(entryRel);
  return [...seen].sort();
}

export function sha256Base64(text) {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}

/** 公開用 index.html と importmap の SHA-256 を生成する。 */
export function renderPublicIndex(sourceHtml, origin = DEFAULT_ORIGIN) {
  const base = origin.replace(/\/+$/, '');
  const pageUrl = `${base}/`;
  const ogImage = `${base}/og.jpg`;

  let html = sourceHtml
    .replace('href="./valley.css"', 'href="./valley/valley.css"')
    .replace('href="./valley-touch.css"', 'href="./valley/valley-touch.css"')
    .replace('href="./share-ui.css"', 'href="./valley/share-ui.css"')
    .replace('src="./entry.js"', 'src="./valley/main.js"')
    .replaceAll('../vendor/', './vendor/');

  const importMapMatch = html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/);
  if (!importMapMatch) throw new Error('importmap script not found in valley/index.html');
  const importMapHash = sha256Base64(importMapMatch[1]);

  const metaBlock = [
    `<link rel="canonical" href="${pageUrl}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="残火の鎌倉">`,
    `<meta property="og:locale" content="ja_JP">`,
    `<meta property="og:title" content="${SITE_TITLE}">`,
    `<meta property="og:description" content="${SITE_DESC}">`,
    `<meta property="og:url" content="${pageUrl}">`,
    `<meta property="og:image" content="${ogImage}">`,
    `<meta property="og:image:alt" content="夕暮れの隠れ谷と水穂の里を見下ろす場面">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${SITE_TITLE}">`,
    `<meta name="twitter:description" content="${SITE_DESC}">`,
    `<meta name="twitter:image" content="${ogImage}">`,
  ].join('\n');

  const headClose = html.indexOf('</head>');
  if (headClose < 0) throw new Error('</head> not found in valley/index.html');
  html = html.slice(0, headClose) + metaBlock + '\n' + html.slice(headClose);
  return { html, importMapHash };
}

/** Cloudflare Pages 用の _headers を生成する。 */
export function buildHeaders(importMapHash) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'sha256-${importMapHash}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "font-src 'self'",
    // GLTFLoader の埋め込み画像（ImageBitmapLoader）が端末内 blob: URL を fetch するため必須。外部へは出ない。
    "connect-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  return [
    '/*',
    '  X-Frame-Options: DENY',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()',
    `  Content-Security-Policy: ${csp}`,
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/vendor/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n');
}

export function render404Html() {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#171e1b">
<title>ページが見つかりません | ${SITE_TITLE}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#171e1b;color:#eee9dc;font:15px/1.8 'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;text-align:center}
  main{max-width:440px}
  h1{margin:0 0 12px;font:400 28px/1.5 'Yu Mincho','Hiragino Mincho ProN',serif;letter-spacing:.14em}
  p{margin:0 0 24px;color:#b6b9ac}
  a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 22px;border:1.5px solid rgba(238,233,220,.88);border-radius:4px;color:#eee9dc;text-decoration:none;font-family:'Yu Mincho','Hiragino Mincho ProN',serif;letter-spacing:.1em}
  a:hover{border-color:#d7705a}
</style>
</head>
<body>
  <main>
    <h1>このページは見つかりません</h1>
    <p>お探しの住所は存在しないか、移動しました。</p>
    <a href="/">残火の鎌倉 — 隠れ谷の灯 を開く</a>
  </main>
</body>
</html>
`;
}

function copyFilteredDir(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(dstDir, entry.name);
    if (entry.isDirectory()) copyFilteredDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

export function buildPages({
  root = DEFAULT_ROOT,
  outDir = path.join(root, '.pages-dist'),
  origin = DEFAULT_ORIGIN,
  ogSource = path.join(root, 'dist/valley/og.jpg'),
} = {}) {
  const distDir = path.join(root, 'dist');
  const resolvedOut = path.resolve(outDir);
  if (resolvedOut === path.resolve(root) || resolvedOut === path.resolve(distDir)) {
    throw new Error('Refusing to overwrite repository root or dist/');
  }

  fs.rmSync(resolvedOut, { recursive: true, force: true });
  fs.mkdirSync(resolvedOut, { recursive: true });

  // 1. JS closure from valley/main.js
  const jsFiles = collectValleyClosure(distDir, 'valley/main.js');
  for (const rel of jsFiles) {
    const dest = path.join(resolvedOut, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(distDir, rel), dest);
  }

  // 2. Stylesheets & favicon
  for (const css of ['valley.css', 'valley-touch.css', 'share-ui.css']) {
    const dest = path.join(resolvedOut, 'valley', css);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(distDir, 'valley', css), dest);
  }
  fs.copyFileSync(path.join(distDir, 'valley', 'favicon.svg'), path.join(resolvedOut, 'favicon.svg'));

  // 3. Vendor + Chapter 1 assets only (excludes v18 scene.glb, terrain, foliage, and kamakura photo)
  copyFilteredDir(path.join(distDir, 'vendor'), path.join(resolvedOut, 'vendor'));
  copyFilteredDir(path.join(distDir, 'assets/characters'), path.join(resolvedOut, 'assets/characters'));
  copyFilteredDir(path.join(distDir, 'assets/valley'), path.join(resolvedOut, 'assets/valley'));

  // 4. Licenses & provenance notices
  for (const doc of ['LICENSE', 'LICENSE-ASSETS.md', 'NOTICE.md']) {
    fs.copyFileSync(path.join(root, doc), path.join(resolvedOut, doc));
  }
  fs.mkdirSync(path.join(resolvedOut, 'licenses'), { recursive: true });
  fs.copyFileSync(path.join(root, 'licenses/THREE-LICENSE.txt'), path.join(resolvedOut, 'licenses/THREE-LICENSE.txt'));

  // 5. OGP image
  if (!fs.existsSync(ogSource)) throw new Error(`Missing OGP image source: ${ogSource}`);
  fs.copyFileSync(ogSource, path.join(resolvedOut, 'og.jpg'));

  // 6. index.html, 404.html, _headers, _redirects
  const sourceHtml = fs.readFileSync(path.join(distDir, 'valley/index.html'), 'utf8');
  const { html, importMapHash } = renderPublicIndex(sourceHtml, origin);
  fs.writeFileSync(path.join(resolvedOut, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(resolvedOut, '404.html'), render404Html(), 'utf8');
  fs.writeFileSync(path.join(resolvedOut, '_headers'), buildHeaders(importMapHash), 'utf8');
  fs.writeFileSync(
    path.join(resolvedOut, '_redirects'),
    '/valley / 301\n/valley/ / 301\n/valley/index.html / 301\n',
    'utf8',
  );

  // Compute summary
  let fileCount = 0;
  let totalBytes = 0;
  let maxBytes = 0;
  let maxFile = '';
  const walk = d => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) {
        const size = fs.statSync(p).size;
        fileCount++;
        totalBytes += size;
        if (size > maxBytes) {
          maxBytes = size;
          maxFile = path.relative(resolvedOut, p);
        }
      }
    }
  };
  walk(resolvedOut);
  return { outDir: resolvedOut, origin, jsCount: jsFiles.length, fileCount, totalBytes, maxBytes, maxFile, importMapHash };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const pick = flag => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const info = buildPages({
    outDir: pick('--out'),
    origin: pick('--origin') || DEFAULT_ORIGIN,
    ogSource: pick('--og-source'),
  });
  console.log(
    `Pages build complete: ${info.fileCount} files (${(info.totalBytes / 1048576).toFixed(1)} MiB), ` +
      `${info.jsCount} JS modules, largest ${info.maxFile} (${(info.maxBytes / 1048576).toFixed(2)} MiB) -> ${info.outDir}`,
  );
}
