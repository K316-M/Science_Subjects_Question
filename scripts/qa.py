#!/usr/bin/env python3
"""
审题：录题与出题共用的自动检查
------------------------------
每一项检查不通过，就往题目的 flags 里加一句说明。/dev 只把「有 flags」的题展开给你看、
让你改；flags 是空的题收在「一键采纳」清单里。所以这里的检查漏掉什么，你就少看到什么 ——
宁可多标，不要少标。

  1. text_problems   题干/选项夹英文虚词（「甘油 and 脂肪酸」）、残留转写标记、题号没去掉、
                     公式的反斜线少写（控制字元）、$ 没成对、$ 外面的 LaTeX 指令、AI 在解析里自言自语
  2. source_drift    Word/PPT/文字档：题干与选项要能在原档里一字不差找到，
                     AI 改字、加字、漏字（例如漏掉「不」）都标出来，并写出原档与录入的差异
  3. cross_check     请 Gemini 在看不到答案的情况下重做一次选择题，和已有答案比对
"""

import difflib
import json
import re
import unicodedata

import gemini_api

SUBJECT_LABEL = {"biology": "生物", "chemistry": "化学", "physics": "物理", "math": "高级数学"}
LETTERS = "ABCD"

CJK = re.compile(r"[一-鿿]")
ENGLISH_FILLER = re.compile(r"(?<![A-Za-z])(and|or|the|of|is|are|not|which|with|what)(?![A-Za-z])", re.I)
LEFTOVER_MARK = re.compile(r"\[/?标记[^\]]*\]|\[图\d+\]")
LEADING_NUMBER = re.compile(r"^\s*(\d{1,3}|[（(]\d{1,3}[)）])\s*[.．、)]")
# 同一行里先有「I 叙述」再有「II」：罗马数字叙述没有各占一行（物理的电流 I 不会接著出现 II）
ROMAN_ONE_LINE = re.compile(r"(?<![A-Za-z])I\s+\S.*?\sII(?![A-Za-z])")
MATH_SPAN = re.compile(r"\$[^$]*\$")
CONTROL_CHAR = re.compile(r"[\x08\x0c\t\r]")   # 公式的反斜线少写一个时，\b \f \t \r 会变成这些
RAW_LATEX = re.compile(r"\\[A-Za-z]+")          # $ 外面的 \sqrt、\gamma：网站只排 $ 里面的，外面的原样显示成程式码
# AI 出题／写解析时算到一半发现不对、自己改口留下的话。2026-09 那批：有这些字的题全都要改或退
# （答案错、题目改到一半、选项对不上），而「答案有疑」反而多半是误报
SELF_TALK = re.compile(r"等等|哎呀|重新(计算|分析|审题|核对|核算|检查)|让我们?(重新|检查|核对|修正)|"
                       r"修正选项|与选项不符|若题目改为|重写(此|这)题|慢，检查")
# 该写成上下标却写成一般数字的（学生站就显示 H2O、Fe3+、v0、m/s2）。数学用 LaTeX，不查；$…$ 里面也不查。
# 不用 (?<!…)：dev/dev.js 有一份一样的，旧版 iPhone Safari 不认。第 2 组是要标出来的字
_ELEM = r"(?:[A-Z][a-z]?[0-9]*|\((?:[A-Z][a-z]?[0-9]*)+\)[0-9]*)"
PLAIN_SCRIPTS = [
    re.compile(r"((?:^|[^A-Za-z0-9])[0-9]*)(" + _ELEM + r"*(?:[A-Z][a-z]?[0-9]+|\((?:[A-Z][a-z]?[0-9]*)+\)[0-9]+)[+-]?" + _ELEM + r"*)(?![A-Za-z0-9])"),  # H2O、2H2O（系数不标）、Ca(OH)2、Fe3+
    re.compile(r"(^|[^A-Za-z0-9.])([A-Za-z][0-9])(?![A-Za-z0-9.])"),                                          # v0、m1、T2、F1
    re.compile(r"(^|[^A-Za-z])((?:[a-z]+/)?(?:m|cm|mm|km|dm|s)[23])(?![A-Za-z0-9])"),                          # m/s2、cm3
    re.compile(r"(^|[^A-Za-z0-9])(" + _ELEM + r"+[+-])(?![A-Za-z0-9+-])"),                                    # NAD+、OH-
    re.compile(r"()([_^]\([^)]*\))"),                                                                         # 录题留下的 _(…)、^(…)
]


def plain_scripts(text):
    """依出现的位置排好；被前面较长的包住的（m/s2 里的 s2）不另外列，重复的也不列"""
    found = sorted(((m.start(2), m.end(2), m.group(2)) for rx in PLAIN_SCRIPTS for m in rx.finditer(text)),
                   key=lambda f: (f[0], -f[1]))
    out, reach = [], -1
    for start, end, token in found:
        if end <= reach:
            continue
        reach = max(reach, end)
        if token not in out:
            out.append(token)
    return out


# ---------- 数学公式（LaTeX） ----------
# 数学题的公式写成 $…$ 里的 LaTeX。放进 JSON 字串，反斜线要写两次（"\\frac"），AI 常常只写一次：
#   \sin、\sqrt、\, 这类 → JSON 不合法，整批解析失败；
#   \frac、\theta、\times、\beta → 被当成 \f \t \b 跳脱字元，悄悄变成看不见的控制字元，公式坏掉。
# 解析前先补成两个反斜线。合法的跳脱（\n 换行、\" 引号、\uXXXX）不动；
# \b \f \n \r \t 开头的字，只有列在这里的才当成公式指令补（\ne、\nu、\ni 可能是「换行＋字母」，不列，提示词要 AI 写 \neq）
LATEX_ESCAPE_LOOKALIKES = {
    "frac", "forall", "beta", "bar", "begin", "binom", "big", "bigl", "bigr", "boxed", "because", "bmod",
    "neq", "not", "notin", "nabla", "right", "rightarrow", "rho", "rangle", "rm",
    "times", "theta", "tan", "tanh", "text", "textbf", "textrm", "tfrac", "to", "tau", "triangle", "therefore", "tilde",
}
_BACKSLASH = re.compile(r"\\(u[0-9a-fA-F]{4}|[A-Za-z]+|.)", re.S)

MATH_RULES = r"""
【数学公式写法】
- 公式一律写成 LaTeX，前后用 $ 包起来，例如 $\frac{1}{2}x^2$、$\sqrt{3}$、$\int_0^1 x\,dx$；中文字写在 $ 外面。
- JSON 字串里的反斜线一律写两次：写 "\\frac{1}{2}"，不要写 "\frac{1}{2}"（少一个，公式会坏掉）。
- 选项前缀写在 $ 外面，例如 "A. $x=-1$"。
- 不等号写 \neq（不要写 \ne）；乘号 \times；点乘 \cdot。
- 小于、大于写 \lt、\gt，小于等于、大于等于写 \leq、\geq；不要直接打 < >（网页会当成 HTML 标签吃掉）。
- 符号照统考公式表：余割 \operatorname{cosec}（不写 csc）、反三角函数 \sin^{-1}x（不写 arcsin）、组合数 {}_nC_r、
  对数 \log_a x、自然对数 \ln x、行列式 \det(A)、伴随矩阵 \operatorname{adj}(A)、无穷等比级数和 S_\infty、
  矩阵 \begin{pmatrix}…\end{pmatrix}、行列式 \begin{vmatrix}…\end{vmatrix}。
"""

# 生物、化学、物理：公式少，简单的直接打符号，复杂的才用 $…$ 的 LaTeX（网站一样排得出来）
FORMULA_RULES = r"""
【公式与符号写法】
- 化学式、离子一律用真正的下标、上标字：H₂O、Ca(OH)₂、C₆H₁₂O₆、SO₄²⁻、Fe³⁺、NH₄⁺、NAD⁺；不可以写成 H2O、SO42-、Fe3+、NAD+。
- 物理量代号的下标也一样：v₀、v₁、m₁、m₂、F₁、R₁、T₂、Eₖ、Eₚ；单位的次方与 10 的次方用上标：m/s²、cm³、10⁻³、6.02×10²³。
- 下标是中文或好几个字母的（F合、R总、v最大），写成 $F_{\text{合}}$、$R_{\text{总}}$、$v_{\max}$。
- 其他简单的直接打符号：λ、Δ、Ω、μ、→、⇌、≤、≥、≠、√2。
- 分数、根号里有式子这类复杂的公式才写 LaTeX，前后用 $ 包起来，例如 $\frac{1}{2}mv^2$、$\sqrt{\frac{2h}{g}}$；中文字写在 $ 外面。
- $ 外面不可以出现 \sqrt、\frac、\gamma 这类反斜线指令（网页会原样显示成程式码）。
- JSON 字串里的反斜线一律写两次：写 "\\frac{1}{2}"，不要写 "\frac{1}{2}"。
- $ 里面的小于、大于写 \lt、\gt，不要直接打 < >。
"""


def repair_latex_backslashes(text):
    def fix(m):
        body = m.group(1)
        if body in ("\\", '"', "/") or re.fullmatch(r"u[0-9a-fA-F]{4}", body):
            return m.group(0)
        if body[0] in "bfnrt" and body not in LATEX_ESCAPE_LOOKALIKES:
            return m.group(0)
        return "\\" + m.group(0)
    return _BACKSLASH.sub(fix, text)


def extract_json_array(text):
    cleaned = re.sub(r"^```(json)?|```$", "", text.strip(), flags=re.M).strip()
    data = json.loads(repair_latex_backslashes(cleaned))
    if not isinstance(data, list):
        raise json.JSONDecodeError("不是 JSON 数组", cleaned, 0)
    return data


def _stem(record):
    return record.get("q") or record.get("question") or ""


def _option_body(opt):
    return re.sub(r"^\s*[A-D][.．]\s*", "", str(opt))


def text_problems(record):
    """只看题目本身就知道有问题的地方。/dev 的 textLint（dev/dev.js）是同一套，改规则或字句两边要一样"""
    out = []
    pieces = [("题干", _stem(record))] + [(f"选项{LETTERS[i]}", o) for i, o in enumerate(record.get("options") or [])]
    pieces.append(("解析", record.get("explanation") or ""))
    for label, text in pieces:
        text = str(text)
        prose = MATH_SPAN.sub("", text)   # 公式里的 \text{or} 不算夹英文
        if label != "解析" and CJK.search(prose):   # 解析常带英文术语，不查
            m = ENGLISH_FILLER.search(prose)
            if m:
                out.append(f"{label}夹了英文「{m.group(0)}」，疑似转写错误")
        if LEFTOVER_MARK.search(text):
            out.append(f"{label}残留转写标记「{LEFTOVER_MARK.search(text).group(0)}」")
        if CONTROL_CHAR.search(text):
            out.append(f"{label}有看不见的控制字元，多半是公式的反斜线少写一个（\\frac、\\theta 这类），请检查公式")
        if text.count("$") % 2:
            out.append(f"{label}的公式 $ 没有成对，显示会乱掉")
        elif RAW_LATEX.search(prose):
            # 标记本身会显示在 /dev：一句里有两个 $ 会被当成公式排掉，所以只能出现一个
            out.append(f"{label}有写在公式外面的 LaTeX 指令「{RAW_LATEX.search(prose).group(0)}」，学生会看到原始码，"
                       "请改成符号（√、γ），或前后加 $ 放进公式")
        if any(c in span for span in MATH_SPAN.findall(text) for c in "<>"):
            out.append(f"{label}的公式里有 < 或 >，网页会当成 HTML 标签，请改成 \\lt、\\gt")
        plain = plain_scripts(prose) if record.get("subject") != "math" else []
        if plain:
            out.append(f"{label}有没写成上下标的「{'」「'.join(plain[:3])}」：化学式、物理量的数字要下标（H₂O、v₀），"
                       "离子电荷、单位次方要上标（Fe³⁺、m/s²）")
    for label, text in pieces:
        m = SELF_TALK.search(str(text))
        if m:
            out.append(f"⚠️ {label}里有 AI 自言自语「{m.group(0)}」：这种题多半算错或中途改过题，答案、选项、解析都要核对")
            break
    if LEADING_NUMBER.match(_stem(record)):
        out.append("题干开头的题号没去掉")
    if any(ROMAN_ONE_LINE.search(line) for line in _stem(record).splitlines()):
        out.append("题干的罗马数字叙述（I、II…）挤在同一行，请每项换行")
    return out


# ---------- 与原档比对 ----------

def canon(text):
    """比对用：去掉转写标记，全形/上下标/罗马数字统一（NFKC），只留字母、数字、汉字"""
    text = LEFTOVER_MARK.sub("", str(text or ""))
    text = unicodedata.normalize("NFKC", text).lower()
    return "".join(ch for ch in text if ch.isalnum())


def _drift(piece, source):
    """piece 在原档里一字不差找得到就回 None；否则回传差异说明"""
    a = canon(piece)
    if len(a) < 2 or a in source:
        return None
    i, j, k = difflib.SequenceMatcher(None, a, source, autojunk=False).find_longest_match(0, len(a), 0, len(source))
    if k < max(3, len(a) // 4):
        return "原档里找不到这段文字"
    start = max(0, j - i - 5)
    window = source[start:j - i + len(a) + 5]
    matcher = difflib.SequenceMatcher(None, a, window, autojunk=False)
    if matcher.ratio() < 0.7:
        return "原档里找不到这段文字（可能被 AI 改写了）"
    diffs = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag == "insert" and (i1 == 0 or i1 == len(a)):
            continue   # 原档在这段前後多出来的字（题号、下一题）不算
        diffs.append(f"原档「{window[j1:j2] or '（无）'}」→ 录入「{a[i1:i2] or '（漏掉）'}」")
    return "；".join(diffs[:3]) if diffs else None


def source_drift(record, source):
    """source 是 canon() 过的原档全文；Word/PPT/文字档才有，照片与 PDF 没有原文可比"""
    out = []
    pieces = [("题干", _stem(record))] + [(f"选项{LETTERS[i]}", _option_body(o))
                                        for i, o in enumerate(record.get("options") or [])]
    for label, text in pieces:
        # 数学：原档的公式多半是方程式物件或上下标，抽出来的文字和 LaTeX 对不上；只比对公式以外的文字
        why = next(filter(None, (_drift(chunk, source) for chunk in MATH_SPAN.split(str(text)))), None)
        if why:
            out.append(f"⚠️ {label}和原档不一致：{why}")
    return out


# ---------- 答案复核 ----------

def build_check_prompt(subject, mcqs):
    lines = []
    for i, q in enumerate(mcqs, 1):
        lines.append(f"第 {i} 题：{q['q']}\n" + "\n".join(q["options"]))
    return f"""你是 UEC 高中统考{SUBJECT_LABEL.get(subject, subject)}科阅卷老师。请独立作答下列选择题（不要参考任何其他资料上的答案），
只回传 JSON 数组，每题一项：{{"n": 题号, "answer": 0-3 的下标（0=A…3=D）, "reason": "一句话理由"}}

""" + "\n\n".join(lines)


# 答案复核不用哪一级模型。2026-09 化学那批 7 个「答案有疑」全是 flash-lite 自己算错；
# 只剩这一级时宁可标「答案未经 AI 复核」，也不要给一堆假的疑点
CHECK_SKIP_TIERS = ("flash-lite",)


def cross_check(api_key, subject, records, report_notes):
    """Gemini 不看答案再做一次选择题。失败不挡录题，只把每题标成「未复核」"""
    mcqs = [r for r in records if r["type"] == "mcq"]
    if not mcqs:
        return
    gemini_api.retry_busy()                  # 出题时忙碌被跳过的较强模型，这时多半又能用了：从最好的重新试
    try:
        answers = extract_json_array(gemini_api.generate(api_key, [{"text": build_check_prompt(subject, mcqs)}],
                                                         temperature=0, skip_tiers=CHECK_SKIP_TIERS))
    except gemini_api.LowTierOnly:
        report_notes.append("答案复核没跑：较强的模型都额度用完或忙碌，只剩 flash-lite（它复核常自己算错，标出来的疑点多半是假的），"
                            "这批的答案请全部人工核对")
        for r in mcqs:
            r["flags"].append("答案未经 AI 复核")
        return
    except (gemini_api.GeminiError, json.JSONDecodeError) as e:
        report_notes.append(f"答案复核没跑成（{str(e)[:60]}），这批的答案请全部人工核对")
        for r in mcqs:
            r["flags"].append("答案未经 AI 复核")
        return
    by_n = {a.get("n"): a for a in answers if isinstance(a, dict)}
    for i, r in enumerate(mcqs, 1):
        got = by_n.get(i, {})
        second = got.get("answer")
        if not isinstance(second, int) or not 0 <= second <= 3:
            r["flags"].append("答案未经 AI 复核")
            continue
        r["review"] = {"ai_answer": second, "reason": str(got.get("reason", ""))[:120]}
        if second == r["answer"]:
            if r.get("answer_source") == "ai":
                r["flags"].append("原档没标答案，由 AI 作答（两次一致），仍请核对")
            continue
        who = {"marked": "原档标的", "generated": "出题时给的"}.get(r.get("answer_source"), "AI 第一次作答")
        r["flags"].append(f"⚠️ 答案有疑：{who}是 {LETTERS[r['answer']]}，AI 复核选 {LETTERS[second]}"
                          f"（{r['review']['reason'] or '无理由'}），请核对")
