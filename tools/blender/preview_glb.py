# preview_glb.py — GLB を4方向（正面・斜め・側面・背面）から描き、目視確認用のPNGを出す（v19）
#
# 何を：骨入れや焼き込みの前に、形と質感（色）を確かめる。Workbench（テクスチャ表示）なので速く、GPUに頼らない。
# 実行：Blender --background --factory-startup --python tools/blender/preview_glb.py -- <in.glb> <出力の接頭辞> [幅 高さ]
# 出力：<接頭辞>_front.png / _q34.png / _side.png / _back.png と、情報を標準出力へ（面数・骨数・外形寸法）。

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, prefix = Path(argv[0]), argv[1]
W = int(argv[2]) if len(argv) > 2 else 600
H = int(argv[3]) if len(argv) > 3 else 900

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(src))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
tris = 0
for o in meshes:
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        p = o.matrix_world @ Vector(c)
        lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
        hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
size = hi - lo
center = (hi + lo) / 2
print('[preview]', src.name, 'meshes', len(meshes), 'armatures', len(arms), 'tris', tris,
      'bones', sum(len(a.data.bones) for a in arms), 'size(m)', tuple(round(v, 3) for v in size))

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.image_settings.file_format = 'PNG'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.display.shading.show_shadows = False
scene.display.shading.show_cavity = False
scene.world = bpy.data.worlds.new('w')
scene.world.color = (0.18, 0.18, 0.18)
scene.view_settings.view_transform = 'Standard'

cam_data = bpy.data.cameras.new('cam')
cam_data.lens = 85
cam_data.clip_end = 100
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
dist = max(size.z, size.x * 1.2) * 2.2 + 1.0
for name, ang in (('front', 0), ('q34', 40), ('side', 90), ('back', 180)):
    a = math.radians(ang)
    # 人物はBlenderで -Y を向く。ang=0 は正面（-Y側から見る）。
    cam.location = center + Vector((math.sin(a) * dist, -math.cos(a) * dist, 0))
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f'{prefix}_{name}.png'
    bpy.ops.render.render(write_still=True)
print('[preview] done')
