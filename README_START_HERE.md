# 残火の鎌倉 | 開発引き継ぎフォルダ

**土台：v16 散策版。次の「桶で水を運ぶ遊び」は、まだ実装していません。**

このフォルダを丸ごと Claude Code または Codex の作業対象にしてください。ブラウザで動く現在のコード・実3D素材・依存ライブラリ・既存テストと、次の実装を依頼する日本語指示書が入っています。エージェントへの送信や公開は行っていません。

## 1. まず起動する

Node.js 18 以上が使える環境で、解凍した `Kamakura_Developer_Handoff_v16` フォルダをターミナルで開きます。

```sh
node --version
npm start
```

表示された **http://127.0.0.1:8080** をブラウザで開きます。終了は `Ctrl+C`。

- `npm install`、ビルド、APIキー、ログイン、外部CDNは不要です。依存コードとテクスチャは同梱済みです。
- ポートが使われている場合：`npm start -- --port 8081`。サーバーはこのPCのループバックだけで待ち受けます。
- npm がない場合：`node tools/serve.mjs`。Node.js 自体の導入が必要なら、利用環境の管理方針に従ってください。
- Python 3 のみある場合：`python3 -m http.server 8080 --bind 127.0.0.1 --directory dist` でも閲覧できます。ただし自動テストには Node.js が必要です。Windows では `py -m http.server ...` が使える場合があります。
- `dist/index.html` のダブルクリックによる `file://` 起動は非対応です。
- WebGL2 対応ブラウザが必要です。最初に約19.5 MBの3Dモデルを読み込みます。

## 2. 依頼する文章

`PROMPT_FOR_CLAUDE_CODE_OR_CODEX.md` を開き、本文をエージェントへ貼り付けてください。作業フォルダをこのフォルダに指定します。Claude Code と Codex のどちらでも同じ本文を使えます。両方を同時に同じフォルダへ書き込ませないでください。

この指示書は次の実装を依頼するためのものです。現時点で追加ゲーム機能が完成したことを示すものではありません。

## 3. 変更前・変更後の確認

```sh
npm test
npm run check
npm run smoke
```

- `npm test`：既存の衝突11件＋設定値5件。ゲーム進行や実ブラウザ操作のテストではありません。
- `npm run check`：必要ファイル、JavaScript構文、GLBの基本構造と画像内蔵を確認。
- `npm run smoke`：ローカルHTTPサーバーと11配信ルート、MIME、エラー応答を確認。WebGL描画や実機速度は測定しません。
- テストは `reports/` へ結果を書きます。解凍先に書き込み権限が必要です。
- 詳しい新機能の完成条件は `docs/03_ACCEPTANCE_CHECKLIST_JA.md`。既存16件の成功だけで完成扱いにしないでください。

## フォルダ構成

```text
Kamakura_Developer_Handoff_v16/
├── README_START_HERE.md              最初に読む文書
├── PROMPT_FOR_CLAUDE_CODE_OR_CODEX.md  コピーして依頼する文章
├── AGENTS.md                         共通の開発ルール
├── CLAUDE.md                         共通ルールへの案内
├── package.json                      起動・テストコマンド
├── dist/                             現在の実行ソース。ここを編集する
│   ├── index.html / style.css
│   ├── app.js / ui.js / collision.js
│   ├── assets/scene.glb               最適化済みの実3Dモデル
│   ├── assets/collision.json          地形高さ・簡易衝突データ
│   └── vendor/                       Three.js と必要なローダー
├── docs/                             開発仕様・構造・受入条件・制約
├── tests/                            v16の既存16テスト
├── tools/                            ローカルサーバー・配布検査・参考エクスポート
├── licenses/                         Three.js のMITライセンス
├── provenance/                       素材出典・色修正の記録
├── reports/baseline/                 過去のv16検証とUI参照元
├── reports/screenshots/              v16の表示見本
└── FILES_SHA256.json                 同梱ファイルの照合用ハッシュ
```

## 今できること／まだないこと

**実装済み**：WASD・矢印移動、Shift早歩き、クリックでマウス固定、ドラッグ見回し、タッチ方向ボタン、Esc一時停止、Rで出発点、HでHUD切替、表示設定の保存、地形追従、家・井戸・水際・外周の簡易衝突。

**未実装**：拾う・使う操作、桶の所持状態、水くみ、配達目標、持ち物、ゲーム進行保存、効果音。これらが今回の引き継ぎ先に依頼する範囲です。

## 元モデルについて

このフォルダはブラウザ開発には単体で使えますが、編集用Blender原本の完全バックアップではありません。大きい元データは同梱していません。必要な場合は、ユーザーが管理する [v14 の保存フォルダ](https://drive.google.com/drive/folders/1_KNHyVttOouTVkRKImIdHuCOQj-7UEkB) から別途用意してください。共有権限やログインの引き継ぎは含みません。

元データを変える必要がない限り、既存GLBを再書き出ししない方が安全です。詳しくは `docs/05_ASSETS_AND_LICENSES_JA.md`。

## 知っておいてほしい制限

井戸の造形の粗さ、約74cmの縁側段差、庭と道の材質の境目は既知の状態です。家・縁側・室内・田・水路は立入不可。物理GPUのFPS、スマートフォン実機、Safari実機は未検証です。検証範囲と未確認事項を混同しないでください。
