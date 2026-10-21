# v18 Implementation Plan
既存tasks.mdの1〜7はv17完了記録。以下をv18追補として実行する。

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
- [ ] 12. (P) 地面・森・山・水の質感を改善する
  - 1K素材の出典とhashを保持し、寄り/左右/反対の固定画角で三角境界・格子・裸の床を減らす。
  - _Boundary: Environment, TerrainMaterials, Assets_
  - _Depends: 8_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 8.1, 8.2, 8.3, 8.4_
- [ ] 13. 検証入口へ新規コードを接続し全回帰を確認する
  - Node/配布/HTTP、通常入力の全しごと、六状態復帰、保存移行/拒否、音失敗が通る。
  - キーボードのみでの全5操作と停止/UI入力時の視点停止、即resume→pause/mute後の無音・ループ0・解放をブラウザで確認する。
  - _Boundary: App, VerificationTools, Tests (integration)_
  - _Depends: 10, 11, 12_
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.2, 4.3, 4.5, 6.1, 7.4, 7.5, 7.6, 7.7_
- [ ] 14. 実操作・画像・負荷を評価し最大3周で修正する
  - 390/768/1440と横向き、品質/reduce-motion、移動中性能、5〜10分の独立体験を記録する。
  - 独立レビューの指摘を再現し、必要な修正と関連検証を完了する。
  - I/J/K/Lの見回し・WASD/Eだけの一周、矢印移動、pause/UI入力時の視点停止を独立体験でも確認する。
  - _Boundary: Experience, Visual, Review_
  - _Depends: 13_
  - _Requirements: 4.4, 4.6, 5.1, 5.2, 5.3, 6.1, 6.3, 7.1, 7.2, 7.3, 7.7, 8.1, 8.2, 8.3, 8.4_
- [ ] 15. 非公開Gitへ小刻みに反映しPRをマージする
  - private=true、PRのmerge、mainのCIと通常起動、ローカル/remote一致を読み戻す。
  - _Boundary: GitDelivery_
  - _Depends: 14_
  - _Requirements: 6.2_

## レビュー記録
独立レビュー2回で実行条件の追記と7.7対応漏れを指摘。境界・依存の追加指摘なし。
最終の7.7参照IDを主担当が修正し、全39要件の参照包含を機械照合した。
3回目の独立レビューは行わず、自律実行指示に基づき主担当が追補を確定する。

タスク9: Node15/15・構文5ファイル成功。独立レビューAPPROVED。
タスク11: 音14/14・独立レビューAPPROVED。即resume/pause/muteをChromeでも確認。
タスク10: 5操作×通常/キーのみ、6状態復帰成功。独立コードAPPROVED、体験2指摘の対象再検査も解消。\n