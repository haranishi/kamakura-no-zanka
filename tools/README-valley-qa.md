# 縦切り（`/valley/`）の自動プレイ・撮影の使い方

遊びの本体は `dist/valley/`。開発用の道具は `tools/valley-play.mjs`（ヘッドレスChromeを動かし、`?qa=1` のとき入る `window.__valley` を呼ぶ）。
ランタイムは依存なし。Playwright は `PLAYWRIGHT_MODULE=<…/playwright/index.mjs>` で渡す。
ブラウザの試験ツール（`valley-play`・`valley-shot`・`lab-play`・`measure-load-bytes`）は、ページを開く前に `tools/lib/pointerlock-guard.mjs` でマウスの固定を本物のOSへ届かせない（ヘッドレスChromeは固定を求められると本物のカーソルを動かし、試験のたびに使っている人のカーソルが飛ぶため。ページからは固定できたように見え、見た目も結果も変わらない）。新しく試験ツールを足すときも、`browser.newPage()` の直後に `await guardPointerLock(page);` を入れる。旧い庭用の `browser-check`・`measure-frame-time` は対象外（使うときは、画面を触っていない時間に回す）。

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
- `tools/scenarios/regress-guide-hitch.mjs`：案内あり（既定）で林道を走り、基準路から25m以上離れて迷いの助けの復帰探索が0.5秒ごとに働いている間も、暖機後720コマで100ms以上のコマが0・p99が33.4ms以下（強調300コマ以上・復帰路8回以上の作り直しが無ければ、検査が空なので落とす）。
- `tools/scenarios/regress-tree-shadow-wind.mjs`（2026-11-04）：林道の杉で、太陽の影の画像（中央1/4角）を風の位相だけ変えて2回読み比べる。無風は0画素（完全一致）、風・突風は0.5%以上が変わる。標準（4096）と軽量（2048）の両方。時計を進めずに風の値だけ書き換えて `game.render` を呼ぶ。main（木の影に風が無い）では不合格になる。
- `tools/scenarios/regress-continue.mjs`：つづきから。見晴らしの区切りでは道の選択が、クリア後の区切りでは結果の会話と結果画面が出る。
- `tools/scenarios/regress-bank-descent.mjs`：待ち伏せの斜面の土手から道へ降りられ、林道のS字の西の縁（傾斜45度の帯）からも道へ出られる。
- `tools/scenarios/regress-rock-colliders.mjs`：当たりの表に岩が登録され（20個以上）、岩へ向かって歩くと岩の縁で止まる（歩ける場所で比べる）。
- `tools/scenarios/regress-audio-levels.mjs`：効果音24種のピークが −32〜−3dBFS、全種類を2回ずつ重ねても 0dBFS 未満（音の出ない環境では測れず何も確かめない）。
- `tools/scenarios/regress-draw-sheathe.mjs`：抜刀・納刀の層（8.2）を、決まった時間刻みで毎コマ測る（握りの誤差・刃の鞘への収まり・刀の跳び・腕の長さ・骨の戻り・表示。8場面）。`KZ_OUT=… ` でJSONを残す。
- `tools/scenarios/regress-attack-timing.mjs`：同じ入力列で、戦闘の論理（状態・体力・構え・位置）を毎コマ記録し、変更前と変更後が一致することを比べる（`node tools/scenarios/regress-attack-timing.mjs 前.json 後.json`）。
- `tools/scenarios/capture-draw-sheathe.mjs`：抜刀・納刀を、実ゲームの固定カメラ（主人公の左側）で一定間隔に撮る（敵が気づく→抜刀／納刀済みで攻撃→速い抜刀／戦闘後の納刀）。変更前と変更後を同じ条件で撮って比べる。
- `tools/scenarios/measure-draw-sheathe.mjs`：既存の抜刀・納刀の動作で、握りと腰の鞘がどう動くかを測る（前値は `reports/polish3/baseline/draw-sheathe-before.json`）。
- `tools/scenarios/regress-attack-timing.mjs` に `KZ_SCENE=officer` を付けると、相手が侍大将になる（連続技の二段目 officer_b を含む520コマ）。
- `tools/scenarios/regress-slash-trail.mjs`：刃の軌跡（8.3a）を毎コマ確かめる（区間の外・戻りで足さない・閉じて0.05秒で消える・ちらつかない・停止中に詰まらない・抜刀の層の間は足さない・やり直しで消える・揺れ0でも出る・描画呼出の増加1・三段目の停止0.07秒・弾きの火花の向き）。第2周：停止のコマで刃が頭の上にない・火花は刃の進む向き・弾きは刃同士が触れる・敵の刃は予兆の間だけ照る・ひるみは相手から離れる。
- `tools/scenarios/measure-combat-trail.mjs`：技ごとに刀の根元・切先・手首を毎コマ記録し、切先と手首の速さの山と判定の区間の差、帯の区間の切先の道のりを測る（`KZ_OUT=…`）。第2周：接触時刻（相手を間合いの距離に置き、刃が胴の高さを通って最も近づく時刻）と判定の始めの差も測る（`KZ_ONLY=contact` で接触だけ、`KZ_RAW=1` で生サンプル）。
- `tools/scenarios/capture-combat-trail.mjs`：通常三連・強斬り・突き・弾き・侍大将の二段目を、固定カメラ・同じ入力でコマ割りに撮る（`KZ_TAG=before|after|after2`、`KZ_FULL=A:12,…` で等倍も残す）。
- `tools/scenarios/regress-lunge.mjs`：見た目だけの踏み込み（8.3a 第3周・lunge.js）を実ゲームで確かめる。停止のコマで刃が相手の胴に入る（弓以外の11技・相手まで1.2m／1.6m／間合いの端）、見た目の中心どうしが0.55m以上、技が終わって0.4秒で根のずれが0に戻る、壁と急な斜面で根が埋まらない。論理の位置が変わらないことは regress-attack-timing.mjs で main と比べる。
- `tools/scenarios/measure-lunge.mjs`：踏み込みの実測。技ごとに相手を前へ1.2m・1.6m・間合いの端に置いて本物の結線で技を出し、判定の始めのコマの刃と相手の胴の軸の最短距離（0.22m以内なら「入った」）、根の前進・回す角・見た目の中心どうしの距離・論理の位置を記録する。
- `tools/scenarios/regress-impact.mjs`：命中した敵の押し戻し（8.4a・knockback.js）と、とどめ・弾きの軽いスロー（8.5a・time-warp.js）を実ゲームで確かめる（押す距離・三連の間合い・壁と崖・スロー）。
- `tools/scenarios/regress-blood.mjs`：設定「血の表現」（8.4b・blood.js）。同じ入力の戦いを3段階で回し、粒としみの数・上限・描画呼出を足さないこと・戦闘の結果の一致・保存と再読込を確かめる。`__valley.setBlood('off'|'subtle'|'standard')` で段階を変える。撮影は `capture-blood.mjs`。
- `tools/scenarios/regress-combat-hints.mjs`：弾いた直後に「E で、とどめ」の案内が出ず「弾いた。いま反撃」だけが出ること、崩れた敵の前ではとどめの表示と案内が出ることを確かめる（8.3b）。
- `tools/scenarios/measure-arm-spread.mjs`：被弾・弾かれ・倒れの動作で、腕全体が胴の下向きから開く角を、腕の開きの上限（8.3b・arm-spread.js）の前後で毎コマ測る（`KZ_OUT`）。
- `tools/scenarios/capture-combat-impact.mjs`：8.4a・8.5a の前後比較。押し戻しと、とどめ・弾きのスローを、固定カメラ・同じ乱数・同じ入力でコマ割りに撮る（`KZ_TAG=before|after`）。
- `tools/scenarios/smooth-journey.mjs`：走り・歩きの滑らかさの台本（立つ→歩き出す→小走り→走り→停止→反転→旋回→屈み歩き→停止）を固定60Hzで毎コマ記録し、`tools/lib/smooth-metrics.mjs` の指標（足の滑りcm/m・出来事の窓の接地のずれ・関節と向きの跳ね・歩容の往復・カメラの加加速度と角加速度p99・速さの段差）を出す。`KZ_RAW=1` で毎コマの記録も残す。記録の指紋が起動ごとに同じこと（基準は `reports/polish3/locomotion-smooth/baseline.md`）。
- `tools/scenarios/regress-locomotion-speed.mjs`：速さの表と時間で決める加減速（M1・`dist/valley/loco.js`）。止まる距離と時間が30・60・144Hzで一致・旧い経路は1コマで止まる・走り出し／止まり／反転で速さが1コマ1m/秒を超えて跳ばない・候補の表（old・a・b・c・個別の walk/sprint・`?smooth=speed|off`）の定速と仲間・敵の値。止まりの位相を12通りずらした接地のずれも記録する（合否なし）。URL の切替は `valley-play.mjs --query "loco=old&smooth=off"` で渡せる。smooth-journey の接地は M1 から gait-table v2 の「足裏が平ら」の区間（旧い物差しは `slipLegacy`）。
- `tools/scenarios/regress-locomotion-phase.mjs`：足の位相と歩調（M2a・`dist/valley/gait-phase.js`）。歩容の切り替え（小走り2.0・2.5で Shift）・歩き出し・止まり（走り・通常移動）の窓0.5秒の接地のずれを、位相をずらした掃引で、既定と `?smooth=phase`（M1 の経路）を同じページで比べる。通りごとに動作の時計 `mixer.time` を0へ戻す（戻さないと同じ通りが15cmと30cmに分かれた）。
- `tools/scenarios/regress-locomotion-ik.mjs`：脚のIKと接地（M2b・`dist/valley/leg-ik.js`・`leg-plant.js`）。台本1本の定速の滑り（小走り1.84・走り1.30cm/m以下）と窓（歩き出し・反転・旋回）の接地のずれ6cm以内、掃引（歩き出し・切り替え・反転は6cm以内。止まりの既定は M2a より悪くならない。`?stop=hold` の止まりは6cm以内で、30・60・144Hz）、坂・段差（石段の下の林道・土手・川岸・棚田の段）で着いた足の浮き・沈み3cm以内と、歩いて止まった後の足首の高さ。`?smooth=ik`（M2a）と同じページで比べる。既定では、歩幅の伸縮（`?stride=on`）と、止まった後に足を留める版（`?stop=hold`）は入らない。
- `tools/scenarios/capture-ledge.mjs`：棚田の段（0.55m）を下る・登る場面を、段差を越える瞬間を中心に8コマのコマ割りにする（`--tag`・`--query`・`KZ_ONLY`）。平地は IK の有無で画素がほぼ変わらず、効き目は坂と段差に出る。
- `tools/scenarios/capture-smooth.mjs`：同じ台本の走り出し・定速・停止・旋回を、固定の横カメラと追従カメラで8コマのコマ割り（幅1280のJPG）にする（`--tag` で出力名を替え、新旧を同じ条件で撮る。盲検採点用）。場面の前に主人公を瞬間移動させるので、`KZ_PRE`（既定150コマ）だけ立って足を待ちの姿へ戻してから撮る（短いと、脚のIKの足が前の姿のまま写る）。`KZ_EVERY`（コマの間隔・既定4）・`KZ_ONLY`（場面をカンマ区切りで絞る）。
- `node tools/gait-sample.mjs`：周期の移動動作を7体ぶん Node だけで標本化し、`dist/valley/gait-table.js`（生成物）を作り直す（`--check` で一致の確認、`--print` で STANCE_SPEED との照合）。
- `tools/scenarios/regress-hand-grip.mjs`：刀を握る手（8.6a）を毎コマ測る（指・親指の皮と柄・鞘のすき間とめり込み、手首と指の跳び、腕の写しの長さ、動作の骨と切先が層を切った人物と一致）。31場面。`KZ_OUT=…` でJSONを残す。
- `tools/scenarios/regress-hand-grip-game.mjs`：実ゲームの主人公で、敵が気づいて抜く・納刀のまま攻撃・戦闘後の自動の納刀・抜く途中に倒れる、の4場面を通し、見える手を毎コマ測る。
- `tools/scenarios/record-sword-tips.mjs`：全動作クリップと抜刀・納刀の切先の位置を毎コマ記録し、変更前と変更後を比べる（`node tools/scenarios/record-sword-tips.mjs 前.json 後.json`）。
- `tools/scenarios/capture-hand-grip.mjs`：握りの前後をラボで撮る（`tools/lab-play.mjs` で動かす。`KZ_SHEET=guard|draw|walk|enemy`）。前＝同じ版で層を切った人物。
- `tools/lab-play.mjs`：人物ラボ（`lab.html`）を開いてシナリオを動かす（valley-play のラボ版。`--query "who=hero&weapon=drawn"`）。
- `tools/scenarios/capture-trees-detail.mjs`：木（8.1a）の近景（林道・枝の下から見上げ・幹と根元の寄り・広葉・庭・楓の寄り・林道の斥候）・中景（林の縁）・遠景（見晴らし・谷の川・太陽の方位）と、杉と広葉の標本（12〜30m、順光と、太陽の方位へ低く向けた逆光）を、HUDなし・乱数・時刻・風を固定して撮る。第2周で画角の重複を外した。`--q light` では5枚に light- を付ける。変更前のコードでも同じシナリオで撮って比べる。純粋層の変異検査は `node tools/verify-tree-branches-mutations.mjs` と `verify-tree-impostor-mutations.mjs`。
- `tools/scenarios/capture-shadows.mjs`（2026-11-04）：林道の杉と廃寺の庭に近い広葉樹の影の落ちる地面を見下ろし、無風・通常風の2位相・案内の突風で撮る（風の値だけ書き換えて描く）。固定画で主人公だけ横へ動かす10枚（follow-、影の範囲の追従による縁の揺れを見る）と、林道の歩き10枚（walk-、標準のみ）も撮る。`--q light` は light- を付ける。
- `tools/scenarios/capture-tree-lod-far.mjs`：遠景の絵の板（8.1a第2周）と中景が入れ替わる帯（標準150m・軽量100m）を、同じ木へ近づきながら10°の画角で撮る。
- `tools/scenarios/regress-tree-near-breakage.mjs`：木の至近の破綻（8.1a 第3周）を実ブラウザの描画で測る（veil＝カメラ直前の葉の網点の膜、holes＝樹冠の黒い穴、bare＝葉のない枝の突き出し ほか）。
- `tools/scenarios/regress-story.mjs`：物語の本体（S5・S6）を実ゲームの主人公で通す（断片F1〜F5・手がかり・掛け合いが戦闘中に出ない／同じ台詞を繰り返さない・やり直しで断片が二重にならない・保存・結末・焚き火の輪）。`--strict --out reports/polish3/story`。
- `tools/scenarios/capture-calls.mjs`：capture-set と同じ画角を、画面の繰り返し・時計・乱数を止めて撮り（同じコードなら2回撮っても全画素が一致する）、画角ごとの描画の呼び出しと置き物の内訳を `calls.json` に残す。`KZ_MASK=1` で置き物だけの輪郭も残す。前後の画素は `node tools/compare-shots.mjs <前> <後> [--masks]` で比べる（S7-0 の記録は `reports/valley-life/`）。
- `tools/scenarios/capture-walk.mjs`：見晴らし岩（見1）から里の入口まで林道を走る様子を、45コマごとのコマ画像で残す（capture-calls と同じく乱数と時計を止める。S7-A の二次運動と密度の確かめ用）。
- `tools/scenarios/regress-opening.mjs`（`--intro 1` が要る）：オープニング。区間の時刻、語り（字幕OFFでも出る・字と帯の比・帯からはみ出さない）、飛ばす（E・Space・クリック）、短い版、休止、動きを減らす、続きから、旧保存、やり直し、再上映、記録が書けない場合、解放後の谷の描画と資源、場面ごとの描画呼出・三角形、作り込んだ場面の朱の面積（2割以下）と明滅（1秒に3回以下）を確かめる。`KZ_OUT=…` でJSONを残す。純粋層の変異試験は `node tools/verify-opening-mutations.mjs` と `node tools/verify-opening-scenes-mutations.mjs`（場面の置き場・炎・粒子・測り方）。
- `tools/scenarios/measure-opening-perf.mjs`（`--intro 1`）：場面A〜Dごとの1コマの時間（p50・p95・最大）と描画呼出・三角形、始まりと目覚めの最初の1コマの時間。`KZ_OUT=…` でJSON。
- `tools/scenarios/capture-opening.mjs`（`--intro 1`）：オープニングの固定画角（O1〜O4＝場面A〜D、題名、目覚め）を撮る。`KZ_SHOTS=O1a,title` で絞り、`KZ_REDUCED=1` で「動きを減らす」。
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
