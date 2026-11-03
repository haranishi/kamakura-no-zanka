# 8.4b 設定「血の表現」：撮影と数値

2026-11-03。方式・捨てた案は `.kiro/specs/hidden-valley-slice/design-blood.md`、タスクの記録は `tasks-polish3.md` の 8.4b。ここは測った結果と画像の置き場で、点数は付けていない。

## 画像（`blood-*.jpg`）

`capture-blood.mjs` の固定カメラ（2人を少し上の横から）・seed 1333・同じ入力。各行が段階（上から なし／ひかえめ／標準）。

| 画像 | 内容 |
| --- | --- |
| `blood-A.jpg` | ひとつ斬る（弱の一太刀）の命中の0.05・0.2・0.6秒後（実時間）。0.05秒後は停止の最中で、飛沫は胸に集まったまま |
| `blood-B.jpg` | 崩してとどめ。命中の0.2・1.0・2.5秒後。標準だけ、倒れた体の脇の地面に小さなしみ（2.5秒後には薄れ始める） |
| `blood-C.jpg` | ひかえめの一太刀を、標準品質（上）と軽量品質（下）で |

撮り方：`KZ_TITLE=1 KZ_SHEETS=<フォルダ> PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-blood.mjs --out <フォルダ>`（`KZ_TITLE` を外すと段階名を書かない＝盲検用）。

## 数値

- `regress-blood.json`：`regress-blood.mjs` の要約（段階ごとの最大の粒・しみ、乱戦と詰めた命中の最大、描画呼出の範囲、場面の物の数）。
- `capture-numbers.json`：撮影の各コマで出ていた粒・しみの数。
- `perf.json`：`tools/measure-perf.mjs` の8試行（作業前・作業後）と、標準の戦闘を交互に3回ずつ測った p95。作業後の最初の8試行は外の負荷（システムの索引づけで負荷平均10）で標準が31〜42msになり、負荷が下がってから測り直した値を載せた。呼出と三角形の最大は前後で同じ。
