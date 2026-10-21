# Implementation Plan

タスクグラフ独立レビュー: PASS。既存仕様と依頼範囲の自律実行を継承する。

- [x] 1. 基準と実行環境を固定する
  - 既存16件・配布・HTTP検査成功。ループバック起動と既存Chromeで基準画像を撮影する。
  - 比較は同じ画角・幅・画質で行い、元GLBと衝突データを保持する。
  - _Boundary: SDD, Runtime_
  - _Requirements: 6.1, 6.3_

- [x] 2. ゲーム規則と安全な復帰を作る
- [x] 2.1 (P) 順序と二重操作に強い四状態の進行を作る
  - 正しい一周と不正順序の単体検証が通り、目的・所持説明が状態と一致する。
  - _Boundary: Gameplay_
  - _Depends: 1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.2, 2.3_
- [x] 2.2 (P) 届いて見える一対象だけを選ぶ
  - 距離境界、背後、遮蔽、近接する複数対象を検証し、古い予告で実行できない。
  - _Boundary: Interactions_
  - _Depends: 1_
  - _Requirements: 2.1, 2.2_
- [x] 2.3 進行の保存と不正値からの復帰を作る
  - 各状態の往復、壊れたJSON・未知の版・保存拒否でもクラッシュしないテストが通る。
  - _Boundary: Save_
  - _Depends: 2.1_
  - _Requirements: 3.3, 3.4, 3.5_

- [ ] 3. (P) 谷の奥行き、自然光、水と風を描く
  - 追加背景・空・霧・水面・稲の風が見え、軽量と動きを抑える設定で負荷を減らせる。
  - _Boundary: Environment_
  - _Depends: 1_
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 4. (P) 操作後に鳴り、休止で止まる音を作る
  - 取得・給水・配達の音とミュートが動き、未操作・休止・離脱時には鳴らない。
  - _Boundary: Audio_
  - _Depends: 1_
  - _Requirements: 3.1, 4.5_

- [ ] 5. 既存の庭で一周するように結合する
- [ ] 5.1 実モデルの桶を状態に合わせて配置する
  - 39元ノードを最適化前に分離し、所持・水面・配達・再挑戦で全体を同期する。
  - _Boundary: QuestView_
  - _Depends: 1_
  - _Requirements: 2.4_
- [ ] 5.2 進行・対話・表示・入力・風景を明示的に統合する
  - 桶分離→材質調整→可動桶を除外して最適化→風景→状態適用→compileの順を守る。
  - 風は最適化後scene直下の稲にも適用。通常入力で全対象へ到達し、対話予告と実行が一致する。
  - _Boundary: App, WalkUI, QuestView, Environment_
  - _Depends: 2.1, 2.2, 3, 5.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.3, 2.4, 4.1, 4.2, 4.3, 4.4, 4.6, 5.4_
- [ ] 5.3 中断・保存・音・再挑戦を明示的に統合する
  - 全状態の停止・復帰、R、再読込、確認つきリセットで進行と表示が一致する。
  - _Boundary: App, WalkUI, Save, Audio_
  - _Depends: 2.3, 4, 5.2_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.5_

- [ ] 6. 自動検証とブラウザの実操作を通す
- [ ] 6.1 新規コードとテストを検証入口に接続し回帰を確認する
  - package.json・tools/check-package.mjs・tools/smoke.mjsに新規テスト・全JS構文・配信ルートを追加する。
  - Node検証、配布・HTTP検査が新規実装も含めて成功する。
  - _Boundary: Tests, VerificationTools_
  - _Depends: 5.3_
  - _Requirements: 2.1, 2.2, 2.3, 3.3, 3.4, 3.5, 5.4, 6.1_
- [ ] 6.2 通常入力で一周と失敗・中断復帰を確認する
  - 連続経路を歩き、各状態のpause/reload/R、連打、保存・音失敗、再挑戦を実操作で確認する。
  - _Boundary: BrowserVerification_
  - _Depends: 6.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.2, 4.3, 4.4, 4.5, 5.4, 6.1_
- [ ] 6.3 画面・操作感・負荷を確認し実在する指摘を直す
  - 390/768/1440pxと横向き、Tab、音、品質を確認し、固定画角を基準と比較する。
  - 実測環境と未確認のSafari・端末を記録し、必要な修正後に関連検証を通す。
  - _Boundary: VisualVerification, ExperienceVerification_
  - _Depends: 6.2_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 6.1, 6.3_

- [ ] 7. 独立レビューで重大な不具合が残らないことを確認する
  - 読取レビューの指摘を再現し、必要な修正と関連検証を完了する。
  - _Boundary: Review, Integration_
  - _Depends: 6.3_
  - _Requirements: 6.1_

## 引渡ゲート
- [ ] 非公開リポジトリを作成し、段階的commit・push・PR作成・mergeと反映確認を完了する。
- GitHub認証が必要。未復旧ならGit反映だけを未完了と明示する。要件6.2。
