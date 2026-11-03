# C0a前半：純粋層の実装と証拠

2026-11-04。依頼Q。既存のC0a・設計1〜5章・R25〜R29を引き継ぐ。
ゲーム接続は未実施。C0a全体の完了・公開可・画面評価の合格を意味しない。

## 変更したファイル

- `dist/valley/cinematics-data.js`：空の凍結表、制限値、表の検査。
- `dist/valley/cinematics.js`：再生、入力、安全待ち、予約、記録と再開計画。
- `tests/valley-cinematics.test.mjs`：42本の純粋層試験。
- `tools/check-valley.mjs`：既存の純粋層検査へ2モジュールを追加。
- `.kiro/specs/hidden-valley-slice/tasks-cinematics.md`：C0a範囲末尾だけ追記、100行を保持。
- 本書。既存のゲーム・描画・入力・保存処理は変更なし。

## 決めたデータの形

- 演出：`id`（文字列）、`chapter`（正整数）、`kind`（open/end/event）。
- `opening?: true`：openの既存冒頭だけ尺の例外。空ショットは例外にしない。
- `trigger`・`stage`：成立条件・舞台を示す空でない文字列。ここでは評価しない。
- `prepareSec`・`transitionSec`・`returnSec`：非負の有限秒。復帰は0.6秒以下。
- `returnTarget`：接続側が渡す復帰先の一覧に存在する名前。
- `shots`：1個以上のショット。合計尺は上の3秒数と全ショットの和。
- ショット：`durationSec`（正の有限秒）、`camera`、`subtitleIds`、`gestures`、`scenery`、`still`。
- `camera`：`anchor`（基準人物等の名前）、`from`・`to`・`lookAt`（有限数3個の配列）、`fov`（0より大きく180未満の度数）。
- 座標はanchorからの相対位置、単位m。谷と別舞台の高さを混ぜない。
- `subtitleIds`：同じ画面へ出す文の識別子配列。ctx.textByIdで解決する。
- `gestures`・`scenery`：演技・景色の合図の文字列配列。内容の描画は後半。
- `still`：`camera`と`gestures`。字幕は元ショットと共有し、減動でも意味を保つ。
- 字数はUnicodeコードポイントで数え、同時字幕の合計を40字以内にする。
- `CINEMATICS`は空配列を凍結。仮の場面は試験内だけに置いた。

## 接続用の契約と判断

- createCinematicPlayer(entry, {fromBattle})のentryは事前に表の検査を通す。
- stepCinematic(state, dt, input)は呼出側のstateを更新し、{state, events, consumed}を返す。
- phaseはpreparing→playing→returning→ended。shotIndex/shotTimeSecで表を参照する。
- 準備と移行はpreparing内。秒数0の場合は同じ更新で次の段階へ進める。
- eventsはskip-hint・skip・ended。endedにはskippedを付け、そのコマだけ返す。
- consumedは操作名の配列。飛ばし成立時と復帰中の押下を後続へ渡さない。
- 初回の押下は既存の押し続けとみなし、実入力の解放を観測してから受け付ける。
- 戦闘からは3操作を同時に解放した観測が必要。操作ごとの連続長押しだけを数える。
- 新規押下のコマのdtは長押しに加算しない。連打・別操作の時間合算は採らない。
- 休止・非表示中と復帰最初のdtは捨てる。押下の履歴は観測し、長押し時間はリセットする。
- 復帰秒を表でも0.6以下に制限する。長い復帰を許し飛ばし時だけ短縮する案は採らなかった。
- 安全待ちはcancelを優先。3秒まではsafeでstart、3秒超ではgive-up。
- 予約はMap、鍵はJSONの[id, attempt]。区切り文字を連結する衝突し得る鍵は採らない。
- markReserved/markEndedは成功時true。予約前の終了・二重予約・二重終了はfalse。
- 記録は解析済み値またはJSON文字列。null/undefinedは欠落として通知なしでfalse。
- 読込不能はErrorを渡せる。未知版・型不正・解析失敗は全体をfalseへ戻しnoticeを返す。
- 存在するchapter1EndSeenがundefined/null/数/文字列なら拒否する。真偽値への暗黙変換は採らない。
- 保存先には触れず、既存openingSeenや進行保存の版も変更しない。
- planResumeはcp_resultだけを判定。不正・欠落はplay-end、完了済みはto-result。

## 試験と門番の実測

- Node v24.22.1、ブラウザ・追加依存・外部通信なし。
- 変更前：npm test 759/759、npm run check合格。
- 新規単体：node --test tests/valley-cinematics.test.mjs、42/42合格。
- 最終：npm test 801/801合格（既存759本＋新規42本、失敗・skipなし）。
- npm run check合格：285件のJS構文検査、既存素材・参照・純粋層検査を含む。
- 0.59/0.6秒、2.99/3/3.01秒、4.99/5/10/10.01/11秒、40/41字を試験。
- 30/60/144回毎秒で5秒完走と案内・終了各1回、休止・非表示・復帰も試験。
- 次の一時改変を個別に適用し、同じ42本を実行。各回finallyで元のファイルへ復元した。

| 一時改変 | 終了コード | 失敗本数 | 主な検出点 |
| --- | --- | --- | --- |
| a 案内判定を0.3秒へ | 1 | 2 | 0.3/0.59では案内なし、早い押下の拒否 |
| b ended通知を同時に2回へ | 1 | 14 | 完走・飛ばしとも終了通知は1回 |
| c 戦闘の全解放条件を無効へ | 1 | 4 | E/Space/Mouse0の開始前からの保持、同時解放 |
| d 尺の上限判定を11秒へ | 1 | 2 | 10.01秒と11秒を拒否 |

- 4回の復元後に42/42、その後全801本とcheckを通した。意図した一時改変は残していない。
- npm run smokeは変更前からlisten EPERM（127.0.0.1）。HTTPサーバーを起動できず未検証。
- 環境の制限回避・検査の弱体化は行わず、同じ環境失敗の反復も避けた。

## 後半で確かめること

- 世界の更新停止、表示・姿勢・カメラの復元、実入力の消費と解放待ちを接続する。
- 通知はそのコマで各1回だけ処理し、消費した保持入力を次の攻撃・会話へ漏らさない。
- cancelled/give-upの予約は呼出側が破棄し、retryでは試行番号と集合を更新する。
- 読込例外を通知へ渡し、保存不能・中断・表示失敗では完了を書かない。
- 再生後の既存終了処理まで完了してから章末完了を保存する。新規時の初期化失敗も扱う。
- 実接続・描画・減動・保存・戦闘不変・実性能・ブラウザ確認は今回の範囲外。
- HTTPを起動できる環境でnpm run smokeを完走する必要がある。
