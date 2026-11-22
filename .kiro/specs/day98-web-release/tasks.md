# タスク一覧：残火の鎌倉 Day98 Web公開準備

- [x] **T1（純粋層と単体テスト）**：`dist/valley/touch-math.js` を実装し、`tests/valley-touch-math.test.mjs`（7件）で検出・品質選択・スティック計算・走りヒステリシス・原点クランプ・視点ドラッグ・プロンプト変換を検証済み。`tools/check-valley.mjs` の `modules` / `pure` へ登録済み。
- [x] **T2（入力層・近接補助・タッチUI）**：`dist/valley/input.js` にタッチ注入口を追加し、`dist/valley/actors.js` にタッチ時のみの近接360°補助を追加。`dist/valley/valley-touch.js` と `dist/valley/valley-touch.css` を実装し、`dist/valley/main.js`・`dist/valley/hud.js`（タッチ向けヒント9種と語りスキップ表示）・`dist/valley/valley.css`・`dist/valley/index.html` に組み込み済み。
- [x] **T3（共有UI・権利ダイアログ・ファビコン・OGP・案内）**：`dist/valley/share-ui.js`・`dist/valley/share-ui.css`・`dist/valley/favicon.svg`・`dist/valley/og.jpg`（1200×630）を実装し、タイトル画面の共有／権利ボタン、結果画面の共有欄、ロード画面の約78MB・Wi-Fi推奨案内、小画面レスポンシブ崩れ対策を追加済み。
- [x] **T4（Cloudflare Pages 公開ビルド＆公開ゲート）**：`tools/build-pages.mjs`・`tools/verify-pages.mjs`・`tools/verify-pages-browser.mjs` を実装し、`package.json` に `build:pages` / `verify:pages`、`.gitignore` に `.pages-dist/` を追加。`tests/pages-build.test.mjs` で静的契約と変異4件を固定済み。
- [x] **T5（既存回帰・新規単体・公開ゲート実行）**：`npm run build:pages`（177 files / 78.4 MiB）・`npm run verify:pages`・`npm run check`（174 modules / 105 pure layers）・`npm run smoke`（325 files / 28 routes）・`npm test`（2,351件中 pass 2,279 / fail 0 / skipped 72）を通過済み。
- [x] **T6（実ブラウザ検証＆スクショ撮影）**：`tools/verify-pages-browser.mjs` を本番同一 CSP 下で実行し、PC・スマホ縦・スマホ横・極小横の動作・共有4点セット（コントラスト11.71:1）・タッチ移動/視点/屈む/防御/攻撃・HUD非重なり・エラー0・外部通信0を確認し、スクリーンショットを目視確認済み（詳細は `verification.md`）。
- [ ] **T7（ドキュメント更新・独立チェック・PR作成）**：`README.md` 更新とローカルパス/秘密検査済み。`feat/day98-web-release` を commit・push・PR 作成する。
