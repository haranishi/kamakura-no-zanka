# W2c-18 air：飛行の影・谷の霧・高所の雲影

L1〜L4を実装した。Nodeの全体試験と静的検査は成功。見え方は、実 Chrome で確かめて霧を直した（下の「実 Chrome で確かめたこと」）。
仕様はWW15とCOMMON/AIR依頼書を継承した。実装順は影の規則→谷の場と鏡の式→既存合成への配線→互換・解放・全体検証。

|要求|結果|
|---|---|
|L1 飛行の地面への影、段と履歴、丸め、bias、歩行への復帰|実装。4時刻で歩行の箱・光源・フィルターを照合|
|L2 谷の場・海沿い除外・高さと距離・途中2点・時刻・確認表示|実装。分割生成・深度・品質・解放も試験|
|L3 地表から250〜750mで雲影を拡大・減衰|実装。低所と無効旗の互換を照合|
|L4 `__kzAir()`・破棄時の削除|実装。影・後処理の所有者をまとめて確認|
|実Chromeの描画・速度・撮影|未実施。依頼書が親の担当と指定しているため|

変更は依頼書の範囲内。外部素材・依存・通信・共用の谷の実装は追加・変更していない。commitは親が行う。
変更：`dist/valley/`の`kamakura-atmosphere-view.js`・`kamakura-shadow.js`・`kamakura-sky-fx.js`・`kamakura-post.js`・`kamakura-post-view.js`。
追加：同じ場所の`kamakura-mist.js`・`kamakura-flight-shadow.js`。
配線：`kamakura-fly-view.js`のatmosphere.updateへの引数だけ、`world-kamakura.js`のcreateKamakuraPost呼出1行だけ。
試験：`tests/kamakura-atmosphere.test.mjs`・`kamakura-post.test.mjs`・`kamakura-sky-fx.test.mjs`・`kamakura-fly.test.mjs`。
追加試験：`tests/kamakura-mist.test.mjs`・`kamakura-mist-view.test.mjs`・`kamakura-flight-shadow.test.mjs`。ほかは`tools/check-valley.mjs`の一覧と本記録。

## 判断と互換

飛行の大きな箱では通常PCFへ切り替える。歩行は既存のPCFSoftとlight7へ戻す。
飛行のbiasは`−0.75×texel/(far−near)`、normalBiasは`0.6×texel`。異なる箱でも偏りを世界の画素幅でそろえるため。
±450mの起伏と低い太陽を収めるため、光源の距離は水平の張り出しと起伏を太陽高度の正弦で割って決めた。
上を向いた視線では最大箱の半分だけ前へ寄せる。前コマの箱幅を使うと、静止中も中心が移るため採らなかった。
霧は既存の冷暖の霞から色相を取り、地平線の輝度の95%へそろえた。雲影の後・ブルームの加算前に合成する。
`mist=0&cloudhigh=0`の最終シェーダーは変更前と文字列で一致。霧だけでも深度を持つ。軽量・段階2以上では場も作らない。
既存試験のURLと期待値には追加旗を反映した。無効時の一致検査・資源の解放検査を維持し、96通りのGLSLを調べた。
追加した霧のGLSLは、括弧・予約語・数値埋め込み・uniform・未宣言名・整数混入も検査した。GPUコンパイルの代わりにはならない。

## 実行結果

- 開始：通常1,676成功・42省略・0失敗。check成功（123モジュール・77純粋層・582構文）。smokeはlisten EPERMで1失敗。
- 終了の全体試験：通常1,688成功・43省略・0失敗、私有地形付き1,731成功・0省略・0失敗（各600秒以内）。
- 関連試験：48件中46成功・2省略・0失敗。私有地形付きの全体試験では省略なし。
- 終了check：成功（125モジュール・79純粋層・587構文）。git diff --check成功。
- 日本語lint：sudachipy不足で1失敗。依存を追加せず、結論・数値・未確認点を手動で通読した。
- 終了smoke：listen EPERMで1失敗。ブラウザを起動していない。
- 再現：`NODE_OPTIONS=--max-old-space-size=1536 timeout 600 npm test`。
- 私有地形：上のコマンドに`KZ_WORLD_DIR=<親指定の私有世界>`を設定。`npm run check`・`npm run smoke`も実行。
- 関連：`node --test tests/kamakura-atmosphere*.test.mjs tests/kamakura-post*.test.mjs tests/kamakura-sky-fx*.test.mjs tests/kamakura-fly.test.mjs tests/kamakura-mist*.test.mjs tests/kamakura-flight-shadow*.test.mjs`。

## Nodeの数値（GPU測定ではない）

- 合成の谷：4,225セル、12,675セル分の作業、RG32F 33,800バイト。地形の参照は1セル1回。
- 合成の描画：1,089セル、8,712バイト。固定の注入時計では2コマ目に準備完了、1,000コマで資源・行列・テクスチャの再生成なし。
- 追加三角形0・追加描画0。既存の最終合成を使う。霧は通常3回の場参照、確認表示は谷らしさ1回。
- 合成の飛行：箱1,338.776m、texel 0.326850m、near 1m、far 6,876.350m、bias −0.000035655、normalBias 0.196110m。
- 私有地形の谷らしさ0.5以上の割合は21.8528%。指定の5〜35%内。座標・件数・加工データは保存していない。

## 実 Chrome で確かめたこと・直したこと（2026-11-11）

- 飛行の影：見渡す構図で、家と木の塊に影が落ちる。静止した構図でちらつきは見えなかった。
- **霧は、最初は谷を白く塗りつぶした**（真上から見ると白い面）。3 つ直した。帯に途切れを入れる（`wispFrom`・`wispTo`）。見下ろす角度では薄くする（`downThin`）。上限を下げる（`cap` 0.42・`totalCap` 0.5）。色は、太陽と反対の側でも少し暖かくした（`warmBase`）。
- 歩く視点（峠）で、足元は白くならない。高い所からの雲の影は、斑点に見えない。

## 調整定数（各モジュール先頭。上げたときの変化）

|場所・名前|現在値|上げると|
|---|---|---|
|FLIGHT_SHADOW.minSize / maxSize / distanceScale|92m / 3,600m / 0.95|影の範囲が広がり、同じ解像度では粗くなる|
|sizeRatio / hysteresis|1.25 / 0.08|箱の段が粗くなる／段を保持する幅が広がる|
|maxDistance / relief|6,000m / 450m|視線の探索／影の奥行きの余裕が広がる|
|minSunY / near|0.08 / 1m|低い太陽での距離を短縮／手前を多く切る|
|softLimit / biasTexels / normalTexels|150m / 0.75 / 0.6|接地フィルターを広い箱でも使う／縞を抑えるが影が離れやすい|
|MIST.cell / maxSide|32m / 512|場が粗くなる／細かい場を許す（512以下を守る）|
|meanRadius / floorRadius|350m / 250m|広い地形から谷を選ぶ／深い谷底を拾いやすい|
|coastRadius / seaHeight|150m / 0.5m|霧を避ける海沿いの範囲が広がる|
|low / high|3m / 12m|浅い谷で霧が減る／全量に届く谷を絞る|
|falloff / scale / stretch|22m / 380m / 2.2|高く溜まる／模様が大きくなる／東西に長くなる|
|speed / noiseBase / noiseGain|1.5m/s / 0.55 / 0.45|速く流れる／均一に濃くなる／模様の濃淡が強まる|
|near / full|120m / 500m|足元の無霧範囲／濃くなるまでの距離が伸びる|
|farStart / far|7,500m / 9,000m|遠くまで霧を残す|
|cap / totalCap / pathWeight|0.55 / 0.6 / 0.5|各点／合計／途中の霧が濃くなる|
|brightness / MIST_TIMES|0.95 / 朝0.8・昼0.25・夕方前0.5・夕方0.6|明るくなる／各時刻の霧が濃くなる|
|CLOUD_HIGH.low / high / scale / strength|250m / 750m / 3 / 0.45|高所補正の開始／完了を遅くする／大模様になる／影が強くなる|

生成の調整はMIST.budgetMs=2、batchCells=64、cellsPerFrame=8,192。増やすと早くできるが1コマの負担が増える。
影の探索精度はraySteps=24・refineSteps=12。増やすと細かい地面を拾えるが更新の仕事が増える。
既知のNode失敗は無い。GPUの霧の費用・影の縞や浮き・霧の色と帯の読みやすさには自信の判断材料が無く、親の確認が必要。
透明で深度を書かない川は背後の深度を使う。霧は地形の範囲外では出ない。山自体の影は依頼範囲外。
