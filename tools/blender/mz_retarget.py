# mz_retarget.py — 動作の写し替え・ループ化・計測（numpy だけ。Blender の外でも動く）（assets-r1・2026-10-01）
# （出所：本人の制作物 minato-web/tools/blender/mz_retarget.py を残火の鎌倉 v19 で写して使う。内容は変更していない）
#
# 何を：
#   1. 写し替え：各骨について「元の骨の世界の回転 × 元の休みの世界の回転の逆」を写し先の休みの世界の回転に掛ける。
#      休みの姿勢で骨の向き（付け根→先の点）が違う分は、元の休みの姿勢を写し先の向きへ回してから差を取る
#      （CMU のT字の腕は8°下がり、漁師は16〜18°、r1 は33°下がる。差を補正しないと腕が体に寄ったり開いたりする）。
#      腰の移動は脚の長さ（太もも＋すね）の比で縮める。
#   2. ループ化：1周を選び、進む向きを前へそろえ、腰の水平の移動を引いてその場の動作にし、
#      継ぎ目の差を1周に均して消し、左足が一番前に出た瞬間から始まるよう回す。
#   3. 計測：長さ・腰の移動・腰の高さ・速さ・足の着く位相・足の滑り・右手の速さの山・手首の曲がり・手の胴へのめり込み。
# どの素材から：extract_motions.py が .captures/assets/cache/ に置いた骨の世界の回転と位置。
# 版：r1。

import json
from pathlib import Path

import numpy as np

from mz_quat import (fix_continuity, qangle, qbetween, qconj, qmul, qnormalize, qrot, qyaw, slerp, yaw_of)
from mz_skel import CMU_DIR_CHILD, CMU_TO_MESHY, MESHY_DIR_CHILD

FRONT = np.array([0.0, -1.0, 0.0])  # 人物の前（Blender の -Y）
TRAVEL_YAW = {'forward': 0.0, 'back': np.pi, 'left': np.pi / 2, 'right': -np.pi / 2}


class Skeleton:
    def __init__(self, names, parents, rest_rot, rest_head, rest_tail):
        self.names = list(names)
        self.idx = {n: i for i, n in enumerate(self.names)}
        self.parent = [self.idx[p] if p is not None and p in self.idx else -1 for p in parents]
        self.rest_rot = np.asarray(rest_rot, dtype=np.float64)
        self.rest_head = np.asarray(rest_head, dtype=np.float64)
        self.rest_tail = np.asarray(rest_tail, dtype=np.float64)
        self.order = self._topo()

    def _topo(self):
        order, seen = [], set()
        def visit(i):
            if i in seen:
                return
            if self.parent[i] >= 0:
                visit(self.parent[i])
            seen.add(i)
            order.append(i)
        for i in range(len(self.names)):
            visit(i)
        return order

    def rest_dirs(self, table):
        out = np.zeros((len(self.names), 3))
        for i, n in enumerate(self.names):
            child = table.get(n)
            d = None
            if child and child in self.idx:
                d = self.rest_head[self.idx[child]] - self.rest_head[i]
                if np.linalg.norm(d) < 1e-5:
                    d = None
            if d is None:
                d = self.rest_tail[i] - self.rest_head[i]
            if np.linalg.norm(d) < 1e-7:
                d = qrot(self.rest_rot[i], np.array([0.0, 1.0, 0.0]))
            out[i] = d / np.linalg.norm(d)
        return out

    def leg_length(self):
        ls = []
        for side in ('Left', 'Right'):
            a = self.rest_head[self.idx[side + 'UpLeg']]
            b = self.rest_head[self.idx[side + 'Leg']]
            c = self.rest_head[self.idx[side + 'Foot']]
            ls.append(np.linalg.norm(b - a) + np.linalg.norm(c - b))
        return float(np.mean(ls))

    @staticmethod
    def from_meta(meta):
        names = meta['bones']
        r = meta['rest']
        return Skeleton(names, [r[n]['parent'] for n in names], [r[n]['rot'] for n in names],
                        [r[n]['head'] for n in names], [r[n]['tail'] for n in names])


class Clip:
    def __init__(self, name, meta, rot, pos):
        self.name = name
        self.meta = meta
        self.rig = meta['rig']
        self.fps = float(meta['fps'])
        self.rot = fix_continuity(qnormalize(rot))
        self.pos = pos
        self.skel = Skeleton.from_meta(meta)

    @staticmethod
    def load(cache_dir, name):
        cache_dir = Path(cache_dir)
        meta = json.loads((cache_dir / (name + '.json')).read_text())
        z = np.load(cache_dir / (name + '.npz'))
        return Clip(name, meta, z['rot'], z['pos'])


def resample_world(rot, pos, idx):
    """小数のコマ位置 idx（元のコマ番号、0始まり）で、回転は球面補間・位置は線形補間。"""
    idx = np.asarray(idx, dtype=np.float64)
    i0 = np.clip(np.floor(idx).astype(int), 0, len(rot) - 1)
    i1 = np.clip(i0 + 1, 0, len(rot) - 1)
    t = idx - i0
    r = slerp(rot[i0], rot[i1], np.repeat(t[:, None], rot.shape[1], axis=1))
    p = pos[i0] + (pos[i1] - pos[i0]) * t[:, None, None]
    return fix_continuity(r), p


# ---------------------------------------------------------------- 写し替え

def bone_map(clip, tgt):
    """写し先の骨 → 元の骨（無ければ None）。"""
    if clip.rig == 'cmu':
        inv = {m: c for c, m in CMU_TO_MESHY.items()}
        return [clip.skel.idx.get(inv.get(n)) if inv.get(n) else None for n in tgt.names]
    return [clip.skel.idx.get(n) for n in tgt.names]


def retarget(clip, tgt, rot=None, pos=None, correct_rest=True):
    """世界の向きで写す。戻り値：写し先の骨の世界の回転（F,T,4）・腰の位置（F,3）・情報。"""
    rot = clip.rot if rot is None else rot
    pos = clip.pos if pos is None else pos
    src = clip.skel
    F = rot.shape[0]
    T = len(tgt.names)
    mp = bone_map(clip, tgt)
    sdir = src.rest_dirs(CMU_DIR_CHILD if clip.rig == 'cmu' else MESHY_DIR_CHILD)
    tdir = tgt.rest_dirs(MESHY_DIR_CHILD)
    world = np.zeros((F, T, 4))
    offsets = {}
    for t in tgt.order:
        s = mp[t]
        if s is not None:
            off = qbetween(sdir[s], tdir[t]) if correct_rest else np.array([1.0, 0, 0, 0])
            offsets[tgt.names[t]] = float(np.degrees(qangle(off, np.array([1.0, 0, 0, 0]))))
            c = qmul(qmul(qconj(src.rest_rot[s]), qconj(off)), tgt.rest_rot[t])
            world[:, t] = qmul(rot[:, s], np.broadcast_to(c, (F, 4)))
        else:
            p = tgt.parent[t]
            local_rest = qmul(qconj(tgt.rest_rot[p]), tgt.rest_rot[t])
            world[:, t] = qmul(world[:, p], np.broadcast_to(local_rest, (F, 4)))
    world = fix_continuity(qnormalize(world))
    hs = mp[tgt.idx['Hips']]
    k = tgt.leg_length() / src.leg_length()
    sp = pos[:, hs]
    th = tgt.rest_head[tgt.idx['Hips']]
    info = {'legScale': round(k, 4), 'restOffsetDeg': {n: round(v, 2) for n, v in offsets.items() if v > 0.5}}
    if clip.rig == 'cmu':
        # CMU のT字のコマは床に立っていない（足首が床より下）ので、休みの腰の高さとの差は使えない。
        # 高さは脚の比で縮め、そのうえで着いている足（足首かつま先の低いほう）が休みの高さに来るよう上下にずらす。
        hips = np.zeros((F, 3))
        hips[:, :2] = (sp[:, :2] - sp[0, :2]) * k + th[:2]
        hips[:, 2] = sp[:, 2] * k
        pos = fk(tgt, world, hips)
        low = np.full(F, np.inf)
        for n in ('LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'):
            low = np.minimum(low, pos[:, tgt.idx[n], 2] - tgt.rest_head[tgt.idx[n], 2])
        dz = -float(np.percentile(low, 15))
        hips[:, 2] += dz
        info['groundFixM'] = round(dz, 4)
    else:
        hips = th + (sp - src.rest_head[hs]) * k
    return world, hips, info


def to_local(tgt, world, hips):
    """骨の世界の回転 → Blender の pose_bone の回転（休みからの局所の回転）と腰の位置。"""
    F, T = world.shape[:2]
    basis = np.zeros_like(world)
    rr = tgt.rest_rot
    for t in range(T):
        p = tgt.parent[t]
        if p < 0:
            basis[:, t] = qmul(np.broadcast_to(qconj(rr[t]), (F, 4)), world[:, t])
        else:
            c = qmul(qconj(rr[t]), rr[p])
            basis[:, t] = qmul(qmul(np.broadcast_to(c, (F, 4)), qconj(world[:, p])), world[:, t])
    basis = fix_continuity(qnormalize(basis))
    h = tgt.idx['Hips']
    loc = qrot(np.broadcast_to(qconj(rr[h]), (F, 4)), hips - tgt.rest_head[h])
    return basis, loc


def from_local(tgt, basis, loc):
    """to_local の逆（ループの継ぎ目を直した後に世界へ戻す）。"""
    F, T = basis.shape[:2]
    world = np.zeros_like(basis)
    rr = tgt.rest_rot
    for t in tgt.order:
        p = tgt.parent[t]
        if p < 0:
            world[:, t] = qmul(np.broadcast_to(rr[t], (F, 4)), basis[:, t])
        else:
            c = qmul(qconj(rr[p]), rr[t])
            world[:, t] = qmul(qmul(world[:, p], np.broadcast_to(c, (F, 4))), basis[:, t])
    h = tgt.idx['Hips']
    hips = tgt.rest_head[h] + qrot(np.broadcast_to(rr[h], (F, 4)), loc)
    return qnormalize(world), hips


def fk(tgt, world, hips):
    """骨の付け根の世界の位置（F,T,3）。"""
    F, T = world.shape[:2]
    pos = np.zeros((F, T, 3))
    for t in tgt.order:
        p = tgt.parent[t]
        if p < 0:
            pos[:, t] = hips
        else:
            off = qrot(qconj(tgt.rest_rot[p]), tgt.rest_head[t] - tgt.rest_head[p])
            pos[:, t] = pos[:, p] + qrot(world[:, p], np.broadcast_to(off, (F, 3)))
    return pos


# ---------------------------------------------------------------- ループ

def foot_forward(tgt, pos, side='Left'):
    """足（足首）が腰より前（-Y）にどれだけ出ているか。"""
    return (pos[:, tgt.idx[side + 'Foot']] - pos[:, tgt.idx['Hips']]) @ FRONT


def local_maxima(x, min_gap):
    idx = [i for i in range(1, len(x) - 1) if x[i] >= x[i - 1] and x[i] > x[i + 1]]
    out = []
    for i in idx:  # 近すぎる山は高いほうを残す
        if out and i - out[-1] < min_gap:
            if x[i] > x[out[-1]]:
                out[-1] = i
        else:
            out.append(i)
    return out


MAJOR = ['Hips', 'Spine02', 'Spine01', 'Spine', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm',
         'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot', 'Head']


def pose_distance(tgt, basis_a, basis_b, hz_a, hz_b):
    ids = [tgt.idx[n] for n in MAJOR if n != 'Hips']
    ang = qangle(basis_a[ids], basis_b[ids])
    return float(np.sum(np.degrees(ang) ** 2) / len(ids)) ** 0.5 + abs(hz_a - hz_b) * 100.0


def choose_cycle(tgt, world, hips, fps, spec):
    """1周の区間 [a, b]（元のコマ番号）を選ぶ。"""
    F = len(world)
    basis, _ = to_local(tgt, world, hips)
    whole_seam = pose_distance(tgt, basis[0], basis[-1], hips[0, 2], hips[-1, 2])
    if spec.get('window'):
        a, b = spec['window']
        return a, b, 'given', whole_seam
    if spec.get('whole') or whole_seam < 8.0:
        return 0, F - 1, 'whole clip', whole_seam
    pos = fk(tgt, world, hips)
    # 進む向きのそろっていない元の動作でも前後がわかるよう、腰の速度の向きで足の前後を測る
    vel = np.gradient(hips[:, :2], axis=0)
    ker = np.ones(15) / 15
    vx = np.convolve(vel[:, 0], ker, mode='same'); vy = np.convolve(vel[:, 1], ker, mode='same')
    sp = np.hypot(vx, vy)
    if spec.get('events') != 'window' and np.median(sp) * fps > 0.2:
        d = np.stack([vx, vy, np.zeros(F)], -1) / np.maximum(sp, 1e-9)[:, None]
        if TRAVEL_YAW.get(spec.get('travel', 'forward'), 0.0) == np.pi:
            d = -d  # 後ろ歩き：体の前は進む向きの逆
        fwd = np.sum((pos[:, tgt.idx['LeftFoot']] - pos[:, tgt.idx['Hips']]) * d, axis=-1)
    else:
        fwd = foot_forward(tgt, pos)
    ev = local_maxima(fwd, min_gap=int(0.35 * fps))
    cands = []
    if spec.get('events') != 'window':
        for i in range(len(ev) - 1):
            a, b = ev[i], ev[i + 1]
            if a < 0.08 * F or b > 0.97 * F:
                continue
            if (b - a) < 0.35 * fps:
                continue
            score = pose_distance(tgt, basis[a], basis[b], hips[a, 2], hips[b, 2])
            mid = abs((a + b) / 2 - F / 2) / F
            cands.append((score + 10 * mid, a, b))
    if cands:
        cands.sort()
        return cands[0][1], cands[0][2], 'left-foot cycle', whole_seam
    # 足で切れない（泳ぎ・梯子など）：継ぎ目の差が一番小さい区間を探す
    lmin = int(spec.get('min_seconds', 0.8) * fps)
    best = None
    for a in range(0, max(1, F - lmin)):
        for b in range(a + lmin, F):
            s = pose_distance(tgt, basis[a], basis[b], hips[a, 2], hips[b, 2]) - 0.02 * (b - a)
            if best is None or s < best[0]:
                best = (s, a, b)
    return best[1], best[2], 'min-seam window', whole_seam


def make_loop(tgt, world, hips, fps, spec, out_fps=30.0):
    """ループにする。戻り値：world, hips（その場）, 情報（区間・進む向きの補正・1周の距離・速さ）。"""
    a, b, how, whole_seam = choose_cycle(tgt, world, hips, fps, spec)
    T = len(tgt.names)
    dur = (b - a) / fps
    n = max(8, int(round(dur * out_fps)))
    idx = a + (b - a) * np.arange(n + 1) / n
    # 写し先の世界の回転と腰を、出力のコマ割りで取り直す
    w, _ = resample_world(world, np.zeros((len(world), T, 3)), idx)
    i0 = np.floor(idx).astype(int); i1 = np.minimum(i0 + 1, len(hips) - 1); tt = (idx - i0)[:, None]
    h = hips[i0] + (hips[i1] - hips[i0]) * tt
    info = {'window': [int(a), int(b)], 'windowSeconds': [round(a / fps, 3), round(b / fps, 3)], 'how': how,
            'wholeClipSeamDeg': round(whole_seam, 2), 'loopFrames': n, 'loopSeconds': round(n / out_fps, 4),
            'timeScale': round((n / out_fps) / dur, 4) if dur > 0 else 1.0}
    disp = h[-1, :2] - h[0, :2]
    dist = float(np.linalg.norm(disp))
    kind = spec.get('kind', 'cycle')
    travel = spec.get('travel')
    theta = 0.0
    if kind == 'cycle' and travel in TRAVEL_YAW and dist > 0.15:
        theta = TRAVEL_YAW[travel] - float(yaw_of(np.array([disp[0], disp[1], 0.0])))
        theta = (theta + np.pi) % (2 * np.pi) - np.pi
        qz = qyaw(theta)
        w = qmul(np.broadcast_to(qz, w.shape), w)
        c = h[0].copy()
        h = qrot(np.broadcast_to(qz, (len(h), 4)), h - c) + c
    info['headingCorrectionDeg'] = round(float(np.degrees(theta)), 2)
    info['cycleDistance'] = round(dist, 4)
    if kind == 'cycle' and travel in TRAVEL_YAW and dist > 0.15:
        dv = np.array([np.sin(TRAVEL_YAW[travel]), -np.cos(TRAVEL_YAW[travel])])
        fwd = (h[:, :2] @ dv)
        step = np.diff(fwd)
        info['rootSpeedProfile'] = step / max(np.mean(step), 1e-9)  # 位相をずらす前のコマ順
    # その場にする：1周の水平の進みを線形に引く
    s = np.linspace(0.0, 1.0, n + 1)[:, None]
    d2 = h[-1, :2] - h[0, :2]
    hz_resid = h[0, 2] - h[-1, 2]
    if kind == 'cycle':
        # 1周の平均の位置を休みの姿勢の腰の真上に置く（左右の揺れは残る）
        h[:, :2] = h[:, :2] - h[0, :2] - d2 * s
        h[:, :2] += tgt.rest_head[tgt.idx['Hips'], :2] - h[:-1, :2].mean(axis=0)
    else:
        h[:, :2] = h[:, :2] - d2 * s
    h[:, 2] += hz_resid * s[:, 0]
    if spec.get('vertical_inplace'):
        climb = h[-1, 2] - h[0, 2]
        h[:, 2] -= climb * s[:, 0]
        info['cycleClimb'] = round(float(climb), 4)
    # 継ぎ目：最後のコマを最初のコマに合わせ、差を1周に均す
    basis, loc = to_local(tgt, w, h)
    for t in range(T):
        delta = qmul(basis[0, t], qconj(basis[-1, t]))
        corr = slerp(np.broadcast_to(np.array([1.0, 0, 0, 0]), (n + 1, 4)), np.broadcast_to(delta, (n + 1, 4)), s[:, 0])
        basis[:, t] = qmul(corr, basis[:, t])
    loc[-1] = loc[0]
    basis[-1] = basis[0]
    w, h = from_local(tgt, basis, loc)
    # 左足が一番前に出た瞬間から始める（歩き・小走り・走りの位相をそろえる）
    shift = 0
    if kind == 'cycle':
        pos = fk(tgt, w, h)
        shift = int(np.argmax(foot_forward(tgt, pos)[:-1]))
        if shift:
            order = list(range(shift, n)) + list(range(0, shift)) + [shift]
            w = w[order]
            h = h[order]
    info['phaseShiftFrames'] = shift
    if 'rootSpeedProfile' in info:
        prof = info['rootSpeedProfile']
        prof = np.concatenate([prof[shift:], prof[:shift]]) if shift else prof
        info['rootSpeedProfile'] = [round(float(x), 3) for x in prof]
    seam_after = float(np.degrees(np.max(qangle(w[0], w[-1]))))
    info['seamAfterDeg'] = round(seam_after, 3)
    return fix_continuity(w), h, info


# ---------------------------------------------------------------- 計測

def runs(mask):
    """真の連続区間 [(start, end_exclusive)]。"""
    out, start = [], None
    for i, m in enumerate(mask):
        if m and start is None:
            start = i
        if not m and start is not None:
            out.append((start, i)); start = None
    if start is not None:
        out.append((start, len(mask)))
    return out


def _clean_runs(mask, n, loop, min_len, max_gap):
    """真の区間を取り出し、短いすき間（max_gap コマ以下）をつなぎ、短すぎる区間（min_len 未満）を捨てる。"""
    rr = runs(mask)
    if loop and len(rr) > 1 and rr[0][0] == 0 and rr[-1][1] == n:
        first = rr.pop(0)
        last = rr.pop(-1)
        rr.append((last[0], first[1] + n))
        rr.sort()
    merged = []
    for r in rr:
        if merged and r[0] - merged[-1][1] <= max_gap:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(r)
    if loop and len(merged) > 1 and (merged[0][0] + n) - merged[-1][1] <= max_gap:
        last = merged.pop(-1)
        first = merged.pop(0)
        merged.append((last[0], first[1] + n))
    return [r for r in merged if r[1] - r[0] >= min_len]


def foot_contacts(tgt, pos, fps, loop, travel_speed=0.0, travel_dir=None):
    """足が着いている区間（0〜1の位相）と、着いている間の滑り（m）。
    pos はその場の位置（loop）か、根の動きを含む位置（繰り返さない動作）。
    着いている＝足首かつま先が床の近く（その足の一番低い高さ＋3.5cm 以内）で、
    その場の位置で見て前へ動いていない（着いた足は体に対して後ろへ流れ、浮いた足は前へ出る）。
    滑り＝体を travel_speed で前へ送ったとき、着いている間に足が床の上で動いた距離。"""
    n = len(pos) - 1 if loop else len(pos)
    d = np.array([0.0, -1.0, 0.0]) if travel_dir is None else np.asarray(travel_dir, dtype=np.float64)
    res = {}
    min_len = max(2, int(round(0.07 * fps)))
    max_gap = 2
    t = np.arange(n) / fps
    for side in ('Left', 'Right'):
        ank = pos[:n, tgt.idx[side + 'Foot']]
        toe = pos[:n, tgt.idx[side + 'ToeBase']]
        ha = ank[:, 2] - tgt.rest_head[tgt.idx[side + 'Foot'], 2]
        ht = toe[:, 2] - tgt.rest_head[tgt.idx[side + 'ToeBase'], 2]
        low = np.minimum(ha, ht)
        base = np.percentile(low, 5)
        pts = np.where((ha < ht)[:, None], ank, toe)
        if loop:
            vel = (np.roll(pts, -1, axis=0) - np.roll(pts, 1, axis=0)) * fps / 2
        else:
            vel = np.gradient(pts, axis=0) * fps
        if loop:
            along = vel @ d  # その場の位置での前向きの速さ（着いた足は約 -travel_speed）
            moving = along > max(0.25, 0.25 * travel_speed)
            if travel_speed < 0.05:
                moving = np.hypot(vel[:, 0], vel[:, 1]) > 0.25
        else:
            moving = np.hypot(vel[:, 0], vel[:, 1]) > 0.25
        mask = (low - base < 0.035) & ~moving
        rr = _clean_runs(mask, n, loop, min_len, max_gap)
        phases, slide = [], 0.0
        shift_v = (d * travel_speed)[None, :] * t[:, None] if loop else np.zeros((n, 3))
        cycle_shift = d * travel_speed * (n / fps)
        base_a = np.percentile(ha, 5)
        base_t = np.percentile(ht, 5)
        for (s0, s1) in rr:
            # 踵から爪先へ転がる間に「一番低い点」が足首から爪先へ移るので、足首は足首が下りている間、
            # 爪先は爪先が下りている間だけで、床の上の動きを測る
            for joint, hh, bb in ((ank, ha, base_a), (toe, ht, base_t)):
                ids = [i for i in range(s0, s1) if hh[i % n] - bb < 0.03]
                if len(ids) < 2:
                    continue
                seg = np.array([joint[i % n] + shift_v[i % n] + (cycle_shift if i >= n else 0.0) for i in ids])[:, :2]
                slide = max(slide, float(np.max(np.linalg.norm(seg - seg[0], axis=-1))))
            end = s1 % n if (loop and s1 > n) else s1
            phases.append([round(s0 / n, 3), round(end / n, 3)])
        res[side.lower()] = {'contactPhases': phases, 'maxSlideM': round(slide, 4), 'groundOffsetM': round(float(base), 4)}
    return res


def stance_speed(tgt, pos, fps, travel_dir=None):
    """その場の動作で、着いている足が体に対して後ろへ流れる速さ＝進む速さ。
    足が低い区間（0.2秒以上）ごとに、進む向きの位置を時間で回帰した傾きを取り、区間の長さで重み付けて平均する。"""
    n = len(pos) - 1
    d = np.array([0.0, -1.0, 0.0]) if travel_dir is None else np.asarray(travel_dir, dtype=np.float64)
    num, den = 0.0, 0.0
    for side in ('Left', 'Right'):
        ank = pos[:n, tgt.idx[side + 'Foot']]
        toe = pos[:n, tgt.idx[side + 'ToeBase']]
        low = np.minimum(ank[:, 2] - tgt.rest_head[tgt.idx[side + 'Foot'], 2], toe[:, 2] - tgt.rest_head[tgt.idx[side + 'ToeBase'], 2])
        base = np.percentile(low, 5)
        rr = _clean_runs(low - base < 0.03, n, True, max(3, int(round(0.1 * fps))), 2)
        for (s0, s1) in rr:
            ids = [i % n for i in range(s0, s1)]
            mid = (ank[ids] + toe[ids]) / 2 @ d
            tt = np.arange(len(ids)) / fps
            slope = np.polyfit(tt, mid, 1)[0]
            if slope < 0:  # 後ろへ流れている区間だけ（足を引きずる区間は入れない）
                num += -slope * len(ids)
                den += len(ids)
    return float(num / den) if den else 0.0


def hand_speed_metrics(tgt, pos, fps, side='Right'):
    p = pos[:, tgt.idx[side + 'Hand']]
    v = np.gradient(p, axis=0) * fps
    sp = np.linalg.norm(v, axis=-1)
    if len(sp) >= 5:
        sp = np.convolve(np.pad(sp, 1, mode='edge'), np.ones(3) / 3, mode='valid')
    n = len(sp) - 1
    if n <= 0:
        return None
    pk = int(np.argmax(sp))
    peak = float(sp[pk])
    a = pk
    while a > 0 and sp[a - 1] > 0.6 * peak:
        a -= 1
    b = pk
    while b < len(sp) - 1 and sp[b + 1] > 0.6 * peak:
        b += 1
    # 振りかぶりの始まり：山より前で、手が速さ 15% を初めて超えた所（それより前の最後の静止）
    w = a
    while w > 0 and sp[w - 1] > 0.15 * peak:
        w -= 1
    # 戻りの始まり：当たりの後、手が一番遅くなった所（振り切って止まり、構えへ戻り始める）
    r = b
    end = min(len(sp) - 1, b + int(0.6 * fps))
    if end > b:
        r = b + int(np.argmin(sp[b:end + 1]))
    return {'peakSpeed': round(peak, 3), 'peakPhase': round(pk / n, 4),
            'activeWindow': [round(a / n, 4), round(b / n, 4)], 'activeWindowSeconds': [round(a / fps, 3), round(b / fps, 3)],
            'windupStart': round(w / n, 4), 'recoveryStart': round(r / n, 4)}


def wrist_bend(tgt, world, pos):
    out = {}
    for side in ('Left', 'Right'):
        fa = pos[:, tgt.idx[side + 'Hand']] - pos[:, tgt.idx[side + 'ForeArm']]
        fa /= np.linalg.norm(fa, axis=-1, keepdims=True)
        hy = qrot(world[:, tgt.idx[side + 'Hand']], np.broadcast_to(np.array([0.0, 1.0, 0.0]), fa.shape))
        # 手の骨の休みの向きと前腕の休みの向きの差は引く（休みの姿勢で 0°）
        fa_r = tgt.rest_head[tgt.idx[side + 'Hand']] - tgt.rest_head[tgt.idx[side + 'ForeArm']]
        fa_r /= np.linalg.norm(fa_r)
        hy_r = qrot(tgt.rest_rot[tgt.idx[side + 'Hand']], np.array([0.0, 1.0, 0.0]))
        rest = np.degrees(np.arccos(np.clip(fa_r @ hy_r, -1, 1)))
        ang = np.degrees(np.arccos(np.clip(np.sum(fa * hy, axis=-1), -1, 1))) - rest
        out[side.lower()] = {'maxDeg': round(float(ang.max()), 1), 'framesOver60': int(np.sum(ang > 60))}
    return out


def hand_torso(tgt, world, pos, torso):
    """手（手首と手のひらの中心）が胴の楕円の筒にどれだけ入るか（m）。torso は build 側で形から測った値。"""
    if torso is None:
        return None
    sp = tgt.idx['Spine01']
    out = {}
    F = len(pos)
    for side in ('Left', 'Right'):
        h = tgt.idx[side + 'Hand']
        hy = qrot(world[:, h], np.broadcast_to(np.array([0.0, 1.0, 0.0]), (F, 3)))
        pts = [pos[:, h], pos[:, h] + hy * torso['handCenter']]
        depth = np.zeros(F)
        for p in pts:
            rel = qrot(qconj(world[:, sp]), p - pos[:, sp])  # 胴の骨の向きで見た位置
            rel = qrot(np.broadcast_to(tgt.rest_rot[sp], (F, 4)), rel)  # 休みの姿勢の世界の軸へ
            x, y, z = rel[:, 0], rel[:, 1], rel[:, 2]
            inside_z = (z > torso['zMin']) & (z < torso['zMax'])
            r = np.sqrt((x / torso['rx']) ** 2 + ((y - torso['cy']) / torso['ry']) ** 2)
            d = (1.0 - r) * min(torso['rx'], torso['ry'])
            d = np.where(inside_z, d, -1.0)
            depth = np.maximum(depth, d)
        out[side.lower()] = {'maxDepthM': round(float(depth.max()), 3), 'framesOver3cm': int(np.sum(depth > 0.03))}
    return out
