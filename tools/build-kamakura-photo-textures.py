#!/usr/bin/env python3
"""Pack CC0 Poly Haven photo scans into the Kamakura "photo detail" textures.

Why this exists (W2c-10 / R4): the procedural-only surfaces read as cartoon-like. A photograph carries
micro-relief and brightness variation that noise cannot fake, but dropping photo albedo into the scene
would also change every average colour. So each material is packed as DETAIL ONLY:

    R = tangent-space normal X (OpenGL, 0.5 centred)
    G = tangent-space normal Y (OpenGL, 0.5 centred)
    B = sqrt(brightness ratio / 3), where ratio = (albedo luminance * AO^0.7) / its own mean

The shader multiplies its existing base colour by `ratio`, which is 1.0 on average, so the average
reflectance of every surface stays what the palette chose. Everything is rebuilt from the sources by this
script; outputs carry their source URL, md5 and sha256 in provenance/kamakura-photo-textures.json.

Usage (run from the repository root):
    python3 tools/build-kamakura-photo-textures.py            # download (cached), build, write outputs
    python3 tools/build-kamakura-photo-textures.py --verify   # only check shipped files against provenance

Requires Pillow and NumPy (build time only; nothing is added to the shipped game).
"""
import argparse, hashlib, io, json, math, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageFile

ImageFile.MAXBLOCK = 1 << 26  # optimize=True needs a large encoder block for big JPEGs

TOOL_VERSION = 1
API = "https://api.polyhaven.com"
OUT_DIR = "dist/assets/kamakura/photo"
DATA_JS = "dist/valley/kamakura-photo-tex-data.js"
PROVENANCE = "provenance/kamakura-photo-textures.json"
AO_POWER = 0.7
RATIO_CAP = 3.0
JPEG_QUALITY = 88
# key, Poly Haven id, output size (px), oriented (grain/stalk direction matters: never rotate), role.
MATERIALS = [
    ("wallWoodA", "weathered_planks", 1024, True, "vertical weathered boards"),
    ("wallWoodB", "weathered_plank_siding", 512, True, "lapped siding and plank roofs"),
    ("wallPlaster", "clay_plaster", 1024, False, "earth plaster wall"),
    ("wallPlasterWorn", "worn_plaster_wall", 512, False, "patched whitewash"),
    ("roofThatch", "thatch_roof_angled", 1024, True, "thatch, straw runs down the slope"),
    ("roofThatchOld", "riet_01", 512, True, "old grey reed thatch"),
    ("roofTile", "clay_roof_tiles_02", 512, True, "clay roof tiles"),
    ("stoneRubble", "stone_wall", 512, False, "rubble masonry"),
    ("groundSoil", "dry_ground_rocks", 1024, False, "dry tan soil with pebbles"),
    ("groundDark", "forest_ground_06", 512, False, "dark forest soil with scattered leaves"),
    ("groundNeedles", "forrest_ground_03", 512, False, "needle litter"),
    ("groundTurf", "grass_ground", 512, False, "dry turf and roots"),
    ("groundSand", "coast_sand_01", 1024, False, "dry coastal sand with grit (15 m per tile, so 1K)"),
    ("groundSandWet", "damp_beach_sand", 512, False, "damp sand"),
    ("groundPebbles", "ganges_river_pebbles", 512, False, "river pebbles"),
    ("barkCedar", "japanese_cedar_bark", 512, True, "Japanese cedar trunks (grooves run up the trunk)"),
    ("barkPine", "pine_bark", 1024, True, "pine trunks (plates run up the trunk)"),
]
UA = "kamakura-no-zanka-asset-build/1 (CC0 texture fetch)"


def curl(url, dest=None):
    """System curl: uses the OS trust store (python.org builds often ship without root certificates)."""
    cmd = ["curl", "-sSfL", "-m", "240", "-A", UA]
    if dest:
        subprocess.run(cmd + ["-o", dest, url], check=True)
        return None
    return subprocess.run(cmd + [url], check=True, capture_output=True).stdout


def fetch(url, dest, md5=None):
    """Download once into the cache; verify the md5 published by the API."""
    if not os.path.exists(dest):
        curl(url, dest + ".part")
        os.replace(dest + ".part", dest)
    data = open(dest, "rb").read()
    if md5 and hashlib.md5(data).hexdigest() != md5:
        raise SystemExit(f"md5 mismatch for {url}")
    return data


def api_json(path):
    return json.loads(curl(API + path))


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def load_rgb(data, size=None):
    im = Image.open(io.BytesIO(data)).convert("RGB")
    return im


def downsample(arr, size):
    """Area-style resize of a float HxWxC array (box via PIL on float channels)."""
    if arr.shape[0] == size:
        return arr
    chans = []
    for c in range(arr.shape[2]):
        im = Image.fromarray(arr[:, :, c].astype(np.float32), mode="F")
        chans.append(np.asarray(im.resize((size, size), Image.BOX), dtype=np.float32))
    return np.stack(chans, axis=2)


def seam_score(gray):
    """Mean |edge wrap difference| divided by mean |neighbour difference|: ~1 when the tile is seamless."""
    wrap = (np.abs(gray[:, 0] - gray[:, -1]).mean() + np.abs(gray[0, :] - gray[-1, :]).mean()) / 2
    inner = (np.abs(np.diff(gray, axis=1)).mean() + np.abs(np.diff(gray, axis=0)).mean()) / 2
    return float(wrap / max(inner, 1e-9))


def build_material(key, ident, size, oriented, role, cache):
    info = api_json(f"/info/{ident}")
    files = api_json(f"/files/{ident}")

    def pick(map_name):
        entry = files.get(map_name, {}).get("1k", {}).get("jpg")
        return entry

    sources, arrays = [], {}
    for label, names in (("diff", ("Diffuse",)), ("nor", ("nor_gl",)), ("ao", ("AO",)), ("rough", ("Rough",))):
        entry = next((pick(n) for n in names if pick(n)), None)
        if not entry:
            if label in ("diff", "nor"):
                raise SystemExit(f"{ident}: missing {label}")
            continue
        dest = os.path.join(cache, f"{ident}_{label}_1k.jpg")
        data = fetch(entry["url"], dest, entry.get("md5"))
        arrays[label] = np.asarray(load_rgb(data), dtype=np.float32) / 255.0
        sources.append({"map": label, "url": entry["url"], "bytes": len(data), "md5": entry["md5"],
                        "sha256": hashlib.sha256(data).hexdigest(), "size": list(arrays[label].shape[1::-1])})
    diff = srgb_to_linear(arrays["diff"])
    luma = diff @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    ratio_raw = luma * (arrays["ao"][:, :, 0] ** AO_POWER if "ao" in arrays else 1.0)
    ratio = np.clip(ratio_raw / max(float(ratio_raw.mean()), 1e-6), 0.0, RATIO_CAP)
    normal = arrays["nor"] * 2.0 - 1.0
    stats = {
        "meanLinearRgb": [round(float(v), 4) for v in diff.reshape(-1, 3).mean(axis=0)],
        "meanLuma": round(float(luma.mean()), 4),
        "ratioP05": round(float(np.percentile(ratio, 5)), 3),
        "ratioP50": round(float(np.percentile(ratio, 50)), 3),
        "ratioP95": round(float(np.percentile(ratio, 95)), 3),
        "roughness": round(float(arrays["rough"][:, :, 0].mean()), 3) if "rough" in arrays else None,
        "seam": round(seam_score(np.sqrt(ratio / RATIO_CAP)), 3),
    }
    # Downsample each field independently, then renormalise the normals.
    ratio = downsample(ratio[:, :, None], size)[:, :, 0]
    nxy = downsample(normal[:, :, :2], size)
    nz = np.sqrt(np.clip(1.0 - (nxy ** 2).sum(axis=2), 0.0, 1.0))
    length = np.sqrt((nxy ** 2).sum(axis=2) + nz ** 2)
    nxy = nxy / np.maximum(length, 1e-6)[:, :, None]
    # Re-centre the ratio after resampling so the mean stays exactly 1.
    ratio = ratio / max(float(ratio.mean()), 1e-6)
    packed = np.stack([nxy[:, :, 0] * 0.5 + 0.5, nxy[:, :, 1] * 0.5 + 0.5,
                       np.sqrt(np.clip(ratio / RATIO_CAP, 0.0, 1.0))], axis=2)
    out = Image.fromarray(np.clip(packed * 255.0 + 0.5, 0, 255).astype(np.uint8), "RGB")
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=JPEG_QUALITY, subsampling=0, optimize=True)  # 4:4:4: channels are unrelated data
    jpeg = buf.getvalue()
    return jpeg, {
        "key": key, "polyhaven": ident, "title": info["name"], "authors": sorted(info["authors"].keys()),
        "page": f"https://polyhaven.com/a/{ident}", "license": "CC0-1.0", "role": role, "oriented": oriented,
        "meters": round(info["dimensions"][0] / 1000.0, 4), "size": size, "file": f"{key}.jpg",
        "sources": sources, "stats": stats,
    }


def js_table(materials):
    lines = ["// Generated by tools/build-kamakura-photo-textures.py (version %d). Do not edit by hand." % TOOL_VERSION,
             "// Source of truth for the packed CC0 detail textures; see provenance/kamakura-photo-textures.json.",
             "// Packing: R,G = OpenGL normal xy (0.5 centred), B = sqrt(brightness ratio / %.1f); ratio has mean 1." % RATIO_CAP,
             "export const PHOTO_PACK = Object.freeze({ ratioCap: %.1f, aoPower: %.1f, jpegQuality: %d });" % (RATIO_CAP, AO_POWER, JPEG_QUALITY),
             "export const PHOTO_TEX_DATA = Object.freeze({"]
    for m in materials:
        s = m["stats"]
        lines.append("  %s: Object.freeze({ file: '%s', size: %d, meters: %s, oriented: %s, meanLinearRgb: %s, roughness: %s })," % (
            m["key"], m["file"], m["size"], json.dumps(m["meters"]), "true" if m["oriented"] else "false",
            json.dumps(s["meanLinearRgb"]), json.dumps(s["roughness"])))
    lines.append("});")
    return "\n".join(lines) + "\n"


def verify():
    prov = json.load(open(PROVENANCE))
    bad = []
    for m in prov["materials"]:
        path = os.path.join(OUT_DIR, m["file"])
        if not os.path.exists(path):
            bad.append(f"missing {path}")
            continue
        sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
        if sha != m["output"]["sha256"]:
            bad.append(f"sha256 differs for {path}")
    if bad:
        print("\n".join(bad)); return 1
    print(f"ok: {len(prov['materials'])} textures match provenance"); return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "kamakura-photo-src"))
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()
    if args.verify:
        sys.exit(verify())
    os.makedirs(args.cache, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    materials = []
    for key, ident, size, oriented, role in MATERIALS:
        jpeg, record = build_material(key, ident, size, oriented, role, args.cache)
        path = os.path.join(OUT_DIR, record["file"])
        with open(path, "wb") as f:
            f.write(jpeg)
        record["output"] = {"path": path, "bytes": len(jpeg), "sha256": hashlib.sha256(jpeg).hexdigest()}
        materials.append(record)
        print(f"{key:16s} {ident:26s} {size:4d}px {len(jpeg)//1024:4d}KB  mean={record['stats']['meanLinearRgb']} seam={record['stats']['seam']}")
    with open(DATA_JS, "w") as f:
        f.write(js_table(materials))
    prov = {
        "tool": "tools/build-kamakura-photo-textures.py", "toolVersion": TOOL_VERSION,
        "license": "CC0-1.0", "licenseUrl": "https://polyhaven.com/license",
        "note": "Detail-only packing: normals and a mean-1 brightness ratio. No source albedo is shipped, so average colours are unchanged.",
        "packing": {"R": "normal x (OpenGL, 0.5 centred)", "G": "normal y (OpenGL, 0.5 centred)",
                    "B": "sqrt(ratio / %.1f), ratio = luminance * AO^%.1f / mean" % (RATIO_CAP, AO_POWER),
                    "jpeg": {"quality": JPEG_QUALITY, "subsampling": "4:4:4"}},
        "totalBytes": sum(m["output"]["bytes"] for m in materials), "materials": materials,
    }
    with open(PROVENANCE, "w") as f:
        json.dump(prov, f, indent=1, ensure_ascii=False); f.write("\n")
    print("total bytes:", prov["totalBytes"])


if __name__ == "__main__":
    main()
