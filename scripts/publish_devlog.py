#!/usr/bin/env python3
"""
发布一版更新日志：把「版本＋内容」加到 data/devlog.json 最前面
------------------------------------------------------------------
由 .github/workflows/publish_devlog.yml（Actions →「发布更新日志」）叫；网站右上角「日志」读这个档案。

  VERSION   版本号，例如 1.2（前面的 v 可写可不写），要比现在最新的一版新
  CONTENT   内容：每一点之间用 || 隔开，例如「新增 A || 修正 B」
  日期自动填马来西亚的今天。

  VERSION=1.2 CONTENT='新增 A || 修正 B' python3 scripts/publish_devlog.py
"""
import datetime
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DEVLOG = os.path.join(ROOT, 'data', 'devlog.json')
# 内容里分隔每一点的符号（GitHub 的输入框只有一行，没办法按 Enter 分点）
SEPARATOR = '||'
# 一点最多几个字：再长多半是忘了用 || 分开
MAX_ITEM_CHARS = 200
MYT = datetime.timezone(datetime.timedelta(hours=8))
VERSION_RE = re.compile(r'\d+(\.\d+){1,2}')


def version_key(v):
    return tuple(int(x) for x in v.split('.'))


def problems_in(data):
    """data/devlog.json 的格式问题（scripts/check_repo.py 也用这个挡）"""
    entries = data.get('entries') if isinstance(data, dict) else None
    if not isinstance(entries, list):
        return ['要有 entries 清单']
    out = []
    for n, e in enumerate(entries, 1):
        at = f'第 {n} 版'
        if not isinstance(e, dict):
            out.append(f'{at}格式不对')
            continue
        v = str(e.get('version', ''))
        if not VERSION_RE.fullmatch(v):
            out.append(f'{at}的版本号「{v}」要像 1.2 或 1.2.3')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(e.get('date', ''))):
            out.append(f'{at}（v{v}）的日期要写成 YYYY-MM-DD')
        items = e.get('items')
        if not isinstance(items, list) or not items or not all(isinstance(t, str) and t.strip() for t in items):
            out.append(f'{at}（v{v}）的内容要是一串不空的文字')
    versions = [str(e.get('version', '')) for e in entries if isinstance(e, dict)]
    if all(VERSION_RE.fullmatch(v) for v in versions):
        for a, b in zip(versions, versions[1:]):
            if version_key(a) <= version_key(b):
                out.append(f'版本要新的在前、不重复：v{a} 排在 v{b} 前面不对')
    return out


def fail(msg):
    print(f'❌ {msg}')
    sys.exit(1)


def main():
    version = os.environ.get('VERSION', '').strip().lstrip('vV').strip()
    if not VERSION_RE.fullmatch(version):
        fail(f'版本号「{version}」要像 1.2 或 1.2.3')
    items = [t.strip() for t in os.environ.get('CONTENT', '').split(SEPARATOR) if t.strip()]
    if not items:
        fail('内容是空的')
    long_items = [t for t in items if len(t) > MAX_ITEM_CHARS]
    if long_items:
        fail(f'有一点超过 {MAX_ITEM_CHARS} 个字，是不是忘了用 {SEPARATOR} 分开？「{long_items[0][:30]}…」')

    with open(DEVLOG, encoding='utf-8') as f:
        data = json.load(f)
    entries = data['entries']
    if entries and version_key(version) <= version_key(entries[0]['version']):
        fail(f'v{version} 没有比现在最新的 v{entries[0]["version"]} 新（同一版要改内容，直接改 data/devlog.json）')

    date = datetime.datetime.now(MYT).date().isoformat()
    entries.insert(0, {'version': version, 'date': date, 'items': items})
    bad = problems_in(data)
    if bad:
        fail('；'.join(bad))
    with open(DEVLOG, 'w', encoding='utf-8') as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

    lines = [f'## ✅ 已加入更新日志 v{version}（{date}）', ''] + [f'- {t}' for t in items]
    print('\n'.join(lines))
    for name, text in (('GITHUB_STEP_SUMMARY', '\n'.join(lines) + '\n'), ('GITHUB_OUTPUT', f'version={version}\n')):
        if os.environ.get(name):
            with open(os.environ[name], 'a', encoding='utf-8') as f:
                f.write(text)


if __name__ == '__main__':
    main()
