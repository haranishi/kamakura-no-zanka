# W2c-18 seaedge：海と地形外の山並み

S1〜S4を実装した。画面の見え方は、実 Chrome で確かめて色と角度の決まりを直した（末尾の「実 Chrome で確かめたこと」）。
既存WW15と共通・SEAEDGE依頼書を仕様として引き継いだ。変更は指定ファイル内に収め、commitはしていない。

| 要求 | 実装／見送り | 検証と残件 |
|---|---|---|
| S1 沖の色 | 実装 | 俯角係数、歩行5点の一致、4時刻の暗さ、sea2=0の旧シェーダー一致をNodeで確認 |
| S2 遠い波 | 実装 | 2方向のうねり、4本／軽量2本、25秒の移動、画素幅補正、浜と崖の差を確認 |
| S3 外の山 | 実装 | 陸区間の外へ延長、辺の接続、角、予算、遅延生成、解放を確認 |
| 接続点の2m下限 | 一部見送り | 0.5〜2mの辺では高さ一致を優先。末尾に理由を記載 |
| S4 確認用の口 | 実装 | 色・品質・所有者を含むdebug関数の解放を確認 |
| Chrome撮影とGPU測定 | 見送り | 依頼書で親の担当に指定。Node結果を画面の合格とは扱わない |

変更：`dist/valley/kamakura-sea-view.js`、`kamakura-layers.js`、`tools/check-valley.mjs`、`tests/kamakura-layers.test.mjs`。
追加：`dist/valley/kamakura-sea-far.js`、`kamakura-backdrop.js`、`kamakura-backdrop-view.js`。
追加試験：`tests/kamakura-sea-far.test.mjs`、`kamakura-backdrop.test.mjs`、`kamakura-backdrop-view.test.mjs`。記録は本ファイル。
一覧への配線はimportとbackdropの1項目だけ。既存試験の期待値は層の一覧だけを更新した。

| 実行コマンド | 結果 |
|---|---|
| 開始時 `NODE_OPTIONS=--max-old-space-size=1536 timeout 600 npm test` | 1,676成功・0失敗・42省略 |
| 終了時 同コマンド | 1,689成功・0失敗・43省略 |
| `KZ_WORLD_DIR=<依頼書指定先> NODE_OPTIONS=--max-old-space-size=1536 timeout 600 npm test` | 1,732成功・0失敗・0省略 |
| `npm run check` | 成功：構文588件・純粋79層・参照126モジュール |
| 開始・終了時 `npm run smoke` | 各1失敗：待ち受けのlisten EPERM。ブラウザには進まない |
| 関連試験 `node --test tests/kamakura-sea-far.test.mjs tests/kamakura-backdrop*.test.mjs tests/kamakura-sea.test.mjs tests/kamakura-layers.test.mjs` | 29成功・0失敗・2省略 |
| `git diff --check` | 成功 |

| Node集計（私有世界の集計だけ） | 標準 | 軽量 |
|---|---:|---:|
| 山並みの三角形 | 45,478 | 29,329 |
| 山並みの描画命令（視錐台判定前） | 2 | 1 |
| 生成時の標高サンプル呼び出し | 77,051 | 62,429 |
| 生成時に検討した三角形 | 47,825 | 30,754 |
| 三角形中心が海側になる割合 | 0% | 0% |

海面は既存の2三角形・1命令を使用し、追加の形・テクスチャは0。
既存の距離テクスチャをRG16Fにし、赤に岸距離、緑に浜／崖の係数を詰めた。sea2=0は従来のR16F。
山並みは最初の描画後に一度だけ作る。完成後はupdate自体を外すため、層の毎コマCPU処理は0。
GLSLは差し込み印、関数とuniformの宣言順、括弧、予約語、数値、型を検査した。Threeの条件分岐を展開した文字列も確認した。

親のChrome確認は同じ画角・画面寸法で前後を撮り、次を行う。
1. `/valley/index.html?world=kamakura&debug=1&fly=1&cam=overlook`を開く。沖の青緑、浜に沿う筋、北の山並みを確認する。
2. `&sea2=0`、`&backdrop=0`を個別に加えて再読込する。岸距離場の完成後も比較する。
3. `&sea2debug=1&post=0`で赤＝波の筋、緑＝うねりの明暗、青＝地平線へ寄せる量を数える。見下ろす沖では青が消える。
4. `&backdropdebug=1&post=0`で赤紫＝内側、黄＝外側。陸海の境と接続部に穴が無いか確認する。
5. コンソールで`__kzSea2()`・`__kzBackdrop()`を読む。後者のreadyが真になり、triangles/drawsが上限内か確認する。
6. 浜を歩き、150m内の泡をsea2=0と比較する。遠い浜・島・岩にも筋があるか、25秒以上動かして確認する。
7. `&time=noon|morning|golden|evening`、`&q=light`、`&adaptstep=2|3&autoscale=0`を個別に試す。歩く視点の峠でも山並みを見る。
8. GLSLエラー、海の増分+0.15ms以内、白飛び5%以下、見渡す画での波の可読性を実測する。

見た目の定数は`SEA_FAR`（sea-far.js先頭）と`BACKDROP`（backdrop.js先頭）だけで調整する。値を変えたら再読込する。

| 定数 | 現在値 | 上げた場合 |
|---|---|---|
| SEA_FAR.grazingFullDeg / grazingEndDeg | 2 / 17度 | 空色が残る俯角が広がる |
| deepGain / reflectionMin | .9 / .025 | 沖が明るくなる／真下の空反射が増える |
| offshoreM / deepStartM / outsideM | 200 / 60 / 3000m | 空色化／深色化の開始が沖へ移る。outsideMは格子外の代用距離 |
| swellStartM / swellFullM | 300 / 800m | うねりが入る距離が遠くなる |
| swellWavelengthM / swellSpeed | [110,73]m / [.23,.31]rad毎秒 | 大きいうねり／速い移動になる |
| swellSlope / swellContrast | .025 / .06 | 法線の傾き／明暗が強くなる |
| swellAngleDeg / swellSecondary | 約53.13度 / .4 | 2方向の開き／第2波の割合が増える |
| linesStartM / linesFullM | 150 / 400m | 遠景の筋を出す距離が遠くなる |
| linePositionsM / lineWidthsM | [6,22,48,85]m / [2,3,4,6]m | 筋が沖へ移る／太くなる |
| linePeriodS / linePhase | 25秒 / .25周 | 移動が遅くなる／開始位相が進む |
| linePixels / lineStrength | 1.5px / .65 | 遠くで太く薄くなる／白い筋が強くなる |
| lineFadePhase / lineFeather | .1 / .25 | 出入りが長くなる／縁が柔らかくなる |
| gapScaleM / gapLow / gapHigh / gapOffset | 45m / .32 / .66 / 7 | 途切れが長くなる／筋が減る／筋が薄くなる／筋同士の模様がずれる |
| cliffProbeM / cliffSlopeStart / cliffSlopeEnd / cliffGain | 16m / .12 / .65 / .18 | 内陸まで測る／崖の抑制を遅らせる／弱める／崖にも筋が増える |
| glintStrength / glintPower / glintCellM | .08 / 12 / 3m | 反射が強くなる／帯が狭くなる／粒が大きくなる |
| glintLow / glintHigh / glintDrift / glintFilterPixels | .86 / .98 / .1 / 2px | 粒が減る／薄くなる／速く動く／遠くで粒が大きくなる |
| reducedSwell / reducedLines | .5 / 2 | 軽量・段階2の効果と費用が増える |
| BACKDROP.extentM / nearExtentM / nearCellM / farCellM | 30000 / 6000 / 160 / 640m | 遠くまで描く／細かい範囲を広げる／格子を粗くする |
| blendM / landThresholdM / minHeightM / seamSnapM | 800 / .5 / 2 / .01m | 接続が緩やかになる／陸の入口が減る／最低地面が上がる／辺の外への丸め幅が増える |
| nearMinM / nearMaxM / farMinM / farMaxM | 60 / 160 / 250 / 600m | 近い山／遠い山が高くなる |
| farHeightStartM / northGain | 15000m / .2 | 山が高くなる距離が遠のく／北ほど高くなる |
| ridgeScaleM / valleyScaleM / ridgeWeight / noiseOffset | 2800m / 950m / .7 / 13 | 尾根／谷が広がる／尾根が強まる／谷の模様がずれる |
| shadeScaleM / shadeContrast | 560m / .1 | 色むらが大きくなる／濃淡が強くなる |
| adaptRangesM / lightRangeM | [30000,18000,3000,1600]m / 6000m | 各品質で遠くまで描く |

色は海の既存深色と森の既存樹冠色から導いた。確認色はdebugNear=0xff00ff、debugFar=0xffff00。予算はmaxTriangles=60000、maxDraws=2。
接続点の標高が0.5〜2mの場合、「辺と一致」と「全頂点2m以上」は両立しない。接続点だけ高さ一致を優先し、その外の頂点を2m以上にした。
山並みは手続きで作る背景で、地形の外の史実の山の再現ではない。岸の急さは既存の距離場から推定している。
海のテクスチャ容量は従来の約2倍。GPU費用と模様の読みやすさは未測定であり、次の最小ステップは親の固定画角比較である。
日本語lintはSudachiPy未導入で実行できず、依存を増やさず手動チェックリストで通読した。

## 実 Chrome で確かめたこと・直したこと（2026-11-11）

- 沖の白い面は消えた。色は、最初は灰色がかった青だったので、深い青緑へ寄せた（`deepTint`）。
- **低い高さ（海面から 60m）や峠から見ると、海がまだ白かった。** 空の色へ寄せる角度の幅（俯角 2〜17 度）が広すぎた。1.2〜9 度に縮めた。歩く視点の 200m 沖は 0.7 度なので、今と同じ。
- 遠い海が映す空の色を、太陽の向きで変えた（`skyCool`）。太陽の側は暖かい地平線の色、反対の側は冷たく暗い空。
- 白い波の筋は、幅を広げ、途切れを増やした。見渡す構図で、浜に沿って読める。浜の歩く視点（近くの波打ち際）は、新旧で同じに見えた。
- 山並み：北の地平線の水色の帯は消えた。色は、明るくした木の塊に合わせた（`CANOPY_LIFT`）。
