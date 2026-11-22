# 設計書：残火の鎌倉 Day98 Web公開準備

## UX 5階層を通したことで確定した設計判断（5件）

1. **右下ボタンの厳選と役割分離**：PC の13操作をそのまま右下へ並べると親指が誤爆するため、右下は常時5ボタン（斬る・受ける・避ける・強斬り・調べる/とどめ/闇討ち）に絞り、補助3操作（屈む・狙う・風）は上部の小型ピルへ、仲間指示（Q）は既存の `#party` バッジタップへ統合した。
2. **タッチ時のポインターロック抑止と近接補助**：`main.js` の `onLockChange` はロック解除で即休止するため、タッチモードでは `requestLock()` を呼ばず、かつ `HeroActor.beginMove` の自動振り向き角度のみタッチ時に全周（360°・間合い 3.6m）へ広げる（戦闘規則の判定・威力は不変）。
3. **2本目の指タップ吸収（`onTap`）**：Day82 の事故（左手でスティックを押したまま右手で休止/再開を押すと `click` が発火しない）を防ぐため、タッチ操作中の UI ボタンには 2本目以降の `pointerup` 発火＋500ms `click` 吸収を使う。
4. **公開出力でのパス無改変配置**：`.pages-dist/index.html` をルートに置き、第一章 JS を `.pages-dist/valley/` のまま保つことで、`buildings.js`・`props.js`・`characters.js`・`main.js`・`audio-valley.js` の `../assets/...` と `../audio.js` を1行も書き換えずに解決する。
5. **importmap ハッシュ CSP と `connect-src blob:`**：`<script type="importmap">` はインラインのため、`build-pages.mjs` が正確な SHA-256 を計算して `_headers` の `script-src` へ埋め込む。また Three.js `GLTFLoader` が埋め込み画像を `blob:` 経由で `fetch` するため、`connect-src 'self' blob:` を必須とする。

## モジュール構成

### 1. タッチ操作と品質選択（`dist/valley/`）
- `dist/valley/touch-math.js`（**純粋層**：`check-valley.mjs` の `pure` 検査対象）：
  - `TOUCH_CFG`（半径・不感帯 `0.18`・走り切替 `1.4/1.15`・`tapSlop: 6`・感度係数）
  - `detectTouchMode(search, coarseMatches)` → `'on' | 'off' | 'auto'`
  - `selectInitialQuality({ queryQuality, savedQuality, touchMode })` → `'standard' | 'light'`
  - `stickRadius(viewHeight)`、`clampOrigin(x, y, R, w, h)`、`stickFromDrag(dx, dy, R, wasRunning)`
  - `LookDrag` クラス、`touchPromptSpec(promptText)`（コンテキストボタン表示仕様）
- `dist/valley/input.js`（最小拡張）：
  - 既存のキーボード・マウス処理を無変更のまま維持し、`touchMode` フラグ、`injectStick(right, forward, run)`、`injectLook(dx, dy)`、`touchKeyDown(code)`、`touchKeyUp(code)`、`touchMouseDown(btn)`、`touchMouseUp(btn)`、`releaseTouch()` を追加。
  - `held` / `pressed` / `mouse` / `mousePressed` へ同じ集合を使って注入するため、`game.js`・`actors.js`・`cinematics-frame.js`（`skipDown`）がそのまま動く。
- `dist/valley/valley-touch.js` & `dist/valley/valley-touch.css`：
  - `ValleyTouchControls` が `html.kz-touch` の付与・操作層 DOM 生成・マルチタッチ追跡・stale pointer 回収・プロンプト同期・会話/演出タップ送り・縦向き推奨バナー・`onTap` を担当。
  - `main.js` は `detectTouchMode`・`selectInitialQuality` で初期化し、`input.touchMode` が真なら `requestLock()` を呼ばない。

### 2. 共有UI・権利モーダル・メタ情報（`dist/valley/`）
- `dist/valley/share-ui.js` & `dist/valley/share-ui.css`：
  - タイトル画面の「共有する」（`aria-label="このアプリを共有する"`）で `<dialog id="share-dialog">` を開き、結果画面にも `#result-share` を自動据え付け。
  - 4点セット（`navigator.share`・X・LINE・リンクコピー＋Instagram/YouTube注記）と、`canonical` URL・`meta[name="share:text"]` 読み取り。
  - 「権利・出典」ボタンで `<dialog id="credits-dialog">` を開き、MIT・CC BY 4.0・Three.js・Poly Haven・CMU・Meshy・創作注記・GitHub リポジトリリンクを表示。
- `dist/valley/favicon.svg`：墨地に朱の角印「残火」。

### 3. Cloudflare Pages 公開ビルド＆公開ゲート（`tools/`）
- `tools/build-pages.mjs`（`npm run build:pages`）：
  - `dist/valley/main.js` と `dist/valley/share-ui.js` から相対 import を再帰走査し、第一章が実際に使う JS のみを `.pages-dist/valley/`（および `dist/audio.js` → `.pages-dist/audio.js`）へコピー。
  - `dist/vendor/`、`dist/assets/characters/`、`dist/assets/valley/`、ライセンス文書（`LICENSE`・`LICENSE-ASSETS.md`・`NOTICE.md`・`licenses/THREE-LICENSE.txt`）、`og.jpg`（`docs/images/valley-overlook.jpg` または最新撮影から 1200×630 で生成）、`favicon.svg` を配置。
  - `.pages-dist/index.html` を生成（`./valley/...`・`./vendor/...` パス調整＋`canonical`・OGP・Twitter Card・`share:text` 挿入）。
  - `<script type="importmap">` の SHA-256 を算出し、`_headers`・`_redirects`・`404.html` を出力。
- `tools/verify-pages.mjs`（`npm run verify:pages`）：
  - 公開前ゲート：25 MiB 上限・禁止ファイル除外（`scene.glb`・`kamakura-*`・`lab/viewer/world`）・HTML/CSS/JS 全相対参照の実在・importmap SHA-256 と `_headers` CSP の一致・`connect-src` の `blob:` 許可・`canonical`/OGP/`twitter:card`/`share:text` 契約を機械検証。
- `tools/verify-pages-browser.mjs`：
  - `.pages-dist/` をローカル配信し、Playwright 実 Chromium（`guardPointerLock` 適用）で本番と同一の `_headers` を注入して、PC（1280×720）・スマホ縦（390×844）・スマホ横（844×390）・極小横（568×320）での起動・共有4点セット（44px・コントラスト3:1）・権利ダイアログ・タッチスティック/視点/斬る/受ける/避ける/調べる・CSP違反0・コンソールエラー0・外部通信0を検証し、確認用スクショも撮る。
