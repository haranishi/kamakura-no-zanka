# 8.6a 刀を握る手：前後の記録（2026-10-30）

設計と、採った方式の理由は `.kiro/specs/hidden-valley-slice/design-hand-grip.md`。ここは、測った結果と画像の置き場です。

## 画像（`*.jpg`）

どれも人物ラボ（`lab.html`）で、同じ版の層を切った人物を「前」、層ありを「後」として、同じ画角で撮った。カメラは刀・鞘の枠に固定している。

| ファイル | 内容 |
|---|---|
| `lab-hero-guard.jpg` | 主人公。構え・歩き・袈裟・横薙ぎ・唐竹・とどめの各1コマを、右手の寄り（表・裏）と戦闘の画角で |
| `lab-hero-draw.jpg` | 主人公の抜刀（u 0.15〜0.8）。右手の寄り・左手の寄り（鞘）・戦闘の画角 |
| `lab-hero-walk.jpg` | 納刀して歩く・待つ。握っていない手の指の軽い曲げ |
| `lab-soldier-guard.jpg`・`lab-officer-guard.jpg` | 兵・侍大将の構えと攻撃 |

撮り方：`tools/scenarios/capture-hand-grip.mjs`（`tools/lab-play.mjs` で動かす。`KZ_SHEET=guard|draw|walk|enemy`）。

## 測定

- 毎コマの回帰（`tools/scenarios/regress-hand-grip.mjs`・31場面。結果は `regress-hand-grip.json`）：手の皮のめり込み最大1.4mm、手首と指の跳び最大2.98倍、動作の骨は層を切った人物と6e-8rad以内、切先の差0、腕の写しの長さの変化0.06mm以下、握っていない手の写しと動作の骨の差7e-8rad以下。
- すき間（指の付け根・中の節で柄にいちばん近い皮）：構え・攻撃で主人公4.5mm以下・兵3.7mm以下、抜刀中5.9mm以下、侍大将12.9mm。目標3mmには届いていない（設計の表を参照）。
- 実ゲーム（`tools/scenarios/regress-hand-grip-game.mjs`・4場面）：敵が気づいて抜く・納刀のまま攻撃・戦闘後の自動の納刀・抜く途中に倒れる。握り切り・鞘を持ち・納め切ったら解ける。
- 刀の軌跡（`tools/scenarios/record-sword-tips.mjs`）：変更前の版（655c21d）と比べ、3人の全動作と抜刀・納刀の116列・22,379コマで、切先の差は最大0.0000mm。
- 戦闘の論理（`tools/scenarios/regress-attack-timing.mjs`）：変更前の版と320コマ一致。
- 性能（`tools/scenarios/measure-perf.mjs`、戦闘の場面・標準品質）：描画呼出682・三角形4,188,713は前後で同じ。p95は、同じ条件で続けて測った前後で26.6ms→25.8ms（差なし）。ただし測定中、Macで別の作業（Rustのビルド、別のChrome）が動いていて、前後とも20msを超えた。最初の1回は17.3ms。静かな環境での8試行の再測定が要る。型ごとの準備は43〜64ms（読み込みの間に1回）、毎コマの更新は1人約0.01ms増。

## 未確認

両手持ちの左手（8.6a-2）・本人のプレイ・別役の盲検採点・Safari・Firefox・実機。
