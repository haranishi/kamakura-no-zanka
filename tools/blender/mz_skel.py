# mz_skel.py — 骨の名前・対応表（bpy を使わない。Blender の外でも読める）（assets-r1・2026-10-01）
# （出所：本人の制作物 minato-web/tools/blender/mz_skel.py を残火の鎌倉 v19 で写して使う。内容は変更していない）
#
# 何を：Meshy 24本の骨の並び、骨の向きを決める先の点、CMU→Meshy の対応表。
# どの素材から：骨の名前は minato-no-zanka の Meshy の骨入れFBXと CMU の BVH を調べて決めた（inspect_rigs.py）。
# 版：r1。

# Meshy の自動リグの24本（4体とも名前と並びが同じ）。背骨は腰側が Spine02。
MESHY_BONES = [
    'Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
    'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
    'Spine02', 'Spine01', 'Spine', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'neck', 'Head', 'head_end', 'headfront',
]

# 骨の向き（休みの姿勢の補正に使う）を決める「先の点」。子の骨の付け根を使い、葉の骨は自分の Y 軸。
MESHY_DIR_CHILD = {
    'Hips': 'Spine02', 'Spine02': 'Spine01', 'Spine01': 'Spine', 'Spine': 'neck', 'neck': 'Head', 'Head': 'head_end',
    'LeftShoulder': 'LeftArm', 'LeftArm': 'LeftForeArm', 'LeftForeArm': 'LeftHand', 'LeftHand': None,
    'RightShoulder': 'RightArm', 'RightArm': 'RightForeArm', 'RightForeArm': 'RightHand', 'RightHand': None,
    'LeftUpLeg': 'LeftLeg', 'LeftLeg': 'LeftFoot', 'LeftFoot': 'LeftToeBase', 'LeftToeBase': None,
    'RightUpLeg': 'RightLeg', 'RightLeg': 'RightFoot', 'RightFoot': 'RightToeBase', 'RightToeBase': None,
    'head_end': None, 'headfront': None,
}

# CMU（cgspeed の BVH・31本）→ Meshy。LHipJoint/RHipJoint・Neck1・指は使わない（世界の向きで写すので、
# 途中の骨を飛ばしても子の骨の向きはそのまま写る）。
CMU_TO_MESHY = {
    'Hips': 'Hips', 'LowerBack': 'Spine02', 'Spine': 'Spine01', 'Spine1': 'Spine', 'Neck': 'neck', 'Head': 'Head',
    'LeftShoulder': 'LeftShoulder', 'LeftArm': 'LeftArm', 'LeftForeArm': 'LeftForeArm', 'LeftHand': 'LeftHand',
    'RightShoulder': 'RightShoulder', 'RightArm': 'RightArm', 'RightForeArm': 'RightForeArm', 'RightHand': 'RightHand',
    'LeftUpLeg': 'LeftUpLeg', 'LeftLeg': 'LeftLeg', 'LeftFoot': 'LeftFoot', 'LeftToeBase': 'LeftToeBase',
    'RightUpLeg': 'RightUpLeg', 'RightLeg': 'RightLeg', 'RightFoot': 'RightFoot', 'RightToeBase': 'RightToeBase',
}
# CMU 側の「先の点」。BVH では Hips と LowerBack、Spine1 と Neck・肩の付け根が同じ点にあるので、
# 一つ上の骨の付け根を使う。手は人差し指の付け根、首は Neck1 を飛ばして Head、頭は葉。
CMU_DIR_CHILD = {
    'Hips': 'Spine', 'LowerBack': 'Spine', 'Spine': 'Spine1', 'Spine1': 'Neck1', 'Neck': 'Head', 'Head': None,
    'LeftShoulder': 'LeftArm', 'LeftArm': 'LeftForeArm', 'LeftForeArm': 'LeftHand', 'LeftHand': 'LeftHandIndex1',
    'RightShoulder': 'RightArm', 'RightArm': 'RightForeArm', 'RightForeArm': 'RightHand', 'RightHand': 'RightHandIndex1',
    'LeftUpLeg': 'LeftLeg', 'LeftLeg': 'LeftFoot', 'LeftFoot': 'LeftToeBase', 'LeftToeBase': None,
    'RightUpLeg': 'RightLeg', 'RightLeg': 'RightFoot', 'RightFoot': 'RightToeBase', 'RightToeBase': None,
}

CMU_BVH_SCALE = 0.056444  # cgspeed の BVH の単位 → m（Unity版 build-locomotion.py と同じ値）
