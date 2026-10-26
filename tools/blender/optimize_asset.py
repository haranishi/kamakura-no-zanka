# optimize_asset.py — GLB を読み、画像を上限サイズへ縮めて WebP で書き出す（v19）。形（頂点）は変えない。
# 実行：Blender --background --factory-startup --python tools/blender/optimize_asset.py -- <in.glb> <out.glb> [最大辺px=1536] [品質=85]
import sys
from pathlib import Path
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = Path(argv[0]), Path(argv[1])
limit = int(argv[2]) if len(argv) > 2 else 1536
quality = int(argv[3]) if len(argv) > 3 else 85
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(src))
shrunk = 0
for im in bpy.data.images:
    w, h = im.size
    if max(w, h) > limit and w > 0 and h > 0:
        k = limit / max(w, h)
        im.scale(max(1, int(w * k)), max(1, int(h * k)))
        shrunk += 1
dst.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(dst), export_format='GLB', export_yup=True, export_image_format='WEBP', export_image_quality=quality,
                          export_materials='EXPORT', export_apply=False, export_cameras=False, export_lights=False,
                          export_draco_mesh_compression_enable=False, export_tangents=False)
print('[optimize]', src.name, '->', dst.name, 'images', len(bpy.data.images), 'shrunk', shrunk, '%.2f MB' % (dst.stat().st_size / 1e6))
