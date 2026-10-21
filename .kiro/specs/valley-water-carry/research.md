# Research: 既存素材から判断した統合点

## Summary
v16の既存16件、構文・モデル・HTTP検査はすべて成功した。
既存の詳細仕様が水運びを定義しているため、新しい大規模企画を作らずその縦切りを採用する。

## Research Log
- docs/01〜05、AGENTS.md、app/ui/collisionとGLBを確認した。
- 桶はBucket_の39部品。最適化で親から外れるため、先に専用Groupへ隔離する。
- 地表の開始点は(-2.3,6.4)、桶は(-4.55,3.10)、井戸は(-6.40,2.20)。
- 井戸中心は立入不可。東・南側の安全な庭から届くアンカーが必要。
- 桶中心は地表から約0.42m。距離を水平で統一し、足元の桶を不当に遠い扱いにしない。
- 元GLBは約19.5MB。稲901株を含む共有描画を維持する。
- 既存の画像は空背景と切れた地形端が目立つ。背景稜線・木立・霧が改善の中心。
- Three.jsの現物は0.180.0。シェーダー差込みは同梱ShaderChunkと突き合わせる。
- 公式API: https://threejs.org/docs/pages/Material.html 、https://threejs.org/docs/pages/WebGLRenderer.html 。

## Design Decisions
- 状態変化と表示を分け、保存は4状態だけ。途中アニメーションや位置を永続化しない。
- 全体のフレームワーク移行は操作・素材の回帰リスクがあるため見送る。
- 追加ライブラリを使わず、既存Three.js・Web Audio・標準テストを採用する。
- 写実的な素材を残し、背景・大気・光の整合で画面を改善する。

## Verification Constraints
ブラウザのスクリーンショットと実操作を新たに確認する。過去のv16画像を今回の証拠にしない。
GitHubは開始時401。認証復旧後、haranishi/kamakura-no-zankaを非公開で作成し読み戻し確認した。

## v18の実検査後の判断
土粒・格子抑制は画像で改善。遠景の葉カード・黄褐色の裸床・水面切端白線が残った。
改善2周目は元GLBを保持し、岸の接続と外周の色を調整する。
fir_tree_01本体464.8MBは使わず、公式APIの1K twig diff/alphaだけ646KBを取得した。
画像のMD5をAPI記録と照合。CC0、作者Rob Tuytel/Rico Cilliers、出典は素材記録へ残す。
