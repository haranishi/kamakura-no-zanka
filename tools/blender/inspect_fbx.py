# inspect_fbx.py — Meshyの骨入りFBXの中身（骨名・スケール・面数・材質・UV・動作）を標準出力へ出す（v19）
# 実行：Blender --background --factory-startup --python tools/blender/inspect_fbx.py -- <rigged.fbx>
import sys
import bpy
from mathutils import Vector

path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=path, use_anim=True, ignore_leaf_bones=False, automatic_bone_orientation=False, use_custom_normals=True)
for o in bpy.data.objects:
    print('[obj]', o.type, o.name, 'scale', tuple(round(v, 4) for v in o.scale), 'rot', tuple(round(v, 3) for v in o.rotation_euler), 'parent', o.parent.name if o.parent else None)
arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for a in arms:
    print('[bones]', len(a.data.bones), [b.name for b in a.data.bones])
    h = a.data.bones['Hips']
    print('[hips head_local]', tuple(round(v, 4) for v in h.head_local))
for m in meshes:
    me = m.data
    print('[mesh]', m.name, 'verts', len(me.vertices), 'polys', len(me.polygons), 'uv', [u.name for u in me.uv_layers], 'materials', [mt.name if mt else None for mt in me.materials],
          'vgroups', len(m.vertex_groups))
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for v in me.vertices:
        p = m.matrix_world @ v.co
        lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z))); hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    print('[bounds]', tuple(round(v, 3) for v in lo), tuple(round(v, 3) for v in hi))
print('[images]', [(i.name, i.size[:], i.packed_file is not None) for i in bpy.data.images])
print('[actions]', [(a.name, tuple(a.frame_range)) for a in bpy.data.actions])
print('[scene fps]', bpy.context.scene.render.fps)
