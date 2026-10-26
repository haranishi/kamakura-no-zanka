# mz_common.py — 骨へ動作を写し替える Blender の道具の共通部分。
# 出所：本人の制作物 minato-web/tools/blender/mz_common.py（assets-r1・2026-10-01）を、残火の鎌倉 v19 で写して使う。
# 変更：動作キャッシュの場所を環境変数 KAMAKURA_MOTION_CACHE で指定でき、出力先を dist/assets/characters にした。
#
# 何を：FBX/BVH の読み込み、一番長いテイクの選択、骨の休みの姿勢と動作の世界座標での取り出し、
#       四元数の計算、骨の対応表（Meshy 24本・CMU 31本）をまとめる。
# どの素材から：/Users/hara/Projects/minato-no-zanka の Meshy の FBX と CMU の BVH（読むだけ）。
# 版：r1。Blender 5.2.2 で確かめた（Action はスロット付き＝layers/strips/channelbags の API）。
#
# 座標の約束（この道具の中だけ）：Blender の世界座標。Z が上、人物は -Y を向く、単位は m。
# glTF に書き出すと Y が上・人物は +Z を向く（Blender の -Y → glTF の +Z）。

import bpy
import json
import math
import os
import sys
from pathlib import Path
from mathutils import Matrix, Quaternion, Vector

UNITY_ROOT = Path('/Users/hara/Projects/minato-no-zanka')
WEB_ROOT = Path(__file__).resolve().parents[2]
# 動作キャッシュは湊の extract_motions.py が作った npz/json（181ファイル）。本作では読むだけ。
CACHE_DIR = Path(os.environ.get('KAMAKURA_MOTION_CACHE', '/Volumes/Projects-SSD/Projects/minato-web/captures/assets/cache'))
CAPTURE_DIR = WEB_ROOT / '.captures' / 'assets'
CHAR_OUT = WEB_ROOT / 'dist' / 'assets' / 'characters'

from mz_skel import *  # noqa: F401,F403  骨の表（MESHY_BONES・CMU_TO_MESHY など）



def log(*a):
    print('[mz]', *a, flush=True)


def args_after_dashes():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # 読み込み前の既定。FBX は自分のフレームレート（Meshy は 30）を場面に入れる。
    bpy.context.scene.render.fps = 30
    bpy.context.scene.render.fps_base = 1.0


def import_fbx(path):
    before_obj = set(bpy.data.objects)
    before_act = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=str(path), use_anim=True, ignore_leaf_bones=False,
                             automatic_bone_orientation=False, use_custom_normals=True)
    objs = [o for o in bpy.data.objects if o not in before_obj]
    acts = [a for a in bpy.data.actions if a not in before_act]
    arms = [o for o in objs if o.type == 'ARMATURE']
    meshes = [o for o in objs if o.type == 'MESH']
    return arms, meshes, acts


def import_bvh(path, scale=CMU_BVH_SCALE):
    before_obj = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=str(path), global_scale=scale, axis_forward='-Z', axis_up='Y',
                            use_fps_scale=False, update_scene_fps=True, update_scene_duration=True,
                            rotate_mode='NATIVE')
    arm = [o for o in bpy.data.objects if o not in before_obj and o.type == 'ARMATURE'][0]
    return arm


def action_fcurves(action):
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out


def action_length(action):
    fr = action.frame_range
    return fr[1] - fr[0]


def longest_action(actions):
    """Text to Motion の FBX は1コマの基本姿勢と本物の2テイク。一番長いものを選ぶ。"""
    if not actions:
        return None
    return max(actions, key=lambda a: (action_length(a), len(action_fcurves(a))))


def assign_action(obj, action):
    if obj.animation_data is None:
        obj.animation_data_create()
    obj.animation_data.action = action
    if action is not None and len(action.slots) and obj.animation_data.action_slot is None:
        obj.animation_data.action_slot = action.slots[0]


def mat_rot(m):
    """拡大縮小を含む行列から回転だけを取り出す。"""
    return m.to_3x3().normalized().to_quaternion()


def rest_world(arm):
    """休みの姿勢の各骨の世界の行列（拡大縮小なし・m）と先の点。"""
    mw = arm.matrix_world
    out = {}
    for b in arm.data.bones:
        m = mw @ b.matrix_local
        out[b.name] = {
            'rot': mat_rot(m),
            'head': (mw @ b.head_local).copy(),
            'tail': (mw @ b.tail_local).copy(),
            'parent': b.parent.name if b.parent else None,
        }
    return out


def sample_world(arm, frames):
    """frames（小数のコマ番号の列）での各骨の世界の回転と位置。"""
    sc = bpy.context.scene
    names = [pb.name for pb in arm.pose.bones]
    rots, poss = [], []
    for f in frames:
        fi = int(math.floor(f))
        sc.frame_set(fi, subframe=f - fi)
        mw = arm.matrix_world
        rr, pp = [], []
        for pb in arm.pose.bones:
            m = mw @ pb.matrix
            rr.append(mat_rot(m))
            pp.append(m.translation.copy())
        rots.append(rr)
        poss.append(pp)
    return names, rots, poss


def direction(rest, name, dir_table):
    """休みの姿勢での骨の向き（単位ベクトル）。dir_table の先の点、無ければ骨の Y 軸。"""
    r = rest[name]
    child = dir_table.get(name)
    if child:
        if child.endswith('@tail'):
            c = child[:-5]
            tip = rest[c]['tail']
        else:
            tip = rest[child]['head']
        d = tip - r['head']
        if d.length > 1e-5:
            return d.normalized()
    d = r['tail'] - r['head']
    if d.length > 1e-6:
        return d.normalized()
    return (r['rot'] @ Vector((0, 1, 0))).normalized()


def q_list(q):
    return [q.w, q.x, q.y, q.z]


def v_list(v, nd=6):
    return [round(v.x, nd), round(v.y, nd), round(v.z, nd)]


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1))


def mesh_world_bounds(objs):
    import numpy as np
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        oe = o.evaluated_get(dg)
        me = oe.to_mesh()
        co = np.empty(len(me.vertices) * 3, dtype=np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        mw = np.array(o.matrix_world)
        co = co @ mw[:3, :3].T + mw[:3, 3]
        pts.append(co)
        oe.to_mesh_clear()
    allp = np.concatenate(pts)
    return allp.min(axis=0), allp.max(axis=0), allp
