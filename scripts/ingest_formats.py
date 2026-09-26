#!/usr/bin/env python3
"""
录题收件：把 drafts/ 里各种格式的档案，转成 Gemini 看得懂的 parts
---------------------------------------------------------------------
以前只收照片，丢进 Word 档会被静默跳过（工作流还显示「成功」）。现在：

  照片 jpg/png/webp/heic、PDF  → 原档直接交给 Gemini（它本来就会看）
  Word .docx、PowerPoint .pptx → 抽出文字、表格与内嵌图片；
                                 萤光、底线、彩色字会用「[标记:…]…[/标记]」保留下来，
                                 很多老师用萤光笔标答案（eclass 生物题就是 25 题 25 个黄色萤光）
  纯文字 .txt/.md              → 直接读
  其他（.doc .ppt .xls .pages…）→ 丢 Unsupported，报告里写清楚要另存成什么

只用标准库，GitHub Actions 上不必另外装东西。
"""

import base64
import mimetypes
import os
import re
import zipfile
import xml.etree.ElementTree as ET

IMAGE_EXT = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
             ".heic": "image/heic", ".heif": "image/heif"}
TEXT_EXT = {".txt", ".md"}
PDF_INLINE_LIMIT = 18 * 1024 * 1024   # Gemini inline 请求上限约 20MB
OLD_OFFICE = {".doc": "Word", ".ppt": "PowerPoint", ".xls": "Excel", ".xlsx": "Excel"}

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
W = "{%s}" % NS["w"]


# 文字类来源的开头；录题脚本认这个字串，知道这份有原文可以逐字比对
SOURCE_HEADER = "【原档内容】\n"


class Unsupported(Exception):
    """这个档案读不了；讯息会原样写进报告，告诉管理员怎么处理。"""


def _inline(mime, data):
    return {"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode("ascii")}}


def _rels(z, rels_path):
    """rId → 压缩档里的路径"""
    if rels_path not in z.namelist():
        return {}
    base = os.path.dirname(os.path.dirname(rels_path))
    out = {}
    for rel in ET.fromstring(z.read(rels_path)).findall("rel:Relationship", NS):
        target = rel.get("Target", "")
        out[rel.get("Id")] = os.path.normpath(os.path.join(base, target)).replace("\\", "/")
    return out


class _Figures:
    """内嵌图片：文字里放 [图N]，图片本身依序接在 parts 後面"""

    def __init__(self, z):
        self.z = z
        self.items = []      # (编号, 压缩档路径)
        self.by_path = {}

    def ref(self, path):
        if path not in self.by_path:
            self.by_path[path] = len(self.items) + 1
            self.items.append((self.by_path[path], path))
        return f"[图{self.by_path[path]}]"

    def parts(self, notes):
        out = []
        for n, path in self.items:
            mime = mimetypes.guess_type(path)[0] or ""
            if not mime.startswith("image/") or mime in ("image/x-emf", "image/x-wmf", "image/emf", "image/wmf"):
                notes.append(f"图{n}（{os.path.basename(path)}）是 AI 看不懂的格式，含这张图的题请人工补图")
                continue
            out.append({"text": f"[图{n}] 如下："})
            out.append(_inline(mime, self.z.read(path)))
        return out

    def media(self):
        """编号 → (副档名, bytes)，给录题脚本把配图存进 images/"""
        return {n: (os.path.splitext(p)[1].lower(), self.z.read(p)) for n, p in self.items}


# ---------- Word ----------

def _run_marks(rpr):
    """萤光、底线、彩色字：老师常用来标答案。粗体太常拿来当标题，不算"""
    marks = []
    if rpr is None:
        return marks
    hl = rpr.find("w:highlight", NS)
    if hl is not None and hl.get(W + "val", "none") != "none":
        marks.append("萤光")
    shd = rpr.find("w:shd", NS)
    if shd is not None and shd.get(W + "fill", "auto").lower() not in ("auto", "ffffff", "000000", ""):
        marks.append("底色")
    u = rpr.find("w:u", NS)
    if u is not None and u.get(W + "val", "single") != "none":
        marks.append("底线")
    color = rpr.find("w:color", NS)
    if color is not None and color.get(W + "val", "auto").lower() not in ("auto", "000000"):
        marks.append("彩色字")
    return marks


MC_FALLBACK = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback"
M = "{%s}" % NS["m"]
SUP = str.maketrans("0123456789+-−=()n", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾ⁿ")
SUB = str.maketrans("0123456789+-=()", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎")


def _script(text, table, mark):
    """上下标：能换成 Unicode 上下标字就换（3×10⁸、H₂O），换不了才写成 ^(…)/_(…)。
    以前直接压平，3×10⁸ 会变成 3×108，物理化学题整题就错了"""
    if not text:
        return ""
    out = text.translate(table)
    return out if all(ord(c) > 127 or c.isspace() for c in out) else f"{mark}({text})"


def _omml(node):
    """Word 公式转成看得懂的文字：分数 a/b、上下标、根号。以前把字接在一起，3/32 会变成 332"""
    tag = node.tag
    kids = lambda name: node.find(M + name)
    text = lambda n: _omml(n) if n is not None else ""
    if tag == M + "t":
        return node.text or ""
    if tag == M + "f":
        num, den = text(kids("num")), text(kids("den"))
        wrap = lambda t: t if len(t) <= 1 or t.isalnum() else f"({t})"
        return f"{wrap(num)}/{wrap(den)}"
    if tag == M + "sSup":
        return text(kids("e")) + _script(text(kids("sup")), SUP, "^")
    if tag == M + "sSub":
        return text(kids("e")) + _script(text(kids("sub")), SUB, "_")
    if tag == M + "sSubSup":
        return text(kids("e")) + _script(text(kids("sub")), SUB, "_") + _script(text(kids("sup")), SUP, "^")
    if tag == M + "rad":
        deg = text(kids("deg"))
        return (_script(deg, SUP, "^") if deg else "") + f"√({text(kids('e'))})"
    if tag == M + "d":
        pr = node.find(M + "dPr")
        beg = pr.find(M + "begChr") if pr is not None else None
        end = pr.find(M + "endChr") if pr is not None else None
        inner = "".join(text(e) for e in node.findall(M + "e"))
        return (beg.get(M + "val") if beg is not None else "(") + inner + (end.get(M + "val") if end is not None else ")")
    if tag.endswith("Pr"):
        return ""
    return "".join(_omml(c) for c in node)


def _blips(node):
    """这个 run 自己的图（不含文字框里别的 run 的图、不含 Fallback 那份重复的）"""
    for child in node:
        if child.tag in (MC_FALLBACK, W + "txbxContent"):
            continue
        if child.tag == "{%s}blip" % NS["a"]:
            yield child
        yield from _blips(child)


def _docx_walk(node, pieces, rels, figs):
    for child in node:
        tag = child.tag
        if tag == MC_FALLBACK:
            continue             # 文字框在 Choice 与 Fallback 各存一份，只读一份，不然每句都重复
        if tag == W + "r":
            rpr = child.find("w:rPr", NS)
            marks = tuple(_run_marks(rpr))
            va = rpr.find("w:vertAlign", NS) if rpr is not None else None
            va = va.get(W + "val") if va is not None else ""
            buf = ""
            for sub in child:
                if sub.tag == W + "t":
                    t = sub.text or ""
                    buf += _script(t, SUP, "^") if va == "superscript" else _script(t, SUB, "_") if va == "subscript" else t
                elif sub.tag == W + "tab":
                    buf += "\t"
                elif sub.tag in (W + "br", W + "cr"):
                    buf += "\n"
            for blip in _blips(child):
                rid = blip.get("{%s}embed" % NS["r"])
                if rid in rels:
                    buf += figs.ref(rels[rid])
            if buf:
                pieces.append((marks, buf))
            _docx_walk(child, pieces, rels, figs)   # 文字框里的段落
        elif tag in (M + "oMath",):
            math = _omml(child)
            if math:
                pieces.append(((), math))
        elif tag not in (W + "t", W + "rPr", W + "pPr"):
            _docx_walk(child, pieces, rels, figs)


def _docx_paragraph(p, rels, figs):
    pieces = []          # (marks tuple, text)
    _docx_walk(p, pieces, rels, figs)
    # 相邻、标记相同的片段合并，标记只包一次
    out, cur_marks, cur = [], None, ""
    for marks, text in pieces + [(None, "")]:
        if marks == cur_marks:
            cur += text
            continue
        if cur:
            out.append(f"[标记:{'、'.join(cur_marks)}]{cur}[/标记]" if cur_marks else cur)
        cur_marks, cur = marks, text
    return "".join(out)


def _docx_block_text(el, rels, figs):
    if el.tag == W + "p":
        return _docx_paragraph(el, rels, figs)
    if el.tag == W + "tbl":
        rows = []
        for tr in el.findall("w:tr", NS):
            cells = []
            for tc in tr.findall("w:tc", NS):
                # 储存格里还可能再套一层表格（eclass 的题目就是这样排的），逐块递回
                cells.append("\n".join(t for t in (_docx_block_text(b, rels, figs) for b in tc) if t.strip()))
            rows.append(" | ".join(cells))
        return "\n".join(rows)
    return ""


def read_docx(path, notes):
    try:
        z = zipfile.ZipFile(path)
        body = ET.fromstring(z.read("word/document.xml")).find("w:body", NS)
    except (zipfile.BadZipFile, KeyError, ET.ParseError):
        raise Unsupported("Word 档打不开（可能损坏或是加密的），请在 Word 里重新另存为 .docx")
    rels = _rels(z, "word/_rels/document.xml.rels")
    figs = _Figures(z)
    lines = [t for t in (_docx_block_text(el, rels, figs) for el in body) if t.strip()]
    text = "\n".join(lines)
    if not text.strip() and not figs.items:
        raise Unsupported("Word 档里没有读到任何文字或图片")
    return text, figs


# ---------- PowerPoint ----------

def read_pptx(path, notes):
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise Unsupported("PowerPoint 档打不开，请重新另存为 .pptx")
    slides = sorted((n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
                    key=lambda n: int(re.search(r"(\d+)", os.path.basename(n)).group(1)))
    figs = _Figures(z)
    blocks = []
    for i, name in enumerate(slides, 1):
        rels = _rels(z, f"ppt/slides/_rels/{os.path.basename(name)}.rels")
        root = ET.fromstring(z.read(name))
        paras = []
        for para in root.iter("{%s}p" % NS["a"]):
            t = "".join(x.text or "" for x in para.iter("{%s}t" % NS["a"]))
            if t.strip():
                paras.append(t)
        for blip in root.iter("{%s}blip" % NS["a"]):
            rid = blip.get("{%s}embed" % NS["r"])
            if rid in rels:
                paras.append(figs.ref(rels[rid]))
        if paras:
            blocks.append(f"—— 第 {i} 页 ——\n" + "\n".join(paras))
    if not blocks:
        raise Unsupported("PowerPoint 里没有读到任何文字或图片")
    return "\n\n".join(blocks), figs


# ---------- 入口 ----------

def to_parts(path):
    """回传 (parts, notes, media)：
    parts 接在提示词後面交给 Gemini；notes 是要写进报告的提醒；
    media 是 {图编号: (副档名, bytes)}，照片来源则是 {0: 整张原图}"""
    ext = os.path.splitext(path)[1].lower()
    notes = []

    if ext in IMAGE_EXT:
        with open(path, "rb") as f:
            data = f.read()
        return [_inline(IMAGE_EXT[ext], data)], notes, {0: (ext, data)}

    if ext == ".pdf":
        size = os.path.getsize(path)
        if size > PDF_INLINE_LIMIT:
            raise Unsupported(f"PDF 有 {size // (1024 * 1024)}MB，超过 18MB 上限，请拆成几份再上传")
        with open(path, "rb") as f:
            return [_inline("application/pdf", f.read())], notes, {}

    if ext in TEXT_EXT:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
        if not text.strip():
            raise Unsupported("文字档是空的")
        return [{"text": SOURCE_HEADER + text}], notes, {}

    if ext in (".docx", ".pptx"):
        text, figs = (read_docx if ext == ".docx" else read_pptx)(path, notes)
        parts = [{"text": SOURCE_HEADER + text}] + figs.parts(notes)
        return parts, notes, figs.media()

    if ext in OLD_OFFICE:
        kind = OLD_OFFICE[ext]
        target = ".docx" if kind == "Word" else ".pptx" if kind == "PowerPoint" else ".pdf"
        raise Unsupported(f"{ext} 是{'旧版 ' if ext != '.xlsx' else ''}{kind} 格式，请另存为 {target} 再上传")
    raise Unsupported(f"不支持 {ext or '没有副档名'} 的档案；可用：照片、PDF、.docx、.pptx、.txt")
