"""小精灵姿势图：refs/*.png → assets/sprite/*.webp

  1. 去光晕：把半透明的柔光外圈切掉，边缘像素的颜色换成内侧实色，避免白边/灰边
  2. 饱和度对齐 idle（portal 例外：它多出来的饱和度是传送门特效本身）
  3. 以底下的滑板为基准，把每张的大小和位置对齐 idle，换姿势时角色不会跳
  4. 统一裁切，输出 256px WebP

用法：python3 scripts/sprite/build.py
"""
import glob
import os

import cv2
import numpy as np
from PIL import Image, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
REFS = os.path.join(HERE, 'refs')
OUT = os.path.join(HERE, '..', '..', 'assets', 'sprite')
SIZE = 256
KEEP_SAT = {'portal'}        # 不做饱和度对齐


def load(name):
    return np.asarray(Image.open(os.path.join(REFS, name + '.png')).convert('RGBA')).astype(np.float32)


def dehalo(a):
    rgb, al = a[..., :3], a[..., 3]
    # 光晕 = 半透明、偏白/偏灰的外圈；喷射火焰、传送门光这类半透明是有颜色的，要留着
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    haze = np.clip((0.35 - sat) / 0.2, 0, 1)        # 饱和度 <0.15 算光晕，>0.35 算特效
    cut = np.clip((al - 150) / (235 - 150), 0, 1) * 255
    new_al = al * (1 - haze) + np.minimum(al, cut) * haze
    # 边缘颜色：用内侧不透明像素的颜色往外扩，盖掉原本混进去的白色/灰色
    solid = (al >= 250).astype(np.float32)
    k = 7
    num = cv2.blur(rgb * solid[..., None], (k, k))
    den = cv2.blur(solid, (k, k))[..., None]
    bleed = np.where(den > 1e-3, num / np.maximum(den, 1e-3), rgb)
    edge = (haze > 0.5) & (new_al > 0) & (al < 250) & (den[..., 0] > 0.05)
    out_rgb = np.where(edge[..., None], bleed, rgb)
    return np.dstack([out_rgb, new_al])


def mean_sat(img):
    a = np.asarray(img.resize((300, 300))).astype(np.float32) / 255
    rgb, al = a[..., :3], a[..., 3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    m = (al > 0.8) & ~((mx > 0.95) & (s < 0.08))
    return s[m].mean()


def match_sat(img, ref):
    k = 1.0
    out = img
    for _ in range(4):
        k *= ref / mean_sat(out)
        out = ImageEnhance.Color(img).enhance(k)
    return out


def board_mask(a):
    # 滑板在下方 35%：拿这一段的 alpha 做对齐
    # 只用实心像素，传送门光、喷射火焰这些半透明的不算
    m = (a[..., 3] >= 250).astype(np.float32)
    h = m.shape[0]
    m[: int(h * 0.65)] = 0
    return m


def align(a, ref_mask):
    """暴力搜缩放 + 平移，让滑板和 idle 的滑板重叠最多。先在 1/4 尺寸粗搜。"""
    small = 0.25
    rm = cv2.resize(ref_mask, None, fx=small, fy=small, interpolation=cv2.INTER_AREA)
    m = board_mask(a)
    best = (-1, 1.0, 0, 0)
    for s in np.arange(0.80, 1.21, 0.01):
        sm = cv2.resize(m, None, fx=small * s, fy=small * s, interpolation=cv2.INTER_AREA)
        pad = np.zeros((rm.shape[0] * 3, rm.shape[1] * 3), np.float32)
        oy, ox = rm.shape[0], rm.shape[1]
        h, w = min(sm.shape[0], pad.shape[0] - oy), min(sm.shape[1], pad.shape[1] - ox)
        pad[oy:oy + h, ox:ox + w] = sm[:h, :w]
        res = cv2.matchTemplate(pad, rm, cv2.TM_CCORR_NORMED)
        _, v, _, loc = cv2.minMaxLoc(res)
        if v > best[0]:
            best = (v, s, (ox - loc[0]) / small, (oy - loc[1]) / small)
    _, s, tx, ty = best
    M = np.float32([[s, 0, tx], [0, s, ty]])
    h, w = a.shape[:2]
    # 先预乘 alpha 再变换，避免透明区的颜色渗到边上
    pm = a.copy()
    pm[..., :3] *= pm[..., 3:4] / 255
    warped = cv2.warpAffine(pm, M, (w, h), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
    al = warped[..., 3:4]
    warped[..., :3] = np.where(al > 0, warped[..., :3] * 255 / np.maximum(al, 1e-3), 0)
    return warped, best


def main():
    os.makedirs(OUT, exist_ok=True)
    names = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(REFS, '*.png')))
    names = [n for n in names if n != 'sprite-ref']
    idle = dehalo(load('idle'))
    ref_mask = board_mask(idle)
    ref_sat = mean_sat(Image.fromarray(idle.astype(np.uint8)))

    frames = {}
    for n in names:
        a = dehalo(load(n), )
        if n != 'idle':
            a, (score, s, tx, ty) = align(a, ref_mask)
            print(f'{n:8} align scale={s:.2f} dx={tx:+.0f} dy={ty:+.0f} match={score:.3f}')
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')
        if n not in KEEP_SAT:
            img = match_sat(img, ref_sat)
        frames[n] = img

    # 所有姿势用同一个正方形裁切：包住全部的并集，贴底
    boxes = [f.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox() for f in frames.values()]
    l = min(b[0] for b in boxes); t = min(b[1] for b in boxes)
    r = max(b[2] for b in boxes); btm = max(b[3] for b in boxes)
    side = max(r - l, btm - t)
    cx = (l + r) / 2
    box = (int(cx - side / 2), btm - side, int(cx - side / 2) + side, btm)
    for n, img in frames.items():
        out = img.crop(box).resize((SIZE, SIZE), Image.LANCZOS)
        path = os.path.join(OUT, n + '.webp')
        out.save(path, 'WEBP', quality=88, method=6, exact=False)
        print(f'{n:8} → {os.path.relpath(path, os.getcwd())} {os.path.getsize(path) // 1024}KB sat={mean_sat(out):.3f}')


if __name__ == '__main__':
    main()
