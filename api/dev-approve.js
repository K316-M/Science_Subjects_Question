// 审题：把待审区（papers/pending_approval.json）里的题目采纳进正式题库，或直接退回。
// 这是整条流水线最後一哩 —— 在此之前，AI 产出的题目永远到不了学生手上。
// 采纳时可以顺便带上 /dev 编辑器里的修改（patch）与新配图，和题库、待审区一起一个 commit 写进去。
const { publishingConfig, verifySession, sendJson, readJsonBody, sameOrigin } = require('./_lib/devauth');
const { snapshot, readJson, commitFiles, sendError } = require('./_lib/github');
const {
  SUBJECTS, PENDING_PATH, bankPath, InputError, normalize, toBankEntry, applyPatch, decodeImage,
} = require('./_lib/questions');

module.exports = async (req, res) => {
  // =========================
  // 登录验证
  // =========================
  if (!verifySession(req)) {
    return sendJson(res, 401, {
      ok: false,
      error: 'unauthenticated',
      message: '请先登录开发者工作台',
    });
  }

  if (req.method !== 'POST') {
    return sendJson(
      res,
      405,
      {
        ok: false,
        error: 'method_not_allowed',
      },
      {
        Allow: 'POST',
      }
    );
  }

  if (!sameOrigin(req)) {
    return sendJson(res, 403, {
      ok: false,
      error: 'bad_origin',
    });
  }

  // =========================
  // GitHub 发布配置
  // =========================
  const pub = publishingConfig();

  if (!pub.token) {
    return sendJson(res, 501, {
      ok: false,
      error: 'publishing_not_configured',
      message:
        '尚未配置一键发布：请在 Vercel 环境变数里加入 GITHUB_TOKEN。',
    });
  }

  try {
    const body = await readJsonBody(req);

    const action =
      body.action === 'reject'
        ? 'reject'
        : 'adopt';

    // =========================
    // 读取待审区
    // =========================
    const snap = await snapshot(pub);
    const writes = [];
    const pendingJson = await readJson(pub, snap, PENDING_PATH);

    const items =
      pendingJson &&
      Array.isArray(pendingJson.items)
        ? pendingJson.items
        : [];

    if (!items.length) {
      throw new InputError('待审区目前是空的。');
    }

    // =========================
    // 取得本次请求要处理的题目
    // =========================
    const requested =
      action === 'adopt'
        ? Array.isArray(body.items)
          ? body.items
          : []
        : Array.isArray(body.ids)
          ? body.ids.map(id => ({ id }))
          : [];

    if (!requested.length) {
      throw new InputError(
        '没有指定要处理的题目。'
      );
    }

    // =========================
    // 建立 ID 索引
    // =========================
    const byId = new Map(
      items.map(it => [it.id, it])
    );

    const handled = [];
    const handledSet = new Set();

    const skipped = [];
    const skippedSet = new Set();

    function markHandled(id) {
      if (!handledSet.has(id)) {
        handledSet.add(id);
        handled.push(id);
      }
    }

    function markSkipped(id, why) {
      if (!skippedSet.has(id)) {
        skippedSet.add(id);
        skipped.push({
          id,
          why,
        });
      }
    }

    // ============================================================
    // 采纳题目
    // ============================================================
    if (action === 'adopt') {
      // ----------------------------------------------------------
      // 同一次请求中，同一个 ID 只处理一次
      // ----------------------------------------------------------
      const uniqueRequested = [];
      const requestedIds = new Set();

      for (const ask of requested) {
        if (requestedIds.has(ask.id)) {
          continue;
        }

        requestedIds.add(ask.id);
        uniqueRequested.push(ask);
      }

      // ----------------------------------------------------------
      // 按科目分组
      // 每个科目的题库只读取 / 写入一次
      // ----------------------------------------------------------
      const groups = new Map();

      for (const ask of uniqueRequested) {
        const item = byId.get(ask.id);

        if (!item) {
          markSkipped(
            ask.id,
            '待审区里找不到这一题'
          );
          continue;
        }

        const subject = SUBJECTS.includes(
          item.subject
        )
          ? item.subject
          : null;

        if (!subject) {
          markSkipped(
            ask.id,
            '科目不明'
          );
          continue;
        }

        if (!groups.has(subject)) {
          groups.set(subject, []);
        }

        groups.get(subject).push({
          ask,
          item,
          chapterId: String(
            ask.chapterId ||
            item.chapter_id ||
            ''
          ),
        });
      }

      // ----------------------------------------------------------
      // 逐科目处理
      // ----------------------------------------------------------
      for (const [subject, rows] of groups) {
        const bankJson = await readJson(
          pub,
          snap,
          bankPath(subject)
        );

        if (
          !bankJson ||
          !Array.isArray(bankJson.sections)
        ) {
          rows.forEach(r =>
            markSkipped(
              r.item.id,
              `${subject} 的题库读不到或格式不对`
            )
          );

          continue;
        }

        const sections = bankJson.sections;
        let changed = 0;

        // --------------------------------------------------------
        // 逐题处理
        // --------------------------------------------------------
        for (const {
          ask,
          item,
          chapterId,
        } of rows) {
          // 找目标章节
          const section = sections.find(
            s => s.id === chapterId
          );

          if (!section) {
            markSkipped(
              item.id,
              '找不到对应章节，请先在下拉选单指定'
            );
            continue;
          }

          // ------------------------------------------------------
          // 数据验证
          // ------------------------------------------------------
          let entry;
          let image = null;

          try {
            // 编辑器里的修改与新配图，先套上去再验证
            const edited = applyPatch(item, ask.patch);
            if (ask.image) {
              image = decodeImage(subject, item.id, ask.image);
              edited.image = image.ref;
            }
            entry = toBankEntry(edited);
          } catch (e) {
            if (!(e instanceof InputError)) throw e;
            markSkipped(
              item.id,
              e.message
            );
            continue;
          }

          // ------------------------------------------------------
          // 取得目标题型列表
          // ------------------------------------------------------
          const list =
            item.type === 'subjective'
              ? (section.subjectives =
                  section.subjectives || [])
              : (section.mcqs =
                  section.mcqs || []);

          // ------------------------------------------------------
          // 题干标准化
          // ------------------------------------------------------
          const key = normalize(
            entry.q || entry.question
          );

          // ------------------------------------------------------
          // 目标章节已经存在相同题目
          //
          // 这是幂等情况：
          // 说明之前可能已经成功写入题库，
          // 但 pending 区没有及时移除。
          // 因此可以安全地从 pending 移除。
          // ------------------------------------------------------
          if (
            list.some(
              x =>
                normalize(
                  x.q || x.question
                ) === key
            )
          ) {
            markHandled(item.id);
            continue;
          }

          // ------------------------------------------------------
          // 检查其他章节是否已经有相同题目
          //
          // 不能因为管理员选择了错误章节，
          // 就把同一道题复制到多个章节。
          //
          // 与目标章节重复：
          //   → 幂等成功
          //
          // 与其他章节重复：
          //   → 跳过
          //   → 保留 pending
          //   → 让管理员人工决定章节归属
          // ------------------------------------------------------
          const duplicateElsewhere =
            sections.some(s => {
              if (s.id === section.id) {
                return false;
              }

              const otherList =
                item.type === 'subjective'
                  ? Array.isArray(
                      s.subjectives
                    )
                    ? s.subjectives
                    : []
                  : Array.isArray(s.mcqs)
                    ? s.mcqs
                    : [];

              return otherList.some(
                x =>
                  normalize(
                    x.q || x.question
                  ) === key
              );
            });

          if (duplicateElsewhere) {
            markSkipped(
              item.id,
              '正式题库其他章节已有相同题干，请人工确认章节归属'
            );
            continue;
          }

          // ------------------------------------------------------
          // 再检查一次目标列表
          //
          // 防止同一批次中不同 pending ID
          // 带着完全相同的题目进入同一章节。
          // ------------------------------------------------------
          if (
            list.some(
              x =>
                normalize(
                  x.q || x.question
                ) === key
            )
          ) {
            markHandled(item.id);
            continue;
          }

          // ------------------------------------------------------
          // 正式写入
          // ------------------------------------------------------
          list.push(entry);
          if (image) {
            writes.push({ path: image.path, base64: image.base64 });
          }

          markHandled(item.id);
          changed += 1;
        }

        // --------------------------------------------------------
        // 该科目有新增题目才写回 GitHub
        // --------------------------------------------------------
        if (changed) {
          writes.push({
            path: bankPath(subject),
            json: bankJson,
          });
        }
      }
    } else {
      // ==========================================================
      // 退回题目
      // ==========================================================
      const uniqueIds = new Set();

      requested.forEach(ask => {
        if (uniqueIds.has(ask.id)) {
          return;
        }

        uniqueIds.add(ask.id);

        if (byId.has(ask.id)) {
          markHandled(ask.id);
        } else {
          markSkipped(
            ask.id,
            '待审区里找不到这一题'
          );
        }
      });
    }

    // ============================================================
    // 从 pending 区移除已经处理成功的题目
    // ============================================================
    if (handled.length) {
      // 题库、配图、待审区在同一个 commit 里：要嘛全部写进去，要嘛都没写。
      const keep = items.filter(
        it => !handledSet.has(it.id)
      );

      writes.push({
        path: PENDING_PATH,
        json: {
          ...pendingJson,
          items: keep,
        },
      });

      await commitFiles(
        pub,
        snap,
        writes,
        action === 'adopt'
          ? `📥 采纳 ${handled.length} 道题目进题库`
          : `🗑️ 退回 ${handled.length} 道待审题目`
      );
    }

    // ============================================================
    // 返回结果
    // ============================================================
    return sendJson(res, 200, {
      ok: true,
      action,
      handled: handled.length,
      skipped,
    });
  } catch (err) {
    return sendError(res, err, 'dev-approve');
  }
};
