# 影（案A・2026-11-04）の前後

木が風で揺れたとき影も揺れるようにし、歩いても影の縁が揺れないようにした（design-graphics.md「影（案A）」）。数値は `summary.json`（この環境のみ）。
- `before-/after-broadleaf-winddiff.jpg`：通常風の2位相の差を赤で重ねた。前は樹冠だけが赤く、地面の長い影は動かない。後は影の縁も赤い。
- `before-/after-broadleaf-gustdiff.jpg`：無風と案内の突風の差。
- `before-/after-follow-diff.jpg`（標準）・`light-follow-diff`（軽量）：無風の固定画で主人公だけを動かした9区間の変化の重ね。前は影の縁と小物に点が出る。後は主人公の像と焚き火だけ。
- 撮影は `tools/scenarios/capture-shadows.mjs`、回帰は `regress-tree-shadow-wind.mjs`。

性能：描画呼出・三角形は前後で同じ。標準・移動は1コマあたり約1ms重い（p50の平均 13.3→14.4ms、p95の中央 16.8→17.9ms。環境の揺れで p95 は 14.8〜21.5ms を行き来する）。影の描画が近景の木の風の計算と葉の切り抜きを毎コマ行うため。採るかどうかは本人の判断待ち。
