# Design: 人物・動作・武器

## 配役（参考画像は Drive `02_マップ・コンセプト/2026-10-19_人物・生活_生成参考画像`）

| id | 役 | 元 | 生成 | 身長 |
|---|---|---|---|---|
| hero | 榊三郎景継（主人公） | 01 主人公 | 三面図(nano-banana-pro)→multi-image→骨入れ | 1.66m |
| archer | 梓 弥十郎（弓手・仲間） | 04を元に新規の三面図 | 同上 | 1.62m |
| soldier | 追手の雑兵 | 02 敵・下級兵 | image-to-3d | 1.62m |
| officer | 追手の侍大将 | 03 敵・将校 | image-to-3d（ultra） | 1.72m |
| villager_m / villager_f / child | 水穂の里の男・女・子 | 04・05・06 | image-to-3d | 1.58 / 1.48 / 1.20m |

弓兵は雑兵の体に弓と矢筒を付け、服の色と頭巾を変えた変種とする（クレジットを増やさない）。
生成設定は meshy-7・t-pose・PBR・質感4k・三角形・30,000〜40,000面。**4kは同額**。8kは使わない。
全員、顔と服は参考画像に従う。他作品の人物・衣装・ロゴに似せない。生成物は `provenance/meshy-v19.json` に
task_id・設定・日付・取得物のSHA256・利用条件（有料プラン・非公開）を残す。

## 動作の再利用（追加クレジットをほぼ使わない）

湊の残火 Web版の道具（`~/Projects/minato-web/tools/blender/` と、SSD上の動作キャッシュ181ファイル）で、
Meshyの24本骨へ約90本の動作（Meshy・CMU）を写し替えて1体1GLBに焼く。これは本人の制作物で、CMUは自由利用。
`tools/blender/build_valley_character.py` として写しを作り、出力先と人物表だけを本作用にする。
入れる動作は必要分に絞る（約45本）。足りない動作だけMeshyのライブラリから3クレジットで足す。

| 状態 | 動作（既存の名前） |
|---|---|
| 待ち・構え | `Katana_Guard_Idle`（構え）、`Alert`、`Long_Breathe_and_Look_Around`（平常） |
| 歩き・走り | `Samurai_Walk` `Samurai_Jog` `Samurai_Run`、`Cautious_Crouch_Walk_*`（屈み）、`Injured_Walk`（負傷） |
| 戦闘の足 | `Walk_Fight_Forward` `Walk_Fight_Back`、`Roll_Dodge` `Stand_Dodge` |
| 攻撃 | `Katana_Kesa_Cut` `Katana_Gyakukesa_Cut` `Katana_Yokonagi_Cut`（三連）、`Katana_Karatake_Heavy`（強）、`Katana_Charged_Cut`（溜め）、`Katana_Thrust`、`Katana_Finisher`（とどめ）、`Iai_Draw_Cut`、`Officer_Attack`（侍大将） |
| 受け | `Katana_Parry`（弾き）、`Sword_Parry_Backward` `Two_Handed_Parry`（受け）、`Katana_Counter_Cut` |
| 抜刀・納刀 | `Katana_Draw_v2` `Katana_Sheathe` |
| 被弾・倒れ | `Hit_Reaction` `Hit_Reaction_1` `Hit_Reaction_to_Waist`、`Knock_Down`、`Fall_Dead_from_Abdominal_Injury` `dying_backwards`、`Stand_Up2` `Stand_Up3` |
| 弓 | `Archery_Shot` `Draw_and_Shoot_from_Back` `Kneeling_Reload` |
| 生活 | `Pull_Radish` `Collect_Object` `Stand_and_Chat` `Talk_with_Hands_Open` `Sit_Cross_Legged_on_Floor` `Dozing_Elderly` `Formal_Bow` `Wave_One_Hand` `Male_Bend_Over_Pick_Up` `Push_and_Walk_Forward` `Stand_and_Drink` `Kneel_on_One_Knee_and_Stand` |
| 起床・調べる | `Wake_Up_and_Look_Up` `Walking_Scan_with_Sudden_Look_Back` `open_door` |

繰り返す動作は最後のコマが最初と同じ（`LoopRepeat`）。位置はその場。移動は論理が決め、再生の速さを `速さ ÷ avgSpeed` に合わせる。
攻撃の当たり区間は、動作ごとの手首の速さの山の6割を超える区間（manifest の `rightHand.activeWindow`）から取り、戦闘の `MOVES` の値と照らす。

## 動作制御（`characters.js`）

- 状態機械は論理の状態（`idle/move/attack/block/dodge/hit/stagger/down/dead/talk/work`）を見て、クリップを選ぶだけ。
- 遷移は層で重ねる：下半身は移動、上半身は攻撃・受け。切り替えは 0.12〜0.25 秒のクロスフェード。割り込みで姿勢が止まらないよう、攻撃は途中から受けへ移れる窓を持つ。
- 足運びは `footContacts` と `avgSpeed` を使い、歩き・走りの再生速度を実速度に合わせる。足の滑りは測って記録する（許容 8cm）。
- 同種の複数体は、動作の開始位相・服の色（material.color を掛ける）・体格（±4%）・待機の種類をずらす。
- 遠い人物は動作の更新を 30→15Hz に落とす。画面外は更新しない。

## 武器・小物（Blender手続き生成 `tools/blender/build_valley_props.py`）

太刀（鞘つき）、薙刀（雑兵）、弓と矢と矢筒、予備の刀。素材は作らず形と材質を手続きで作る。
太刀は右手の骨に固定し、納刀時は左腰の鞘へ。握りは動作ごとの手首位置から調整し、柄が手のひらを貫かない（めり込みを測る）。
弓は左手、矢は右手。矢は発射時に別オブジェクトとして飛ぶ（重力と軽い風）。

## 後回しにするもの

指の骨（Meshyは指なし。握りは持ち物の位置で隠す）、顔の表情、馬、蓑の別オブジェクト、つばき（仲間2人目）。
