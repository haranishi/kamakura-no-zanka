# 変更の境界

- 庭のしごと：`.kiro/specs/valley-water-carry/` が正本。`dist/app.js` ほか既存ファイルは回帰検証のため壊さない。
- 隠れ谷の縦切り：`.kiro/specs/hidden-valley-slice/` が正本。コードは `dist/valley/`、検査は `tests/valley-*.test.mjs`。
- 層は data → logic（Three.js・DOM・乱数・時刻に依存しない）→ view → app → harness。上が下を呼び、逆は禁止（design.md）。
- 素材の加工道具は `tools/blender/`（再生成できること）。生成物には生成元と版を `provenance/` へ記録する。
- 引き継ぎdocs/01〜06は根拠として保持する。現状はREADMEと検証記録で示す。
- 元モデルの全体再生成や衝突規則の緩和で問題を隠さない。
