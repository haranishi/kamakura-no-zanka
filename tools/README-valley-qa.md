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
- `tools/scenarios/regress-retry-leak.mjs`：やり直しを4回繰り返しても形・画像が増えず、毎回主人公が立ち直って見晴らしへ戻り、里の敵5人が作り直される。
- `tools/scenarios/regress-cleared-dialogue.mjs`：里を守った瞬間に振りかぶっていた兵の一撃・飛んでいる矢が、会話の最中に主人公へ当たらない（体力10で見守る）。
- `tools/scenarios/regress-continue.mjs`：つづきから。見晴らしの区切りでは道の選択が、クリア後の区切りでは結果の会話と結果画面が出る。
- `tools/scenarios/regress-bank-descent.mjs`：待ち伏せの斜面の土手から道へ降りられ、林道のS字の西の縁（傾斜45度の帯）からも道へ出られる。
- `tools/scenarios/regress-rock-colliders.mjs`：当たりの表に岩が登録され（20個以上）、岩へ向かって歩くと岩の縁で止まる（歩ける場所で比べる）。
- `tools/scenarios/regress-audio-levels.mjs`：効果音24種のピークが −32〜−3dBFS、全種類を2回ずつ重ねても 0dBFS 未満（音の出ない環境では測れず何も確かめない）。
- `tools/scenarios/regress-draw-sheathe.mjs`：抜刀・納刀の層（8.2）を、決まった時間刻みで毎コマ測る（握りの誤差・刃の鞘への収まり・刀の跳び・腕の長さ・骨の戻り・表示。8場面）。`KZ_OUT=… ` でJSONを残す。
- `tools/scenarios/regress-attack-timing.mjs`：同じ入力列で、戦闘の論理（状態・体力・構え・位置）を毎コマ記録し、変更前と変更後が一致することを比べる（`node tools/scenarios/regress-attack-timing.mjs 前.json 後.json`）。
- `tools/scenarios/capture-draw-sheathe.mjs`：抜刀・納刀を、実ゲームの固定カメラ（主人公の左側）で一定間隔に撮る（敵が気づく→抜刀／納刀済みで攻撃→速い抜刀／戦闘後の納刀）。変更前と変更後を同じ条件で撮って比べる。
- `tools/scenarios/measure-draw-sheathe.mjs`：既存の抜刀・納刀の動作で、握りと腰の鞘がどう動くかを測る（前値は `reports/polish3/baseline/draw-sheathe-before.json`）。
- `tools/scenarios/capture-calls.mjs`：capture-set と同じ画角を、画面の繰り返し・時計・乱数を止めて撮り（同じコードなら2回撮っても全画素が一致する）、画角ごとの描画の呼び出しと置き物の内訳を `calls.json` に残す。`KZ_MASK=1` で置き物だけの輪郭も残す。前後の画素は `node tools/compare-shots.mjs <前> <後> [--masks]` で比べる（S7-0 の記録は `reports/valley-life/`）。
- 検査の流れの見本：`tools/scenarios/` のシナリオ。

## 第2弾の前測定（7.0・7.0b）
Nodeだけで実行（リポジトリのルート）。本数は杉・広葉・松の順。
```
node tools/measure-trees.mjs --json
node tools/measure-trees.mjs --baseline reports/baseline/polish2-trees-before.json
node tools/measure-load-budget.mjs --json --max 110
node tools/measure-guide-starts.mjs --json
```
`--max` はMiB、超過時は終了コード1。容量棚卸しは未使用物を含む上界で、実読み込みではない。
保存済みの前値は `reports/baseline/polish2-{trees,load-inventory,guide-starts}-before.json`。
案内表のmarkerは現行の静的初期値。nav距離は新guideの道路必須点を守る距離とは異なる。
ブラウザ測定の条件・出力・未確認点は [README-polish2-measure.md](README-polish2-measure.md)。
```
PLAYWRIGHT_MODULE=… node tools/measure-load-bytes.mjs --out .captures/load-before.json
PLAYWRIGHT_MODULE=… node tools/measure-perf.mjs --out .captures/perf-before
```
実読み込みはURLごとの本体バイトを重複なしで収集。84.5MiB以下なら削減不要、総枠90MiBと比較する。
性能は600コマ暖機→初期化→1800コマを8試行。標本・環境・入力・位置・判定を保存する。

## 固定13画角（FIXED_13）
既存の撮影から植生が主に写る10枚を、画像を見て選んだ（2026-10-27）。会話の枠が大きく被る03・06と、14にほぼ同じ15は外した。

|番号|名前・選定理由|
|---|---|
|01|start-thirdperson：廃寺と周囲の樹林を三人称で比べる|
|04|forest-road-scout：林道の路肩と林床|
|08|overlook-village：里と森の広域のまとまり|
|09|village-front：里の入口と森の境目|
|11|village-fight-wide：里の広場の草と背景の杉|
|12|captive-prompt：里の草と背景の杉林|
|14|ambush：帰路の林内と斜面|
|19|cart-banners：里の端と森の境目|
|20|valley-river-distance：川岸と対岸の遠景植生|
|21|far-mountains：山腹の遠景の樹林|
|22|grass-closeup：低い視点の草近景（株がまばら）|
|23|cedar-interior：杉林の暗い塊（葉の抜けが黒い穴になる）|
|24|maple-broadleaf：広葉樹の樹冠（現行kind1はケヤキ・栗、楓は未実装）|

新3枚はseed1333・時刻12秒から6コマ・乱数固定。高さは地面から。主人公は視線の4m後ろに置き、体は写らない。撮影設計値はすべて未測定。
座標はNodeで世界のデータを調べて候補を出し、画像を見て選んだ。

|番号|カメラ[x,高さ,z] → 注視点[x,高さ,z]・FOV|選んだ理由|
|---|---|---|
|22|[66,.7,-9] → [54,.4,-8.6]・54°|6m内の草が最多（153株）の平地。建物（house3）が背景に入る|
|23|[-36,1.7,-48] → [-33.6,1.8,-59.8]・58°|林道の中心から道なりに見る。左右に杉の列|
|24|[-17.3,2,-91.2] → [-34.6,6.5,-95.9]・50°|周りの杉が少ない広葉樹の固まりを、18m離れた開けた側から見る|

```
PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-set.mjs --w 1280 --h 720 --seed 1333 --out .captures/polish2-before
```
既存番号の撮影手順は維持。新3枚は2026-10-27に撮影して構図を確かめた。紅葉の色は現行の樹種では出ない（楓は未実装）。

人物GLBの圧縮と独立検算（未完了）：
`node tools/compress-characters.mjs --in .work/original-characters --out dist/assets/characters --report reports/character-compression/compression.json`（`--dry-run` はGLBを書かない）。
`node tools/verify-compressed-characters.mjs --original .work/original-characters --compressed dist/assets/characters`。再現・実測・目標未達は [検証記録](../reports/character-compression/README.md)。
