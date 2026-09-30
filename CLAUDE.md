# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## 5. 本项目：每次改动都要同步 docs/CUSTOMIZE.md

`docs/CUSTOMIZE.md` 是开发者「自己动手改」的索引（想改什么 → 档案 → 搜哪个名字 → 现在的值 → 🟢🟡🔴）。
每一次改动（功能、文字、流程、工作流程、素材），在交付前都要检查：

- **新增**了开发者可能想自己调的东西（数值、门槛、次数、时间、开关、文字、名称、排程）→ 在对应段落加一列
- **改到**已经列出的项目（值、档案、名字变了，或多了一处要一起改）→ 更新那一列
- 值**写死在程式中间、没有名字可搜** → 先抽成有名字、带注解的常数，再列进去（这份文件靠「搜名字」定位，不写行号）
- 改错会坏事的（例如两处要一起改、改了会影响学生已存的资料）→ 标 🔴 并写明原因
- 每个「搜这个名字」都要实际在那个档案里搜得到

交付时在回覆里说明这次动了 CUSTOMIZE.md 的哪几列；没有要加的也要说「这次没有新的可调项目」。

---

## 6. 本项目：有新功能就附「更新日志草稿」

网站有更新日志（工具列的「日志」，资料在 `data/devlog.json`）。发哪一篇、什么时候发，由使用者在 Actions 跑「发布更新日志」决定（填版本号＋内容）。
每次交付前判断：

- **有新功能**（学生看得到的新东西、新的操作方式）→ PR 说明最後附「更新日志草稿」：
  - 版本号：`data/devlog.json` 最新一版 +0.1；整个改版 +1
  - 内容：一行，每一点之间用 `||` 隔开；照学生看得懂的话写，不写档名、函式名
  - 使用者要能直接贴进工作流的两格
- **只是修错、改文字、调参数、内部重构**（没有新功能）→ 不用写，在回覆里说「这次不用发更新日志」
- 不要自己改 `data/devlog.json` 发新的一篇（使用者要求才改）
