# mz_quat.py — numpy の四元数（w, x, y, z・ハミルトン積・Blender と同じ約束）（assets-r1・2026-10-01）
# （出所：本人の制作物 minato-web/tools/blender/mz_quat.py を残火の鎌倉 v19 で写して使う。内容は変更していない）
#
# 何を：写し替えとループ処理と計測で使う四元数とベクトルの計算。Blender の外（普通の python3）でも動く。
# どの素材から：なし（計算だけ）。
# 版：r1。

import numpy as np


def qmul(a, b):
    aw, ax, ay, az = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bw, bx, by, bz = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    ], axis=-1)


def qconj(q):
    return q * np.array([1.0, -1.0, -1.0, -1.0])


def qnormalize(q):
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def qrot(q, v):
    """q で v を回す（v' = q v q*）。"""
    u = q[..., 1:]
    w = q[..., :1]
    t = 2.0 * np.cross(u, v)
    return v + w * t + np.cross(u, t)


def qbetween(u, v):
    """単位ベクトル u を v へ回す最小の回転。"""
    u = u / np.linalg.norm(u, axis=-1, keepdims=True)
    v = v / np.linalg.norm(v, axis=-1, keepdims=True)
    d = np.sum(u * v, axis=-1, keepdims=True)
    c = np.cross(u, v)
    q = np.concatenate([1.0 + d, c], axis=-1)
    n = np.linalg.norm(q, axis=-1, keepdims=True)
    bad = (n[..., 0] < 1e-8)
    if np.any(bad):  # 真逆：u に直交する軸で180°
        ub = u[bad]
        ax = np.cross(ub, np.array([1.0, 0, 0]))
        small = np.linalg.norm(ax, axis=-1) < 1e-6
        ax[small] = np.cross(ub[small], np.array([0, 1.0, 0]))
        ax /= np.linalg.norm(ax, axis=-1, keepdims=True)
        q[bad] = np.concatenate([np.zeros((len(ub), 1)), ax], axis=-1)
        n = np.linalg.norm(q, axis=-1, keepdims=True)
    return q / n


def qaxis_angle(axis, angle):
    axis = np.asarray(axis, dtype=np.float64)
    axis = axis / np.linalg.norm(axis)
    h = np.asarray(angle, dtype=np.float64)[..., None] / 2.0
    return np.concatenate([np.cos(h), np.sin(h) * axis], axis=-1)


def qyaw(theta):
    return qaxis_angle([0.0, 0.0, 1.0], theta)


def qangle(a, b):
    d = np.abs(np.sum(a * b, axis=-1))
    return 2.0 * np.arccos(np.clip(d, 0.0, 1.0))


def qlog_angle(q):
    return 2.0 * np.arccos(np.clip(np.abs(q[..., 0]), 0.0, 1.0))


def slerp(a, b, t):
    """a から b へ t（0〜1、配列可）だけ。短い道を通る。"""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    t = np.asarray(t, dtype=np.float64)
    d = np.sum(a * b, axis=-1, keepdims=True)
    b = np.where(d < 0, -b, b)
    d = np.abs(d)
    tt = t[..., None] if t.ndim == a.ndim - 1 else t
    lin = d > 0.9995
    om = np.arccos(np.clip(d, -1.0, 1.0))
    so = np.sin(om)
    so = np.where(so < 1e-9, 1.0, so)
    wa = np.where(lin, 1.0 - tt, np.sin((1.0 - tt) * om) / so)
    wb = np.where(lin, tt, np.sin(tt * om) / so)
    return qnormalize(wa * a + wb * b)


def fix_continuity(q):
    """コマ順に並んだ四元数（F, ..., 4）の符号をそろえ、補間で裏返らないようにする。"""
    q = q.copy()
    for f in range(1, q.shape[0]):
        d = np.sum(q[f] * q[f - 1], axis=-1)
        q[f][d < 0] *= -1.0
    return q


def qto_mat(q):
    w, x, y, z = q[..., 0], q[..., 1], q[..., 2], q[..., 3]
    return np.stack([
        np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], -1),
        np.stack([2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], -1),
        np.stack([2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], -1),
    ], -2)


def yaw_of(v):
    """水平のベクトルの向き。0 = -Y（人物の前）、正 = +X（人物の左）へ。"""
    return np.arctan2(v[..., 0], -v[..., 1])
