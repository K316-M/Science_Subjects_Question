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

照片与 PDF 的配图：请 Gemini 回报图在第几页、哪个位置，再用 crop_figure 裁出来。
这一步要 Pillow（照片）与 pypdfium2（PDF 转图），工作流会装；本机没装就退回旧做法（照片存整张、PDF 请人工补图）。
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


VML_IMAGE = "{urn:schemas-microsoft-com:vml}imagedata"


def _blips(node):
    """这个 run 自己的图（不含文字框里别的 run 的图、不含 Fallback 那份重复的）。
    旧版 .doc 另存的 .docx 图片常是 VML 的 v:imagedata，不是 a:blip，两种都要收"""
    for child in node:
        if child.tag in (MC_FALLBACK, W + "txbxContent"):
            continue
        if child.tag in ("{%s}blip" % NS["a"], VML_IMAGE):
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
                rid = blip.get("{%s}embed" % NS["r"]) or blip.get("{%s}id" % NS["r"])
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
    return _join_marked(pieces)


def _join_marked(pieces):
    """(标记, 文字) 片段接起来：相邻、标记相同的合并，标记只包一次"""
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

def _pptx_marks(rpr):
    """PPT 里老师标答案：萤光、底线、指定颜色的字（跟随主题色的不算，整页都是那个颜色）"""
    marks = []
    if rpr is None:
        return marks
    if rpr.find("a:highlight", NS) is not None:
        marks.append("萤光")
    if rpr.get("u", "none") != "none":
        marks.append("底线")
    color = rpr.find("a:solidFill/a:srgbClr", NS)
    if color is not None and color.get("val", "").upper() not in ("000000", "FFFFFF"):
        marks.append("彩色字")
    return marks


def _pptx_paragraph(para):
    pieces = []
    for run in para:
        if run.tag not in ("{%s}r" % NS["a"], "{%s}fld" % NS["a"]):
            continue
        rpr = run.find("a:rPr", NS)
        t = "".join(x.text or "" for x in run.findall("a:t", NS))
        base = int(rpr.get("baseline", "0")) if rpr is not None else 0
        if base > 0:
            t = _script(t, SUP, "^")
        elif base < 0:
            t = _script(t, SUB, "_")
        if t:
            pieces.append((tuple(_pptx_marks(rpr)), t))
    return _join_marked(pieces)


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
            t = _pptx_paragraph(para)
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


# ---------- 照片与 PDF 的配图裁切 ----------

def _upright_photo(path):
    """手机照片常只在 EXIF 里记「要转 90 度」。先真的转正、缩到长边 3000px 再用，
    Gemini 看到的方向与裁图时的方向才一致。没装 Pillow 或读不了（例如 HEIC）就回 None"""
    try:
        import io
        from PIL import Image, ImageOps
        img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    except Exception:
        return None
    img.thumbnail((3000, 3000))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def crop_figure(path, page, box, photo=None):
    """box 是 Gemini 回报的 [ymin, xmin, ymax, xmax]（0–1000 的相对座标）。
    照片直接裁（photo 是 to_parts 转正後的图）；PDF 先把那一页转成图再裁。
    回传 (副档名, bytes)；缺套件、座标不合理、裁出来太小都回 None，交给人工"""
    try:
        import io
        from PIL import Image
        y0, x0, y1, x1 = [float(v) / 1000 for v in box]
    except Exception:
        return None
    if not (0 <= y0 < y1 <= 1 and 0 <= x0 < x1 <= 1) or (y1 - y0) * (x1 - x0) < 0.01:
        return None
    try:
        if photo is not None:
            img = Image.open(io.BytesIO(photo))
        else:
            import pypdfium2
            doc = pypdfium2.PdfDocument(path)
            if not 1 <= int(page) <= len(doc):
                return None
            img = doc[int(page) - 1].render(scale=2.5).to_pil()
    except Exception:
        return None
    w, h = img.size
    pad = 0.02                      # 四周多留一点，免得切到图边的标号
    crop = img.convert("RGB").crop((int(max(0, x0 - pad) * w), int(max(0, y0 - pad) * h),
                                    int(min(1, x1 + pad) * w), int(min(1, y1 + pad) * h)))
    buf = io.BytesIO()
    crop.save(buf, "PNG", optimize=True)
    return ".png", buf.getvalue()


# ---------- 入口 ----------

def to_parts(path):
    """回传 (parts, notes, media)：
    parts 接在提示词後面交给 Gemini；notes 是要写进报告的提醒；
    media 是 {图编号: (副档名, bytes)}，照片来源则是 {0: 整张原图}"""
    ext = os.path.splitext(path)[1].lower()
    notes = []

    if ext in IMAGE_EXT:
        upright = _upright_photo(path)
        if upright:
            # 送给 Gemini 与之後裁图用的是同一张转正的图，框出来的位置才对得上
            return [_inline("image/jpeg", upright)], notes, {0: (".jpg", upright)}
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
