# W2c-16b 光と空気：Node検証と実機への引き継ぎ

L1〜L5を実装した。Nodeで切り戻し・描画回数・解放を確認済み。見た目とGPU時間は親の実Chrome確認待ち。
WW13.2とdesign-web-r10.mdを継承し、仕様・タスク・共用ファイルは変更していない。

## 要求への対応

| 要求 | 結果 |
|---|---|
| L1 深度 | 有効な標準後処理だけFloatTypeの深度を付与。逆射影と世界行列を使い回す。 |
| L2 光の筋 | 1/4解像度で空のマスクと24読みの放射ぼかし。画面端で滑らかに消え、背後・画面外は追加描画なし。 |
| L3 雲の影 | 高さ700mへ投影した3段ノイズ。東へ10m/秒。暗部・空を除外し、線形色の暗化を抑制。 |
| L4 golden | 完全な時刻表を追加。太陽高度約21.74度・西南西。他の3時刻の表はハッシュ一致。 |
| L5 診断 | postdebug=depth・shafts・cloudと、debug=1時の__kzLight()。disposeで削除。 |
| 切り戻し・負荷 | shafts=0&cloud=0で旧最終シェーダーと6描画が一致。軽量・段階2以上は後処理なし。 |

## 変更範囲

- dist/valley/kamakura-post-view.js、kamakura-post.js、kamakura-atmosphere.js。
- 新規dist/valley/kamakura-sky-fx.js（純粋な規則とGLSL）。
- tests/kamakura-post.test.mjs、kamakura-atmosphere.test.mjs、新規kamakura-sky-fx.test.mjs。
- tools/check-valley.mjsのmodules・pureの一覧2行と、この記録。
- atmosphere-viewの夕方判定は変更不要。goldenは海・水の時刻選択と共有照明をそのまま通る。

## 実行結果

Node v24.22.1。同梱Three r180の実オブジェクトと代役rendererで検証した。GPU描画の試験ではない。

| コマンド | 開始時 | 終了時 |
|---|---|---|
| NODE_OPTIONS=--max-old-space-size=1536 timeout 600 npm test | 1470成功・38スキップ | 1479成功・38スキップ |
| KZ_WORLD_DIR=<承認済みローカルデータ> NODE_OPTIONS=--max-old-space-size=1536 timeout 600 npm test | 1508成功 | 1517成功 |
| npm run check | 成功 | 成功（105 modules・62 pure・532構文） |
| npm run smoke | listen EPERMで失敗 | 同じEPERMで失敗 |
| node --test tests/kamakura-post*.test.mjs tests/kamakura-atmosphere*.test.mjs tests/kamakura-sky-fx.test.mjs | — | 23成功 |
| git diff --check | — | 成功 |

日本語文書lintはSudachiPy未導入で実行不能（ModuleNotFoundError）。追加導入はせず、本文は通読して確認した。
承認済みデータは読み取りのみ。値・座標・地形件数は記録や新規試験へ転記していない。
既存の6描画試験は効果を切るURLを明示した。期待する描画数は変更せず、新規試験で有効時の8描画も確認した。

## Nodeで測れた数値

- 合成平面160,000標本（10km四方・25m刻み）：雲の影の非ゼロ面積42.074%、平均密度0.254493。
- 10cm移動したときの密度差は最大0.003725未満。模様は東へ10m/秒で平行移動する。
- 正午・明るい灰色の合成平面では、線形HDR輝度の平均低下1.3652%。
- 最も濃い雲でも線形色の各チャンネルの低下は最大5.562%。画面の平均輝度の実測ではない。
- 光の筋は最大0.14の線形加算。時刻別の強さは正午0.15・朝0.5・金0.6・夕0.7。
- 1280×720で光の描画先は320×180を2枚。太陽が見えると計8描画、背後・画面外・雲だけは6描画。
- 1000コマで描画先7個・追跡資源14個と、材質・行列・ベクトルの参照が不変。
- 深度・描画先・材質・geometryはリサイズ、段階2への移行、二重disposeで各1回だけ解放。
- 合成の5m平面をnear=0.15・far=10000の行列で逆射影し、誤差1e-10m未満。
- 時計は任意のnow関数で注入できる。60秒の空白でも0.1秒だけ進み、負の差では進まない。

## 親が実Chromeで確かめる手順

基点は `/valley/index.html?world=kamakura`。標準・1280×720・DPR1で同じ画角の前後を保存する。
1. `&postdebug=depth`：近くの物は暗く、距離に比例して明るく、空は白。GLエラー・コンソールエラー0を確認。
2. `&time=morning` と `&time=golden` で太陽へ向く。`&postdebug=shafts` と通常表示で木・家の隙間の筋を確認。
3. `&pos=-366,230&yaw=211&time=evening`：筋の白飛び・縞・カメラ回転時の跳びがないこと。
4. `&pos=2650,480&yaw=90` と `&fly=top`：`&postdebug=cloud`で雲の模様が東へ流れ、空は白のままになること。
5. `&shafts=0&cloud=0` と比較し、効果を切った表示がR9と一致すること。雲だけは`&shafts=0`で比較する。
6. 雲だけの前後で画面平均の輝度低下が6%以内か測る。彩度差・影の面積・筋が占める画素割合も記録する。
7. `&debug=1`で`__kzLight()`を読む。太陽が背後ならshafts.active=false。リサイズ後もdepth=true。
8. `&q=light`と自動段階2以上でdepth=false、追加資源が解放されること。終了時のテクスチャ数も確認。
9. GPU時間を同じ画角の前後で測る。筋あり+0.4ms以内、背後の雲だけ+0.1ms以内が目安。

## 未確認と次の一歩

GLSLの構文上の罠とuniformをNodeで検査したが、GPUコンパイル・MSAA深度の実描画は未確認。
ブラウザとサーバーは依頼書の制約に従い起動していない。固定画角の画像・録画・性能値・実画面の輝度差はない。
既知の実行不具合はNodeでは見つかっていない。透明な川は既存の底面深度を使うため、水面上の見え方も実機で確認する。
実装方針の変更はなし。雲の暗化は、平均輝度の制約を優先して強さ表に0.18の係数を掛けた。
commitはgitのindex.lock作成がOperation not permittedで拒否され、省略した。push・PR・マージはしていない。
次の最小の一歩は、親がdepth表示でMSAA深度を確認し、goldenの固定画角を効果あり／なしで撮影すること。
