# 縦切り（`/valley/`）の自動プレイ・撮影の使い方

遊びの本体は `dist/valley/`。開発用の道具は `tools/valley-play.mjs`（ヘッドレスChromeを動かし、`?qa=1` のとき入る `window.__valley` を呼ぶ）。
ランタイムは依存なし。Playwright は `PLAYWRIGHT_MODULE=<…/playwright/index.mjs>` で渡す。

```
PLAYWRIGHT_MODULE=… node tools/valley-play.mjs <シナリオ.mjs> --out <出力フォルダ> [--w 1280 --h 720 --q standard|light --seed 1333 --intro 1 --lk <見た目の調整> --log --strict]
```
シナリオは `export default async function (ctx) {…}`。冒頭の目覚めの演出は既定で飛ばす（`--intro 1` で見る）。
`ctx`: `st()`（状態）・`step(n,dt)`（1/60秒×n コマ進めて描く）・`freeze(true)`（自動の進行を止めて手動で進める）・`start('new'|'continue')`・
`key(code,down)`・`tap(code,frames)`・`click(button,hold)`・`release(button)`・`call(名前,…引数)`・`v(式)`（ページ内で式を評価）・`shot(名前)`・`log(…)`。
最初に `await start('new'); await freeze(true);` を呼ぶ。以降は `step` で時間を進める（実時間では進まない）。
`--strict`：ページの例外・コンソールの error が1つでもあれば終了コード1（回帰の検査用）。`--lk sx:0.5,sy:0.17,sunc:ffc088,…` は見た目（太陽の向き・色・霧）を書き換えずに試す（キーの一覧は `main.js` の冒頭）。

## `__valley` のフック（`call(名前, …)` で呼ぶ）
| 名前 | 内容 |
|---|---|
| `state()` | 段階(beat)・目的・主人公(座標/体力/構え/状態)・敵(状態/体力/構え/気づき)・仲間・資源・保存・矢の数 など |
| `step(n,dt)` / `perf(n)` | コマを進める／1コマの重さ(ms)・描画の三角形数 |
| `teleport(x,z,yaw)` / `look(yaw,pitch)` | 主人公を移す／カメラの向き（yaw は前方が `(-sin,-cos)`。北が -Z） |
| `dispatch(event)` | 任務へ出来事を送る（`enter_zone` `arrived` `dialogue_end` `enemy_down` など。近道用） |
| `camera(pos,look,fov)` | 固定カメラ（y は地面からの高さm）。`camera(null)` で解除 |
| `god(on)` | 主人公の体力と構えを毎コマ満たす（検査用） |
| `advanceDialogue(all)` | 会話を進める |
| `quality('light')` | 描画品質 |

操作は実際のキーと同じ：`key('KeyW')` 歩く・`ShiftLeft` 走る・`KeyC` 屈む・`click(0)` 斬る・`KeyF` 強く斬る・`click(2,true)` 受け（押しっぱなし）・
`Space` 転がる・`KeyE` 調べる/とどめ/闇討ち・`Tab` 狙う・`KeyQ` 弥十郎へ指示。会話は `E`。

## 任務の流れ（`state().beat`）
b0 庭へ降りる（`temple_yard` に入る）→ b1 穂太の話 → b2 林道（斥候）→ b3 見晴らし（`viewpoint` に着く→会話→ `#choice-front` / `#choice-flank` を押す）
→ b4 里（`village_front/north/south` に入る。敵5）→ b5 弥十郎を解く（捕虜の近くで `E`）→ b6 帰路（`ambush_trigger` で待ち伏せ）→ b7 `temple_steps` に着く→結果。
座標の目安は `dist/valley/world-data.js` の `zones` と `spawns`。

## 例
- `tools/scenarios/capture-set.mjs`：固定画角を撮る（画面の採点・前後比較用）。影は主人公に追従するので、遠景を撮るときは主人公をカメラの足元へ置く。
- `tools/scenarios/regress-arrow-death.mjs`：矢で倒れても描画が止まらず、倒れた画面が出る（`--strict` で回す）。
- 検査の流れの見本：`tools/scenarios/` のシナリオ。
