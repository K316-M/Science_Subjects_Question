#!/usr/bin/env python3
"""
合并前的自动检查（.github/workflows/check.yml 在每个 PR、每次推到 main 时跑）
------------------------------------------------------------------------
只挡「会让网站坏掉」的问题，挡到就失败；/dev 巡检里的「缺解析」「疑似缺图」这类提醒不在这里挡。

  1. JSON 读得开：题库、待审区、申诉结果、manifest、vercel.json、各科 scene.json
  2. 题库：章节 id 不重复；上线的选择题有题干、恰好 4 个选项、答案在 0～3；
     做答题有题干与参考答案；配图档案真的存在；数学的卷别只能是 I／II（下架的题不检查）
  3. 待审区：每题有 id、科目、题型，id 不重复
  4. 语法：scripts/ 底下的 Python、网站与 API 的 JS（含 index.html 里内嵌的 <script>）
  5. docs/CUSTOMIZE.md：每一列「搜这个名字」都要在那一列写的档案里搜得到（CLAUDE.md 第 5 条）

  python3 scripts/check_repo.py      # 有问题就列出来并 exit 1
"""
import glob
import json
import os
import py_compile
import re
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PAPERS = ('I', 'II')          # 同 api/_lib/questions.js 的 PAPERS
problems = []
_loaded = {}


def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, '/')


def load_json(path):
    """同一个档案只读一次、只报一次错"""
    if path not in _loaded:
        try:
            with open(path, encoding='utf-8') as f:
                _loaded[path] = json.load(f)
        except (OSError, ValueError) as e:
            problems.append(f'{rel(path)}：JSON 读不开（{e}）')
            _loaded[path] = None
    return _loaded[path]


def check_json_files():
    patterns = ['papers/*.json', 'data/*.json', 'manifest.json', 'vercel.json',
                'assets/visual/*/scene.json', 'source/scene/*.json']
    for pattern in patterns:
        for path in sorted(glob.glob(os.path.join(ROOT, pattern))):
            load_json(path)


def check_bank(path):
    bank = load_json(path)
    if bank is None:
        return
    name = rel(path)
    sections = bank.get('sections')
    if not isinstance(sections, list):
        problems.append(f'{name}：没有 sections 列表')
        return
    seen = set()
    for sec in sections:
        sid = sec.get('id')
        where = f"{name} {sid or '（没有 id 的章）'}"
        if not sid:
            problems.append(f'{where}：章节缺 id')
        elif sid in seen:
            problems.append(f'{where}：章节 id 重复（学生的进度、笔记靠它对应）')
        seen.add(sid)
        if not str(sec.get('title') or '').strip():
            problems.append(f'{where}：章节缺标题')
        for i, q in enumerate(sec.get('mcqs') or []):
            if q.get('hidden'):
                continue
            at = f'{where} 选择题第 {i + 1} 题'
            opts = q.get('options')
            if not str(q.get('q') or '').strip():
                problems.append(f'{at}：题干是空的')
            if not isinstance(opts, list) or len(opts) != 4 or not all(str(o).strip() for o in opts):
                problems.append(f'{at}：选项不是 4 个有字的选项')
            if not isinstance(q.get('answer'), int) or isinstance(q.get('answer'), bool) or not 0 <= q['answer'] <= 3:
                problems.append(f'{at}：答案不是 0～3（A～D）')
            check_common(q, at)
        for i, q in enumerate(sec.get('subjectives') or []):
            if q.get('hidden'):
                continue
            at = f'{where} 做答题第 {i + 1} 题'
            if not str(q.get('question') or '').strip():
                problems.append(f'{at}：题干是空的')
            if not str(q.get('answer') or '').strip():
                problems.append(f'{at}：缺参考答案')
            check_common(q, at)


def check_common(q, at):
    image = q.get('image')
    if image and not os.path.isfile(os.path.join(ROOT, str(image).lstrip('./'))):
        problems.append(f'{at}：配图 {image} 不存在')
    if 'paper' in q and q['paper'] not in PAPERS:
        problems.append(f"{at}：卷别 {q['paper']!r} 只能是 'I' 或 'II'")


def check_pending(subjects):
    data = load_json(os.path.join(ROOT, 'papers', 'pending_approval.json'))
    if data is None:
        return
    items = data.get('items') if isinstance(data, dict) else None
    if not isinstance(items, list):
        problems.append('papers/pending_approval.json：没有 items 列表')
        return
    seen = set()
    for i, item in enumerate(items):
        at = f"papers/pending_approval.json 第 {i + 1} 题（{item.get('id')}）"
        if not item.get('id'):
            problems.append(f'{at}：缺 id')
        elif item['id'] in seen:
            problems.append(f'{at}：id 重复')
        seen.add(item.get('id'))
        if item.get('subject') not in subjects:
            problems.append(f"{at}：科目 {item.get('subject')!r} 没有对应的题库")
        if item.get('type') not in ('mcq', 'subjective'):
            problems.append(f"{at}：题型 {item.get('type')!r} 不是 mcq／subjective")


def check_python():
    for path in sorted(glob.glob(os.path.join(ROOT, 'scripts', '**', '*.py'), recursive=True)):
        try:
            py_compile.compile(path, cfile=os.path.join(tempfile.gettempdir(), 'check_repo.pyc'), doraise=True)
        except py_compile.PyCompileError as e:
            problems.append(f'{rel(path)}：Python 语法错误\n    ' + e.msg.strip().replace(ROOT + os.sep, ''))


def node_check(path, label):
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    if r.returncode:
        detail = '\n    '.join(r.stderr.replace(path, label).strip().splitlines()[:4])
        problems.append(f'{label}：JS 语法错误\n    {detail}')


def check_js():
    files = []
    for pattern in ['js/*.js', 'api/**/*.js', 'dev/*.js', 'sw.js', 'scripts/**/*.js']:
        files += glob.glob(os.path.join(ROOT, pattern), recursive=True)
    for path in sorted(set(files)):
        if '/node_modules/' not in path.replace(os.sep, '/'):
            node_check(path, rel(path))
    # 网页里内嵌的 <script>（不含 src= 与 JSON 这类资料）
    for page in ['index.html', 'dev/index.html', 'dev/login.html']:
        full = os.path.join(ROOT, page)
        if not os.path.isfile(full):
            continue
        html = open(full, encoding='utf-8').read()
        for n, m in enumerate(re.finditer(r'<script(?![^>]*\bsrc=)(?![^>]*type="(?:application/(?:ld\+)?json|importmap)")[^>]*>(.*?)</script>', html, re.S), 1):
            with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
                f.write(m.group(1))
            node_check(f.name, f'{page} 第 {n} 段内嵌 <script>')
            os.unlink(f.name)


def check_customize():
    """表头有「搜这个名字」的表格：那一格里每个 `名字` 都要在同一列「档案」格写的档案里搜得到"""
    path = os.path.join(ROOT, 'docs', 'CUSTOMIZE.md')
    cols = None
    for line in open(path, encoding='utf-8'):
        if not line.startswith('|'):
            cols = None
            continue
        cells = [c.strip() for c in re.split(r'(?<!\\)\|', line.strip())[1:-1]]
        if cols is None:
            cols = cells if '搜这个名字' in cells else False
            continue
        if not cols or set(line) <= set('|-: \n'):
            continue
        row = dict(zip(cols, cells))
        # 档案格写的档案，加上名称格里顺带点名的档案（例如「`index.html` 搜 `exam-list-hint`」）
        cited = re.findall(r'`([^`]+)`', row.get('档案', '') + row.get('搜这个名字', ''))
        paths = [p for p in dict.fromkeys(cited) if os.path.isfile(os.path.join(ROOT, p))]
        if not paths:
            continue   # 档案不在仓库里（例如 GitHub 设定）
        texts = [open(os.path.join(ROOT, p), encoding='utf-8').read() for p in paths]
        for name in re.findall(r'`([^`]+)`', row.get('搜这个名字', '')):
            name = name.replace('\\|', '|')
            if os.path.isfile(os.path.join(ROOT, name)) or name in ('—',):
                continue
            if not any(name in t for t in texts):
                problems.append(f"docs/CUSTOMIZE.md「{row.get(cols[0], '')[:30]}」：`{name}` 在 {'、'.join(paths)} 里搜不到")


def main():
    check_json_files()
    banks = sorted(glob.glob(os.path.join(ROOT, 'papers', '*_question_bank.json')))
    for path in banks:
        check_bank(path)
    check_pending({os.path.basename(p).replace('_question_bank.json', '') for p in banks})
    check_python()
    check_js()
    check_customize()

    lines = ['## ✅ 合并前检查：全部通过'] if not problems else \
        [f'## ❌ 合并前检查：{len(problems)} 个问题', ''] + [f'- {p}' for p in problems]
    print('\n'.join(lines))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
