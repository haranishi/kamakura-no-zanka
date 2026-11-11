# 夕暮れの空・海・遠景の検証記録

実装とNodeでの検証を行った。画面の合否は未判定で、次は実Chromeで同じ構図を撮って比較する。
対象はWW17.5の空気と遠景。外部素材、依存、共用の空の変更、データ出力、commitは無い。

## 要求と判断

|要求|結果|
|---|---|
|K1 雲|実装。低空の4層。eveningでは弱める。clouds2=0で旧シェーダーへ戻る|
|K2 光の道|実装。旧反射の丸い光と物理鏡面反射を外し、方位と俯角で細長い道を描く。sunpath2=0で旧表示|
|K3 山・岬・島|実装。任意のmeta.horizonを検査し、1描画で表示。horizon=0、または指定無しで層を作らない|
|K4 霧・陰|実装。duskだけ低い霧と青紫の暗部を強める。duskair=0で旧値へ戻る|
|実画面・固定画角の前後撮影|見送り。この工程ではブラウザを操作しない指定のため|

平面を世界の遠方へ置くと、飛行や歩行で方位と大きさが変わる。そのため遠景は角度で作り、視点の回転だけで投影する。
雲と光の道は既存の空と海に差し込む。追加の全画面描画や画像を使わず、形の式はCPUとGLSLで共有した。
旧試験の「夕暮れの陰は夕方と同じ」は、K4に合わせて「夕暮れで強まり、旗で同じ値へ戻る」に改めた。

## 検査の証拠

- 開始時の通常試験：成功2,076・失敗0・省略70。checkは成功。smokeはlisten EPERM。
- 完了時の通常試験：成功2,085・失敗0・省略70。私有データ試験は再実行で成功2,150・失敗0・省略5。初回は成功2,148・失敗1・中断1・省略5で600秒停止。
- 対象8ファイルの試験：成功76・失敗0・省略1（私有データ未指定）。
- 私有データの初回失敗は町追加の既存の2秒制限。同時実行の影響を疑い、試験は弱めず1回だけ単独で再実行したところ通った。
- check：成功。162モジュール、純粋層99、構文検査681。
- GLSL：雲の断片、遠景の頂点・断片、海の4経路の計7本をglslcでコンパイル。成功7・失敗0。
- GLSLの括弧・予約語・未宣言の追加識別子・浮動小数点・Three.jsの差込位置も試験した。
- コンパイラー用の前置きで入出力・uniformを補い、同梱Three.jsのaverage名を置換した。WebGLでの実コンパイルは未確認。
- Node v24.22.1、同梱Three.js r180、shaderc v2026.3で確認。
- 後半の形状計算と真上・真下の保護を加えた後も対象試験とGLSLを再実行。検証用のコードとログは一時領域に置いた。

## Nodeで測った数字（合成データ）

|項目|標準|軽量|
|---|---:|---:|
|遠景の数（段階0→3）|12→6|8→6|
|三角形（段階0 / 1 / 2 / 3）|2304 / 1536 / 768 / 192|768 / 512 / 384 / 144|
|描画命令（各段階）|1|1|
|準備時の稜線標本（全段階）|2442|934|
|準備した頂点（全段階）|14400|5424|
|頂点配列の容量（byte）|288000|108480|

遠景は毎フレームの形状計算0。雲は既存の空（2,208三角形）に追加するため描画増加0、光の道は海の2三角形・1描画のまま。
雲は31,500標本で、0.3〜9度の約40.5%を半分以上の濃さで覆った。最下部4度に独立した2層がある。
光の道の全幅は水平線で1.4375度（日の直径の1.25倍）、手前で12度。俯角24度まで伸びる。
この数値は描画性能や画素の見やすさを保証しない。GPU時間とFPSは測っていない。

## 実Chromeでの確認

1. 場面のデータを既存の方法で読み、`/valley/index.html?world=kamakura&time=dusk&fly=1&cam=overlook&debug=1`を開く。
2. 高さ55m・俯角21度・縦画角50度で撮る。空の最下部に2層以上、日は1個、海に細長い粒の道、谷に薄い帯が見えるかを確認する。
3. `&clouds2debug=1`：雲は青、日の近くは橙。`&sundebug=1`：日が黄、にじみが紫、海の道は水色。
4. meta.horizonに下の例を持つ場面で、`&horizondebug=1`：山並みは青、岬は橙、島は緑。木・家・海が手前に重なることを見る。
5. 開発者コンソールで`__kzClouds2()`・`__kzSunPath()`・`__kzHorizon()`・`__kzAir()`を読む。遠景の距離nullは無限遠を意味する。
6. 浜の目の高さ1.7mでも海を見る。歩行・飛行・旋回で遠景の方位と大きさが動かないことを見る。
7. `&clouds2=0&sunpath2=0&horizon=0&duskair=0`の同じ構図と比較する。霧は`&postdebug=mist`、陰は`&light7=0`でも比較する。
8. `&q=light`・`&adaptstep=2`・`&adaptstep=3`、朝・昼・夕方前・夕方を確認する。画面とコンソールのエラーも記録する。

meta.horizonの例（自作の角度。データへは今回書き込んでいない）：
```json
[{"bearing_deg":145,"width_deg":60,"height_deg":2.8,"kind":"range"},{"bearing_deg":205,"width_deg":18,"height_deg":1.8,"kind":"headland"},{"bearing_deg":182,"width_deg":4,"height_deg":0.6,"kind":"island"}]
```

## 画面を詰める定数（上げたときの変化）

|場所・定数|現在値|上げると|
|---|---|---|
|CLOUDS2.heightsDeg / widthsDeg|[.95,2.65,4.9,7.7] / [.63,.8,1.05,1.3]度|帯が上がる / 太る|
|CLOUDS2.minDeg / maxDeg / featherDeg|.3 / 9 / .18度|下端が上がる / 上端が上がる / 縁がぼける|
|CLOUDS2.bendDeg / bendScale / coreShare|.32 / .43 / .45|うねりが大きい / 細かい / 芯が太い|
|CLOUDS2.noiseOffset|[19.3,7.1]|層ごとの模様の位相が変わる|
|CLOUDS2.alongDeg / driftDegS|11度 / .018度毎秒|横長の塊が大きい / 流れが速い|
|CLOUDS2.coverLow / coverHigh / opacity|.24 / .55 / .92|雲が減る / 濃い所が減る / 濃くなる|
|CLOUDS2.shadeMix / shadeGain / warmGain / rimGain / sunWidthDeg|.64 / .6 / .9 / .85 / 32度|霧色寄り / 明るい / 暖色が明るい / 縁が光る / 光る範囲が広い|
|CLOUDS2.eveningGain / reducedGain / reducedLayers / minimumLayers|.42 / .7 / 2 / 1|夕方が濃い / 軽量が濃い / 層が多い / 最軽量の層が多い|
|SEA_PATH.horizonWidths / nearWidthDeg / lengthDeg / strength|1.25 / 12度 / 24度 / 1|沖の幅 / 手前の幅 / 長さ / 明るさが増す|
|SEA_PATH.nearGain / fallPower / edgeShare|.12 / 1.3 / .65|手前が明るい / 手前ほど薄い / 横の芯が太い|
|SEA_PATH.cellM / drift / grainLow / grainHigh / nearThreshold / mean|.45m / .06 / .64 / .94 / .16 / .23|粒が大きい / 速い / 少ない / 明るい粒が減る / 手前が疎 / 遠くの平均が明るい|
|HORIZON.gain（山 / 岬 / 島）/ haze|[.72,.42,.53] / [.66,.3,.48]|陸が明るい / 空に溶ける|
|HORIZON.skyMix / baseFade / ridgeBase / ridgeNoise|.65 / .24 / .2 / .8|霧色寄り / 裾の霞が厚い / 稜線が高い / 起伏が強い|
|HORIZON.coarseScale / fineScale / fineShare / taperRise / taperFall|5.7 / 17.3 / .23 / 7 / 4|大きい起伏が細かい / 小さい起伏が細かい / 細部が強い / 左端が急 / 右端が急|
|HORIZON.seedCoarse / seedFine / bottomDeg|.17 / .31 / -.08度|形の位相が変わる / 同左 / 裾が上がる|
|HORIZON.segments / lightSegments / lightItems / reducedItems|[96,64,32,16] / [48,32,24,12] / 8 / 6|輪郭が細かい / 同左 / 軽量で多い / 最軽量で多い|
|DUSK.mid / fogColor / hemiSky / hemiGround|#75628a / #8f9bc0 / #929bc9 / #6a6f93|青成分を増やすと雲・霞・陰が冷たくなる|
|DUSK.postMist / mist.density / base / falloff|1.15 / .0001 / 5m / .075毎m|帯が濃い / 低い霧が濃い / 霧が高い / 高所で薄い|
|DUSK.postShade / DUSK_AIR.shadeFloor|.38 / .013|陰が青寄り / 最暗部が明るい|
|DUSK_AIR.mistNearM / mistFullM / mistScaleM / mistWarmBase|35m / 220m / 125m / .04|霧の始点が遠い / 濃くなる距離が遠い / 帯が大きい / 橙寄り|

未確認：実Chromeでの雲の縁、光の道の画素密度、山と海の境、霧の濃さ、軽量時の見え方。
既知の制約：meta.horizonが無ければ遠景は出ない。軽量・自動段階2以上では後処理の霧は停止し、材質の低い霧だけ残る。
文章lintは辞書モジュール不足で実行できず、手動チェックリストで確認した。
次の最小ステップは、上記の固定構図と浜を撮り、色・濃さ・粒の幅だけを調整すること。
