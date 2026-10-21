# 変更の境界

- `.kiro/specs/valley-water-carry/` を今回の要件・設計・検証の正本にする。
- 引き継ぎdocs/01〜05は根拠として保持し、現状はREADMEと今回の検証記録で示す。
- `dist/app.js` は入力・描画・UIとゲームの結合を担う。
- `dist/gameplay.js` と`dist/interactions.js`は純粋なゲーム規則を担う。
- `dist/save.js`は進行保存、`dist/audio.js`は音の生存期間を担う。
- `dist/environment.js`は追加背景・光・植生と水面の見た目を担う。
- 元モデルの全体再生成や衝突規則の緩和で問題を隠さない。
