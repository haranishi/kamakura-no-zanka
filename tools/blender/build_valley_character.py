# build_valley_character.py — 1体を「皮付きの形・骨・必要な動作」の GLB にする（残火の鎌倉 v19・2026-10-27）
# 出所：本人の制作物 minato-web/tools/blender/build_character.py（assets-r1）を写して、本作の人物表・入れる動作・出力先に変えた。
# 変更点：人物表（Meshy v19 の骨入りFBX）、役割ごとの動作表（valley_clips.json）、草摺の重み直しなし、出力先 dist/assets/characters。
#
# 何を：
#   1. 骨入れ FBX を読み、Armature の 0.01（cm）と形の回転を当てて m 単位・恒等の変換にする。
#   2. 重みを1頂点4本までにして足し合わせを1にする（three.js は4本まで）。
#   3. 法線を作り直す（FBX の法線は UV の継ぎ目に硬い辺があり、顔に四角い明暗が出た＝Unity版 r7 の指摘）。
#      角度60°までの面をなめらかにつなぎ、同じ位置で分かれた頂点どうしも60°以内なら平均する。
#   4. 質感（prep_character_textures.py の WebP）を glTF の PBR（色・法線・ORM）につなぐ。
#   5. .captures/assets/cache/ の全部の動作を、この人物の骨へ写し替えて Action にする（mz_retarget.py）。
#      繰り返しの動作はその場の1周にする（mz_clips.LOOPS）。
#   6. GLB に書き出す（Y が上・人物は +Z を向く・Draco なし・WebP は EXT_texture_webp）。
#   7. 動作ごとの計測を .captures/assets/manifest_<人物>.json に書く（make_manifest.py がまとめる）。
# どの素材から（読むだけ）：minato-no-zanka の骨入れ FBX（下の CHARS）、cache の動作、stage の WebP。
# 版：r1。
#
# 実行：Blender --background --factory-startup --python tools/blender/build_valley_character.py -- <hero|archer|soldier|officer|villager_m|villager_f|child> [--only 名前,名前|--all] [--no-normals-fix] [--out パス]
# 事前：骨入りFBXを .captures/assets/rig/<人物>_rigged.fbx に置き、prep_valley_textures.py で .captures/assets/stage/<人物>/ に質感を作る。

import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
import mz_common as mz  # noqa: E402
import mz_clips  # noqa: E402
import mz_retarget as rt  # noqa: E402
from mz_quat import qconj, qrot  # noqa: E402

RIG = mz.CAPTURE_DIR / 'rig'
STAGE = mz.CAPTURE_DIR / 'stage'
CLIPS_FILE = Path(__file__).resolve().parent / 'valley_clips.json'

CHARS = {
    'hero': {'label': '榊三郎景継（主人公）', 'role': 'hero'},
    'archer': {'label': '梓弥十郎（弓手）', 'role': 'archer'},
    'soldier': {'label': '追手の雑兵', 'role': 'soldier'},
    'officer': {'label': '追手の侍大将', 'role': 'officer'},
    'villager_m': {'label': '水穂の里の男', 'role': 'villager'},
    'villager_f': {'label': '水穂の里の女', 'role': 'villager'},
    'child': {'label': '水穂の里の子', 'role': 'villager'},
}
for _k, _v in CHARS.items():
    _v['rig'] = RIG / (_k + '_rigged.fbx')
    _v['native'] = None
USE_REWEIGHTED = {}


def parse_args():
    a = mz.args_after_dashes()
    char = a[0]
    only = None
    if '--only' in a:
        only = set(a[a.index('--only') + 1].split(','))
    out = None
    if '--out' in a:
        out = Path(a[a.index('--out') + 1])
    rig_override = None
    if '--reweighted' in a:
        rig_override = 'reweighted'
    if '--original' in a:
        rig_override = 'original'
    if only is None and '--all' not in a:
        table = json.loads(CLIPS_FILE.read_text())
        only = set(table['common']) | set(table.get(CHARS[char]['role'], []))
    return char, only, '--no-normals-fix' not in a, out, rig_override, '--no-export' in a


# ---------------------------------------------------------------- 形と骨

def load_rig(path, name):
    arms, meshes, acts = mz.import_fbx(path)
    arm = arms[0]
    for a in acts:
        bpy.data.actions.remove(a)
    arm.animation_data_clear()
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    arm.name = name
    arm.data.name = name + '_skeleton'
    body = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.join()
    body.name = name + '_body'
    body.data.name = name + '_body'
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return arm, body


def clean_weights(body, arm):
    bones = set(b.name for b in arm.data.bones)
    for vg in list(body.vertex_groups):
        if vg.name not in bones:
            body.vertex_groups.remove(vg)
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.0001, keep_single=True)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)


def fix_normals(body, angle_deg=60.0):
    """角度でなめらかにつなぐ法線。同じ位置で分かれた頂点どうしも、面の向きが angle_deg 以内なら平均する。"""
    me = body.data
    nv, nl, npoly = len(me.vertices), len(me.loops), len(me.polygons)
    co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    lv = np.empty(nl, dtype=np.int64); me.loops.foreach_get('vertex_index', lv)
    pn = np.empty(npoly * 3); me.polygons.foreach_get('normal', pn); pn = pn.reshape(-1, 3)
    pa = np.empty(npoly); me.polygons.foreach_get('area', pa)
    ls = np.empty(npoly, dtype=np.int64); me.polygons.foreach_get('loop_start', ls)
    lt = np.empty(npoly, dtype=np.int64); me.polygons.foreach_get('loop_total', lt)
    lp = np.repeat(np.arange(npoly), lt)
    # 同じ位置の頂点をまとめる（0.01 mm で丸める）
    key = np.round(co / 1e-5).astype(np.int64)
    _, vgrp = np.unique(key, axis=0, return_inverse=True)
    vgrp = vgrp.reshape(-1)
    lg = vgrp[lv]
    order = np.argsort(lg, kind='stable')
    lg_sorted = lg[order]
    bounds = np.flatnonzero(np.diff(lg_sorted)) + 1
    starts = np.concatenate([[0], bounds]); ends = np.concatenate([bounds, [nl]])
    fn = pn[lp] * np.maximum(pa[lp], 1e-12)[:, None]
    fu = pn[lp]
    cos_thr = math.cos(math.radians(angle_deg))
    out = np.zeros((nl, 3))
    merged = 0
    for s, e in zip(starts, ends):
        ids = order[s:e]
        u = fu[ids]
        sim = (u @ u.T) >= cos_thr
        acc = sim.astype(np.float64) @ fn[ids]
        out[ids] = acc
        if len(set(lv[ids].tolist())) > 1:
            merged += 1
    out /= np.maximum(np.linalg.norm(out, axis=-1, keepdims=True), 1e-12)
    me.polygons.foreach_set('use_smooth', np.ones(npoly, dtype=bool))
    me.normals_split_custom_set(out.tolist())
    return merged


def torso_shape(body, arm):
    """手の胴へのめり込みを測るための胴の楕円の筒（Spine01 の付け根から見た、休みの姿勢の世界の軸）。"""
    me = body.data
    bones = ['Spine02', 'Spine01', 'Spine']
    gid = {body.vertex_groups[b].index: b for b in bones if b in body.vertex_groups}
    sp = np.array(arm.data.bones['Spine01'].head_local)
    pts = []
    for v in me.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        if best is not None and best.group in gid and best.weight > 0.5:
            pts.append(np.array(v.co) - sp)
    p = np.array(pts)
    p = p[np.abs(p[:, 0]) < 0.2]
    cy = float(np.median(p[:, 1]))
    return {'rx': float(np.percentile(np.abs(p[:, 0]), 85)), 'ry': float(np.percentile(np.abs(p[:, 1] - cy), 85)), 'cy': cy,
            'zMin': float(np.percentile(p[:, 2], 3)), 'zMax': float(np.percentile(p[:, 2], 97)), 'handCenter': 0.08,
            'vertices': int(len(p))}


def target_skeleton(arm):
    names = [pb.name for pb in arm.pose.bones]
    bones = arm.data.bones
    return rt.Skeleton(names, [bones[n].parent.name if bones[n].parent else None for n in names],
                       [mz.q_list(mz.mat_rot(bones[n].matrix_local)) for n in names],
                       [list(bones[n].head_local) for n in names], [list(bones[n].tail_local) for n in names])


# ---------------------------------------------------------------- 質感

def gltf_output_group():
    g = bpy.data.node_groups.get('glTF Material Output')
    if g:
        return g
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    g.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    g.nodes.new('NodeGroupInput')
    return g


def make_material(char):
    d = STAGE / char
    mat = bpy.data.materials.new(char + '_mat')
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    def img(name, colorspace):
        im = bpy.data.images.load(str(d / name))
        im.colorspace_settings.name = colorspace
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = im
        return n
    col = img('color.webp', 'sRGB')
    nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
    nor = img('normal.webp', 'Non-Color')
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nor.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    orm = img('orm.webp', 'Non-Color')
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    grp = nt.nodes.new('ShaderNodeGroup')
    grp.node_tree = gltf_output_group()
    nt.links.new(sep.outputs['Red'], grp.inputs['Occlusion'])
    bsdf.inputs['IOR'].default_value = 1.5
    # 片面にする（glTF の doubleSided: false）。裏面を消して4体を前後斜めから描き、穴が見えないことを確かめた。
    mat.use_backface_culling = True
    return mat


# ---------------------------------------------------------------- 動作

def write_action(arm, name, basis, loc, names):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    slot = act.slots.new(id_type='OBJECT', name=arm.name)
    layer = act.layers.new('Layer')
    strip = layer.strips.new(type='KEYFRAME')
    cb = strip.channelbag(slot, ensure=True)
    F = basis.shape[0]
    frames = np.arange(F, dtype=np.float64) + 1.0
    lin = np.full(F, 1, dtype=np.int32)  # 'LINEAR'

    def curve(path, index, group, values):
        fc = cb.fcurves.new(path, index=index, group_name=group)
        fc.keyframe_points.add(F)
        co = np.empty(2 * F)
        co[0::2] = frames
        co[1::2] = values
        fc.keyframe_points.foreach_set('co', co)
        fc.keyframe_points.foreach_set('interpolation', lin)
        fc.update()
    for t, b in enumerate(names):
        for i in range(4):
            curve('pose.bones["%s"].rotation_quaternion' % b, i, b, basis[:, t, i])
        if b == 'Hips':
            for i in range(3):
                curve('pose.bones["%s"].location' % b, i, b, loc[:, i])
    tr = arm.animation_data.nla_tracks.new()
    tr.name = name
    st = tr.strips.new(name, 1, act)
    st.action_slot = slot
    tr.mute = True
    return act


GROUND_TOL = 0.015  # これより高く浮いている地上の動作は、一番低い足が休みの高さに来るまで下ろす


def lowest_foot(tgt, world, hips):
    pos = rt.fk(tgt, world, hips)
    low = np.full(len(pos), np.inf)
    for b in ('LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'):
        low = np.minimum(low, pos[:, tgt.idx[b], 2] - tgt.rest_head[tgt.idx[b], 2])
    return float(low.min())


def gltf_vec(v):
    """Blender（Z上・-Y前）→ glTF（Y上・+Z前）。"""
    return [round(float(v[0]), 4), round(float(v[2]), 4), round(float(-v[1]), 4)]


def clip_metrics(tgt, world, hips, fps, name, spec, loop_info, torso):
    pos = rt.fk(tgt, world, hips)
    n = len(world) - 1
    m = {'frames': int(len(world)), 'seconds': round(n / fps, 4), 'fps': fps,
         'hipsHeightRange': [round(float(hips[:, 2].min()), 4), round(float(hips[:, 2].max()), 4)]}
    if spec:
        m['loop'] = True
        m['loopKind'] = spec['kind']
        m.update({k: loop_info[k] for k in ('window', 'windowSeconds', 'how', 'headingCorrectionDeg', 'phaseShiftFrames', 'timeScale', 'seamAfterDeg', 'wholeClipSeamDeg') if k in loop_info})
        if 'cycleClimb' in loop_info:
            m['cycleClimbM'] = loop_info['cycleClimb']
            m['climbSpeed'] = round(loop_info['cycleClimb'] / (n / fps), 4)
        dist = loop_info['cycleDistance']
        travel = spec.get('travel')
        if spec['kind'] == 'cycle' and travel:
            speed_from = 'root'
            dirv = {'forward': [0, -1.0, 0], 'back': [0, 1.0, 0], 'left': [1.0, 0, 0], 'right': [-1.0, 0, 0]}[travel]
            if dist < 0.15:
                speed = rt.stance_speed(tgt, pos, fps, dirv)
                dist = speed * n / fps
                speed_from = 'stance foot'
            else:
                speed = dist / (n / fps)
            m['cycleDistanceM'] = round(float(dist), 4)
            m['avgSpeed'] = round(float(speed), 4)
            m['speedFrom'] = speed_from
            m['travel'] = travel
            fc = rt.foot_contacts(tgt, pos, fps, True, speed, dirv)
            m['footContacts'] = {k: v['contactPhases'] for k, v in fc.items()}
            m['footSlideM'] = {k: v['maxSlideM'] for k, v in fc.items()}
            m['footGroundOffsetM'] = {k: v['groundOffsetM'] for k, v in fc.items()}
            if 'rootSpeedProfile' in loop_info:
                m['rootSpeedProfile'] = loop_info['rootSpeedProfile']
        m['rootDisplacement'] = [0.0, 0.0, 0.0]
        m['rootDisplacementM'] = 0.0
    else:
        m['loop'] = False
        d = hips[-1] - hips[0]
        d[2] = 0
        m['rootDisplacement'] = gltf_vec(d)
        m['rootDisplacementM'] = round(float(np.linalg.norm(d[:2])), 4)
        path = np.sum(np.linalg.norm(np.diff(hips[:, :2], axis=0), axis=-1))
        m['rootPathM'] = round(float(path), 4)
        fc = rt.foot_contacts(tgt, pos, fps, False, 0.0)
        m['footSlideM'] = {k: v['maxSlideM'] for k, v in fc.items()}
    hs = rt.hand_speed_metrics(tgt, pos, fps)
    if hs and (name in mz_clips.ATTACKS or not spec):
        m['rightHand'] = hs
    m['attack'] = name in mz_clips.ATTACKS
    m['wristBendDeg'] = rt.wrist_bend(tgt, world, pos)
    ht = rt.hand_torso(tgt, world, pos, torso)
    if ht:
        m['handInTorso'] = ht
    lowest = np.full(len(pos), np.inf)
    for b in ('LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'):
        lowest = np.minimum(lowest, pos[:, tgt.idx[b], 2] - tgt.rest_head[tgt.idx[b], 2])
    m['footBelowRestMinM'] = round(float(lowest.min()), 4)
    return m


def main():
    char, only, normals_fix, out_path, rig_override, no_export = parse_args()
    cfg = CHARS[char]
    use_rw = USE_REWEIGHTED.get(char, False)
    if rig_override == 'reweighted':
        use_rw = True
    if rig_override == 'original':
        use_rw = False
    rig_path = cfg['rig_reweighted'] if use_rw else cfg['rig']
    t0 = time.time()
    mz.reset_scene()
    sc = bpy.context.scene
    sc.render.fps = 30
    sc.render.fps_base = 1.0
    arm, body = load_rig(rig_path, char)
    clean_weights(body, arm)
    merged = fix_normals(body) if normals_fix else 0
    mat = make_material(char)
    body.data.materials.clear()
    body.data.materials.append(mat)
    tgt = target_skeleton(arm)
    torso = torso_shape(body, arm)
    lo, hi, _ = mz.mesh_world_bounds([body])
    mz.log(char, 'rig', rig_path.name, 'height %.3f' % (hi[2] - lo[2]), 'normals merged groups', merged, 'torso', {k: round(v, 3) for k, v in torso.items()})
    if arm.animation_data is None:
        arm.animation_data_create()
    index = json.loads((mz.CACHE_DIR / 'index.json').read_text())
    clips_meta = {}
    for item in index['clips']:
        name = item['name']
        if only and name not in only:
            continue
        clip = rt.Clip.load(mz.CACHE_DIR, name)
        spec = mz_clips.LOOPS.get(name)
        rot, posc, fps = clip.rot, clip.pos, clip.fps
        if not spec and abs(fps - 30.0) > 1e-6:  # 30fps に取り直す（今は CMU だけで、どれもループ）
            n = int(round((len(rot) - 1) / fps * 30))
            rot, posc = rt.resample_world(rot, posc, np.arange(n + 1) * fps / 30.0)
            fps = 30.0
        world, hips, info = rt.retarget(clip, tgt, rot, posc)
        loop_info = {}
        if spec:
            world, hips, loop_info = rt.make_loop(tgt, world, hips, fps, spec)
            fps = 30.0
        lift = lowest_foot(tgt, world, hips)
        if name not in mz_clips.OFF_GROUND and lift > GROUND_TOL:
            hips = hips.copy()
            hips[:, 2] -= lift
            info['groundFixM'] = round(-lift, 4)
        basis, loc = rt.to_local(tgt, world, hips)
        write_action(arm, name, basis, loc, tgt.names)
        m = clip_metrics(tgt, world, hips, fps, name, spec, loop_info, torso)
        m['source'] = {'file': clip.meta['file'], 'rig': clip.rig, 'take': clip.meta['take'], 'takeCount': len(clip.meta['takes']),
                       'sourceFrames': clip.meta['frames'], 'sourceFps': clip.meta['fps']}
        m['retarget'] = info
        m['native'] = (clip.rig == cfg['native'])
        if name in mz_clips.NOTES:
            m['note'] = mz_clips.NOTES[name]
        clips_meta[name] = m
    mz.log(char, 'clips', len(clips_meta), 'in %.1fs' % (time.time() - t0))
    out = out_path or (mz.CHAR_OUT / (char + '.glb'))
    out.parent.mkdir(parents=True, exist_ok=True)
    if not no_export:
        bpy.ops.object.select_all(action='DESELECT')
        arm.animation_data.action = None
        for pb in arm.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
        bpy.ops.export_scene.gltf(
            filepath=str(out), export_format='GLB', export_yup=True, export_apply=False,
            export_texcoords=True, export_normals=True, export_tangents=True, export_materials='EXPORT',
            export_image_format='AUTO', export_cameras=False, export_lights=False, export_extras=False,
            export_skins=True, export_all_influences=False, export_def_bones=False, export_rest_position_armature=True,
            export_animations=True, export_animation_mode='ACTIONS', export_anim_slide_to_zero=True, export_force_sampling=True,
            export_frame_step=1, export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True,
            export_reset_pose_bones=True, export_anim_single_armature=True, export_morph=False,
            export_draco_mesh_compression_enable=False)
        mz.log(char, 'wrote', out, '%.2f MB' % (out.stat().st_size / 1e6))
    bones = arm.data.bones
    char_meta = {
        'label': cfg['label'], 'file': out.name, 'rig': str(rig_path), 'reweighted': use_rw,
        'height': round(float(hi[2] - lo[2]), 4), 'forwardAxis': '+Z', 'upAxis': '+Y', 'units': 'm',
        'hipsHeight': round(float(bones['Hips'].head_local[2]), 4), 'legLength': round(tgt.leg_length(), 4),
        'rightHandBone': 'RightHand', 'leftHandBone': 'LeftHand', 'headBone': 'Head', 'headFrontBone': 'headfront',
        'boneCount': len(bones), 'bones': [b.name for b in bones],
        'mesh': {'vertices': len(body.data.vertices), 'triangles': sum(len(p.vertices) - 2 for p in body.data.polygons),
                 'normalsFix': normals_fix, 'coincidentGroupsAveraged': merged, 'maxInfluences': 4},
        'torsoProxy': {k: round(v, 4) if isinstance(v, float) else v for k, v in torso.items()},
        'clips': clips_meta,
        'buildSeconds': round(time.time() - t0, 1),
    }
    if out.exists():
        char_meta['bytes'] = out.stat().st_size
    mz.write_json(mz.CAPTURE_DIR / ('manifest_%s.json' % char) if not out_path else out.with_suffix('.json'), char_meta)
    mz.log(char, 'done in %.1fs' % (time.time() - t0))


main()
