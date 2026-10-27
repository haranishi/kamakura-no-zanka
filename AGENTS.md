# 開発エージェント共通ガイド

人でもAIエージェントでも、このリポジトリで作業するときの共通の基準です。ユーザーの最新の明示的な依頼を優先してください。
外部の方の貢献の入口は [CONTRIBUTING.md](CONTRIBUTING.md)、ライセンスは [LICENSE](LICENSE)・[LICENSE-ASSETS.md](LICENSE-ASSETS.md)・[NOTICE.md](NOTICE.md) です。

## 最初に読む

1. `README.md`（遊び方と全体像）
2. `.kiro/specs/hidden-valley-slice/`（v19の要件・設計・タスク。現行の正本）
3. `docs/10_STORY_AND_DESIGN_JA.md`（物語と設計思想）
4. `tools/README-valley-qa.md`（自動プレイと固定画角の撮影）

前作（庭で水を運ぶ v18）の資料は `README_START_HERE.md` と `.kiro/specs/valley-water-carry/`。`docs/01`〜`05` はv16引き継ぎ時の資料なので、当時の記述と現在の状態を区別してください。

## 作業の原則

- 実装を頼まれたときだけ実装する。資料レビューだけの依頼ならコード変更を始めない。
- `dist/` は生成物ではなく編集対象。フレームワーク移行や全体書き直しは不要。ビルド・外部CDN・通信は足さない。
- 規則の層（`combat.js`・`enemy-ai.js`・`quest.js`・`collision.js` など）は Three.js・DOM・乱数・時計に触れない。`node tools/check-valley.mjs` が見張る。
- セーブの互換を守る（`dist/valley/save.js`）。壊す変更は版を上げて移行を書く。
- 庭（`/`）の挙動と検査は壊さない。
- 作業の最初と最後に `npm test && npm run check && npm run smoke` を通す。規則を変えたら、対応するテストを足す。
- 依存を増やす前に、同梱の標準機能で足りないか考える。足すなら出典・バージョン・ライセンスを `NOTICE.md` と `provenance/` に残す。
- 素材を足すときは、出所と条件を `provenance/` に残す。AI生成なら生成の条件も残す。他人の作品を参照画像に使わない。
- 秘密鍵、トークン、環境に依存する絶対パス、個人データをソースやコミットに入れない。
- モデルやコライダーを無断で全面再生成しない。
- エラーを隠す、テストを削除して緑にする、未測定のFPSを書く、未実行の確認を成功と報告することは禁止。

## 依頼なしにしないこと

公開先やデプロイ先の新設、アカウント作成、課金、`main` への直接 push、force push、他人のPRのマージ。

## 完了時に残すもの

変更概要、確かめたコマンドと結果、実ブラウザで確認した手順と環境、未確認のこと、既知の不具合、次の最小ステップ。見た目の変更は固定画角の撮影を前後で添える。
