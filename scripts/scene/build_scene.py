"""把一张参考图拆成「会动的分层背景」（assets/visual/<科目>/scene.json）。

决定性的影像处理，不靠生成式：位置、颜色都跟参考图一模一样。

  pip install -r scripts/scene/requirements.txt

  # 1. 分析：找出画面上每一个独立的元素，输出一张标了编号的检查图
  python scripts/scene/build_scene.py analyze scripts/scene/refs/biology.png /tmp/bio

  # 2. 看 /tmp/bio/components.png，决定哪些编号要组成哪个图层、怎么动，写进设定档
  #    （参考 scripts/scene/biology.json）

  # 3. 产出：底图、各图层、scene.json（连护眼模式的夜色底图一起）
  python scripts/scene/build_scene.py build scripts/scene/biology.json /tmp/bio assets/visual/biology

  # 只重做夜色底图（调 NIGHT_PAPER / NIGHT_K 之後）
  python scripts/scene/build_scene.py night assets/visual/biology

设定档里每个图层：
  ids     参考图上的元素编号（analyze 印出来的）
  rect    或者用一个框 [x, y, 宽, 高] 圈出元素：框里所有「不是纸」的像素都算，
          连 analyze 抓不到的淡线（轨道、光线、淡色轮廓）也会跟著一起动。
          前面图层已经拿走的像素不会重复拿，所以框可以大一点，把小元素排在前面。
  motion  none | sway 摇摆 | float 上下飘 | bob 轻晃 | drift 漂移
  wide    横式画面是否在原位显示（false = 已经画在底图里，只在直式画面单独出现）
  tall    直式画面（手机）贴著视窗的位置，例如 {"left": "4%", "top": "36%", "width": "16vmin"}
  fade_bottom  底部渐隐的像素数（元素被截断时用）
wide 为 true 的图层会从底图里补掉，才不会动的时候露出一个重影。
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image


def paper_field(im):
    """估计每一点的纸色：纸是画面上最亮的，逐通道取邻域最亮再大范围模糊。"""
    h, w = im.shape[:2]
    small = cv2.resize(im, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    small = cv2.dilate(small, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
    small = cv2.GaussianBlur(small, (0, 0), 12)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)


# 护眼模式（深夜）的纸色：深暖灰，不用纯黑。颜料在夜里只剩 NIGHT_K 的浓度，像微光。
# 图层在夜里的 CSS 透明度用同一个数（写进 scene.json 的 night.layer_opacity），底图和会动的元素才对得上。
NIGHT_PAPER = (29, 27, 24)
NIGHT_K = 0.32


def lab_dist(im, paper):
    lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB).astype(np.float32)
    plab = cv2.cvtColor(paper, cv2.COLOR_BGR2LAB).astype(np.float32)
    return np.sqrt(((lab - plab) ** 2).sum(axis=2))


def make_night(dest):
    """夜色底图：从白天的底图还原「颜料 + 透明度」，再以 NIGHT_K 的浓度画到深色纸上。"""
    spec_path = os.path.join(dest, 'scene.json')
    spec = json.load(open(spec_path, encoding='utf-8'))
    plate = cv2.imread(os.path.join(dest, spec['plate']))
    paper = paper_field(plate)
    a = np.clip((lab_dist(plate, paper) - 5.0) / 32.0, 0, 1) ** 0.85
    C, P = plate.astype(np.float32), paper.astype(np.float32)
    F = np.clip((C - (1 - a[..., None]) * P) / np.maximum(a, 0.02)[..., None], 0, 255)
    N = np.array(NIGHT_PAPER[::-1], np.float32)
    w = (NIGHT_K * a)[..., None]
    grain = (C - P) * (1 - a[..., None]) * 0.5           # 保留一点纸纹，深色大面积才不会像塑胶
    night = np.clip(N * (1 - w) + F * w + grain, 0, 255).astype(np.uint8)
    rel = os.path.join(os.path.dirname(spec['plate']), 'plate-night.webp')
    Image.fromarray(night[..., ::-1]).save(os.path.join(dest, rel), quality=84, method=6)
    spec['night'] = {'plate': rel, 'layer_opacity': NIGHT_K}
    with open(spec_path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(spec, ensure_ascii=False, indent=1))
    print(f"夜色底图 → {os.path.join(dest, rel)}（{os.path.getsize(os.path.join(dest, rel)) // 1024} KB）")


def analyze(ref, work):
    os.makedirs(work, exist_ok=True)
    im = cv2.imread(ref)
    paper = paper_field(im)
    lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB).astype(np.float32)
    plab = cv2.cvtColor(paper, cv2.COLOR_BGR2LAB).astype(np.float32)
    dist = np.sqrt(((lab - plab) ** 2).sum(axis=2))          # 离纸色多远 = 这里画了多少东西

    mask = (dist > 14).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)

    vis = im.copy()
    comps = []
    for i in sorted(range(1, n), key=lambda k: -stats[k, 4]):
        x, y, w, h, area = (int(v) for v in stats[i])
        if area < 150:
            continue
        comps.append({'id': i, 'area': area, 'box': [x, y, w, h]})
        cv2.rectangle(vis, (x, y), (x + w, y + h), (0, 0, 255) if area > 20000 else (255, 0, 0), 2)
        cv2.putText(vis, str(i), (x + 3, y + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    cv2.imwrite(os.path.join(work, 'components.png'), vis)
    np.save(os.path.join(work, 'dist.npy'), dist)
    np.save(os.path.join(work, 'labels.npy'), labels)
    cv2.imwrite(os.path.join(work, 'paper.png'), paper)
    cv2.imwrite(os.path.join(work, 'ref.png'), im)
    json.dump(comps, open(os.path.join(work, 'components.json'), 'w'), indent=1)
    for c in comps[:40]:
        print(f"#{c['id']:4d}  面积 {c['area']:7d}  位置 {c['box']}")
    print(f"\n检查图：{os.path.join(work, 'components.png')}")


def build(config_path, work, dest):
    cfg = json.load(open(config_path, encoding='utf-8'))
    im = cv2.imread(os.path.join(work, 'ref.png'))
    H, W = im.shape[:2]
    dist = np.load(os.path.join(work, 'dist.npy'))
    labels = np.load(os.path.join(work, 'labels.npy'))
    paper = cv2.imread(os.path.join(work, 'paper.png')).astype(np.float32)
    layer_dir = os.path.join(dest, 'scene')
    os.makedirs(layer_dir, exist_ok=True)

    moving = np.zeros((H, W), np.uint8)
    claimed = np.zeros((H, W), np.uint8)
    layers = []
    for L in cfg['layers']:
        if 'rect' in L:
            x, y, w, h = L['rect']
            box = np.zeros((H, W), np.uint8)
            box[y:y + h, x:x + w] = 1
            # 纸纹离纸色都在 7 以内，8 以上就是画上去的东西，淡线也抓得到
            m = ((dist > 8) & (box > 0) & (claimed == 0)).astype(np.uint8)
            m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))) & (1 - claimed)
        else:
            m = np.isin(labels, L['ids']).astype(np.uint8)
            m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
        claimed |= m
        m = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 2.0)
        # 离纸色越远越不透明；水彩的淡边保留成半透明
        a = np.clip((dist - 5.0) / 32.0, 0, 1) ** 0.85 * np.clip(m * 1.4, 0, 1)
        ys, xs = np.where(m > 0.02)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        if L.get('fade_bottom'):
            a = a * np.clip((y1 - np.arange(H)) / float(L['fade_bottom']), 0, 1)[:, None]
        A = a[y0:y1, x0:x1]
        C = im[y0:y1, x0:x1].astype(np.float32)
        P = paper[y0:y1, x0:x1]
        # 反预乘：从「颜料 × 透明度 + 纸」还原出颜料本身的颜色，叠回任何底色都不会发灰
        F = np.clip((C - (1 - A[..., None]) * P) / np.maximum(A, 0.02)[..., None], 0, 255)
        F = np.where(A[..., None] > 0.02, F, C)
        rgba = np.dstack([F[..., ::-1], A * 255]).astype(np.uint8)
        Image.fromarray(rgba, 'RGBA').save(os.path.join(layer_dir, f"{L['name']}.webp"), quality=88, method=6)

        out = {'src': f"scene/{L['name']}.webp", 'box': [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
               'motion': L.get('motion', 'none')}
        for k in ('speed', 'origin'):
            if k in L:
                out[k] = L[k]
        out['wide'] = L.get('wide', True)
        if 'tall' in L:
            out['tall'] = L['tall']
        layers.append(out)
        if out['wide']:
            moving |= (m > 0.02).astype(np.uint8)

    # 底图：把横式画面里会动的元素补掉（纸面平滑，inpaint 很干净）
    hole = cv2.dilate(moving, np.ones((9, 9), np.uint8)) * 255
    plate = cv2.inpaint(im, hole, 11, cv2.INPAINT_TELEA)
    Image.fromarray(plate[..., ::-1]).save(os.path.join(layer_dir, 'plate.webp'), quality=84, method=6)

    spec = {'size': [W, H], 'plate': 'scene/plate.webp', 'layers': layers}
    with open(os.path.join(dest, 'scene.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(spec, ensure_ascii=False, indent=1))
    total = sum(os.path.getsize(os.path.join(layer_dir, x)) for x in os.listdir(layer_dir))
    print(f"{len(layers)} 个图层 + 底图，共 {total // 1024} KB → {dest}/scene.json")
    make_night(dest)


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'analyze':
        analyze(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 5 and sys.argv[1] == 'build':
        build(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) == 3 and sys.argv[1] == 'night':
        make_night(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)
