# 設計：描画まで確かめる CI

## 方針
- **ブラウザは runner 標準の Google Chrome を使い、CDP（DevTools プロトコル）を Node 組み込みの `WebSocket` で直接話す**。Playwright など新しい依存を足さない（AGENTS.md の「依存を増やす前に…」）。
- 描画は `--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`（ソフトウェア）。速度は見ない。画面は PNG で残す。
- 合成データはリポジトリに置かず、**CI の中で毎回生成**する（バイナリをコミットしない）。`tools/serve.mjs` の `KZ_WORLD_DIR`（`/world-private/`）へ渡す。

## 合成データの作り方（CI1）
- 小さな格子（例 256×256・cell 8m）に、決定的な疑似乱数（固定の種）で、地形・地面の分類・川・海・家・施設・木・道を置く。形式は `kamakura-data.js` の `validateMeta`・`decodeData` と、実データ README のスキーマに従う。GLB（家の部品・施設）は、最小の自前の GLB 書き出し（箱と屋根と堂の内部）で作る。
- **「主要な描画経路が全部動く」の確かめ方**：スモークの中で、ページ内から `renderer.info.programs`（コンパイルされたシェーダープログラムの一覧）を読み、期待する種類（地面・草・木・家・施設・水・海）が揃っていること、各プログラムの `diagnostics` が無いことを確かめる。

## スモーク（CI2・CI4）
- 起動 → HUD の「東 …」が出るまで待つ → 地面の用意（`kz-tone-ready`）を待つ（上限あり）→ 画角ごとに撮影・エラーの回収。
- エラーの回収：`Runtime.exceptionThrown`・`Log.entryAdded`（error/warning）・`Runtime.consoleAPICalled`（error/warning）。許可リスト（既知の無害な警告）は、ファイルに理由つきで書く。空に近く保つ。
- **検出力（CI4）**：`--inject-bad-glsl` を付けると、ページに読み込まれる材質のシェーダーへ `position.y--0.013` を差し込み、スモークが**非0で終わる**ことを CI のステップで確かめる（`! node tools/gl-smoke.mjs --inject-bad-glsl`）。

## CI（CI3・CI5）
- `verify.yml` に `gl-smoke` ジョブ（`ubuntu-24.04`・アクションは SHA 固定・5 分）。`google-chrome` は runner 標準。
- 必須化は手順だけ `docs/` に書く：`gh api -X PUT repos/<owner>/<repo>/branches/main/protection …`（検査名 `Node 22`・`Node 24`・`GL smoke`・`strict: true`）。**3 回続けて成功してから**、親が実行する。
