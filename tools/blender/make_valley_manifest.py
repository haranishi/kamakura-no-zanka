#!/usr/bin/env python3
# make_valley_manifest.py — 人物ごとの焼き込み記録（.captures/assets/manifest_<人物>.json）から、
# 実行時に使う動作の計測値だけを dist/assets/characters/clips.json にまとめる（v19）。
# 同じ動作は人物が違っても骨の動きがほぼ同じなので、一番多く動作を持つ人物（hero→soldier→…）の値を採る。
# 出力の各動作：seconds / loop / kind(cycle|idle) / avgSpeed / rootDisp[x,z] / active[秒,秒]（手首の速さの山）/ windup,recovery（秒）/ hipsY[min,max] / contacts
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / '.captures/assets'
ORDER = ['hero', 'soldier', 'officer', 'archer', 'villager_m', 'villager_f', 'child']


def main():
    clips = {}
    chars = {}
    for who in ORDER:
        f = SRC / f'manifest_{who}.json'
        if not f.exists():
            continue
        m = json.loads(f.read_text())
        chars[who] = {k: m[k] for k in ('label', 'file', 'height', 'hipsHeight', 'legLength', 'bytes') if k in m}
        chars[who]['clips'] = sorted(m['clips'].keys())
        for name, e in m['clips'].items():
            if name in clips:
                continue
            c = {'seconds': e['seconds'], 'loop': bool(e.get('loop')), 'hipsY': e['hipsHeightRange']}
            if e.get('loopKind'):
                c['kind'] = e['loopKind']
            if 'avgSpeed' in e:
                c['avgSpeed'] = e['avgSpeed']
            rd = e.get('rootDisplacement')
            if rd and not e.get('loop'):
                c['rootDisp'] = [round(rd[0], 3), round(rd[2], 3)]
            rh = e.get('rightHand')
            if rh:
                c['active'] = rh['activeWindowSeconds']
                c['peakSpeed'] = rh['peakSpeed']
                c['windup'] = round(rh['windupStart'] * e['seconds'], 3)
                c['recovery'] = round(rh['recoveryStart'] * e['seconds'], 3)
            if 'footContacts' in e:
                c['contacts'] = e['footContacts']
            clips[name] = c
    out = ROOT / 'dist/assets/characters/clips.json'
    out.write_text(json.dumps({'version': 1, 'fps': 30, 'characters': chars, 'clips': clips}, ensure_ascii=False, separators=(',', ':')))
    print('clips', len(clips), 'bytes', out.stat().st_size)
    for n, c in sorted(clips.items()):
        if c.get('kind') == 'cycle':
            print(f"  cycle {n:34s} {c['seconds']:5.2f}s avgSpeed {c.get('avgSpeed')}")


main()
