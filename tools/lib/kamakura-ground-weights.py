"""Read-only private ground acceptance check; Python standard library only.
Print aggregate errors, never source colours or coordinates. No output files.
"""
import ast
import json
import os
import struct
import sys
import zipfile

directory = sys.argv[1]
with open(os.path.join(directory, "meta.json"), encoding="utf-8") as f:
    meta = json.load(f)
with open(os.path.join(directory, "ground.json"), encoding="utf-8") as f:
    info = json.load(f)
with open(os.path.join(directory, "ground_rgb.bin"), "rb") as f:
    rgb = f.read()
surface = os.environ.get("KZ_SURFACE_FILE", os.path.join(directory, "..", "data", "kamakura_surface.npz"))
with zipfile.ZipFile(surface) as z:
    raw = z.read("weights.npy")
assert raw[:6] == b"\x93NUMPY"
major = raw[6]
header_size = 2 if major == 1 else 4
length = struct.unpack("<H" if major == 1 else "<I", raw[8:8 + header_size])[0]
start = 8 + header_size + length
header = ast.literal_eval(raw[8 + header_size:start].decode("latin1"))
w, h = meta["grid"]["width"], meta["grid"]["height"]
assert header["descr"] == "|u1" and not header["fortran_order"]
assert header["shape"] == (h, w, 8)
weights = memoryview(raw)[start:]
assert len(weights) == w * h * 8 and len(rgb) == w * h * 3
assert len(info["class_colors_srgb"]) == len(info["classes"]) == 8
counts, sums = [0] * 8, [[0, 0, 0] for _ in range(8)]
for i in range(w * h):
    row = weights[i * 8:i * 8 + 8]
    total = sum(row)
    if not total:
        continue
    for k, value in enumerate(row):
        if value > total * 0.9:
            counts[k] += 1
            for c in range(3):
                sums[k][c] += rgb[i * 3 + c]
            break
classes = []
for k, count in enumerate(counts):
    error = max(abs(sums[k][c] / count - info["class_colors_srgb"][k][c]) for c in range(3)) if count else None
    classes.append(dict(name=info["classes"][k], cells=count, maxError255=error,
                        skip=None if count else "重み0.9超の升目なし"))
print(json.dumps(dict(classes=classes), ensure_ascii=False))
