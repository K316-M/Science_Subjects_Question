#!/usr/bin/env python3
"""
合并前的自动检查（.github/workflows/check.yml 在每个 PR、每次推到 main 时跑）
------------------------------------------------------------------------
只挡「会让网站坏掉」的问题，挡到就失败；/dev 巡检里的「缺解析」「疑似缺图」这类提醒不在这里挡。

  1. JSON 读得开：题库、待审区、申诉结果、manifest、vercel.json、各科 scene.json
  2. 题库：章节 id 不重复；上线的选择题有题干、恰好 4 个选项、答案在 0～3；
     做答题有题干与参考答案；配图档案真的存在；数学的卷别只能是 I／II、标签只能是 exam／extra／school 且年份只跟着 exam（下架的题不检查）
  3. 待审区：每题有 id、科目、题型，id 不重复
  4. 语法：scripts/ 底下的 Python、网站与 API 的 JS（含 index.html 里内嵌的 <script>）
  5. docs/CUSTOMIZE.md：每一列「搜这个名字」都要在那一列写的档案里搜得到（CLAUDE.md 第 5 条）
  6. api/ 的接口数不能超过 Vercel 免费方案的 12 个
  7. 更新日志 data/devlog.json：版本号、日期、内容的格式，新的在前（规则在 scripts/publish_devlog.py）
  8. 教学地图 data/teach/*.json：关卡与题目 id 不重复、parents 存在且无环、题型与答案格式、
     反应式类别在固定清单内、每个小节有魔王关和专属题、图案名字 js/teach.js 里有

  python3 scripts/check_repo.py      # 有问题就列出来并 exit 1
"""
import collections
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
TAGS = ('exam', 'extra', 'school')   # 同 api/_lib/questions.js 的 TAGS、YEAR_MIN、YEAR_MAX
YEAR_RANGE = (2000, 2099)
API_FUNCTION_LIMIT = 12       # Vercel Hobby 方案的无伺服器函数上限
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
    patterns = ['papers/*.json', 'data/*.json', 'data/teach/*.json', 'manifest.json', 'vercel.json',
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
    if 'tag' in q and q['tag'] not in TAGS:
        problems.append(f"{at}：标签 {q['tag']!r} 只能是 {'、'.join(TAGS)}")
    if 'year' in q:
        year = q['year']
        if q.get('tag') != 'exam':
            problems.append(f'{at}：有年份却不是「统考」标签')
        elif not isinstance(year, int) or isinstance(year, bool) or not YEAR_RANGE[0] <= year <= YEAR_RANGE[1]:
            problems.append(f'{at}：年份 {year!r} 要是 {YEAR_RANGE[0]}～{YEAR_RANGE[1]} 的整数')


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


def check_function_limit():
    """Vercel 免费（Hobby）方案一次部署最多 12 个无伺服器函数，也就是 api/ 底下（不含 _lib/）的 .js 档。
    第 13 个会让整个部署失败，学生站也跟着上不了线；新功能请并进现有的接口（例如 api/dev-edit.js 的 target）。"""
    count = len(glob.glob(os.path.join(ROOT, 'api', '*.js')))
    if count > API_FUNCTION_LIMIT:
        problems.append(f'api/ 有 {count} 支接口，超过 Vercel 免费方案的上限 {API_FUNCTION_LIMIT}：'
                        '部署会失败。请并进现有的接口，不要另开新档')


def check_devlog():
    from publish_devlog import problems_in
    data = load_json(os.path.join(ROOT, 'data', 'devlog.json'))
    if data is not None:
        problems.extend(f'data/devlog.json：{p}' for p in problems_in(data))


TEACH_TYPES = ('term', 'calc', 'essay')


def _teach_motifs():
    """js/teach.js 的 MOTIFS 里有哪些图案名字（资料里的 motif／cover 只能用这些）"""
    try:
        with open(os.path.join(ROOT, 'js', 'teach.js'), encoding='utf-8') as f:
            src = f.read()
    except OSError:
        return set()
    block = src.split('const MOTIFS = {', 1)[-1].split('\n  };', 1)[0]
    return set(re.findall(r'^    ([a-z]+): ', block, re.M))


def _teach_question(q, at, seen):
    qid = q.get('id')
    if not qid or qid in seen:
        problems.append(f'{at}：题目 id 缺少或重复（{qid}）')
    seen.add(qid)
    at = f'{at}/{qid}'
    t = q.get('type')
    if t not in TEACH_TYPES:
        problems.append(f'{at}：type 只能是 {"／".join(TEACH_TYPES)}（现在是 {t}）')
        return
    if not (q.get('q') or '').strip():
        problems.append(f'{at}：没有题干')
    if t == 'term':
        opts = q.get('options')
        if not (isinstance(opts, list) and len(opts) == 4 and all(isinstance(o, str) and o.strip() for o in opts)):
            problems.append(f'{at}：名词题要恰好 4 个选项')
        if q.get('answer') not in (0, 1, 2, 3) or isinstance(q.get('answer'), bool):
            problems.append(f'{at}：名词题 answer 要是 0～3')
        elif isinstance(opts, list) and len(set(opts)) != len(opts):
            problems.append(f'{at}：选项有重复')
    elif t == 'calc':
        a = q.get('answer')
        if isinstance(a, bool) or not isinstance(a, (int, float)):
            problems.append(f'{at}：计算题 answer 要是数字')
        if not isinstance(q.get('unit'), str):
            problems.append(f'{at}：计算题要有 unit 栏（没有单位就写空字串）')
        if not (q.get('steps') or '').strip():
            problems.append(f'{at}：计算题要有分步解法 steps')
        tol = q.get('tol', 0.02)
        if isinstance(tol, bool) or not isinstance(tol, (int, float)) or not 0 < tol <= 0.2:
            problems.append(f'{at}：tol 要在 0～0.2 之间')
    else:
        pts = q.get('points')
        if not (isinstance(pts, list) and len(pts) >= 3 and all(isinstance(x, str) and x.strip() for x in pts)):
            problems.append(f'{at}：论述题自评要点至少 3 条')
        if not (q.get('model') or '').strip():
            problems.append(f'{at}：论述题要有参考答案 model')


_TEACH_MARK_OK = re.compile(r'[_^]\{[^{}]+\}')
_TEACH_MARK_BAD = re.compile(r'[_^]|<su[bp]>|\*\*')


def _teach_markup(o, at):
    """教学资料的文字只认 _{c}（下标）、^{2+}（上标）和 Unicode（₂ ²）。js/teach.js 的 rich() 只处理前两种，
    其余的 _ ^ <sub> ** 会原样露在网页上（例如 K_c、A^(y+)），所以这里先挡下来。"""
    if isinstance(o, dict):
        for k, v in o.items():
            _teach_markup(v, f'{at}/{k}')
    elif isinstance(o, list):
        for i, v in enumerate(o):
            _teach_markup(v, f'{at}/{i}')
    elif isinstance(o, str):
        left = _TEACH_MARK_OK.sub('', o)
        m = _TEACH_MARK_BAD.search(left)
        if m:
            problems.append(f'{at}：文字里有没处理好的上下标／标记「{left[max(0, m.start() - 8):m.end() + 8]}」'
                            '——下标写 _{c}、上标写 ^{2+}，或直接用 Unicode（₂ ²）')


def _teach_art(data_ids):
    """assets/teach/manifest.json 登记的插画：文件要真的存在，名字要对得上某张地图／关卡／魔王（<cover|node|boss>-<id>.webp）"""
    path = os.path.join(ROOT, 'assets', 'teach', 'manifest.json')
    if not os.path.isfile(path):
        return
    data = load_json(path)
    files = (data or {}).get('files')
    if not isinstance(files, list):
        problems.append('assets/teach/manifest.json：files 要是清单（数组）')
        return
    for f in files:
        m = re.fullmatch(r'(cover|node|boss)-(.+)\.webp', f) if isinstance(f, str) else None
        deco = re.fullmatch(r'deco-(.+)-\d+\.webp', f) if isinstance(f, str) else None
        fx = isinstance(f, str) and re.fullmatch(r'fx-(star|sparkle|confetti-a|confetti-b)\.webp', f)
        pose = re.fullmatch(r'boss-(.+)-(hit|atk)\.webp', f) if isinstance(f, str) else None
        if fx or pose:    # 特效小图 fx-<star|sparkle|confetti-a|confetti-b>.webp；魔王受击／攻击姿势 boss-<魔王 id>-<hit|atk>.webp
            if pose and pose.group(1) not in data_ids.get('boss', set()):
                problems.append(f'assets/teach/manifest.json：{f} 找不到对应的魔王 id')
            elif not os.path.isfile(os.path.join(ROOT, 'assets', 'teach', f)):
                problems.append(f'assets/teach/manifest.json：登记了 {f}，但 assets/teach/ 里没有这个档案')
            continue
        if deco:    # 地图上的装饰贴纸：deco-<地图 id>-<序号>.webp
            if deco.group(1) not in data_ids.get('cover', set()):
                problems.append(f'assets/teach/manifest.json：{f} 找不到对应的地图 id')
            elif not os.path.isfile(os.path.join(ROOT, 'assets', 'teach', f)):
                problems.append(f'assets/teach/manifest.json：登记了 {f}，但 assets/teach/ 里没有这个档案')
            continue
        if not m:
            problems.append(f'assets/teach/manifest.json：{f!r} 不是 <cover|node|boss>-<id>.webp、boss-<魔王 id>-<hit|atk>.webp、deco-<地图 id>-<序号>.webp 或 fx-<star|sparkle|confetti-a|confetti-b>.webp')
        elif m.group(2) not in data_ids.get(m.group(1), set()):
            problems.append(f'assets/teach/manifest.json：{f} 找不到对应的{ {"cover": "地图", "node": "关卡", "boss": "魔王"}[m.group(1)] } id')
        elif not os.path.isfile(os.path.join(ROOT, 'assets', 'teach', f)):
            problems.append(f'assets/teach/manifest.json：登记了 {f}，但 assets/teach/ 里没有这个档案')


def check_teach():
    motifs = _teach_motifs()
    art_ids = {'cover': set(), 'node': set(), 'boss': set()}
    for path in sorted(glob.glob(os.path.join(ROOT, 'data', 'teach', '*.json'))):
        data = load_json(path)
        if data is None:
            continue
        name = rel(path)
        _teach_markup(data, name)
        cats = {c.get('id'): c for c in data.get('reaction_categories') or []}
        if not cats:
            problems.append(f'{name}：缺 reaction_categories')
        seen_q, seen_node = set(), set()
        for m in data.get('maps') or []:
            at = f'{name}/{m.get("id")}'
            nodes = {n.get('id'): n for n in m.get('nodes') or []}
            bosses = {b.get('id'): b for b in m.get('bosses') or []}
            art_ids['cover'].add(m.get('id'))
            art_ids['node'].update(nodes)
            art_ids['boss'].update(bosses)
            if len(nodes) != len(m.get('nodes') or []):
                problems.append(f'{at}：关卡 id 有重复')
            for ident in list(nodes) + list(bosses):
                if not ident or ident in seen_node:
                    problems.append(f'{at}：关卡／魔王 id 缺少或跨地图重复（{ident}）')
                seen_node.add(ident)
            if motifs and m.get('cover') not in motifs:
                problems.append(f'{at}：cover 图案 {m.get("cover")} 不在 js/teach.js 的 MOTIFS 里')
            for sc in m.get('scenery') or []:
                if motifs and sc not in motifs:
                    problems.append(f'{at}：scenery 图案 {sc} 不在 js/teach.js 的 MOTIFS 里')
            for n in list(nodes.values()) + list(bosses.values()):
                nat = f'{at}/{n.get("id")}'
                for k in ('col', 'row'):
                    if isinstance(n.get(k), bool) or not isinstance(n.get(k), (int, float)):
                        problems.append(f'{nat}：{k} 要是数字')
                if isinstance(n.get('col'), (int, float)) and not 0 <= n['col'] <= 3:
                    problems.append(f'{nat}：col 要在 0～3')
                if motifs and n.get('motif') not in motifs:
                    problems.append(f'{nat}：motif {n.get("motif")} 不在 js/teach.js 的 MOTIFS 里')
                for par in n.get('parents') or []:
                    if par not in nodes and par not in bosses:
                        problems.append(f'{nat}：parents 里的 {par} 不存在')
            # 无环：沿 parents 一路往上走，不能走回自己
            allnodes = {**nodes, **bosses}
            for start in allnodes:
                stack, visited = list(allnodes[start].get('parents') or []), set()
                while stack:
                    cur = stack.pop()
                    if cur == start:
                        problems.append(f'{at}/{start}：parents 绕成了圈')
                        break
                    if cur in visited or cur not in allnodes:
                        continue
                    visited.add(cur)
                    stack.extend(allnodes[cur].get('parents') or [])
            for n in nodes.values():
                nat = f'{at}/{n.get("id")}'
                if n.get('tier') not in (1, 2, 3, 4):
                    problems.append(f'{nat}：tier 要是 1～4')
                lesson = n.get('lesson') or {}
                if not (lesson.get('summary') and lesson.get('points')):
                    problems.append(f'{nat}：知识卡缺 summary／points')
                for r in lesson.get('reactions') or []:
                    cat = cats.get(r.get('category'))
                    if not cat:
                        problems.append(f'{nat}：反应式类别 {r.get("category")} 不在 reaction_categories 里')
                    elif cat.get('levels') and r.get('level') not in cat['levels']:
                        problems.append(f'{nat}：{cat["name"]}的反应式要标 level（{"／".join(cat["levels"])}）：{r.get("name")}')
                    if not (r.get('name') and r.get('equation')):
                        problems.append(f'{nat}：反应式缺 name／equation')
                if 'gist' in n and not (isinstance(n['gist'], str) and 0 < len(n['gist']) <= 26):
                    problems.append(f'{nat}：gist（地图卡片上的一句话重点）要是 1～26 字的字串；不写就用知识卡的 tip')
                if len(n.get('challenges') or []) < 3:
                    problems.append(f'{nat}：每关至少 3 题')
                for q in n.get('challenges') or []:
                    _teach_question(q, nat, seen_q)
            in_section = collections.Counter()
            for sec in m.get('sections') or []:
                sat = f'{at}/{sec.get("id")}'
                pool = 0
                for nid in sec.get('nodes') or []:
                    if nid not in nodes:
                        problems.append(f'{sat}：小节里的关卡 {nid} 不存在')
                    else:
                        in_section[nid] += 1
                        pool += len(nodes[nid].get('challenges') or [])
                boss = bosses.get(sec.get('boss'))
                if not boss:
                    problems.append(f'{sat}：小节缺魔王关（boss）')
                else:
                    _teach_question(boss.get('extra') or {}, f'{sat}/{boss["id"]}', seen_q)
                if pool < 4:
                    problems.append(f'{sat}：小节题池只有 {pool} 题，魔王关要抽 4 题')
            for nid in nodes:
                if in_section[nid] != 1:
                    problems.append(f'{at}/{nid}：要恰好属于一个小节（现在 {in_section[nid]} 个）')
    _teach_art(art_ids)


def main():
    check_json_files()
    banks = sorted(glob.glob(os.path.join(ROOT, 'papers', '*_question_bank.json')))
    for path in banks:
        check_bank(path)
    check_pending({os.path.basename(p).replace('_question_bank.json', '') for p in banks})
    check_python()
    check_js()
    check_customize()
    check_function_limit()
    check_devlog()
    check_teach()

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
