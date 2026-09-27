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
