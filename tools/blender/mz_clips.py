# mz_clips.py — 動作ごとの扱い（繰り返すか・進む向き・攻撃か・注意）（assets-r1・2026-10-01）
# （出所：作者の別作品（非公開）の Blender 道具を残火の鎌倉 v19 で写して使う。内容は変更していない）
#
# 何を：ループにする動作と、その切り方。攻撃として右手の速さの山を測る動作。一覧に書く注意。
# どの素材から：動作の名前は extract_motions.py の一覧（ArtSources/Meshy の動作ファイルの名前）。
#   注意は別作品（Unity版・非公開）の記録にある。
# 版：r1。
#
# kind：cycle＝歩き・走りなど進む繰り返し（1周を選んで前へそろえ、その場にする）、idle＝その場の繰り返し。
# travel：1周で進む向き（forward/back/left）。window：元のコマ番号（0始まり）で1周を指定（CMU は Unity版と同じ区間）。
# whole：動作全体を1周にする。events='window'：足で周期を切れない（泳ぎ・梯子）ので継ぎ目の差が最小の区間を探す。

LOOPS = {
    # Text to Motion の歩き・小走り・走り（足軽 r2 の骨）。Unity版では小走り・走りは跳ねて尻を蹴るので CMU に戻した。
    'Samurai_Walk': {'kind': 'cycle', 'travel': 'forward'},
    'Samurai_Jog': {'kind': 'cycle', 'travel': 'forward'},
    'Samurai_Run': {'kind': 'cycle', 'travel': 'forward'},
    # CMU（BVH のコマ番号−1。Unity版 ArtSources/Original/locomotion-metrics.json の first/last と同じ区間）
    'CMU_Walk': {'kind': 'cycle', 'travel': 'forward', 'window': (170, 298)},
    'CMU_Jog': {'kind': 'cycle', 'travel': 'forward', 'window': (53, 148)},
    'CMU_Run': {'kind': 'cycle', 'travel': 'forward', 'window': (53, 143)},
    # Meshy ライブラリ（その場の動作が多い。速さは着いている足が後ろへ流れる速さから見積もる）
    'Walk_Fight_Forward': {'kind': 'cycle', 'travel': 'forward'},
    'Walk_Fight_Back': {'kind': 'cycle', 'travel': 'back'},
    'Cautious_Crouch_Walk_Forward': {'kind': 'cycle', 'travel': 'forward'},
    'Cautious_Crouch_Walk_Backward': {'kind': 'cycle', 'travel': 'back'},
    'Cautious_Crouch_Walk_Left': {'kind': 'cycle', 'travel': 'left'},
    'Crouch_Walk_with_Torch': {'kind': 'cycle', 'travel': 'forward'},
    'Injured_Walk': {'kind': 'cycle', 'travel': 'forward'},
    'Loco_Casual_Walk': {'kind': 'cycle', 'travel': 'forward'},
    'Loco_Run_02': {'kind': 'cycle', 'travel': 'forward'},
    'Loco_RunFast': {'kind': 'cycle', 'travel': 'forward'},
    'Casual_Walk': {'kind': 'cycle', 'travel': 'forward'},
    'Push_and_Walk_Forward': {'kind': 'cycle', 'travel': 'forward'},
    'Swim_Forward': {'kind': 'cycle', 'travel': 'forward', 'events': 'window', 'min_seconds': 1.0},
    'Ladder_Climb_Loop': {'kind': 'cycle', 'travel': None, 'events': 'window', 'min_seconds': 0.8, 'vertical_inplace': True},
    # その場の繰り返し
    'Katana_Guard_Idle': {'kind': 'idle'},
    'Swim_Idle': {'kind': 'idle'},
    'Talk_with_Hands_Open': {'kind': 'idle'},
    'Long_Breathe_and_Look_Around': {'kind': 'idle'},
    'Torch_Look_Around': {'kind': 'idle'},
    'Alert': {'kind': 'idle'},
    # 歩いたり止まったりして見回す（23.8秒）。一定の速さで送ると足が滑るので、その場の繰り返しとして入れる
    'Walk_Slowly_and_Look_Around': {'kind': 'idle'},
    'Stand_and_Chat': {'kind': 'idle'},
    'Dozing_Elderly': {'kind': 'idle'},
    'Sit_Cross_Legged_on_Floor': {'kind': 'idle'},
}

# 床に立っていない動作（よじ登り・梯子・泳ぎ・ぶら下がり）。床への高さ合わせをしない
OFF_GROUND = {'Climb_Up_Rope', 'Hang_and_Climb_Left', 'Ladder_Mount_Start', 'Ladder_Climb_Loop', 'Ladder_Climb_Finish',
              'Swim_Idle', 'Swim_Forward', 'swimming_to_edge', 'climbing_up_wall', 'Jump_and_Grab_Wall'}

# 右手の速さの山（当たりの区間）を測る攻撃
ATTACKS = {
    'Katana_Kesa_Cut', 'Katana_Gyakukesa_Cut', 'Katana_Yokonagi_Cut', 'Katana_Karatake_Heavy', 'Katana_Thrust',
    'Katana_Charged_Cut', 'Katana_Counter_Cut', 'Katana_Finisher', 'Iai_Draw_Cut', 'Officer_Attack', 'Attack_r1',
}

# 区分（一覧で探しやすいように）
GROUPS = {
    'combat': ['Katana_Kesa_Cut', 'Katana_Gyakukesa_Cut', 'Katana_Yokonagi_Cut', 'Katana_Karatake_Heavy', 'Katana_Thrust',
               'Katana_Charged_Cut', 'Katana_Counter_Cut', 'Katana_Finisher', 'Iai_Draw_Cut', 'Katana_Guard_Idle',
               'Katana_Draw_v2', 'Katana_Sheathe', 'Katana_Parry', 'Two_Handed_Parry', 'Sword_Parry_Backward',
               'Officer_Attack', 'Attack_r1', 'Sword_Shout', 'Walk_Fight_Forward', 'Walk_Fight_Back',
               'Roll_Dodge', 'Stand_Dodge', 'Alert', 'Lower_Weapon_Look_Raise'],
    'react': ['Hit_Reaction', 'Hit_Reaction_1', 'Hit_Reaction_to_Waist', 'Knock_Down', 'Kneel_on_One_Knee_and_Stand',
              'Fall_Dead_from_Abdominal_Injury', 'dying_backwards', 'Stand_Up2', 'Stand_Up3', 'Wake_Up_and_Look_Up'],
    'locomotion': ['Samurai_Walk', 'Samurai_Jog', 'Samurai_Run', 'CMU_Walk', 'CMU_Jog', 'CMU_Run', 'Loco_Casual_Walk',
                   'Loco_Run_02', 'Loco_RunFast', 'Injured_Walk', 'Cautious_Crouch_Walk_Forward', 'Cautious_Crouch_Walk_Backward',
                   'Cautious_Crouch_Walk_Left', 'Crouch_Walk_with_Torch', 'Walk_Slowly_and_Look_Around', 'Walking_Scan_with_Sudden_Look_Back',
                   'Walk_Turn_Left', 'Run_Turn_Left', 'Idle_Turn_Left', 'Run_to_Walk_Transition', 'Sprint_and_Sudden_Stop',
                   'Push_Forward_and_Stop', 'Catching_Breath', 'Long_Breathe_and_Look_Around', 'Torch_Look_Around'],
    'traversal': ['Regular_Jump', 'Jumping_Down', 'Unarmed_Vault', 'Jump_and_Grab_Wall', 'climbing_up_wall', 'Hang_and_Climb_Left',
                  'Climb_Up_Rope', 'Ladder_Mount_Start', 'Ladder_Climb_Loop', 'Ladder_Climb_Finish', 'Swim_Idle', 'Swim_Forward',
                  'swimming_to_edge', 'open_door', 'Collect_Object'],
    'ranged': ['Archery_Shot', 'Draw_and_Shoot_from_Back', 'Kneeling_Reload'],
    'life': ['Talk_with_Hands_Open', 'Wave_One_Hand', 'Stand_to_Sit_Transition_M', 'Sit_to_Stand_Transition_M',
             'Casual_Walk', 'Dozing_Elderly', 'Formal_Bow', 'Male_Bend_Over_Pick_Up', 'Pull_Radish', 'Push_and_Walk_Forward',
             'Sit_Cross_Legged_on_Floor', 'Stand_and_Chat', 'Stand_and_Drink'],
}

# 一覧に書く注意（Unity版で分かったこと）
NOTES = {
    'Samurai_Jog': 'Unity版では跳ねて尻を蹴るので使わず CMU_Jog に戻した（両足が浮く時間が長い）。',
    'Samurai_Run': 'Unity版では跳ねて尻を蹴るので使わず CMU_Run に戻した（両足が浮く時間76%）。',
    'Samurai_Walk': 'Unity版で使った歩き（左手は柄の上）。',
    'CMU_Walk': 'BVH 07_01 を Unity版と同じ区間で切った。脚の比で縮めたので元の 1.381 m/s より遅い。',
    'CMU_Jog': 'BVH 02_03 を Unity版と同じ区間で切った。Unity版で使った小走り。',
    'CMU_Run': 'BVH 09_01 を Unity版と同じ区間で切った。Unity版で使った走り。',
    'Loco_Casual_Walk': 'Meshy ライブラリの歩き。Unity版では腕が横に開いて見えた（A字向けの動作を T字の骨へ）。',
    'Loco_Run_02': 'Meshy ライブラリの走り。腕が横に開く（同上）。',
    'Loco_RunFast': 'Meshy ライブラリの走り。腕が横に開く（同上）。',
    'Katana_Kesa_Cut': '腰は約1.5m、正面から左前へ動く（体を左へ回しながら右足を踏み出す）。Unity版はその場で流した。',
    'Katana_Karatake_Heavy': 'Unity版は深く沈む前（.36）で切って構えへ溶かした。',
    'Katana_Finisher': 'Unity版では「胸の前へ押し出すだけ・手の速さ1.9m/s」で使わず、振り下ろしで代えた。',
    'Katana_Draw_v2': 'Unity版の判定：左腰へ手を伸ばして前へ抜くまでは良いが、両腕が開いて終わる。刀を持たせて確かめるまで保留。',
    'Katana_Sheathe': 'Unity版の判定：はっきりしない（保留）。',
    'Katana_Parry': 'Unity版の判定：頭上で受ける形は使えそう（保留）。',
    'Attack_r1': '足軽 r1（腕を30°下げたA字の骨）で作った動作。Unity版では1コマで右腕が88°回るコマがあった。',
    'Alert': '足軽 r1 の骨で作った動作。',
    'Roll_Dodge': '足軽 r1 の骨で作った動作。',
    'Stand_Dodge': '足軽 r1 の骨で作った動作。Unity版は r1 の腕の角度のずれを嫌って使わなかった（ここでは休みの姿勢の差を補正済み）。',
    'Walk_Slowly_and_Look_Around': '足軽 r1 の骨で作った動作（23.8秒）。',
    'Sit_Cross_Legged_on_Floor': '漁師の骨で作った動作。',
    'Officer_Attack': '侍大将の骨で作った動作（Meshy ライブラリの両手斬り）。',
    'Sword_Shout': '侍大将の骨で作った動作（刀を掲げて吠える）。',
    'Stand_to_Sit_Transition_M': '腰掛けが要る（Unity版の計測：腰が後ろへ 0.379m・左へ 0.185m 動く）。',
    'Sit_to_Stand_Transition_M': '腰掛けが要る。',
    'Dozing_Elderly': '腰掛けが要る（居眠り）。',
    'Swim_Forward': '泳ぎ。Unity版では腰の鞘が上へ突き出た。',
}

EXCLUDED = {
    'Katana_Draw': 'Unity版で「左手が鞘を押さえず、両手の構えで終わらない」として v2 に作り直された（ArtSources/Meshy/motions/combat-r2-draw.tsv）',
    'motions/*_raw.fbx': 'Text to Motion の生の出力（SMPL-H の52本の骨）。同じ動作の24本版が ashigaru/r2/anims にあるのでそちらを使った',
    'rig/Walking.fbx・Running.fbx': '骨入れに付いてくる歩き・走り。Unity版で腕が横に開くとして使わなかった（Samurai_*・CMU_* を使う）',
}
