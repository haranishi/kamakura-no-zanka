#!/usr/bin/env python3
# prep_valley_textures.py — Meshy 人物の質感を GLB に入れる WebP にする（残火の鎌倉 v19・2026-10-27）
# 出所：作者の別作品（非公開）の画像の下ごしらえ道具を写して、本作の人物と入出力の場所に変えた。
#
# 何を：色（sRGB）と法線を 2048、粗さ・金属度を1枚にまとめた ORM（R=AO=白, G=粗さ, B=金属度）を 1024 にして WebP にする。
#       法線は縮める前に -1〜1 へ戻し、縮めた後に長さ1へ戻す（平均で短くなった法線は光が鈍くなるため）。
# 入力（読むだけ）：.captures/assets/src_tex/<人物>/{base_color,normal,roughness,metallic}.png（Meshy 生成物の原本。Gitへ入れない）
# 出力：.captures/assets/stage/<人物>/{color,normal,orm}.webp（build_valley_character.py がここから GLB に入れる）
# 実行：python3 tools/blender/prep_valley_textures.py [人物 ...]

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / '.captures/assets/src_tex'
STAGE = ROOT / '.captures/assets/stage'
COLOR_SIZE, NORMAL_SIZE, ORM_SIZE = 2048, 2048, 1024
Q = {'color': 90, 'normal': 94, 'orm': 90}


def gray(path, size):
    im = Image.open(path)
    im = im.convert('L') if im.mode in ('L', 'I', 'F') else im.convert('RGB').split()[0]
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im, dtype=np.uint8)


def resize_normal(path, size):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im, dtype=np.float32) / 255.0 * 2.0 - 1.0
    if im.size != (size, size):
        a = np.stack([np.asarray(Image.fromarray(a[..., c], mode='F').resize((size, size), Image.LANCZOS)) for c in range(3)], -1)
    a = a / np.maximum(np.linalg.norm(a, axis=-1, keepdims=True), 1e-6)
    a[..., 2] = np.clip(a[..., 2], 0.0, 1.0)
    return Image.fromarray(np.clip((a + 1.0) * 0.5 * 255.0 + 0.5, 0, 255).astype(np.uint8), 'RGB')


def main():
    only = set(sys.argv[1:])
    report = {}
    for d in sorted(p for p in SRC.iterdir() if p.is_dir()):
        key = d.name
        if only and key not in only:
            continue
        out = STAGE / key
        out.mkdir(parents=True, exist_ok=True)
        color = Image.open(d / 'base_color.png').convert('RGB')
        csize = color.size
        color = color.resize((COLOR_SIZE, COLOR_SIZE), Image.LANCZOS) if color.size != (COLOR_SIZE, COLOR_SIZE) else color
        color.save(out / 'color.webp', quality=Q['color'], method=6)
        resize_normal(d / 'normal.png', NORMAL_SIZE).save(out / 'normal.webp', quality=Q['normal'], method=6)
        rough = gray(d / 'roughness.png', ORM_SIZE)
        metal = gray(d / 'metallic.png', ORM_SIZE)
        orm = Image.fromarray(np.stack([np.full_like(rough, 255), rough, metal], -1), 'RGB')
        orm.save(out / 'orm.webp', quality=Q['orm'], method=6)
        report[key] = {'sourceColorSize': list(csize), 'out': {p.name: p.stat().st_size for p in sorted(out.glob('*.webp'))},
                       'metallicMean': round(float(metal.mean()) / 255, 4), 'roughnessMean': round(float(rough.mean()) / 255, 4)}
        print(key, report[key]['out'], 'metal', report[key]['metallicMean'], 'rough', report[key]['roughnessMean'])
    if not only:
        (STAGE / 'textures.json').write_text(json.dumps(report, ensure_ascii=False, indent=1))


main()
