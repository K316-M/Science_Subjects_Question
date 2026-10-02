#!/usr/bin/env python3
"""
老师的教学 PPT → 出题 AI 看的讲义（syllabus/<科目>-notes/<章节id>.md）
------------------------------------------------------------------------
文字照「播放时出现的顺序」排：一进页面就有的（由上到下、由左到右）→ 第 1 次点击 → 第 2 次点击…
下标、上标还原成 H₂O、SO₄²⁻；箭头上方的反应条件写成［高温］。
拿掉：图片、课本页码（「观察思考pg213」）、重复的标题、只有答案没有题目的段落
（「选择题」「作答题」「补充练习」那几页，一直到下一个正常标题为止）；「问题解决」「思考题」留着。
图里的字、用线条画的箭头读不到。

每份 PPT 照档名的「第N章」对到题库那一章（老师照课本编号，化学课本第一章是绪论、题库没有，所以差 1，见 CHAPTER_OFFSET）；
档名没有章号的，照章名找题库里最像的那一章。会印出对照表，对错了改 CHAPTER_OVERRIDE。

  python3 scripts/ppt_notes.py chemistry source/*.pptx

只用 Python 内建模组，不必另外安装。PPT 改了、加了新的就重跑；产出的档案别手改（会被盖掉），
要补充或更正写在 syllabus/<科目>-focus.md。
"""
import collections
import json
import os
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'm': 'http://schemas.openxmlformats.org/officeDocument/2006/math',
    'dgm': 'http://schemas.openxmlformats.org/drawingml/2006/diagram',
    'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
}
A = lambda t: f"{{{NS['a']}}}{t}"
P = lambda t: f"{{{NS['p']}}}{t}"
R = lambda t: f"{{{NS['r']}}}{t}"

# 档名对不到、或对错章的，在这里直接指定：{"档名（不含 .pptx）": "章节id"}；写 None 表示不要这份
CHAPTER_OVERRIDE = {
    "第一章 绪论": None,              # 题库没有绪论这一章
    "第30章 芳香烃_精简版": None,     # 只有 4 页，内容都在「第30章 芳香烃 2025」里
    # 下面五份是习题答案讲解（「1.) A」「4. C」），题目不在里面，AI 看不懂在答什么；易错点已整理进 focus.md
    "第二章 水和氢": None,
    "第三章 原子与分子": None,
    "第四章 化学方程式与化学计算": None,
    "第五章 原子结构": None,
    "第12章 IVA族元素 碳和硅练习题": None,
}
# 老师的章号比题库的多几：化学课本第一章是「绪论」，题库没有这一章
CHAPTER_OFFSET = {"chemistry": 1}
# 只有答案、没有题目的段落从这种标题开始（问题解决、思考题不算）
EXERCISE_TITLE = re.compile(r"(选择题|作答题|补充练习|总练习|旧课本练习|练习)\S*")
NOTES_DIR = os.path.join("syllabus", "{subject}-notes")

SUB = str.maketrans('0123456789+-−=()n', '₀₁₂₃₄₅₆₇₈₉₊₋₋₌₍₎ₙ')
SUP = str.maketrans('0123456789+-−=()n', '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾ⁿ')
SCRIPT_CHARS = re.compile(r"[\d+\-−=()n ]+")
# Wingdings／Symbol 字型的箭头、符号，PowerPoint 存成私用区字元
PUA = {0xF0E0: '→', 0xF0DF: '←', 0xF0E1: '↑', 0xF0E2: '↓', 0xF0E8: '⇒', 0xF0F0: '⇨', 0xF0AE: '→', 0xF0AC: '←',
       0xF0AD: '↑', 0xF0AF: '↓', 0xF0DB: '⇔', 0xF0AB: '↔', 0xF0D8: '➢', 0xF06C: '●', 0xF06E: '■', 0xF0FC: '✓',
       0xF0B1: '±', 0xF0BB: '≈', 0xF0B3: '≥', 0xF0A3: '≤', 0xF0B9: '≠', 0xF044: 'Δ', 0xF0A5: '∞', 0xF0B0: '°'}


def run_text(run):
    t = ''.join(x.text or '' for x in run.iter(A('t')))
    t = ''.join(PUA.get(ord(c), '') if 0xF000 <= ord(c) <= 0xF0FF else c for c in t)
    rpr = run.find(A('rPr'))
    base = int(rpr.get('baseline', '0')) if rpr is not None else 0
    if not t.strip() or base == 0:
        return t
    core, tail = t.rstrip(), t[len(t.rstrip()):]   # 上标後面常跟著 Tab，当成空白
    core = core.replace('–', '-')                    # 电荷常打成 en dash（SO₄²–）
    if SCRIPT_CHARS.fullmatch(core):
        return core.translate(SUB if base < 0 else SUP) + tail
    if base < 0:
        return f'_{core}' + tail
    if re.search(r'[\u4e00-\u9fff]', core):           # 箭头上方的反应条件：［高温］［催化剂］
        return f'［{core.strip()}］' + tail
    if core.strip() in ('o', 'O', '0'):                 # 标准状态：E°、ΔH°
        return '°' + tail
    if core.strip() in ("'", '’'):
        return '′' + tail
    return f'^({core.strip()})' + tail                  # 其他上标当次方：[A]^(x)、(1/2)^(t/T)


def para_text(p):
    parts = []
    for ch in p:
        if ch.tag == A('r'):
            parts.append(run_text(ch))
        elif ch.tag == A('br'):
            parts.append(' / ')
        elif ch.tag == A('fld'):
            parts.append(''.join(x.text or '' for x in ch.iter(A('t'))))
        else:   # 公式（OMML）
            ms = [x.text or '' for x in ch.iter(f"{{{NS['m']}}}t")]
            if ms:
                parts.append(''.join(ms))
    return re.sub(r'[ \t　]+', ' ', ''.join(parts)).strip()


def position(el):
    off = el.find(f".//{A('off')}") if el is not None else None
    return (int(off.get('y')), int(off.get('x'))) if off is not None else (10 ** 12, 10 ** 12)


def collect(tree, rels, zf, base, out, group_pos=None, groups=()):
    """图形清单：[id, 位置, 段落文字, 种类, 所在的组]。组里的图形用整组的位置；整组被设动画时组内一起出现"""
    for el in tree:
        if el.tag in (P('sp'), P('cxnSp')):
            c = el.find(f".//{P('cNvPr')}")
            ph = el.find(f".//{P('ph')}")
            tb = el.find(P('txBody'))
            paras = [para_text(p) for p in tb.findall(A('p'))] if tb is not None else []
            kind = 'title' if ph is not None and ph.get('type') in ('title', 'ctrTitle') else 'text'
            out.append([c.get('id'), group_pos or position(el), paras, kind, groups])
        elif el.tag == P('grpSp'):
            c = el.find(f"{P('nvGrpSpPr')}/{P('cNvPr')}")
            gpos = group_pos or position(el.find(P('grpSpPr')))
            inner = []
            collect(el, rels, zf, base, inner, gpos, groups + (c.get('id'),))
            out.append([c.get('id'), gpos, [t for s in inner if s[3] != 'group' for t in s[2]], 'group', groups])
            out.extend(inner)
        elif el.tag == P('graphicFrame'):
            c = el.find(f".//{P('cNvPr')}")
            paras = []
            tbl = el.find(f".//{A('tbl')}")
            if tbl is not None:
                for tr in tbl.findall(A('tr')):
                    paras.append(' | '.join(' '.join(para_text(p) for p in tc.iter(A('p'))).strip() for tc in tr.findall(A('tc'))))
            dm = el.find(f".//{{{NS['dgm']}}}relIds")
            if dm is not None and rels.get(dm.get(R('dm'))):   # SmartArt 的文字在 diagrams/data*.xml
                d = ET.fromstring(zf.read(posixpath.normpath(posixpath.join(base, rels[dm.get(R('dm'))]))))
                paras += [t for pt in d.iter(f"{{{NS['dgm']}}}pt") for t in (para_text(p) for p in pt.iter(A('p'))) if t]
            out.append([c.get('id'), group_pos or position(el), paras, 'frame', groups])
        elif el.tag == f"{{{NS['mc']}}}AlternateContent":
            choice = el.find(f"{{{NS['mc']}}}Choice")
            if choice is not None:
                collect(choice, rels, zf, base, out, group_pos, groups)


def entrances(sld):
    """主动画序列里的进场：[(第几次点击, 图形id, 段落范围或 None)]；另回传「点某物件才出现」的"""
    steps, triggered, click = [], [], 0
    timing = sld.find(P('timing'))
    if timing is None:
        return steps, triggered
    for seq in timing.iter(P('seq')):
        top = seq.find(P('cTn'))
        main = top is not None and top.get('nodeType') == 'mainSeq'
        for c in seq.iter(P('cTn')):
            cls = c.get('presetClass')
            tgt = c.find(f".//{P('spTgt')}")
            if not cls or tgt is None:
                continue
            rg = tgt.find(f".//{P('pRg')}")
            span = (int(rg.get('st')), int(rg.get('end'))) if rg is not None else None
            if main and c.get('nodeType') == 'clickEffect':
                click += 1
            if cls == 'entr':
                (steps if main else triggered).append((click, tgt.get('spid'), span))
    return steps, triggered


def rels_of(zf, path):
    rp = posixpath.join(posixpath.dirname(path), '_rels', posixpath.basename(path) + '.rels')
    if rp not in zf.namelist():
        return {}
    return {e.get('Id'): e.get('Target') for e in ET.fromstring(zf.read(rp))}


def read_slides(path):
    """每页：(标题, [照出现顺序排的文字])。隐藏的页不算"""
    zf = zipfile.ZipFile(path)
    pres = ET.fromstring(zf.read('ppt/presentation.xml'))
    prels = rels_of(zf, 'ppt/presentation.xml')
    slides = []
    for s in pres.iter(P('sldId')):
        sp = posixpath.normpath(posixpath.join('ppt', prels[s.get(R('id'))]))
        x = ET.fromstring(zf.read(sp))
        if s.get('show') == '0' or x.get('show') == '0':
            continue
        shapes = []
        collect(x.find(f"{P('cSld')}/{P('spTree')}"), rels_of(zf, sp), zf, posixpath.dirname(sp), shapes)
        by_id = {s[0]: s for s in shapes}
        steps, triggered = entrances(x)
        hidden, hidden_para = set(), collections.defaultdict(set)
        for _, sid, span in steps + triggered:
            if span is None:
                hidden.add(sid)
            else:
                hidden_para[sid].update(range(span[0], span[1] + 1))
        # 整组进场时，组里的图形跟着组出现，不算「一开始就有」
        title, lines = None, []
        statics = sorted((s for s in shapes if s[0] not in hidden and s[3] != 'group' and not hidden.intersection(s[4])),
                         key=lambda s: (s[3] != 'title', s[1]))
        for sid, _, paras, kind, _ in statics:
            for i, t in enumerate(paras):
                if not t or i in hidden_para.get(sid, ()):
                    continue
                if kind == 'title' and title is None:
                    title = t.replace(' / ', ' ')
                else:
                    lines.append(t)
        seen = set()
        for _, sid, span in sorted(steps, key=lambda s: s[0]) + triggered:
            if sid not in by_id or (sid, span) in seen or hidden.intersection(by_id[sid][4]):
                continue   # 组里的图形另外设了动画：整组进场时已经算过
            seen.add((sid, span))
            paras = by_id[sid][2]
            lines += [t for t in (paras if span is None else paras[span[0]:span[1] + 1]) if t]
        slides.append((title, lines))
    return slides


def to_notes(slides):
    """拿掉只有答案的段落、课本页码、重复标题；回传讲义文字"""
    out, last_title, skipping = [], None, False
    answer_only = re.compile(r"(\d+\s*[.)、．]+\s*\)?\s*)?[A-D](\s*[,，、]?\s*[IVX]+([,，、]\s*[IVX]+)*)?")   # 「4.) C I, IV」「B」
    page_ref = re.compile(r"\S{0,8}\s*pg\s*\d+", re.I)                                                     # 「观察思考pg213」
    for title, lines in slides:
        head = title or (lines[0] if lines else '')
        if EXERCISE_TITLE.fullmatch(head.strip()):
            skipping = True
            continue
        if title:
            skipping = False
        if skipping:
            continue
        if title and title != last_title:
            out.append(f"\n### {title}")
            last_title = title
        for t in lines:
            if not (answer_only.fullmatch(t) or page_ref.fullmatch(t)):
                out.append(t)
    return '\n'.join(out).strip()


def bank_titles(subject):
    with open(os.path.join('papers', f'{subject}_question_bank.json'), encoding='utf-8') as f:
        return {s['id']: s['title'] for s in json.load(f)['sections']}


def core(title):
    """去掉「第X章」「：」「IIA族元素」这类字，只留拿来比对的章名"""
    t = re.sub(r"第\s*[\d一二三四五六七八九十]+\s*章[：:]?", "", title)
    t = re.sub(r"[IVX]+A族元素|[（(]加[)）]|\d{4}|[\s：:、，/]", "", t)
    return t


def common_len(a, b):
    best = 0
    for i in range(len(a)):
        for j in range(i + best + 1, len(a) + 1):
            if a[i:j] in b:
                best = j - i
            else:
                break
    return best


CN_DIGITS = {c: i for i, c in enumerate('零一二三四五六七八九')}


def chapter_number(name):
    m = re.search(r"第\s*(\d+|[一二三四五六七八九十]+)\s*章", name)
    if not m:
        return None
    n = m.group(1)
    if n.isdigit():
        return int(n)
    tens, _, ones = n.rpartition('十')
    return (CN_DIGITS.get(tens, 1) * 10 if '十' in n else 0) + CN_DIGITS.get(ones, 0)


def match_chapter(subject, name, first_title, chapters):
    if name in CHAPTER_OVERRIDE:
        return CHAPTER_OVERRIDE[name], 'CHAPTER_OVERRIDE 指定'
    n = chapter_number(name)
    if n is not None:
        cid = f"chap{n - CHAPTER_OFFSET.get(subject, 0)}"
        return (cid, f'章号 {n}') if cid in chapters else (None, f'题库没有 {cid}')
    probe = core(name) + core(first_title or '')
    scored = sorted(((common_len(core(t), probe), cid) for cid, t in chapters.items()), reverse=True)
    if not scored or scored[0][0] < 2 or (len(scored) > 1 and scored[0][0] == scored[1][0]):
        return None, f'对不到（{scored[:2]}）'
    return scored[0][1], f'比对「{core(chapters[scored[0][1]])}」'


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    subject, files = sys.argv[1], sorted(sys.argv[2:])
    chapters = bank_titles(subject)
    outdir = NOTES_DIR.format(subject=subject)
    os.makedirs(outdir, exist_ok=True)
    used = {}
    for path in files:
        name = re.sub(r'\s+', ' ', os.path.splitext(os.path.basename(path))[0]).strip()
        slides = read_slides(path)
        cid, why = match_chapter(subject, name, slides[0][0] if slides else '', chapters)
        if not cid:
            print(f"⏭️  {name}：{why}")
            continue
        if cid in used:
            sys.exit(f"❌ {name} 和 {used[cid]} 都对到 {cid}（{chapters[cid]}），请在 CHAPTER_OVERRIDE 指定")
        used[cid] = name
        notes = to_notes(slides)
        target = os.path.join(outdir, f"{cid}.md")
        header = (f"<!-- 自动产生：scripts/ppt_notes.py 从 source/{os.path.basename(path)} 整理。"
                  f"PPT 改了就重跑，别直接改这份；补充、更正写在 syllabus/{subject}-focus.md -->\n"
                  f"# {chapters[cid]}（老师讲义：{name}）\n")
        with open(target, 'w', encoding='utf-8') as f:
            f.write(header + notes + '\n')
        print(f"✅ {name:26s} → {cid:7s} {chapters[cid]:18s} {len(notes):6d} 字（{why}）")
    missing = [f"{cid} {t}" for cid, t in chapters.items() if not os.path.exists(os.path.join(outdir, f"{cid}.md"))]
    if missing:
        print("没有讲义的章节：", '、'.join(missing))


if __name__ == '__main__':
    main()
