# decimate_asset.py — GLB を読み、各メッシュを Decimate（collapse）で縮めて WebP つきで書き出す（v19）。見た目の輪郭を保つため、比は控えめに。
# 実行：Blender --background --factory-startup --python tools/blender/decimate_asset.py -- <in.glb> <out.glb> <比 0〜1> [画像の最大辺px=1536] [品質=85]
import sys
from pathlib import Path
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, ratio = Path(argv[0]), Path(argv[1]), float(argv[2])
limit = int(argv[3]) if len(argv) > 3 else 1536
quality = int(argv[4]) if len(argv) > 4 else 85
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(src))
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
before = sum(len(o.data.polygons) for o in meshes)
for o in meshes:
    bpy.context.view_layer.objects.active = o
    for other in bpy.context.selected_objects:
        other.select_set(False)
    o.select_set(True)
    m = o.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'; m.ratio = ratio; m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=m.name)
after = sum(len(o.data.polygons) for o in meshes)
for im in bpy.data.images:
    w, h = im.size
    if max(w, h) > limit and w > 0 and h > 0:
        k = limit / max(w, h); im.scale(max(1, int(w * k)), max(1, int(h * k)))
dst.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(dst), export_format='GLB', export_yup=True, export_image_format='WEBP', export_image_quality=quality,
                          export_materials='EXPORT', export_apply=False, export_cameras=False, export_lights=False,
                          export_draco_mesh_compression_enable=False, export_tangents=False)
print('[decimate]', src.name, 'faces', before, '->', after, '%.2f MB' % (dst.stat().st_size / 1e6))
