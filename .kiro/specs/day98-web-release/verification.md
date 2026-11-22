# 検証記録：残火の鎌倉 Day98 Web公開準備

- 検証日：2026-11-22
- 対象ブランチ：`feat/day98-web-release`（ベース：`origin/main` `11d93c4`）

## 1. 実施した検証と結果

| 検証項目 | コマンド | 結果 |
|---|---|---|
| Cloudflare Pages 公開ビルド | `npm run build:pages` | 合格（177 files / 78.4 MiB、JS 111モジュール、最大ファイル `assets/characters/officer.glb` 6.48 MiB） |
| 公開契約の静的検証 | `npm run verify:pages` | 合格（25 MiB/100 MiB上限、禁止物除外、相対リンク大小文字一致、importmap SHA-256 CSP・`blob:`、OGP/canonical、秘密・ローカルパス検査） |
| 配布物・谷モジュール整合 | `npm run check` | 合格（174 modules、105 pure layers、66 HTML ids、28 GLBs 60.9 MB、717 JS syntax checks、provenance一致） |
| HTTP 配信スモーク | `npm run smoke` | 合格（325 valley files + 28 routes、MIME・GET/HEAD・404・トラバーサル拒否） |
| 全単体テスト（新規12件含む） | `npm test` | 合格（2,351件中 pass 2,279 / fail 0 / skipped 72。うち `valley-touch-math.test.mjs` 7件・`pages-build.test.mjs` 変異4件含む全パス） |
| 本番同一 `_headers` CSP 下の実ブラウザ検証 | `tools/verify-pages-browser.mjs` | 合格（PC 1280×720 / スマホ縦 390×844 / スマホ横 844×390 / 極小横 568×320） |

## 2. 実ブラウザ検証で検出・修正した不具合

1. **スマホ開始直後の1フレーム遅延**：`#btn-start` 押下直後に `touch.sync()` が次フレームまで走らず縦向きバナー表示が遅れていた。`start()`・`openPause()`・`pause` の `close` で即時 `touch.sync()` を呼ぶよう修正。
2. **スマホHUDの視認性・案内文言（目視スクショで発見）**：
   - `.obj` の距離表記と `.bars`（体力・構え）が重なっていたため、タッチ時レイアウトを再調整し、非重なりを自動検証に追加。
   - タッチ端末でも `WASD で歩く` 等のPC向けヒントが出ていたため、`hud.js` でタッチ向け案内9種を出し分けるよう修正。
   - 縦向き時の横向き推奨バナーが狭く折り返されていたため、`width: min(352px, calc(100vw - 24px))` で2行収まりに修正。
3. **OGP 画像の更新**：旧俯瞰画像（中央に操作テキスト入り）ではなく、PR #222 反映済みの実ブラウザ俯瞰から `dist/valley/og.jpg`（1200×630・299 KB）を生成して組み込んだ。

## 3. 未検証（本番反映・実機確認へ申し送り）

- 物理スマートフォン実機（iOS Safari / Android Chrome）でのタッチ感度・マルチタッチ同時押し・Web Audio 再生・実フレームレート確認。
- 本番 Cloudflare Pages（`day98.rairakku.com`）へのアップロード後の外部ネットワーク疎通と OGP クローラ表示確認。
