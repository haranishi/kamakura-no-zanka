# 第3弾（画づくり・戦闘）の前値：画像

2026-10-28。戦闘の見せ方（R18）の見立てを裏づける画像。設計は `.kiro/specs/hidden-valley-slice/design-combat-presentation.md`、数値の根拠は `research-polish3.md`。
画像は前値で、改善の前後比較には、同じ条件で撮り直したものを使う（本書の画像を改善後と並べて合格にしない）。

| 画像 | 見えること | 撮り方 |
|---|---|---|
| `anim-draw.png` | `Katana_Draw_v2`（2.97秒）の8コマ。手は抜く動きをするが、**刃は手に現れない**（刃は動作と別の表示切替で出る） | ラボ（`dist/valley/lab.html`）。主人公・納刀の見え方（weapon=sheathed）・視点 q34。動作の長さを8等分した時刻（0〜2.9秒）で撮った |
| `anim-sheathe.png` | `Katana_Sheathe`（2.97秒）の8コマ。手・刃・鞘の位置が合わず、**刃が宙に浮いて見えるコマ**がある | 同上（weapon=drawn） |
| `anim-light1.png` | `Katana_Kesa_Cut`（2.47秒）の8コマ。構え→振り上げ→斬り→戻りの全体。ゲームが使うのは0.51〜1.22秒（29%） | 同上（weapon=drawn） |
| `anim-death.png` | 兵の `Fall_Dead_from_Abdominal_Injury`（3.5秒）の8コマ。倒れの流れと、刀の見え方 | 同上（人物は soldier） |
| `fight-sword-stick.png` | 里の戦闘の固定画角（`capture-set.mjs` の11）から、敵兵の腰を切り抜いて2倍にした画像。腰から伸びるのは**柄のない空の鞘**（茶の管）で、抜いた刀身は手元に見えない。鞘が細い棒に見える | 標準品質・1280×720・seed 1333 |

ラボの撮り方：`lab.html?who=<人物>&clip=<動作>&t=<秒>&view=q34&weapon=<drawn|sheathed>&shot=1&w=520&h=700`。1コマごとに時刻 `t` を変えて撮り、4×2に並べた。
動作の使用区間と速さの表は `research-polish3.md` にある。
