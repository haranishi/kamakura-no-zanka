# 第2弾のブラウザ測定

この変更ではブラウザを起動していない。実測値・性能合格・画像の評価はまだない。
Playwrightは既存の `PLAYWRIGHT_MODULE` を指定する。依存追加は不要。

```
PLAYWRIGHT_MODULE=… node tools/measure-load-bytes.mjs --out .captures/load-before.json
PLAYWRIGHT_MODULE=… node tools/measure-perf.mjs --out .captures/perf-before
```

読み込み測定は `createServer()` と valley-shot と同じChrome起動を使う。
空のブラウザコンテキストから新しく始め、庭→林道→見晴らし→里→弥十郎→待ち伏せ→石段→結果を通す。
戦闘完了はQAで進める。シナリオは `scenarios/load-journey.mjs`。
response.body() の非圧縮バイトをURL単位に重複排除し、配信元相対URLで保存する。
data:・HTTPヘッダー・リダイレクト応答は除く。HTTP失敗・本体取得失敗・ページ例外は測定失敗。
JSONは全URLと上位15件、84.5/90MiBとの差、段階、完了状態を持つ。失敗時に削減不要とは判定しない。
親は done 到達、失敗0、全ファイルの合計と読み込み開始からの捕捉を確認する。

性能は標準・軽量×移動・戦闘×2回を別Chromeプロセスで順番に実行する。
各回の `samples.json` は600コマ暖機の実時間、1800コマの全ms/calls/trisと実時間、
OS/Chrome版/GPU/電源、初期配置、seed、入力列、毎コマ位置、敵の補充、草の可視区画の入替を持つ。
`judgement.json` は既存 `judgeAll` の全8回判定。途中失敗なら全体判定を作らず止まる。
単独の診断は次の形（標準・移動・1回目の例）。

```
PERF_SCENE=move PERF_RUN=1 PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/measure-perf.mjs --q standard --w 1280 --h 720 --seed 1333 --intro 0 --strict --out .captures/perf-single
```

移動はb2を固定し、石段→forest全折れ点→西口の順を反転しながら走る。
2回目は道筋の中点から逆向き。カメラは進行方向の通常追従。停止180コマで失敗する。
仕様に長さと時間の食い違いがある：この順の片道は160.806m、現行sprintは5m/s。
1800コマ=30秒では理想的にも150mで、全行程の往復（321.612m）は終わらない。
速度・測定時間は変えていない。親はpositions/endpointTurnsで実際の通過範囲を確認し、測定契約を判断する。
戦闘はb4正面、5体を活動させる。2回目だけ主人公を入口内側(-32,-8)から開始。
死亡・撤退・投降した敵を同じ初期fighter/brain/配置で作り直す。進行イベントは測定中だけ抑止する。
三連の次段は現行combatのchainWindow内に入力する（技終了後ではlight2/3に繋がらない）。
三段目の終了後に受けを.6秒以上保持し、反撃猶予が切れてから通常の弱へ戻る。
親はlight1→2→3とblockの反復、敵5体、補充、位置の停滞をJSONで確認する。

暖機後は人物・任務・入力・時刻・乱数・風・粒・カメラを戻す。GPUの資源とコンパイル済みシェーダは保持する。
測定ページ内だけgame.updateを包むため、入力制御・記録・補充の負荷もmsに含む。
草区画はchildren.visibleの入替数。視錐台での実描画や未実装の区画生成予算を測ったものではない。
固定1280×720 CSS px・DPR1・wクエリにより自動解像度変更を止める。寸法が違えば失敗する。
電源取得失敗は記録して続ける。親はM4 Pro・電源接続・意図したGPUであることを確認する。
この結果を他端末へ当てはめない。標準p95≤20ms、軽量≤33.3ms、全コマ呼出≤900・三角形≤500万。
