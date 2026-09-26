#!/usr/bin/env bash
# 把这批新题接进 main 上的待审区并推送（录题、出题的工作流共用）
#   用法：bash scripts/push_pending.sh "<commit 讯息>" [一起提交的路径…]
#   例如：bash scripts/push_pending.sh "🧪 AI 录题进待审区" drafts images
#
# 新题在 new_pending_items.json（scripts/pending_queue.py 写的）。每次推送前都取 main 上最新的待审区再接上去：
# /dev 刚好采纳、别的批次刚推上去，都只是重来一次，不会冲突（以前开 PR 就会）。
set -euo pipefail
msg=$1; shift

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# 本机改过的待审区不用：推送前会接在 main 的最新版上
git checkout -q -- papers/pending_approval.json

# 处理掉的原档、裁好的配图（出题没有；images/ 这批没裁图就不存在）
extra=0
for p in "$@"; do
  if [ -e "$p" ] || git ls-files --error-unmatch "$p" >/dev/null 2>&1; then git add -A -- "$p"; fi
done
if ! git diff --cached --quiet; then git commit -q -m "$msg"; extra=1; fi
git branch -f batch HEAD

for i in 1 2 3 4 5; do
  git fetch -q origin +refs/heads/main:refs/remotes/origin/main
  if [ "$extra" = 1 ]; then git rebase -q origin/main batch; else git branch -f batch origin/main; fi
  git checkout -q -B attempt batch
  python scripts/pending_queue.py
  git add papers/pending_approval.json
  if [ "$extra" = 1 ]; then git commit -q --amend --no-edit; else git commit -q -m "$msg"; fi
  if git push -q origin HEAD:main; then echo "✅ 已推到 main"; exit 0; fi
  echo "⏳ main 刚被改动（/dev 采纳或别的批次），第 $i 次重试"
  sleep $((i * 3))
done
echo "❌ 试了 5 次都被抢先，这批没推上去；重跑这个工作流就好（原档还在 drafts/）"
exit 1
