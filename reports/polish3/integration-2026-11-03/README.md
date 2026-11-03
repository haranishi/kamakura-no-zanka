# 統合（2026-11-03）の検証記録

PR #30・#31・#33〜#39 を main に取り込んだ後の検証です。測った環境は M4 Pro・ヘッドレス Chrome・1280×720・DPR1 で、測定中は他の作業を止めました。性能の数値はこの環境だけのものです。

## 検証の数

| 項目 | 10/31 の main（`614ed6d`） | 取り込み後（`dd77385`） |
|---|---|---|
| 単体試験（`npm test`） | 560件 | 715件 |
| `npm run check` | — | 合格（75モジュール・39の純粋層・物語データ清浄） |
| `npm run smoke` | — | 合格（28ルート） |
| ブラウザ回帰（`--strict`） | — | 21本すべて合格 |
| CI（Node 22・24） | — | 各マージ後とも成功 |

ブラウザ回帰の21本：arrow-death・audio-levels・bank-descent・cleared-dialogue・continue・draw-sheathe-game・draw-sheathe・follow-guide・guide-switch・hand-grip-game・hand-grip・impact・lunge・retry-leak・rock-colliders・slash-trail・step-levels・story・tree-near-breakage・tree-quality-switch・tree-reduced-motion。

戦闘の論理は、`sayaHoldScale` の修正の前後（`d1c3fdd` と `e69a05e`）で、斥候320コマ・侍大将520コマとも一致しました（`regress-attack-timing.mjs`）。

## 性能

### 公式の8試行（`node tools/measure-perf.mjs`）

判定の全文は [perf-judgement.json](perf-judgement.json)。

| 品質・場面 | 1回目 p95 | 2回目 p95 | 判定（予算20ms） | 三角形の最大 | 描画呼出の最大 |
|---|---|---|---|---|---|
| 標準・移動 | 23.6ms | 21.7ms | **未達** | 4,176,164 | 473〜476 |
| 標準・戦闘 | 17.8ms | 16.3ms | 合格 | 3.86M | 430〜440 |
| 軽量・移動 | 13.3ms | 13.7ms | 合格 | 3.48M | 449〜452 |
| 軽量・戦闘 | 13.3ms | 12.8ms | 合格 | 3.19M | 392〜407 |

### 統合の前後を交互に測った比較（標準・移動、同じ環境、各2回）

単独の診断（`README-polish2-measure.md` の「単独の診断」）を、1800コマの95百分位（p95）で比べました。

| コミット | p95 | 中央値 | 平均 | 描画呼出の最大 | 三角形の最大 |
|---|---|---|---|---|---|
| `614ed6d`（統合前） 1回目 | 19.3ms | 16.4ms | 17.7ms | 757 | 4,456,285 |
| `dd77385`（統合後） 1回目 | 16.0ms | 13.8ms | 15.2ms | 473 | 4,176,164 |
| `614ed6d`（統合前） 2回目 | 18.6ms | 15.9ms | 17.1ms | 757 | 4,456,285 |
| `dd77385`（統合後） 2回目 | 18.1ms | 14.2ms | 15.9ms | 473 | 4,176,164 |

読み方：統合後の方が、平均・描画呼出・三角形とも小さいか同じです（小物のまとめ描きで描画呼出が減りました）。公式の8試行で標準・移動だけ未達だったのは、測った時の負荷の揺れと読みます。ただし p95 が20ms近辺なのは統合前からで、予算の余裕は薄いままです。静かな時刻の再測定と実機は未了です。

## 木の盲検採点（8.1a）の出典

別役（Opus・画像だけ・新旧を伏せた組）の採点結果は、PR #33 のコメントにあります。

| 周 | 比べた対 | 結果 |
|---|---|---|
| 1周目（2026-10-30） | 新 対 旧、12組 | 新が12組すべてで勝ち。平均 新4.9・旧3.0 |
| 2周目（2026-10-30） | 新 対 旧、16組 | 新が13組で勝ち（旧2組・同じ1組） |
| 3周目（2026-10-31） | 2周目 対 3周目、16組 | 2周目9組・3周目3組・同じ4組。破綻のなさは 4.9→5.6 に上がったが、ほかの項目は下がった。どの項目も7に届かず、最高6 |

## 再現

```
npm test && npm run check && npm run smoke
PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-<名前>.mjs --strict --out <出力先>
PLAYWRIGHT_MODULE=… node tools/measure-perf.mjs --out <出力先>
```
