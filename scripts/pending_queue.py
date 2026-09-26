"""
待审区（papers/pending_approval.json）的写入：录题、出题共用
------------------------------------------------------------
以前每批开一个 PR，但每批都改同一个待审区档案：两批同时开着、或先在 /dev 采纳了几题，
後一个 PR 就一定冲突。现在工作流直接推到 main：

  1. 录题／出题脚本呼叫 append()：接进本机的待审区，并把这批新题另存到 NEW_ITEMS_PATH
  2. scripts/push_pending.sh 推送前取 main 上最新的待审区，执行本档（__main__）把这批新题接上去；
     推送时 main 刚好又变了（/dev 采纳、别的批次），就重取再接 —— 永远是「接在最新版後面」，不会冲突
"""

import datetime
import json
import os

PENDING_PATH = os.path.join("papers", "pending_approval.json")
NEW_ITEMS_PATH = "new_pending_items.json"


def load_items():
    if not os.path.exists(PENDING_PATH):
        return []
    with open(PENDING_PATH, encoding="utf-8") as f:
        return json.load(f).get("items", [])


def append(items):
    with open(NEW_ITEMS_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False)
    _merge(items)


def _merge(items):
    pending = {"items": []}
    if os.path.exists(PENDING_PATH):
        with open(PENDING_PATH, encoding="utf-8") as f:
            pending = json.load(f)   # 坏掉就让它报错：不能拿空的盖掉还没审的题
    have = {i.get("id") for i in pending.setdefault("items", [])}
    pending["items"].extend(i for i in items if i.get("id") not in have)
    pending["generated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    os.makedirs(os.path.dirname(PENDING_PATH), exist_ok=True)
    with open(PENDING_PATH, "w", encoding="utf-8") as f:
        json.dump(pending, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    with open(NEW_ITEMS_PATH, encoding="utf-8") as f:
        _merge(json.load(f))
