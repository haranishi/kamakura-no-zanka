# 残火の鎌倉 — 隠れ谷の灯

庭へ水を届け、水路を整え、帰る場所に灯をともす、小さな3D体験です。
v16の実モデルを引き継ぎ、v18でしごとの続き・景色の変化・自然の質感・環境音を加えました。

## 隠れ谷の縦切り（v19・`/valley/`）

`npm start` のあと `http://127.0.0.1:8080/valley/index.html` を開くと、三人称アクションの第一章「隠れ谷の灯」が遊べます（庭の `/` は v18 のまま）。
廃寺で目覚め、里を襲う追手を倒し、縛られた弥十郎を解いて仲間にし、待ち伏せを抜けて帰ります。所要は約10〜15分。
操作：WASD 歩き／Shift 走り／C 屈み／左クリック 斬り（三連）／F 強斬り／右クリック 受け（敵の刃が光ったら、見てから押すと弾き→左クリックで反撃）／
Space 転がり／E 調べる・とどめ・闇討ち／Tab 狙い／Q 弥十郎へ指示／Esc 休止。構え（体力とは別のゲージ）が尽きた敵にはとどめを刺せます。
- 設計：[要件・設計・タスク](.kiro/specs/hidden-valley-slice/)（物語は [docs/10_STORY_AND_DESIGN_JA.md](docs/10_STORY_AND_DESIGN_JA.md)）。
- 自動プレイと固定画角の撮影：[tools/README-valley-qa.md](tools/README-valley-qa.md)（`tools/valley-play.mjs`、Playwright は `PLAYWRIGHT_MODULE` で指定）。
- 出所：人物・小道具は Meshy AI で生成（[provenance/meshy-v19.json](provenance/meshy-v19.json)）。**公開・配布の前に、Meshy の契約プランの商用・公開条件を確認する**。非公開リポジトリのみに置く。
- 検査：`npm test`（規則・世界の整合）、`npm run check`（配布検査。`/valley/` を含む）、`npm run smoke`。
- 検証記録：[reports/VERIFICATION_V19_JA.md](reports/VERIFICATION_V19_JA.md)（独立評価の周回・実測・未確認）。
- 遊びの設計判断と、踏んだ罠：[.kiro/specs/hidden-valley-slice/design-app.md](.kiro/specs/hidden-valley-slice/design-app.md)。回帰の検査（矢で倒れても止まらない・やり直しで資源が増えない）は `tools/scenarios/regress-*.mjs`（`--strict` で回す）。
- 未確認：実機のマウス操作（ポインターロック）・音の聴感・Safari/Firefox。人物の指は元の動作データに指の動きが無く開いたまま。

## ブラウザで遊ぶ

Node.js 18以上で、このフォルダから起動します。

```sh
npm start
```

表示された `http://127.0.0.1:8080` を開きます。
使用中なら `npm start -- --port 8081`。終了はCtrl+Cです。
依存インストール、ビルド、APIキー、外部CDN、ログインは不要です。
`file://`の直接起動は非対応。WebGL2対応ブラウザが必要です。
初回は約24MBのモデルと素材を読み込みます。

## 庭のしごと

1. 庭の桶に近づいて拾う。
2. 井戸の東側で水をくむ。
3. 縁側前の苗床へ届ける。土と苗の姿が変わる。
4. 道へ戻り、水門の落枝を除く。水門が開き、流れが戻る。
5. 縁側前の灯をともす。しごとの後も散策できる。

WASD／矢印で歩き、マウス固定・ドラッグ、またはI/J/K/Lで見回し、Eで操作します。
I/Kは上下、J/Lは左右です。水路を見るときは少し下を向くと流れが分かります。
タッチでは方向ボタン・画面ドラッグ・対象の操作ボタンを使います。
Shiftで早歩き、Escで一時停止、Hで表示切替、Rで出発点へ戻ります。
Rは進行を保ちます。最初からのやり直しはメニューで確認を挟みます。

進行・表示・音設定は同じブラウザの同じURLに保存されます。
旧版の水運びの保存も引き継げます。配達済みなら水路の手入れから続きます。
別ポート・別ブラウザへの同期はありません。保存拒否時も、その場では遊べます。

## 検証する

```sh
npm test
npm run check
npm run smoke
```

通常実行に追加パッケージは不要です。任意の開発用PlaywrightとChromeがあれば、
PlaywrightのESM入口を`PLAYWRIGHT_MODULE`で指定して次も実行できます。

```sh
node tools/browser-check.mjs
node tools/measure-frame-time.mjs
```

[画面比較](reports/graphics-comparison.html)・[検証記録](reports/VERIFICATION_JA.md)と[改善ループ](.agent-harness/runs/2026-10-22-valley-life-v18.md)に根拠を残します。
SDDは[要件](.kiro/specs/valley-water-carry/requirements.md)・[設計追補](.kiro/specs/valley-water-carry/v18-design.md)・[タスク](.kiro/specs/valley-water-carry/v18-tasks.md)を参照してください。

## 素材と現在の範囲

元GLB・衝突データ・既存の家・井戸・稲・道具を保持しています。
Three.js 0.180.0はMIT、追加の土・林床・枝葉画像はCC0です。
[元素材](docs/05_ASSETS_AND_LICENSES_JA.md)と[追加素材](docs/06_TERRAIN_ASSETS_JA.md)に出典と扱いを記録しています。
独自モデルやプロジェクト全体のライセンスは変更していません。

歩けるのは庭と道です。室内、縁側、田、水路、戦闘、人物、全5章の物語は含みません。
標準品質は自然光・影・水と風、軽量は影や装飾負荷を抑えます。
OSの「動きを減らす」設定も反映します。性能は検証記録の測定条件を参照してください。

## 残件と未確認

水路・田のモデル末端に細い継ぎ目が残ります。失敗した延長水面は採用していません。
品質選択欄の矢印キーによる確定は、検査環境の制約で未確認です。
品質の変更処理と、キーボードだけでのゲーム本編一周は確認しています。

## 引き継ぎ資料

`docs/01〜04`、`PROMPT_FOR_CLAUDE_CODE_OR_CODEX.md`と`reports/baseline/`はv16時点の資料です。
当時の「未実装」と現在の状態を区別し、このREADMEと今回の検証記録を正とします。
Web公開用の設定や認証情報は含みません。HTTPサーバーはループバックだけで待ち受けます。
