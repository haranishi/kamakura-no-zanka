# タスク：描画まで確かめる CI

- ☑ **CI-1 合成の鎌倉データ**（CI1）：`tools/make-synthetic-world.mjs`・試験（決定的・サイズ・ローダーが通る・実データの値を含まない）。
- ◐ **CI-2 GL スモーク**（CI2・CI4）：`tools/gl-smoke.mjs`（CDP・新しい依存なし）・`--inject-bad-glsl`・許可リスト。手元の実 Chrome で、合成データを使って通ること。
- ◐ **CI-3 ジョブ**（CI3）：`.github/workflows/verify.yml` に `gl-smoke`。PR で実際に緑になること。
- ☑ **CI-4 文書**（CI5・CI6）：`tools/README-ci.md`・`docs/` に保護の設定手順。
- ⬜ **CI-5 保護の有効化**（CI5）：スモークが3回続けて成功したあと、親が設定する。

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
- 未確認：実Chromeでの通常成功／注入失敗・固定画角PNG・描画経路の網羅・CIの5分以内・実PRの成功。listen EPERMのため親の検証へ引き渡す。
- Git管理領域がworktree外の書込禁止対象のためcommitなし。push・PR・マージ・保護設定は実行していない。
