# v18 Implementation Plan
既存tasks.mdの1〜7はv17完了記録。以下をv18追補として実行する。
12.2と14.2は未達・未確認、15.2は外部CI未実行として保持し、検証済み変更を提出する。

- [x] 8. 基準を実見し、仕様と素材の制約を固める
  - 既存検証成功、独立した体験・画像監査、SSD確認、固定画角のbeforeを保持する。
  - _Boundary: SDD, Audit_
  - _Requirements: 6.1, 6.3, 8.1_
- [x] 9. 六状態のしごとと旧保存の移行を作る
  - 順序・全不正操作・版1四状態移行・版2六状態の保存往復・拒否系のNode検証が通る。
  - _Boundary: Gameplay, Save_
  - _Depends: 8_
  - _Requirements: 2.2, 2.3, 3.3, 3.4, 3.5, 7.1, 7.2, 7.3, 7.4_
- [x] 10. 庭に結果が残る小道具と対話を結合する
  - 全5操作を既存の道から通し、苗床・水路・灯と桶39部品・UIが状態に一致する。
  - I/J/K/Lの見回しとWASD/Eだけでも全対象へ到達でき、矢印移動を保持し、pause・UI入力中は視点が動かない。
  - _Boundary: LifeView, QuestView, App, WalkUI (integration)_
  - _Depends: 9_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.4, 3.1, 3.2, 3.6, 4.1, 4.2, 4.3, 4.4, 4.6, 5.4, 7.1, 7.2, 7.3, 7.5, 7.7_
- [x] 11. (P) ユーザー操作後の環境音を作る
  - 風・水が控えめに鳴り、休止/ミュート/再開反復でも最大2ループで停止・解放する。
  - resume直後のpause/muteでも、非同期処理完了後は無音・ループ0・ソース解放となる。
  - _Boundary: Audio_
  - _Depends: 8_
  - _Requirements: 3.1, 4.5, 7.6_
- [ ] 12. 地面・森・山・水の質感を改善する
- [x] 12.1 検証済みの地面・木立・山・水材質を提出する
  - 8枚の画像の出典/hashと予算を保持し、土の寄り・左右の山・木立と水3種を実見する。
  - 失敗した延長水面・岸を撤去し、新しい明るい矩形を実行版へ残さない。
  - _Boundary: Environment, TerrainMaterials, Assets_
  - _Depends: 8_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 8.1, 8.2, 8.3, 8.4_
- [ ] 12.2 水面末端の継ぎ目を自然につなぐ（未達）
  - 2周試したが追加水面の矩形が残り、試作を撤去。元の細い継ぎ目は未解消。
  - 同じ失敗2周の停止条件に達したため、今回の提出範囲へ混ぜず残件として返す。
  - _Boundary: Environment_
  - _Blocked: harness-limit; 水面接続の設計を次の工程で見直す_
  - _Requirements: 8.4_
- [x] 13. 検証入口へ新規コードを接続し全回帰を確認する
  - Node/配布/HTTP、通常入力の全しごと、六状態復帰、保存移行/拒否、音失敗が通る。
  - キーボードのみでの全5操作と停止/UI入力時の視点停止、即resume→pause/mute後の無音・ループ0・解放をブラウザで確認する。
  - _Boundary: App, VerificationTools, Tests (integration)_
  - _Depends: 10, 11, 12.1_
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.2, 4.3, 4.5, 6.1, 7.4, 7.5, 7.6, 7.7_
- [ ] 14. 体験と画面を評価し、未確認を区別する
- [x] 14.1 実操作・画像・負荷と独立レビューを記録する
  - 390/768/1440と横向き、品質/reduce-motion、移動中性能と独立体験の証拠を残す。
  - IJKL/WASD/E一周とliveフォーカス移動の不具合を修正・再検査する。
  - _Boundary: Experience, Visual, Review_
  - _Depends: 13_
  - _Requirements: 4.4, 4.6, 5.1, 5.2, 5.3, 6.1, 6.3, 7.1, 7.2, 7.3, 7.7, 8.1, 8.2, 8.3, 8.4_
- [ ] 14.2 品質selectを矢印キーで確定する実操作を確認する（未確認）
  - headless/headfulの隔離Chromeと素のselectで同じ値不変。ゲーム固有とは断定しない。
  - 品質の変更処理・キーボード本編の成功と分け、厳密なUIゲートを保留する。
  - _Boundary: BrowserVerification_
  - _Blocked: native selectのキー確定を現検査環境で実証できない_
  - _Requirements: 4.3, 4.6_
- [ ] 15. 非公開Gitへ反映し、外部CIの未実行を区別する
- [ ] 15.1 検証済みの改善をPRでマージしmainの通常起動を確認する
  - private=true、PRのmerge、main通常起動、ローカル/remote一致を読み戻す。
  - _Boundary: GitDelivery_
  - _Depends: 14.1_
  - _Requirements: 6.2_

- [ ] 15.2 GitHubのmain CIを確認する（外部要因で未実行）
  - Node22/24とも課金・利用上限のエラーでjob未起動、step0。アカウント設定は変更しない。
  - macOSのNode22.23.4/24.12.0で同じNode/配布/HTTP検査は成功。GitHub Linux成功へ読み替えない。
  - _Boundary: CI_
  - _Depends: 15.1_
  - _Blocked: GitHub billing/spending limit_
  - _Requirements: 6.2_

## レビュー記録
独立レビュー2回で実行条件の追記と7.7対応漏れを指摘。境界・依存の追加指摘なし。
最終の7.7参照IDを主担当が修正し、全39要件の参照包含を機械照合した。
3回目の独立レビューは行わず、自律実行指示に基づき主担当が追補を確定する。

タスク9: Node15/15・構文5ファイル成功。独立レビューAPPROVED。
タスク11: 音14/14・独立レビューAPPROVED。即resume/pause/muteをChromeでも確認。
タスク10: 5操作×通常/キーのみ、6状態復帰成功。独立コードAPPROVED、体験2指摘の対象再検査も解消。

タスク12.1: 最終6画像・原本・8素材hash・描画予算の独立レビューAPPROVED。12.2は承認範囲外。
タスク13: Node55確認・配布42ファイル/29構文・HTTP28ルート・ブラウザ37グループ成功。
タスク14.1: 体験17/20・UI17/20を別々に記録。指摘の対象再検査と標準/軽量の静止・歩行計測を完了。
