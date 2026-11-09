# タスク：描画まで確かめる CI

- ✅ **CI-1 合成の鎌倉データ**（CI1）：`tools/make-synthetic-world.mjs`・試験（決定的・サイズ・ローダーが通る・実データの値を含まない）。17 ファイル・481KB。
- ✅ **CI-2 GL スモーク**（CI2・CI4）：`tools/gl-smoke.mjs`（CDP・新しい依存なし）・`--inject-bad-glsl`・許可リスト。**手元の実 Chrome で、通常＝PASS（3 画角・78 秒・エラー 0）・故障注入＝FAIL（6 秒で検出・終了コード 1）を確認**。初回は、起動中のページの応答が遅いと CDP が時間切れになったため、遅い応答を許し、撮影の待ちを延ばし、Chrome の性能通知を許可リストに入れた。
- ✅ **CI-3 ジョブ**（CI3）：PR #131 の CI で緑（`GL smoke` は 2 分・描画 99 秒・壊れた GLSL の検出 6 秒。GitHub の runner 標準の Chrome で動いた）。
- ✅ **CI-4 文書**（CI5・CI6）：`tools/README-ci.md`・`docs/CI_BRANCH_PROTECTION_JA.md`。
- ⏳ **CI-5 保護の有効化**（CI5）：連続成功＝①PR #131 ②main への push ③この docs PR。3 回目の成功後に親が設定する。

## 担い手
要件・設計＝親（Fable）／実装＝Codex（個人用）／検証＝親が実 Chrome と実際の PR で確かめる。1 PR にまとめる。


## 実装・検証記録（2026-11-09）
- CI-1：17ファイル・481,771 bytes。固定seed・8MB以下・全任意データの復号・全宣言ファイルの配信を単体試験で確認。
- 家／施設のGLBは既存のコンテナ書き出しを再利用。同梱Three／GLTFLoaderと配置処理をGPUなしで確認した。
- CI-2：CDP・3画角PNG・HUD／地面準備待ち・例外／warning／HTTPエラー回収・故障注入・プロファイル削除を実装。許可リストは空。
- rendererの既存公開口がないため、programsの種類とdiagnosticsの直接検査は依頼書で許可された最小版として見送った。distは変更していない。
- CI-3：GL smokeジョブ・5分上限・SHA固定・失敗artifact・故障注入のshaderFailure必須判定を追加。既存Nodeジョブは変更していない。
- CI-4：README-ciは62行、保護手順は52行。保護の有効化は3回連続成功後に親が行う。
- 開始時：npm testは1,395成功／35スキップ／0失敗、check成功、smokeはlisten EPERMで失敗。
- 終了時：npm testは1,406成功／36スキップ／0失敗（全1,442件）。追加12件は11成功／私有データ未指定で1スキップ。
- 開始・終了とも `NODE_OPTIONS=--max-old-space-size=1536 timeout 300 sh -c 'npm test && npm run check && npm run smoke'` を実行。
- 終了check：498構文・101 module・59純粋層、成功。git diff --check成功。
- 日本語文書lintはsudachipy未導入で実行不可。依存は追加せず、手動チェックリストで通読した。
- 親の確認（2026-11-09）：実 Chrome（手元）と実際の PR（#131）で、通常成功・注入失敗・固定画角の PNG・CI の所要時間（2 分）を確認した。描画経路の網羅（`renderer.info.programs` の直接検査）は、公開口が無いので未実装。
- Git管理領域がworktree外の書込禁止対象のためcommitなし。push・PR・マージ・保護設定は実行していない。
